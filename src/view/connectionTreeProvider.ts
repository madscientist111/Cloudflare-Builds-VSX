import * as vscode from "vscode";
import type { CloudflareAccount } from "../cloudflare/client.js";

export class ConnectionTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  readonly #changed = new vscode.EventEmitter<void>();
  #account: CloudflareAccount | undefined;

  public readonly onDidChangeTreeData = this.#changed.event;

  public constructor(account: CloudflareAccount | undefined) {
    this.#account = account;
  }

  public dispose(): void {
    this.#changed.dispose();
  }

  public getChildren(): vscode.TreeItem[] {
    if (this.#account === undefined) {
      return [];
    }

    const item = new vscode.TreeItem(
      this.#account.name,
      vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue = "cloudflareBuilds.account";
    item.description = "Connected";
    item.iconPath = new vscode.ThemeIcon("cloud");
    item.tooltip = `Connected Cloudflare account: ${this.#account.name}`;
    return [item];
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public setAccount(account: CloudflareAccount | undefined): void {
    this.#account = account;
    this.#changed.fire();
  }
}
