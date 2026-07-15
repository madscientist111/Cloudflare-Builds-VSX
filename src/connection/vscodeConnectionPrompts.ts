import * as vscode from "vscode";
import type { CloudflareAccount } from "../cloudflare/client.js";
import type { ConnectionFailure } from "./connectionService.js";

const TOKEN_URL = vscode.Uri.parse(
  "https://dash.cloudflare.com/profile/api-tokens",
);
const PERMISSIONS_URL = vscode.Uri.parse(
  "https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/#before-you-start",
);

const FAILURE_MESSAGES: Readonly<Record<ConnectionFailure, string>> = {
  api: "Cloudflare could not complete the connection request. Try again later.",
  authentication: "Cloudflare rejected this API token. Create or enter a valid user-scoped token.",
  invalidResponse: "Cloudflare returned an unexpected response. No credentials were saved.",
  network: "Cloudflare could not be reached. Check your connection and try again.",
  permission: "The token needs Workers Builds Configuration: Edit and Workers Scripts: Read.",
  rateLimit: "Cloudflare rate-limited the request. Wait before trying again.",
  storage: "The connection could not be saved securely. No token was retained.",
};

export class VscodeConnectionPrompts {
  public async pickAccount(
    accounts: readonly CloudflareAccount[],
  ): Promise<CloudflareAccount | undefined> {
    const selected = await vscode.window.showQuickPick(
      accounts.map((account) => ({
        account,
        label: account.name,
      })),
      {
        ignoreFocusOut: true,
        placeHolder: "Select the Cloudflare account that owns your Worker",
        title: "Connect Cloudflare Builds",
      },
    );
    return selected?.account;
  }

  public async requestToken(): Promise<string | undefined> {
    const enterToken = "Enter API Token";
    const createToken = "Create API Token";
    const choice = await vscode.window.showInformationMessage(
      "Connect with a user-scoped Cloudflare API token.",
      {
        detail:
          "Required permissions: Workers Builds Configuration: Edit and Workers Scripts: Read. The token is stored only in VS Code SecretStorage.",
        modal: true,
      },
      enterToken,
      createToken,
    );

    if (choice === createToken) {
      await vscode.env.openExternal(TOKEN_URL);
      return undefined;
    }
    if (choice !== enterToken) {
      return undefined;
    }

    return vscode.window.showInputBox({
      ignoreFocusOut: true,
      password: true,
      placeHolder: "Paste the user-scoped API token",
      prompt: "The token will be validated before it is stored.",
      title: "Cloudflare API Token",
    });
  }

  public async showFailure(failure: ConnectionFailure): Promise<void> {
    const viewPermissions = "View Required Permissions";
    const action = await vscode.window.showErrorMessage(
      FAILURE_MESSAGES[failure],
      viewPermissions,
    );
    if (action === viewPermissions) {
      await vscode.env.openExternal(PERMISSIONS_URL);
    }
  }
}
