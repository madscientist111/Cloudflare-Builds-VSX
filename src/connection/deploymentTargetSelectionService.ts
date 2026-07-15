import type { CloudflareErrorKind } from "../cloudflare/apiError.js";
import type { CloudflareAccount } from "../cloudflare/client.js";
import type { DeploymentTargetCandidate } from "../discovery/deploymentTargetDiscovery.js";
import type { GitHubRepositoryIdentity } from "../git/repositoryIdentity.js";
import type { WorkspaceDeploymentTarget } from "./deploymentTargetStore.js";

/** Boundary for finding the canonical repository associated with this workspace. */
export interface RepositoryIdentityResolverPort {
  resolve(): Promise<GitHubRepositoryIdentity>;
}

/** Boundary for finding Cloudflare deployment targets for a repository. */
export interface DeploymentTargetDiscoveryPort {
  discover(
    accountId: string,
    repository: GitHubRepositoryIdentity,
  ): Promise<readonly DeploymentTargetCandidate[]>;
}

/** Boundary for storing the selected workspace deployment target. */
export interface DeploymentTargetStorePort {
  save(target: WorkspaceDeploymentTarget): Promise<void>;
}

/** Boundary for asking a host application to select one of several targets. */
export interface DeploymentTargetSelectionPromptPort {
  pickDeploymentTarget(
    candidates: readonly DeploymentTargetCandidate[],
  ): Promise<DeploymentTargetCandidate | undefined>;
}

export type DeploymentTargetSelectionFailure =
  | "api"
  | "authentication"
  | "invalidResponse"
  | "network"
  | "permission"
  | "prompt"
  | "rateLimit"
  | "repository"
  | "storage";

export type DeploymentTargetSelectionOutcome =
  | {
      readonly kind: "cancelled";
    }
  | {
      readonly failure: DeploymentTargetSelectionFailure;
      readonly kind: "failed";
    }
  | {
      readonly kind: "notFound";
    }
  | {
      readonly kind: "selected";
      readonly target: WorkspaceDeploymentTarget;
    };

/**
 * Resolves and persists the deployment target for one connected Cloudflare account.
 *
 * This service deliberately exposes only small, host-neutral ports. UI adapters own
 * rendering the picker and the store owns persistence validation.
 */
export class DeploymentTargetSelectionService {
  readonly #account: CloudflareAccount;
  readonly #discovery: DeploymentTargetDiscoveryPort;
  readonly #prompts: DeploymentTargetSelectionPromptPort;
  readonly #repositoryResolver: RepositoryIdentityResolverPort;
  readonly #store: DeploymentTargetStorePort;

  public constructor(options: {
    readonly account: CloudflareAccount;
    readonly discovery: DeploymentTargetDiscoveryPort;
    readonly prompts: DeploymentTargetSelectionPromptPort;
    readonly repositoryResolver: RepositoryIdentityResolverPort;
    readonly store: DeploymentTargetStorePort;
  }) {
    this.#account = options.account;
    this.#discovery = options.discovery;
    this.#prompts = options.prompts;
    this.#repositoryResolver = options.repositoryResolver;
    this.#store = options.store;
  }

  public async select(): Promise<DeploymentTargetSelectionOutcome> {
    const repository = await this.#resolveRepository();
    if (repository === undefined) {
      return { failure: "repository", kind: "failed" };
    }

    const candidates = await this.#discover(repository);
    if (candidates instanceof SelectionFailure) {
      return { failure: candidates.failure, kind: "failed" };
    }
    if (candidates.length === 0) {
      return { kind: "notFound" };
    }

    const candidate = await this.#selectCandidate(candidates);
    if (candidate === undefined) {
      return { kind: "cancelled" };
    }
    if (candidate instanceof SelectionFailure) {
      return { failure: candidate.failure, kind: "failed" };
    }

    let target: WorkspaceDeploymentTarget;
    try {
      target = toWorkspaceTarget(this.#account, repository, candidate);
    } catch {
      return { failure: "api", kind: "failed" };
    }

    try {
      await this.#store.save(target);
    } catch {
      return { failure: "storage", kind: "failed" };
    }
    return { kind: "selected", target };
  }

  async #resolveRepository(): Promise<GitHubRepositoryIdentity | undefined> {
    try {
      return await this.#repositoryResolver.resolve();
    } catch {
      return undefined;
    }
  }

  async #discover(
    repository: GitHubRepositoryIdentity,
  ): Promise<readonly DeploymentTargetCandidate[] | SelectionFailure> {
    try {
      return await this.#discovery.discover(this.#account.id, repository);
    } catch (error) {
      return new SelectionFailure(toDiscoveryFailure(error));
    }
  }

  async #selectCandidate(
    candidates: readonly DeploymentTargetCandidate[],
  ): Promise<DeploymentTargetCandidate | SelectionFailure | undefined> {
    if (candidates.length === 1) {
      return candidates[0];
    }

    try {
      const selected = await this.#prompts.pickDeploymentTarget(candidates);
      if (selected === undefined) {
        return undefined;
      }
      return candidates.includes(selected)
        ? selected
        : new SelectionFailure("prompt");
    } catch {
      return new SelectionFailure("prompt");
    }
  }
}

class SelectionFailure {
  public readonly failure: DeploymentTargetSelectionFailure;

  public constructor(failure: DeploymentTargetSelectionFailure) {
    this.failure = failure;
  }
}

function toWorkspaceTarget(
  account: CloudflareAccount,
  repository: GitHubRepositoryIdentity,
  candidate: DeploymentTargetCandidate,
): WorkspaceDeploymentTarget {
  return {
    accountId: account.id,
    repositoryCanonicalName: repository.canonicalName,
    triggers: candidate.triggers.map((trigger) => ({
      environment: trigger.environment,
      id: trigger.id,
      name: trigger.name,
    })),
    worker: {
      name: candidate.worker.name,
      tag: candidate.worker.tag,
    },
  };
}

function toDiscoveryFailure(error: unknown): DeploymentTargetSelectionFailure {
  return isCloudflareError(error) ? error.kind : "api";
}

function isCloudflareError(
  error: unknown,
): error is { readonly kind: CloudflareErrorKind } {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    isCloudflareErrorKind(error.kind)
  );
}

function isCloudflareErrorKind(value: unknown): value is CloudflareErrorKind {
  return (
    value === "api" ||
    value === "authentication" ||
    value === "invalidResponse" ||
    value === "network" ||
    value === "permission" ||
    value === "rateLimit"
  );
}
