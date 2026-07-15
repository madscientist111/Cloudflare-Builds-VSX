import type { BuildTrigger, WorkerRef } from "../cloudflare/client.js";
import { parseGitHubNameWithOwner } from "../git/repositoryIdentity.js";

const DEPLOYMENT_TARGET_KEY = "cloudflareBuilds.deploymentTarget";
const MAX_TRIGGER_COUNT = 2;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_WORKER_NAME_LENGTH = 255;
const MAX_TRIGGER_NAME_LENGTH = 255;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export interface MementoPort {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export type DeploymentTargetTrigger = Pick<
  BuildTrigger,
  "environment" | "id" | "name"
>;

export interface WorkspaceDeploymentTarget {
  readonly accountId: string;
  readonly repositoryCanonicalName: string;
  readonly triggers: readonly DeploymentTargetTrigger[];
  readonly worker: WorkerRef;
}

interface PersistedDeploymentTarget {
  readonly accountId: string;
  readonly repositoryCanonicalName: string;
  readonly triggers: readonly DeploymentTargetTrigger[];
  readonly worker: WorkerRef;
}

/** Stores the non-secret Worker/trigger selection for the current workspace. */
export class DeploymentTargetStore {
  readonly #state: MementoPort;

  public constructor(state: MementoPort) {
    this.#state = state;
  }

  public async clear(): Promise<void> {
    await this.#state.update(DEPLOYMENT_TARGET_KEY, undefined);
  }

  public get(): WorkspaceDeploymentTarget | undefined {
    return parseDeploymentTarget(this.#state.get(DEPLOYMENT_TARGET_KEY));
  }

  public async save(target: WorkspaceDeploymentTarget): Promise<void> {
    const parsed = parseDeploymentTarget(target);
    if (parsed === undefined) {
      throw new Error("Cannot store an invalid deployment target.");
    }

    await this.#state.update(DEPLOYMENT_TARGET_KEY, toPersistedTarget(parsed));
  }
}

function parseDeploymentTarget(value: unknown): WorkspaceDeploymentTarget | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.triggers) ||
    !isSafeIdentifier(value.accountId, MAX_IDENTIFIER_LENGTH) ||
    !isCanonicalRepository(value.repositoryCanonicalName)
  ) {
    return undefined;
  }

  const worker = parseWorker(value.worker);
  if (
    worker === undefined ||
    value.triggers.length === 0 ||
    value.triggers.length > MAX_TRIGGER_COUNT
  ) {
    return undefined;
  }

  const triggers: DeploymentTargetTrigger[] = [];
  const environments = new Set<DeploymentTargetTrigger["environment"]>();
  for (const triggerValue of value.triggers) {
    const trigger = parseTrigger(triggerValue);
    if (trigger === undefined || environments.has(trigger.environment)) {
      return undefined;
    }
    environments.add(trigger.environment);
    triggers.push(trigger);
  }

  return Object.freeze({
    accountId: value.accountId,
    repositoryCanonicalName: value.repositoryCanonicalName,
    triggers: Object.freeze(triggers),
    worker,
  });
}

function parseWorker(value: unknown): WorkerRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    !isSafeIdentifier(value.name, MAX_WORKER_NAME_LENGTH) ||
    !isSafeIdentifier(value.tag, MAX_IDENTIFIER_LENGTH)
  ) {
    return undefined;
  }

  return Object.freeze({ name: value.name, tag: value.tag });
}

function parseTrigger(value: unknown): DeploymentTargetTrigger | undefined {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(value.id, MAX_IDENTIFIER_LENGTH) ||
    !isSafeName(value.name, MAX_TRIGGER_NAME_LENGTH) ||
    (value.environment !== "preview" && value.environment !== "production")
  ) {
    return undefined;
  }

  return Object.freeze({
    environment: value.environment,
    id: value.id,
    name: value.name,
  });
}

function isSafeIdentifier(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    SAFE_IDENTIFIER.test(value)
  );
}

function isSafeName(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !hasControlCharacter(value)
  );
}

function isCanonicalRepository(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const identity = parseGitHubNameWithOwner(value);
  return identity !== undefined && identity.canonicalName === value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function toPersistedTarget(target: WorkspaceDeploymentTarget): PersistedDeploymentTarget {
  return {
    accountId: target.accountId,
    repositoryCanonicalName: target.repositoryCanonicalName,
    triggers: target.triggers.map((trigger) => ({
      environment: trigger.environment,
      id: trigger.id,
      name: trigger.name,
    })),
    worker: {
      name: target.worker.name,
      tag: target.worker.tag,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
