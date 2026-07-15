import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "madscientist111.cloudflare-builds";
const CONNECTION_COMMANDS = [
  "cloudflareBuilds.connect",
  "cloudflareBuilds.disconnect",
  "cloudflareBuilds.selectWorker",
] as const;

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} was not found`);

  await extension.activate();
  assert.equal(extension.isActive, true, "Extension did not activate");

  const commands = await vscode.commands.getCommands(true);
  for (const command of CONNECTION_COMMANDS) {
    assert.ok(commands.includes(command), `${command} is not registered`);
  }
}
