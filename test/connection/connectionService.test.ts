import { describe, expect, it, vi } from "vitest";
import { CloudflareApiError } from "../../src/cloudflare/apiError.js";
import type { CloudflareAccount } from "../../src/cloudflare/client.js";
import { ConnectionService } from "../../src/connection/connectionService.js";
import { ConnectionStore } from "../../src/connection/connectionStore.js";
import { CredentialStore } from "../../src/security/credentialStore.js";

const ACCOUNT: CloudflareAccount = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Primary account",
};
const SECOND_ACCOUNT: CloudflareAccount = {
  id: "abcdef0123456789abcdef0123456789",
  name: "Secondary account",
};

class MemorySecrets {
  public readonly values = new Map<string, string>();

  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  public store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

class MemoryWorkspace {
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

// Inference preserves Vitest mock methods across the test harness.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createHarness(accounts: readonly CloudflareAccount[] = [ACCOUNT]) {
  const secrets = new MemorySecrets();
  const workspace = new MemoryWorkspace();
  const client = {
    checkAccountAccess: vi.fn(() => Promise.resolve()),
    listAccounts: vi.fn(() => Promise.resolve([...accounts])),
    verifyToken: vi.fn(() =>
      Promise.resolve({ id: "token-id", status: "active" as const }),
    ),
  };
  const prompts = {
    pickAccount: vi.fn(() => Promise.resolve<CloudflareAccount | undefined>(undefined)),
    requestToken: vi.fn(() => Promise.resolve<string | undefined>("  opaque-token  ")),
    showFailure: vi.fn(() => Promise.resolve()),
  };
  const connectionChanged = vi.fn();
  const service = new ConnectionService({
    clientFactory: (): typeof client => client,
    connectionChanged,
    connections: new ConnectionStore(workspace),
    credentials: new CredentialStore(secrets),
    prompts,
  });

  return { client, connectionChanged, prompts, secrets, service, workspace };
}

describe("ConnectionService", () => {
  it("validates access before persisting the selected account and token", async () => {
    const harness = createHarness();

    await harness.service.connect();

    expect(harness.client.verifyToken).toHaveBeenCalledOnce();
    expect(harness.client.listAccounts).toHaveBeenCalledOnce();
    expect(harness.client.checkAccountAccess).toHaveBeenCalledWith(ACCOUNT.id);
    expect([...harness.secrets.values.values()]).toEqual(["opaque-token"]);
    expect([...harness.workspace.values.values()]).toEqual([ACCOUNT]);
    expect(harness.connectionChanged).toHaveBeenCalledWith(ACCOUNT);
    expect(harness.prompts.pickAccount).not.toHaveBeenCalled();
  });

  it("asks the user to resolve multiple accounts", async () => {
    const harness = createHarness([ACCOUNT, SECOND_ACCOUNT]);
    harness.prompts.pickAccount.mockResolvedValue(SECOND_ACCOUNT);

    await harness.service.connect();

    expect(harness.prompts.pickAccount).toHaveBeenCalledWith([
      ACCOUNT,
      SECOND_ACCOUNT,
    ]);
    expect(harness.client.checkAccountAccess).toHaveBeenCalledWith(
      SECOND_ACCOUNT.id,
    );
  });

  it("does not persist credentials when permission validation fails", async () => {
    const harness = createHarness();
    harness.client.checkAccountAccess.mockRejectedValue(
      new CloudflareApiError("permission"),
    );

    await harness.service.connect();

    expect(harness.secrets.values.size).toBe(0);
    expect(harness.workspace.values.size).toBe(0);
    expect(harness.prompts.showFailure).toHaveBeenCalledWith("permission");
    expect(harness.connectionChanged).not.toHaveBeenCalled();
  });

  it("maps unexpected failures to a safe storage category", async () => {
    const harness = createHarness();
    harness.client.verifyToken.mockRejectedValue(
      new Error("failure containing confidential data"),
    );

    await harness.service.connect();

    expect(harness.prompts.showFailure).toHaveBeenCalledWith("storage");
    expect(JSON.stringify(harness.prompts.showFailure.mock.calls)).not.toContain(
      "confidential data",
    );
  });

  it("removes both secret and non-secret state on disconnect", async () => {
    const harness = createHarness();
    await harness.service.connect();

    await harness.service.disconnect();

    expect(harness.secrets.values.size).toBe(0);
    expect(harness.workspace.values.size).toBe(0);
    expect(harness.connectionChanged).toHaveBeenLastCalledWith(undefined);
  });
});
