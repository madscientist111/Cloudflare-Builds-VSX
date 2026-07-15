import { describe, expect, it } from "vitest";
import {
  DeploymentTargetStore,
  type WorkspaceDeploymentTarget,
} from "../../src/connection/deploymentTargetStore.js";

const PRODUCTION_TRIGGER = {
  environment: "production" as const,
  id: "production-trigger",
  name: "Production",
};
const PREVIEW_TRIGGER = {
  environment: "preview" as const,
  id: "preview-trigger",
  name: "Preview",
};
const TARGET: WorkspaceDeploymentTarget = {
  triggers: [PRODUCTION_TRIGGER, PREVIEW_TRIGGER],
  worker: { name: "api-worker", tag: "a".repeat(32) },
};

class MemoryMemento {
  public readonly values = new Map<string, unknown>();

  public get(key: string): unknown {
    return this.values.get(key);
  }

  public update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
    return Promise.resolve();
  }
}

describe("DeploymentTargetStore", () => {
  it("round-trips only an immutable domain-shaped deployment target", async () => {
    const state = new MemoryMemento();
    const store = new DeploymentTargetStore(state);

    await store.save(TARGET);

    const loaded = store.get();
    expect(loaded).toEqual(TARGET);
    expect(loaded).toBeDefined();
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.worker)).toBe(true);
    expect(Object.isFrozen(loaded?.triggers)).toBe(true);
    expect(Object.isFrozen(loaded?.triggers[0])).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { worker: TARGET.worker, triggers: "not-an-array" },
    { worker: { name: "../worker", tag: TARGET.worker.tag }, triggers: [] },
    { worker: { name: "api-worker", tag: "../tag" }, triggers: [] },
    {
      worker: TARGET.worker,
      triggers: [{ environment: "production", id: "trigger\nname", name: "Production" }],
    },
    {
      worker: TARGET.worker,
      triggers: [{ environment: "preview", id: "preview-trigger", name: "../Preview" }],
    },
    {
      worker: TARGET.worker,
      triggers: [{ environment: "preview", id: "preview-trigger", name: "\0" }],
    },
    {
      worker: TARGET.worker,
      triggers: [
        {
          environment: "production",
          id: "x".repeat(65),
          name: "Production",
        },
      ],
    },
  ])("rejects malformed or tampered persisted state: %j", (value: unknown) => {
    const state = new MemoryMemento();
    state.values.set("cloudflareBuilds.deploymentTarget", value);

    expect(new DeploymentTargetStore(state).get()).toBeUndefined();
  });

  it("strips extra runtime and secret properties when saving and loading", async () => {
    const state = new MemoryMemento();
    const store = new DeploymentTargetStore(state);
    const targetWithRuntimeData = {
      ...TARGET,
      environmentValues: { API_KEY: "must-not-persist" },
      token: "must-not-persist",
      triggers: TARGET.triggers.map((trigger) => ({
        ...trigger,
        buildToken: "must-not-persist",
        environmentValues: { SECRET: "must-not-persist" },
        logs: ["must-not-persist"],
        workerTag: TARGET.worker.tag,
      })),
      worker: { ...TARGET.worker, token: "must-not-persist" },
    };

    await store.save(targetWithRuntimeData);

    const persisted = JSON.stringify([...state.values.values()]);
    expect(persisted).not.toContain("must-not-persist");

    state.values.set("cloudflareBuilds.deploymentTarget", {
      ...targetWithRuntimeData,
      token: "tampered-token",
    });
    expect(store.get()).toEqual(TARGET);
    expect(JSON.stringify(store.get())).not.toContain("tampered-token");
  });

  it("enforces the production/preview trigger bound", async () => {
    const state = new MemoryMemento();
    const store = new DeploymentTargetStore(state);
    const thirdTrigger = {
      environment: "production" as const,
      id: "another-trigger",
      name: "Other",
    };

    await expect(
      store.save({ ...TARGET, triggers: [...TARGET.triggers, thirdTrigger] }),
    ).rejects.toThrow("Cannot store an invalid deployment target.");
    await expect(
      store.save({
        ...TARGET,
        triggers: [PRODUCTION_TRIGGER, thirdTrigger],
      }),
    ).rejects.toThrow("Cannot store an invalid deployment target.");

    state.values.set("cloudflareBuilds.deploymentTarget", {
      ...TARGET,
      triggers: [...TARGET.triggers, thirdTrigger],
    });
    expect(store.get()).toBeUndefined();
  });

  it("clears the deployment target", async () => {
    const state = new MemoryMemento();
    const store = new DeploymentTargetStore(state);
    await store.save(TARGET);

    await store.clear();

    expect(store.get()).toBeUndefined();
  });
});
