import { describe, expect, it } from "vitest";
import { ConnectionStore } from "../../src/connection/connectionStore.js";

const ACCOUNT = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Example account",
};

class MemoryWorkspaceState {
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

describe("ConnectionStore", () => {
  it("stores only the non-secret account identity", async () => {
    const state = new MemoryWorkspaceState();
    const store = new ConnectionStore(state);

    const accountWithSecret = { ...ACCOUNT, token: "must-not-persist" };
    await store.saveAccount(accountWithSecret);

    expect(store.getAccount()).toEqual(ACCOUNT);
    expect(JSON.stringify([...state.values.values()])).not.toContain(
      "must-not-persist",
    );
  });

  it("rejects malformed persisted state", () => {
    const state = new MemoryWorkspaceState();
    state.values.set("cloudflareBuilds.account", {
      id: "../unsafe",
      name: "Example account",
    });

    expect(new ConnectionStore(state).getAccount()).toBeUndefined();
  });

  it("clears the account mapping", async () => {
    const state = new MemoryWorkspaceState();
    const store = new ConnectionStore(state);
    await store.saveAccount(ACCOUNT);

    await store.clear();

    expect(store.getAccount()).toBeUndefined();
  });
});
