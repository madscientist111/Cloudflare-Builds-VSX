import { describe, expect, it } from "vitest";
import { CredentialStore } from "../../src/security/credentialStore.js";

class MemorySecretStorage {
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

describe("CredentialStore", () => {
  it("round-trips a token through secret storage", async () => {
    const storage = new MemorySecretStorage();
    const credentials = new CredentialStore(storage);

    await credentials.storeToken("opaque-token");

    await expect(credentials.getToken()).resolves.toBe("opaque-token");
    expect([...storage.values.values()]).toEqual(["opaque-token"]);
  });

  it("deletes the stored token", async () => {
    const storage = new MemorySecretStorage();
    const credentials = new CredentialStore(storage);
    await credentials.storeToken("opaque-token");

    await credentials.deleteToken();

    await expect(credentials.getToken()).resolves.toBeUndefined();
  });

  it("refuses to store an empty token", async () => {
    const storage = new MemorySecretStorage();
    const credentials = new CredentialStore(storage);

    await expect(credentials.storeToken("   ")).rejects.toThrow(
      "Cannot store an empty Cloudflare API token.",
    );
    expect(storage.values.size).toBe(0);
  });
});
