import { describe, expect, it, vi } from "vitest";
import {
  CurrentCommitReadError,
  CurrentCommitReader,
} from "../../src/git/currentCommitReader.js";

const HEAD_SHA = "a".repeat(40);
const UPSTREAM_SHA = "b".repeat(40);

type RunGit = (args: readonly string[]) => Promise<string>;

function createCommands(): { runGit: ReturnType<typeof vi.fn<RunGit>> } {
  return { runGit: vi.fn<RunGit>() };
}

function respond(
  runGit: ReturnType<typeof vi.fn<RunGit>>,
  values: readonly string[],
): void {
  for (const value of values) {
    runGit.mockResolvedValueOnce(value);
  }
}

describe("CurrentCommitReader", () => {
  it("returns a pushed current commit", async () => {
    const commands = createCommands();
    respond(commands.runGit, [HEAD_SHA, "main", HEAD_SHA, "Ship reader"]);

    await expect(new CurrentCommitReader(commands).read()).resolves.toEqual({
      branch: "main",
      headSha: HEAD_SHA,
      isPushed: true,
      subject: "Ship reader",
      upstreamSha: HEAD_SHA,
    });
  });

  it("marks a current commit as unpushed when HEAD differs from upstream", async () => {
    const commands = createCommands();
    respond(commands.runGit, [HEAD_SHA, "feature/reader", UPSTREAM_SHA, "Draft"]);

    await expect(new CurrentCommitReader(commands).read()).resolves.toMatchObject({
      isPushed: false,
    });
  });

  it("rejects a detached HEAD", async () => {
    const commands = createCommands();
    respond(commands.runGit, [HEAD_SHA, ""]);

    await expect(new CurrentCommitReader(commands).read()).rejects.toBeInstanceOf(
      CurrentCommitReadError,
    );
  });

  it("rejects a missing upstream without leaking process output", async () => {
    const commands = createCommands();
    respond(commands.runGit, [HEAD_SHA, "main"]);
    commands.runGit.mockRejectedValueOnce(new Error("missing upstream: private data"));

    const failure = new CurrentCommitReader(commands).read();
    await expect(failure).rejects.toThrow("The current Git commit could not be read.");
    await expect(failure).rejects.not.toThrow("private data");
  });

  it.each([
    ["short SHA", "not-a-sha", "main", UPSTREAM_SHA, "Subject"],
    ["control character", HEAD_SHA, "main\u0000branch", UPSTREAM_SHA, "Subject"],
    ["oversized branch", HEAD_SHA, "b".repeat(257), UPSTREAM_SHA, "Subject"],
    ["oversized subject", HEAD_SHA, "main", UPSTREAM_SHA, "s".repeat(1025)],
  ])("rejects malformed %s output", async (_name, head, branch, upstream, subject) => {
    const commands = createCommands();
    respond(commands.runGit, [head, branch, upstream, subject]);

    await expect(new CurrentCommitReader(commands).read()).rejects.toBeInstanceOf(
      CurrentCommitReadError,
    );
  });

  it("uses fixed read-only Git command arrays", async () => {
    const commands = createCommands();
    respond(commands.runGit, [HEAD_SHA, "main", UPSTREAM_SHA, "Subject"]);

    await new CurrentCommitReader(commands).read();

    expect(commands.runGit.mock.calls.map(([args]) => args)).toEqual([
      ["rev-parse", "--verify", "HEAD"],
      ["branch", "--show-current"],
      ["rev-parse", "--verify", "@{upstream}"],
      ["log", "-1", "--format=%s", "HEAD"],
    ]);
  });
});
