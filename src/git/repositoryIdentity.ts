const GITHUB_HOST = "github.com";
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/u;

export interface GitHubRepositoryIdentity {
  readonly canonicalName: string;
  readonly name: string;
  readonly owner: string;
  readonly provider: "github";
}

export function parseGitHubRemote(
  remote: string,
): GitHubRepositoryIdentity | undefined {
  const value = remote.trim();
  if (value.length === 0 || value.includes("\n") || value.includes("\r")) {
    return undefined;
  }

  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+)$/u.exec(value);
  if (scpMatch !== null) {
    return identityFromParts(scpMatch[1], scpMatch[2]);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "ssh:") ||
    url.hostname.toLowerCase() !== GITHUB_HOST ||
    url.password.length > 0 ||
    (url.username.length > 0 &&
      !(url.protocol === "ssh:" && url.username === "git")) ||
    url.port.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return undefined;
  }

  const path = url.pathname.replace(/^\//u, "").replace(/\/$/u, "");
  const parts = path.split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  return identityFromParts(parts[0], parts[1]);
}

export function parseGitHubNameWithOwner(
  value: string,
): GitHubRepositoryIdentity | undefined {
  const parts = value.trim().split("/");
  return parts.length === 2 ? identityFromParts(parts[0], parts[1]) : undefined;
}

function identityFromParts(
  owner: string | undefined,
  repositoryWithSuffix: string | undefined,
): GitHubRepositoryIdentity | undefined {
  if (owner === undefined || repositoryWithSuffix === undefined) {
    return undefined;
  }

  const name = repositoryWithSuffix.endsWith(".git")
    ? repositoryWithSuffix.slice(0, -4)
    : repositoryWithSuffix;
  if (!OWNER.test(owner) || !REPOSITORY.test(name) || name === "." || name === "..") {
    return undefined;
  }

  return {
    canonicalName: `${owner.toLowerCase()}/${name.toLowerCase()}`,
    name,
    owner,
    provider: "github",
  };
}
