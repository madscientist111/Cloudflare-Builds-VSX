import { describe, expect, it } from "vitest";
import {
  parseGitHubNameWithOwner,
  parseGitHubRemote,
} from "../../src/git/repositoryIdentity.js";

const IDENTITY = {
  canonicalName: "cloudflare/workers-sdk",
  name: "workers-sdk",
  owner: "Cloudflare",
  provider: "github",
} as const;

describe("parseGitHubRemote", () => {
  it.each([
    "https://github.com/Cloudflare/workers-sdk.git",
    "https://github.com/Cloudflare/workers-sdk/",
    "git@github.com:Cloudflare/workers-sdk.git",
    "ssh://git@github.com/Cloudflare/workers-sdk.git",
  ])("parses a supported GitHub remote: %s", (remote) => {
    expect(parseGitHubRemote(remote)).toEqual(IDENTITY);
  });

  it.each([
    "http://github.com/Cloudflare/workers-sdk.git",
    "git://github.com/Cloudflare/workers-sdk.git",
    "https://github.example.com/Cloudflare/workers-sdk.git",
    "https://github.com.evil.example/Cloudflare/workers-sdk.git",
    "https://token@github.com/Cloudflare/workers-sdk.git",
    "https://github.com/Cloudflare/workers-sdk/issues",
    "https://github.com/Cloudflare/%2e%2e.git",
    "git@github.com:Cloudflare/workers-sdk.git\n--upload-pack=evil",
    "file:///private/repository",
    "",
  ])("rejects an unsafe or unsupported remote: %s", (remote) => {
    expect(parseGitHubRemote(remote)).toBeUndefined();
  });
});

describe("parseGitHubNameWithOwner", () => {
  it("normalizes a gh nameWithOwner value", () => {
    expect(parseGitHubNameWithOwner(" Cloudflare/workers-sdk ")).toEqual(
      IDENTITY,
    );
  });

  it.each(["owner", "owner/repo/extra", "../repo", "owner/.."])(
    "rejects malformed identity: %s",
    (identity) => {
      expect(parseGitHubNameWithOwner(identity)).toBeUndefined();
    },
  );
});
