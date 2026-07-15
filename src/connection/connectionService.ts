import type {
  CloudflareAccount,
  CloudflareClient,
} from "../cloudflare/client.js";
import { CloudflareApiError } from "../cloudflare/apiError.js";
import type { ConnectionStore } from "./connectionStore.js";
import type { CredentialStore } from "../security/credentialStore.js";

export type ConnectionFailure =
  | "authentication"
  | "permission"
  | "rateLimit"
  | "network"
  | "invalidResponse"
  | "api"
  | "storage";

interface ConnectionPrompts {
  pickAccount(accounts: readonly CloudflareAccount[]): Promise<CloudflareAccount | undefined>;
  requestToken(): Promise<string | undefined>;
  showFailure(failure: ConnectionFailure): Promise<void>;
}

interface CloudflareConnectionClient {
  checkAccountAccess(accountId: string): Promise<void>;
  listAccounts(): Promise<CloudflareAccount[]>;
  verifyToken(): ReturnType<CloudflareClient["verifyToken"]>;
}

type ClientFactory = (token: string) => CloudflareConnectionClient;
type ConnectionChanged = (account: CloudflareAccount | undefined) => void;

export class ConnectionService {
  readonly #clientFactory: ClientFactory;
  readonly #connectionChanged: ConnectionChanged;
  readonly #connections: ConnectionStore;
  readonly #credentials: CredentialStore;
  readonly #prompts: ConnectionPrompts;

  public constructor(options: {
    readonly clientFactory: ClientFactory;
    readonly connectionChanged: ConnectionChanged;
    readonly connections: ConnectionStore;
    readonly credentials: CredentialStore;
    readonly prompts: ConnectionPrompts;
  }) {
    this.#clientFactory = options.clientFactory;
    this.#connectionChanged = options.connectionChanged;
    this.#connections = options.connections;
    this.#credentials = options.credentials;
    this.#prompts = options.prompts;
  }

  public async connect(): Promise<void> {
    const enteredToken = await this.#prompts.requestToken();
    const token = enteredToken?.trim();
    if (token === undefined || token.length === 0) {
      return;
    }

    try {
      const client = this.#clientFactory(token);
      await client.verifyToken();
      const accounts = await client.listAccounts();
      const account = await this.#selectAccount(accounts);
      if (account === undefined) {
        return;
      }
      await client.checkAccountAccess(account.id);
      await this.#saveConnection(token, account);
      this.#connectionChanged(account);
    } catch (error) {
      await this.#prompts.showFailure(toFailure(error));
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.#credentials.deleteToken();
      await this.#connections.clear();
      this.#connectionChanged(undefined);
    } catch {
      await this.#prompts.showFailure("storage");
    }
  }

  async #saveConnection(token: string, account: CloudflareAccount): Promise<void> {
    await this.#credentials.storeToken(token);
    try {
      await this.#connections.saveAccount(account);
    } catch (error) {
      await this.#credentials.deleteToken();
      throw error;
    }
  }

  async #selectAccount(
    accounts: readonly CloudflareAccount[],
  ): Promise<CloudflareAccount | undefined> {
    if (accounts.length === 0) {
      throw new CloudflareApiError("permission");
    }
    if (accounts.length === 1) {
      return accounts[0];
    }
    return this.#prompts.pickAccount(accounts);
  }
}

function toFailure(error: unknown): ConnectionFailure {
  return error instanceof CloudflareApiError ? error.kind : "storage";
}
