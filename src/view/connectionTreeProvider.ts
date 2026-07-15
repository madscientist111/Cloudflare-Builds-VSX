import * as vscode from "vscode";
import type { CloudflareAccount } from "../cloudflare/client.js";
import type { WorkspaceDeploymentTarget } from "../connection/deploymentTargetStore.js";
import {
  createConnectedTargetViewModel,
  type ConnectedTargetTreeNode,
} from "./connectedTargetViewModel.js";

/** Renders the immutable connected-target projection without exposing its IDs. */
export class ConnectionTreeProvider
  implements vscode.TreeDataProvider<ConnectedTargetTreeNode>
{
  readonly #changed = new vscode.EventEmitter<void>();
  #account: CloudflareAccount | undefined;
  #target: WorkspaceDeploymentTarget | undefined;

  public readonly onDidChangeTreeData = this.#changed.event;

  public constructor(
    account: CloudflareAccount | undefined,
    target: WorkspaceDeploymentTarget | undefined,
  ) {
    this.#account = account;
    this.#target = target;
  }

  public dispose(): void {
    this.#changed.dispose();
  }

  public getChildren(
    element?: ConnectedTargetTreeNode,
  ): ConnectedTargetTreeNode[] {
    if (element !== undefined) {
      return [...element.children];
    }
    const viewModel = createConnectedTargetViewModel(this.#account, this.#target);
    return viewModel === undefined ? [] : [viewModel];
  }

  public getTreeItem(element: ConnectedTargetTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded,
    );
    item.contextValue = `cloudflareBuilds.connectedTarget.${element.kind}`;
    item.iconPath = iconFor(element);
    item.tooltip = element.tooltip;
    if (element.kind === "account") {
      item.description = "Connected";
    }
    return item;
  }

  public setState(
    account: CloudflareAccount | undefined,
    target: WorkspaceDeploymentTarget | undefined,
  ): void {
    this.#account = account;
    this.#target = target;
    this.#changed.fire();
  }
}

function iconFor(element: ConnectedTargetTreeNode): vscode.ThemeIcon {
  switch (element.kind) {
    case "account":
      return new vscode.ThemeIcon("account");
    case "repository":
      return new vscode.ThemeIcon("repo");
    case "worker":
      return new vscode.ThemeIcon("symbol-function");
    case "trigger":
      return new vscode.ThemeIcon(
        element.environment === "production" ? "cloud-upload" : "beaker",
      );
  }
}
