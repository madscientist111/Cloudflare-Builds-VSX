import * as vscode from "vscode";

const CONNECT_COMMAND = "cloudflareBuilds.connect";
const BUILDS_VIEW = "cloudflareBuilds.view";

class EmptyBuildsProvider implements vscode.TreeDataProvider<never> {
  public getChildren(): never[] {
    return [];
  }

  public getTreeItem(element: never): vscode.TreeItem {
    return element;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(BUILDS_VIEW, new EmptyBuildsProvider()),
    vscode.commands.registerCommand(CONNECT_COMMAND, async (): Promise<void> => {
      await vscode.window.showInformationMessage(
        "Cloudflare Builds is ready for secure account setup.",
      );
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes all registered subscriptions from the extension context.
}
