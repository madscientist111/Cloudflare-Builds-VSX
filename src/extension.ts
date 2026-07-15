import * as vscode from "vscode";
import { CloudflareClient } from "./cloudflare/client.js";
import type { CloudflareAccount } from "./cloudflare/client.js";
import { ConnectionService } from "./connection/connectionService.js";
import { ConnectionStore } from "./connection/connectionStore.js";
import { VscodeConnectionPrompts } from "./connection/vscodeConnectionPrompts.js";
import { CredentialStore } from "./security/credentialStore.js";
import { ConnectionTreeProvider } from "./view/connectionTreeProvider.js";

const CONNECT_COMMAND = "cloudflareBuilds.connect";
const DISCONNECT_COMMAND = "cloudflareBuilds.disconnect";
const BUILDS_VIEW = "cloudflareBuilds.view";
const CONNECTED_CONTEXT = "cloudflareBuilds.connected";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const credentials = new CredentialStore(context.secrets);
  const connections = new ConnectionStore(context.workspaceState);
  const storedToken = await credentials.getToken();
  let account = connections.getAccount();

  if (storedToken === undefined && account !== undefined) {
    await connections.clear();
    account = undefined;
  }

  const tree = new ConnectionTreeProvider(account);
  const updateConnection = (nextAccount: CloudflareAccount | undefined): void => {
    tree.setAccount(nextAccount);
    void vscode.commands.executeCommand(
      "setContext",
      CONNECTED_CONTEXT,
      nextAccount !== undefined,
    );
  };
  const service = new ConnectionService({
    clientFactory: (token): CloudflareClient => new CloudflareClient(token),
    connectionChanged: updateConnection,
    connections,
    credentials,
    prompts: new VscodeConnectionPrompts(),
  });

  context.subscriptions.push(
    tree,
    vscode.window.registerTreeDataProvider(BUILDS_VIEW, tree),
    vscode.commands.registerCommand(CONNECT_COMMAND, async (): Promise<void> => {
      await service.connect();
    }),
    vscode.commands.registerCommand(DISCONNECT_COMMAND, async (): Promise<void> => {
      const confirmation = await vscode.window.showWarningMessage(
        "Disconnect Cloudflare Builds and remove the stored API token?",
        { modal: true },
        "Disconnect",
      );
      if (confirmation === "Disconnect") {
        await service.disconnect();
      }
    }),
  );

  await vscode.commands.executeCommand(
    "setContext",
    CONNECTED_CONTEXT,
    account !== undefined,
  );
}

export function deactivate(): void {
  // VS Code disposes all registered subscriptions from the extension context.
}
