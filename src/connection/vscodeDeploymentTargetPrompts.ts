import * as vscode from "vscode";
import type { DeploymentTargetCandidate } from "../discovery/deploymentTargetDiscovery.js";
import type { DeploymentTargetSelectionPromptPort } from "./deploymentTargetSelectionService.js";
import type { TargetSelectionCoordinatorFailure } from "./deploymentTargetCoordinator.js";

const SETUP_GUIDE_URL = vscode.Uri.parse(
  "https://developers.cloudflare.com/workers/ci-cd/builds/",
);
const DASHBOARD_URL = vscode.Uri.parse("https://dash.cloudflare.com/");
const FAILURE_MESSAGES: Readonly<Record<TargetSelectionCoordinatorFailure, string>> = {
  api: "Cloudflare could not find a Worker for this repository. Try again later.",
  authentication: "Cloudflare authentication failed. Reconnect Cloudflare and try again.",
  connection: "Connect Cloudflare before selecting a Worker.",
  invalidResponse: "Cloudflare returned an unexpected response. Try selecting a Worker again.",
  network: "Cloudflare could not be reached. Check your connection and try again.",
  permission: "The token needs Workers Builds Configuration: Edit and Workers Scripts: Read.",
  prompt: "The Worker selection could not be completed. Try again.",
  rateLimit: "Cloudflare rate-limited the request. Wait before trying again.",
  repository: "This workspace is not linked to a supported GitHub repository.",
  storage: "The selected Worker could not be saved. Try again.",
  workspace: "Cloudflare Builds requires one trusted local workspace folder to select a Worker.",
};

export class VscodeDeploymentTargetPrompts
  implements DeploymentTargetSelectionPromptPort
{
  public async pickDeploymentTarget(
    candidates: readonly DeploymentTargetCandidate[],
  ): Promise<DeploymentTargetCandidate | undefined> {
    const selected = await vscode.window.showQuickPick(
      candidates.map((candidate) => ({
        candidate,
        description: environmentAvailability(candidate),
        detail: `Root directory: ${rootDirectories(candidate)}`,
        label: candidate.worker.name,
      })),
      {
        ignoreFocusOut: true,
        placeHolder: "Select the Cloudflare Worker for this repository",
        title: "Select Cloudflare Builds Worker",
      },
    );
    return selected?.candidate;
  }

  public async showFailure(
    failure: TargetSelectionCoordinatorFailure,
  ): Promise<void> {
    await vscode.window.showErrorMessage(FAILURE_MESSAGES[failure]);
  }

  public async showNotFound(): Promise<"retry" | undefined> {
    const setupGuide = "Open Setup Guide";
    const dashboard = "Open Cloudflare Dashboard";
    const retry = "Retry";
    const selected = await vscode.window.showInformationMessage(
      "No Cloudflare Worker with Builds configured for this GitHub repository was found.",
      setupGuide,
      dashboard,
      retry,
    );
    if (selected === setupGuide) {
      await vscode.env.openExternal(SETUP_GUIDE_URL);
    } else if (selected === dashboard) {
      await vscode.env.openExternal(DASHBOARD_URL);
    } else if (selected === retry) {
      return "retry";
    }
    return undefined;
  }
}

function environmentAvailability(candidate: DeploymentTargetCandidate): string {
  const environments = new Set(candidate.triggers.map((trigger) => trigger.environment));
  const values: string[] = [];
  if (environments.has("production")) {
    values.push("Production");
  }
  if (environments.has("preview")) {
    values.push("Preview");
  }
  return values.join(", ");
}

function rootDirectories(candidate: DeploymentTargetCandidate): string {
  return [...new Set(candidate.triggers.map((trigger) => trigger.rootDirectory))].join(", ");
}
