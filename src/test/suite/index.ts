import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "madscientist111.cloudflare-builds";
const CONNECT_COMMAND = "cloudflareBuilds.connect";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} was not found`);

  await extension.activate();
  assert.equal(extension.isActive, true, "Extension did not activate");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(CONNECT_COMMAND), "Connect command is not registered");
}
