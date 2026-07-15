import { CloudflareApiError } from "../cloudflare/apiError.js";
import type { BuildTrigger, WorkerRef } from "../cloudflare/client.js";
import {
  parseGitHubNameWithOwner,
  type GitHubRepositoryIdentity,
} from "../git/repositoryIdentity.js";

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const MAX_TRIGGER_CONCURRENCY = 4;

export interface CloudflareDiscoveryClient {
  listTriggers(accountId: string, workerTag: string): Promise<readonly BuildTrigger[]>;
  listWorkers(accountId: string): Promise<readonly WorkerRef[]>;
}

export interface DeploymentTargetCandidate {
  readonly triggers: readonly BuildTrigger[];
  readonly worker: WorkerRef;
}

export class DeploymentTargetDiscovery {
  readonly #client: CloudflareDiscoveryClient;

  public constructor(client: CloudflareDiscoveryClient) {
    this.#client = client;
  }

  public async discover(
    accountId: string,
    repository: GitHubRepositoryIdentity,
  ): Promise<DeploymentTargetCandidate[]> {
    assertDiscoveryInput(accountId, repository);
    const workers = sortWorkers(await this.#listWorkers(accountId));
    const candidates = await mapWithConcurrency(
      workers,
      MAX_TRIGGER_CONCURRENCY,
      async (worker): Promise<DeploymentTargetCandidate | undefined> => {
        const triggers = await this.#listTriggers(accountId, worker.tag);
        const matchingTriggers = triggers.filter(
          (trigger) => trigger.repositoryCanonicalName === repository.canonicalName,
        );
        return matchingTriggers.length === 0
          ? undefined
          : { triggers: sortTriggers(matchingTriggers), worker };
      },
    );

    return candidates.filter(
      (candidate): candidate is DeploymentTargetCandidate => candidate !== undefined,
    );
  }

  async #listWorkers(accountId: string): Promise<readonly WorkerRef[]> {
    try {
      const workers: unknown = await this.#client.listWorkers(accountId);
      if (!isWorkerList(workers)) {
        throw new CloudflareApiError("invalidResponse");
      }
      return workers;
    } catch (error) {
      throw safeDomainError(error);
    }
  }

  async #listTriggers(
    accountId: string,
    workerTag: string,
  ): Promise<readonly BuildTrigger[]> {
    try {
      const triggers: unknown = await this.#client.listTriggers(accountId, workerTag);
      if (!isTriggerList(triggers, workerTag)) {
        throw new CloudflareApiError("invalidResponse");
      }
      return triggers;
    } catch (error) {
      throw safeDomainError(error);
    }
  }
}

function assertDiscoveryInput(
  accountId: string,
  repository: GitHubRepositoryIdentity,
): void {
  if (!ACCOUNT_ID.test(accountId)) {
    throw new CloudflareApiError("invalidResponse");
  }
  if (!hasCanonicalGitHubName(repository)) {
    throw new CloudflareApiError("invalidResponse");
  }
}

function hasCanonicalGitHubName(value: unknown): boolean {
  if (!isRecord(value) || value.provider !== "github" || typeof value.canonicalName !== "string") {
    return false;
  }
  const parsed = parseGitHubNameWithOwner(value.canonicalName);
  return parsed !== undefined && parsed.canonicalName === value.canonicalName;
}

function isWorkerList(value: unknown): value is WorkerRef[] {
  return (
    Array.isArray(value) &&
    value.every(isWorker) &&
    hasUniqueStringProperty(value, "tag")
  );
}

function isWorker(value: unknown): value is WorkerRef {
  return (
    isRecord(value) &&
    isSafeString(value.name) &&
    typeof value.tag === "string" &&
    ACCOUNT_ID.test(value.tag)
  );
}

function isTriggerList(value: unknown, workerTag: string): value is BuildTrigger[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every((trigger) => isTrigger(trigger, workerTag)) &&
    hasUniqueStringProperty(value, "id") &&
    hasUniqueStringProperty(value, "environment")
  );
}

function isTrigger(value: unknown, workerTag: string): value is BuildTrigger {
  if (!isRecord(value) || typeof value.repositoryCanonicalName !== "string") {
    return false;
  }
  const identity = parseGitHubNameWithOwner(value.repositoryCanonicalName);
  return (
    isSafeString(value.id) &&
    isSafeString(value.name) &&
    isSafeString(value.rootDirectory) &&
    value.workerTag === workerTag &&
    identity !== undefined &&
    identity.canonicalName === value.repositoryCanonicalName &&
    isBuildEnvironment(value.environment) &&
    isSafeStringArray(value.branchIncludes) &&
    isSafeStringArray(value.branchExcludes)
  );
}

function isBuildEnvironment(value: unknown): value is BuildTrigger["environment"] {
  return value === "production" || value === "preview";
}

function hasUniqueStringProperty(
  values: readonly unknown[],
  property: string,
): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value[property] !== "string" || seen.has(value[property])) {
      return false;
    }
    seen.add(value[property]);
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 255 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function isSafeStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(isSafeString);
}

function safeDomainError(error: unknown): CloudflareApiError {
  return error instanceof CloudflareApiError
    ? error
    : new CloudflareApiError("api");
}

function sortWorkers(workers: readonly WorkerRef[]): WorkerRef[] {
  return [...workers].sort(
    (left, right) => compareText(left.name, right.name) || compareText(left.tag, right.tag),
  );
}

function sortTriggers(triggers: readonly BuildTrigger[]): BuildTrigger[] {
  return [...triggers].sort(
    (left, right) =>
      compareEnvironment(left.environment, right.environment) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id),
  );
}

function compareEnvironment(
  left: BuildTrigger["environment"],
  right: BuildTrigger["environment"],
): number {
  if (left === right) {
    return 0;
  }
  return left === "production" ? -1 : 1;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Map<number, Result>();
  let nextIndex = 0;

  async function consume(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      const value = values[index];
      if (value === undefined) {
        throw new CloudflareApiError("invalidResponse");
      }
      results.set(index, await mapper(value));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => consume()),
  );
  return values.map((_, index) => {
    const result = results.get(index);
    if (result === undefined && !results.has(index)) {
      throw new CloudflareApiError("invalidResponse");
    }
    return result as Result;
  });
}
