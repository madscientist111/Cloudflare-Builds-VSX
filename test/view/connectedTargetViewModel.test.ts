import { describe, expect, it } from "vitest";
import type { CloudflareAccount } from "../../src/cloudflare/client.js";
import type { WorkspaceDeploymentTarget } from "../../src/connection/deploymentTargetStore.js";
import {
  createConnectedTargetViewModel,
  type ConnectedTargetTreeNode,
  type RepositoryTreeNode,
  type TriggerTreeNode,
  type WorkerTreeNode,
} from "../../src/view/connectedTargetViewModel.js";

const ACCOUNT: CloudflareAccount = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Example account",
};

const TARGET: WorkspaceDeploymentTarget = {
  accountId: ACCOUNT.id,
  repositoryCanonicalName: "cloudflare/workers-sdk",
  triggers: [
    { environment: "production", id: "production-trigger-id", name: "Production" },
    { environment: "preview", id: "preview-trigger-id", name: "Preview" },
  ],
  worker: { name: "api-worker", tag: "worker-tag-that-must-not-be-displayed" },
};

function selectedNodes(viewModel: ReturnType<typeof createConnectedTargetViewModel>): {
  readonly repository: RepositoryTreeNode;
  readonly worker: WorkerTreeNode;
  readonly triggers: readonly TriggerTreeNode[];
} {
  if (viewModel === undefined) {
    throw new Error("Expected a connected account.");
  }
  const repository = viewModel.children[0];
  const worker = repository?.children[0];
  if (
    repository?.kind !== "repository" ||
    worker?.kind !== "worker" ||
    !worker.children.every((node) => node.kind === "trigger")
  ) {
    throw new Error("Expected a selected deployment target.");
  }
  return { repository, triggers: worker.children, worker };
}

function displayText(viewModel: NonNullable<ReturnType<typeof createConnectedTargetViewModel>>): string[] {
  const values: string[] = [];
  function visit(node: ConnectedTargetTreeNode): void {
    values.push(node.label, node.tooltip);
    for (const child of node.children) {
      visit(child);
    }
  }
  visit(viewModel);
  return values;
}

describe("createConnectedTargetViewModel", () => {
  it("represents an account without a selected target cleanly", () => {
    const viewModel = createConnectedTargetViewModel(ACCOUNT, undefined);

    expect(viewModel).toEqual({
      children: [],
      id: "cloudflareBuilds.connectedTarget.account",
      kind: "account",
      label: "Example account",
      tooltip: "Connected Cloudflare account: Example account",
    });
  });

  it("projects an account and its selected canonical repository, Worker, and triggers", () => {
    const viewModel = createConnectedTargetViewModel(ACCOUNT, TARGET);

    expect(viewModel).toEqual({
      children: [
        {
          children: [
            {
              children: [
                {
                  children: [],
                  environment: "production",
                  id: "cloudflareBuilds.connectedTarget.trigger.production",
                  kind: "trigger",
                  label: "Production: Production",
                  tooltip: "Production build trigger: Production",
                },
                {
                  children: [],
                  environment: "preview",
                  id: "cloudflareBuilds.connectedTarget.trigger.preview",
                  kind: "trigger",
                  label: "Preview: Preview",
                  tooltip: "Preview build trigger: Preview",
                },
              ],
              id: "cloudflareBuilds.connectedTarget.worker",
              kind: "worker",
              label: "api-worker",
              tooltip: "Cloudflare Worker: api-worker",
            },
          ],
          id: "cloudflareBuilds.connectedTarget.repository",
          kind: "repository",
          label: "cloudflare/workers-sdk",
          tooltip: "GitHub repository: cloudflare/workers-sdk",
        },
      ],
      id: "cloudflareBuilds.connectedTarget.account",
      kind: "account",
      label: "Example account",
      tooltip: "Connected Cloudflare account: Example account",
    });
  });

  it("orders production before preview regardless of input order", () => {
    const viewModel = createConnectedTargetViewModel(ACCOUNT, {
      ...TARGET,
      triggers: [...TARGET.triggers].reverse(),
    });

    expect(selectedNodes(viewModel).triggers.map((trigger) => trigger.environment)).toEqual([
      "production",
      "preview",
    ]);
  });

  it("returns a deeply immutable tree", () => {
    const viewModel = createConnectedTargetViewModel(ACCOUNT, TARGET);
    const { repository, worker, triggers } = selectedNodes(viewModel);

    expect(Object.isFrozen(viewModel)).toBe(true);
    expect(Object.isFrozen(viewModel?.children)).toBe(true);
    expect(Object.isFrozen(repository)).toBe(true);
    expect(Object.isFrozen(repository.children)).toBe(true);
    expect(Object.isFrozen(worker)).toBe(true);
    expect(Object.isFrozen(worker.children)).toBe(true);
    expect(Object.isFrozen(triggers[0])).toBe(true);
    expect(Object.isFrozen(triggers)).toBe(true);
  });

  it("does not disclose identifiers, secrets, or unmodeled payload data", () => {
    const secret = "must-not-appear";
    const account = { ...ACCOUNT, token: secret };
    const target = {
      ...TARGET,
      environmentValues: { API_KEY: secret },
      logs: [secret],
      rawPayload: { token: secret },
      triggers: TARGET.triggers.map((trigger) => ({
        ...trigger,
        buildToken: secret,
        environmentValues: { SECRET: secret },
        logs: [secret],
      })),
      worker: { ...TARGET.worker, token: secret },
    };

    const serialized = JSON.stringify(createConnectedTargetViewModel(account, target));

    for (const forbidden of [
      ACCOUNT.id,
      TARGET.worker.tag,
      TARGET.triggers[0]?.id,
      TARGET.triggers[1]?.id,
      secret,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("sanitizes hostile display text and bounds its length", () => {
    const hostile = `\u0000 visible\u202E ${"x".repeat(300)}`;
    const viewModel = createConnectedTargetViewModel(
      { ...ACCOUNT, name: hostile },
      {
        ...TARGET,
        triggers: TARGET.triggers.map((trigger) => ({ ...trigger, name: hostile })),
        worker: { ...TARGET.worker, name: hostile },
      },
    );

    if (viewModel === undefined) {
      throw new Error("Expected a connected account.");
    }
    for (const value of displayText(viewModel)) {
      expect(value).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(Array.from(value).length).toBeLessThanOrEqual(120);
    }
  });
});
