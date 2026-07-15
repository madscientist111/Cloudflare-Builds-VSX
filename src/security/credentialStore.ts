const CLOUDFLARE_TOKEN_KEY = "cloudflareBuilds.cloudflareApiToken";

interface SecretStoragePort {
  delete(key: string): Thenable<void>;
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
}

export class CredentialStore {
  readonly #storage: SecretStoragePort;

  public constructor(storage: SecretStoragePort) {
    this.#storage = storage;
  }

  public async deleteToken(): Promise<void> {
    await this.#storage.delete(CLOUDFLARE_TOKEN_KEY);
  }

  public async getToken(): Promise<string | undefined> {
    return this.#storage.get(CLOUDFLARE_TOKEN_KEY);
  }

  public async storeToken(token: string): Promise<void> {
    if (token.trim().length === 0) {
      throw new Error("Cannot store an empty Cloudflare API token.");
    }
    await this.#storage.store(CLOUDFLARE_TOKEN_KEY, token);
  }
}
