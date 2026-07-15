import type { CloudflareAccount } from "../cloudflare/client.js";
import type {
  DeploymentTargetSelectionFailure,
  DeploymentTargetSelectionOutcome,
} from "./deploymentTargetSelectionService.js";
import type { WorkspaceDeploymentTarget } from "./deploymentTargetStore.js";

export type TargetSelectionCoordinatorFailure =
  | DeploymentTargetSelectionFailure
  | "connection"
  | "workspace";

export interface DeploymentTargetSelector {
  select(): Promise<DeploymentTargetSelectionOutcome>;
}

/**
 * Coordinates an explicit target selection without allowing host-specific
 * workspace checks to leak into process or Cloudflare adapters.
 */
export class DeploymentTargetCoordinator {
  readonly #createSelector: (
    account: CloudflareAccount,
    token: string,
    workspacePath: string,
  ) => DeploymentTargetSelector;
  readonly #getAccount: () => CloudflareAccount | undefined;
  readonly #getToken: () => Promise<string | undefined>;
  readonly #messages: {
    showFailure(failure: TargetSelectionCoordinatorFailure): Promise<void>;
    showNotFound(): Promise<"retry" | undefined>;
  };
  readonly #targetSelected: (target: WorkspaceDeploymentTarget) => void;
  readonly #workspacePath: () => string | undefined;
  #disposed = false;
  #selection: Promise<void> | undefined;

  public constructor(options: {
    readonly createSelector: (
      account: CloudflareAccount,
      token: string,
      workspacePath: string,
    ) => DeploymentTargetSelector;
    readonly getAccount: () => CloudflareAccount | undefined;
    readonly getToken: () => Promise<string | undefined>;
    readonly messages: {
      showFailure(failure: TargetSelectionCoordinatorFailure): Promise<void>;
      showNotFound(): Promise<"retry" | undefined>;
    };
    readonly targetSelected: (target: WorkspaceDeploymentTarget) => void;
    readonly workspacePath: () => string | undefined;
  }) {
    this.#createSelector = options.createSelector;
    this.#getAccount = options.getAccount;
    this.#getToken = options.getToken;
    this.#messages = options.messages;
    this.#targetSelected = options.targetSelected;
    this.#workspacePath = options.workspacePath;
  }

  public dispose(): void {
    this.#disposed = true;
  }

  public async select(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    if (this.#selection !== undefined) {
      await this.#selection;
      return;
    }

    const selection = this.#selectOnce();
    this.#selection = selection;
    try {
      await selection;
    } finally {
      if (this.#selection === selection) {
        this.#selection = undefined;
      }
    }
  }

  async #selectOnce(): Promise<void> {
    const workspacePath = this.#workspacePath();
    if (workspacePath === undefined) {
      await this.#messages.showFailure("workspace");
      return;
    }

    const account = this.#getAccount();
    const token = await this.#getToken();
    if (this.#disposed) {
      return;
    }
    if (account === undefined || token === undefined || token.trim().length === 0) {
      await this.#messages.showFailure("connection");
      return;
    }

    let outcome: DeploymentTargetSelectionOutcome;
    try {
      outcome = await this.#createSelector(account, token, workspacePath).select();
    } catch {
      await this.#messages.showFailure("api");
      return;
    }

    if (this.#isDisposed()) {
      return;
    }
    if (outcome.kind === "selected") {
      this.#targetSelected(outcome.target);
      return;
    }
    if (outcome.kind === "notFound") {
      const action = await this.#messages.showNotFound();
      if (action === "retry" && !this.#isDisposed()) {
        await this.#selectOnce();
      }
      return;
    }
    if (outcome.kind === "failed") {
      await this.#messages.showFailure(outcome.failure);
    }
  }

  #isDisposed(): boolean {
    return this.#disposed;
  }
}
