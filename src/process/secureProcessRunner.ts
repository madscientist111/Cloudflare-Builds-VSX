import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 65_536;
const PROCESS_TIMEOUT_MS = 5_000;

type AllowedExecutable = "git" | "gh";

export type ProcessExecutor = (
  executable: AllowedExecutable,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly encoding: "utf8";
    readonly maxBuffer: number;
    readonly shell: false;
    readonly timeout: number;
    readonly windowsHide: true;
  },
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecutor: ProcessExecutor = async (executable, args, options) => {
  const result = await execFileAsync(executable, [...args], options);
  return { stderr: result.stderr, stdout: result.stdout };
};

export class SafeProcessError extends Error {
  public constructor() {
    super("A required local command could not be completed.");
    this.name = "SafeProcessError";
  }
}

export class SecureProcessRunner {
  readonly #cwd: string;
  readonly #executor: ProcessExecutor;

  public constructor(cwd: string, executor: ProcessExecutor = defaultExecutor) {
    if (!isAbsolute(cwd) || cwd.includes("\0")) {
      throw new SafeProcessError();
    }
    this.#cwd = cwd;
    this.#executor = executor;
  }

  public runGh(args: readonly string[]): Promise<string> {
    return this.#run("gh", args);
  }

  public runGit(args: readonly string[]): Promise<string> {
    return this.#run("git", args);
  }

  async #run(executable: AllowedExecutable, args: readonly string[]): Promise<string> {
    if (args.some((arg) => arg.includes("\0"))) {
      throw new SafeProcessError();
    }

    try {
      const result = await this.#executor(executable, args, {
        cwd: this.#cwd,
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: false,
        timeout: PROCESS_TIMEOUT_MS,
        windowsHide: true,
      });
      return result.stdout.trim();
    } catch {
      throw new SafeProcessError();
    }
  }
}
