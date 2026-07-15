import type { CloudflareAccount } from "../cloudflare/client.js";

const ACCOUNT_KEY = "cloudflareBuilds.account";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/u;

interface WorkspaceStatePort {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export class ConnectionStore {
  readonly #state: WorkspaceStatePort;

  public constructor(state: WorkspaceStatePort) {
    this.#state = state;
  }

  public async clear(): Promise<void> {
    await this.#state.update(ACCOUNT_KEY, undefined);
  }

  public getAccount(): CloudflareAccount | undefined {
    const value = this.#state.get(ACCOUNT_KEY);
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
      return undefined;
    }
    if (!ACCOUNT_ID.test(value.id) || value.name.trim().length === 0) {
      return undefined;
    }
    return { id: value.id, name: value.name };
  }

  public async saveAccount(account: CloudflareAccount): Promise<void> {
    if (!ACCOUNT_ID.test(account.id) || account.name.trim().length === 0) {
      throw new Error("Cannot store an invalid Cloudflare account.");
    }
    await this.#state.update(ACCOUNT_KEY, {
      id: account.id,
      name: account.name,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
