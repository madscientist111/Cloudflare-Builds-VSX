import * as vscode from "vscode";
import { CloudflareClient, type CloudflareAccount } from "./cloudflare/client.js";
import { ConnectionService } from "./connection/connectionService.js";
import { ConnectionStore } from "./connection/connectionStore.js";
import { DeploymentTargetCoordinator } from "./connection/deploymentTargetCoordinator.js";
import { DeploymentTargetSelectionService } from "./connection/deploymentTargetSelectionService.js";
import { DeploymentTargetStore } from "./connection/deploymentTargetStore.js";
import { VscodeConnectionPrompts } from "./connection/vscodeConnectionPrompts.js";
import { VscodeDeploymentTargetPrompts } from "./connection/vscodeDeploymentTargetPrompts.js";
import { DeploymentTargetDiscovery } from "./discovery/deploymentTargetDiscovery.js";
import { RepositoryIdentityResolver } from "./git/repositoryIdentityResolver.js";
import { SecureProcessRunner } from "./process/secureProcessRunner.js";
import { CredentialStore } from "./security/credentialStore.js";
import { ConnectionTreeProvider } from "./view/connectionTreeProvider.js";

const CONNECT_COMMAND = "cloudflareBuilds.connect";
const DISCONNECT_COMMAND = "cloudflareBuilds.disconnect";
const SELECT_WORKER_COMMAND = "cloudflareBuilds.selectWorker";
const BUILDS_VIEW = "cloudflareBuilds.view";
const CONNECTED_CONTEXT = "cloudflareBuilds.connected";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const credentials = new CredentialStore(context.secrets);
  const connections = new ConnectionStore(context.workspaceState);
  const targets = new DeploymentTargetStore(context.workspaceState);
  const storedToken = await credentials.getToken();
  let account = connections.getAccount();
  let target = targets.get();

  if (storedToken === undefined && account !== undefined) {
    await connections.clear();
    await targets.clear();
    account = undefined;
    target = undefined;
  }

  const tree = new ConnectionTreeProvider(account, target);
  const targetPrompts = new VscodeDeploymentTargetPrompts();
  const targetCoordinator = new DeploymentTargetCoordinator({
    createSelector: (
      selectedAccount,
      token,
      workspacePath,
    ): DeploymentTargetSelectionService =>
      new DeploymentTargetSelectionService({
        account: selectedAccount,
        discovery: new DeploymentTargetDiscovery(new CloudflareClient(token)),
        prompts: targetPrompts,
        repositoryResolver: new RepositoryIdentityResolver(
          new SecureProcessRunner(workspacePath),
        ),
        store: targets,
      }),
    getAccount: (): CloudflareAccount | undefined => account,
    getToken: (): Promise<string | undefined> => credentials.getToken(),
    messages: targetPrompts,
    targetSelected: (selectedTarget): void => {
      target = selectedTarget;
      tree.setState(account, target);
    },
    workspacePath: trustedSingleWorkspacePath,
  });
  const updateConnection = async (
    nextAccount: CloudflareAccount | undefined,
  ): Promise<void> => {
    const accountChanged = account?.id !== nextAccount?.id;
    account = nextAccount;
    if (nextAccount === undefined || accountChanged) {
      await targets.clear();
      target = undefined;
    }
    tree.setState(account, target);
    await vscode.commands.executeCommand(
      "setContext",
      CONNECTED_CONTEXT,
      nextAccount !== undefined,
    );
    if (nextAccount !== undefined) {
      await targetCoordinator.select();
    }
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
    targetCoordinator,
    vscode.window.registerTreeDataProvider(BUILDS_VIEW, tree),
    vscode.commands.registerCommand(CONNECT_COMMAND, async (): Promise<void> => {
      if (trustedSingleWorkspacePath() === undefined) {
        await targetPrompts.showFailure("workspace");
        return;
      }
      await service.connect();
    }),
    vscode.commands.registerCommand(SELECT_WORKER_COMMAND, async (): Promise<void> => {
      await targetCoordinator.select();
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

function trustedSingleWorkspacePath(): string | undefined {
  if (!vscode.workspace.isTrusted) {
    return undefined;
  }
  const folders = vscode.workspace.workspaceFolders;
  const folder = folders?.length === 1 ? folders[0] : undefined;
  return folder?.uri.scheme === "file" ? folder.uri.fsPath : undefined;
}

export function deactivate(): void {
  // VS Code disposes all registered subscriptions from the extension context.
}
