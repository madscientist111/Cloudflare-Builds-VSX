import {
  parseGitHubNameWithOwner,
  parseGitHubRemote,
  type GitHubRepositoryIdentity,
} from "./repositoryIdentity.js";

interface RepositoryCommands {
  runGh(args: readonly string[]): Promise<string>;
  runGit(args: readonly string[]): Promise<string>;
}

export class RepositoryResolutionError extends Error {
  public constructor() {
    super("The current workspace is not linked to a supported GitHub repository.");
    this.name = "RepositoryResolutionError";
  }
}

export class RepositoryIdentityResolver {
  readonly #commands: RepositoryCommands;

  public constructor(commands: RepositoryCommands) {
    this.#commands = commands;
  }

  public async resolve(): Promise<GitHubRepositoryIdentity> {
    const fromGh = await this.#resolveWithGh();
    if (fromGh !== undefined) {
      return fromGh;
    }

    try {
      const remote = await this.#commands.runGit([
        "remote",
        "get-url",
        "origin",
      ]);
      const identity = parseGitHubRemote(remote);
      if (identity !== undefined) {
        return identity;
      }
    } catch {
      // gh is optional and Git errors are represented by one safe domain error.
    }

    throw new RepositoryResolutionError();
  }

  async #resolveWithGh(): Promise<GitHubRepositoryIdentity | undefined> {
    try {
      const nameWithOwner = await this.#commands.runGh([
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
      ]);
      return parseGitHubNameWithOwner(nameWithOwner);
    } catch {
      return undefined;
    }
  }
}
