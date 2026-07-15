import type { CommitRef } from "./commitRef.js";

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const MAX_BRANCH_LENGTH = 256;
const MAX_SUBJECT_LENGTH = 1_024;

const HEAD_SHA_COMMAND = ["rev-parse", "--verify", "HEAD"] as const;
const BRANCH_COMMAND = ["branch", "--show-current"] as const;
const UPSTREAM_SHA_COMMAND = ["rev-parse", "--verify", "@{upstream}"] as const;
const SUBJECT_COMMAND = ["log", "-1", "--format=%s", "HEAD"] as const;

interface GitCommands {
  runGit(args: readonly string[]): Promise<string>;
}

export class CurrentCommitReadError extends Error {
  public constructor() {
    super("The current Git commit could not be read.");
    this.name = "CurrentCommitReadError";
  }
}

export class CurrentCommitReader {
  readonly #commands: GitCommands;

  public constructor(commands: GitCommands) {
    this.#commands = commands;
  }

  public async read(): Promise<CommitRef> {
    try {
      const headSha = this.#readSha(await this.#commands.runGit(HEAD_SHA_COMMAND));
      const branch = this.#readBranch(await this.#commands.runGit(BRANCH_COMMAND));
      const upstreamSha = this.#readSha(
        await this.#commands.runGit(UPSTREAM_SHA_COMMAND),
      );
      const subject = this.#readSubject(await this.#commands.runGit(SUBJECT_COMMAND));

      return {
        branch,
        headSha,
        isPushed: headSha.toLowerCase() === upstreamSha.toLowerCase(),
        subject,
        upstreamSha,
      };
    } catch {
      throw new CurrentCommitReadError();
    }
  }

  #readSha(value: string): string {
    if (!SHA.test(value)) {
      throw new CurrentCommitReadError();
    }
    return value;
  }

  #readBranch(value: string): string {
    if (
      value.length === 0 ||
      value.length > MAX_BRANCH_LENGTH ||
      CONTROL_CHARACTER.test(value)
    ) {
      throw new CurrentCommitReadError();
    }
    return value;
  }

  #readSubject(value: string): string {
    if (value.length > MAX_SUBJECT_LENGTH || CONTROL_CHARACTER.test(value)) {
      throw new CurrentCommitReadError();
    }
    return value;
  }
}
