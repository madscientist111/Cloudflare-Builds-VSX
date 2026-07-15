import { describe, expect, it, vi } from "vitest";
import {
  SafeProcessError,
  SecureProcessRunner,
  type ProcessExecutor,
} from "../../src/process/secureProcessRunner.js";

const WORKSPACE = "/trusted/workspace";

describe("SecureProcessRunner", () => {
  it("executes only an allowlisted binary without a shell", async () => {
    const executor = vi.fn<ProcessExecutor>(() =>
      Promise.resolve({ stderr: "", stdout: "  git@github.com:owner/repo.git\n" }),
    );
    const runner = new SecureProcessRunner(WORKSPACE, executor);

    await expect(runner.runGit(["remote", "get-url", "origin"])).resolves.toBe(
      "git@github.com:owner/repo.git",
    );

    expect(executor).toHaveBeenCalledWith(
      "git",
      ["remote", "get-url", "origin"],
      {
        cwd: WORKSPACE,
        encoding: "utf8",
        maxBuffer: 65_536,
        shell: false,
        timeout: 5_000,
        windowsHide: true,
      },
    );
  });

  it("passes arguments as distinct values instead of shell text", async () => {
    const executor = vi.fn<ProcessExecutor>(() =>
      Promise.resolve({ stderr: "", stdout: "ok" }),
    );
    const runner = new SecureProcessRunner(WORKSPACE, executor);

    await runner.runGh(["repo", "view", "name with spaces; echo unsafe"]);

    expect(executor.mock.calls[0]?.[1]).toEqual([
      "repo",
      "view",
      "name with spaces; echo unsafe",
    ]);
    expect(executor.mock.calls[0]?.[2].shell).toBe(false);
  });

  it("rejects null bytes before process execution", async () => {
    const executor = vi.fn<ProcessExecutor>(() =>
      Promise.resolve({ stderr: "", stdout: "unused" }),
    );
    const runner = new SecureProcessRunner(WORKSPACE, executor);

    await expect(runner.runGit(["remote\0unsafe"])).rejects.toBeInstanceOf(
      SafeProcessError,
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a relative working directory", () => {
    expect(() => new SecureProcessRunner("relative/path")).toThrow(
      "A required local command could not be completed.",
    );
  });

  it("does not expose stderr from a failed process", async () => {
    const executor = vi.fn<ProcessExecutor>(() =>
      Promise.reject(new Error("stderr contains confidential-data")),
    );
    const runner = new SecureProcessRunner(WORKSPACE, executor);

    const failure = runner.runGh(["repo", "view"]);
    await expect(failure).rejects.toThrow(
      "A required local command could not be completed.",
    );
    await expect(failure).rejects.not.toThrow("confidential-data");
  });
});
