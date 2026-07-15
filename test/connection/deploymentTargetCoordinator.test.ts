import { describe, expect, it, vi } from "vitest";
import type { CloudflareAccount } from "../../src/cloudflare/client.js";
import {
  DeploymentTargetCoordinator,
  type DeploymentTargetSelector,
} from "../../src/connection/deploymentTargetCoordinator.js";
import type { WorkspaceDeploymentTarget } from "../../src/connection/deploymentTargetStore.js";

const ACCOUNT: CloudflareAccount = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Example account",
};
const TARGET: WorkspaceDeploymentTarget = {
  accountId: ACCOUNT.id,
  repositoryCanonicalName: "cloudflare/workers-sdk",
  triggers: [{ environment: "production", id: "trigger-id", name: "Production" }],
  worker: { name: "api-worker", tag: "worker-tag" },
};

// Inference preserves Vitest mock methods across the test harness.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createHarness(workspacePath: string | undefined) {
  const getToken = vi.fn<() => Promise<string | undefined>>(() =>
    Promise.resolve("opaque-token"),
  );
  const createSelector = vi.fn(
    (): DeploymentTargetSelector => ({ select: () => Promise.resolve({ kind: "notFound" }) }),
  );
  const showFailure = vi.fn(() => Promise.resolve());
  const showNotFound = vi.fn(() =>
    Promise.resolve<"retry" | undefined>(undefined),
  );
  const targetSelected = vi.fn();
  const coordinator = new DeploymentTargetCoordinator({
    createSelector,
    getAccount: (): CloudflareAccount => ACCOUNT,
    getToken,
    messages: { showFailure, showNotFound },
    targetSelected,
    workspacePath: (): string | undefined => workspacePath,
  });
  return {
    coordinator,
    createSelector,
    getToken,
    showFailure,
    showNotFound,
    targetSelected,
  };
}

describe("DeploymentTargetCoordinator", () => {
  it("does not retrieve credentials or create a selector outside one trusted workspace seam", async () => {
    const harness = createHarness(undefined);

    await harness.coordinator.select();

    expect(harness.getToken).not.toHaveBeenCalled();
    expect(harness.createSelector).not.toHaveBeenCalled();
    expect(harness.showFailure).toHaveBeenCalledWith("workspace");
  });

  it("reports a missing connection without creating a process-backed selector", async () => {
    const harness = createHarness("/workspace");
    harness.getToken.mockResolvedValue(undefined);

    await harness.coordinator.select();

    expect(harness.createSelector).not.toHaveBeenCalled();
    expect(harness.showFailure).toHaveBeenCalledWith("connection");
  });

  it("projects a selected target and never handles raw failures", async () => {
    const harness = createHarness("/workspace");
    harness.createSelector.mockReturnValue({
      select: () => Promise.resolve({ kind: "selected", target: TARGET }),
    });

    await harness.coordinator.select();

    expect(harness.targetSelected).toHaveBeenCalledWith(TARGET);
    expect(harness.showFailure).not.toHaveBeenCalled();
  });

  it("retries after a no-match prompt without re-entering the command", async () => {
    const harness = createHarness("/workspace");
    harness.showNotFound.mockResolvedValueOnce("retry");
    harness.createSelector
      .mockReturnValueOnce({
        select: () => Promise.resolve({ kind: "notFound" }),
      })
      .mockReturnValueOnce({
        select: () => Promise.resolve({ kind: "selected", target: TARGET }),
      });

    await harness.coordinator.select();

    expect(harness.createSelector).toHaveBeenCalledTimes(2);
    expect(harness.targetSelected).toHaveBeenCalledWith(TARGET);
  });

  it("coalesces overlapping selection commands", async () => {
    let resolveSelection: ((value: { readonly kind: "notFound" }) => void) | undefined;
    const selection = new Promise<{ readonly kind: "notFound" }>((resolve) => {
      resolveSelection = resolve;
    });
    const harness = createHarness("/workspace");
    harness.createSelector.mockReturnValue({ select: () => selection });

    const first = harness.coordinator.select();
    const second = harness.coordinator.select();
    resolveSelection?.({ kind: "notFound" });
    await Promise.all([first, second]);

    expect(harness.createSelector).toHaveBeenCalledOnce();
    expect(harness.showNotFound).toHaveBeenCalledOnce();
  });
});
