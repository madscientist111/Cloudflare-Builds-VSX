import { describe, expect, it, vi } from "vitest";
import {
  RepositoryIdentityResolver,
  RepositoryResolutionError,
} from "../../src/git/repositoryIdentityResolver.js";

function createCommands(): {
  runGh: ReturnType<typeof vi.fn<(args: readonly string[]) => Promise<string>>>;
  runGit: ReturnType<typeof vi.fn<(args: readonly string[]) => Promise<string>>>;
} {
  return {
    runGh: vi.fn(() => Promise.reject(new Error("gh unavailable"))),
    runGit: vi.fn(() =>
      Promise.resolve("git@github.com:Cloudflare/workers-sdk.git"),
    ),
  };
}

describe("RepositoryIdentityResolver", () => {
  it("prefers authenticated gh repository identity", async () => {
    const commands = createCommands();
    commands.runGh.mockResolvedValue("Cloudflare/workers-sdk");

    await expect(new RepositoryIdentityResolver(commands).resolve()).resolves.toEqual({
      canonicalName: "cloudflare/workers-sdk",
      name: "workers-sdk",
      owner: "Cloudflare",
      provider: "github",
    });
    expect(commands.runGh).toHaveBeenCalledWith([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
    expect(commands.runGit).not.toHaveBeenCalled();
  });

  it("falls back to the origin URL when gh is unavailable", async () => {
    const commands = createCommands();

    await expect(new RepositoryIdentityResolver(commands).resolve()).resolves.toMatchObject({
      canonicalName: "cloudflare/workers-sdk",
    });
    expect(commands.runGit).toHaveBeenCalledWith([
      "remote",
      "get-url",
      "origin",
    ]);
  });

  it("falls back when gh returns malformed output", async () => {
    const commands = createCommands();
    commands.runGh.mockResolvedValue("not-a-repository");

    await expect(new RepositoryIdentityResolver(commands).resolve()).resolves.toMatchObject({
      canonicalName: "cloudflare/workers-sdk",
    });
  });

  it("returns one safe error when neither strategy resolves", async () => {
    const commands = createCommands();
    commands.runGit.mockRejectedValue(
      new Error("git failed with confidential command output"),
    );

    const failure = new RepositoryIdentityResolver(commands).resolve();
    await expect(failure).rejects.toBeInstanceOf(RepositoryResolutionError);
    await expect(failure).rejects.toThrow(
      "The current workspace is not linked to a supported GitHub repository.",
    );
    await expect(failure).rejects.not.toThrow("confidential command output");
  });
});
