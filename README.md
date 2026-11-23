# Cloudflare Builds

Cloudflare Builds is a desktop VS Code-compatible extension for monitoring Cloudflare Workers Builds linked to the current GitHub workspace. It is pre-release software and is not published to a marketplace; build and run it from source.

<!-- screenshot: sidebar with a connected Worker -->

## Status

### Works today

- Cloudflare account connection with token permission validation and storage in VS Code `SecretStorage`.
- GitHub repository detection using `gh` when available, with a local Git fallback.
- Worker and trigger discovery in trusted workspaces, including production and preview trigger selection.
- Sidebar tree view showing the connected account, repository, selected Worker, and triggers.
- Workspace persistence for non-secret account, repository, Worker, and trigger selection.
- Read-only Cloudflare Builds API client (list recent builds, fetch a build by UUID) and local Git commit state reader (branch, HEAD SHA, upstream SHA, pushed state).

### Not built yet

- Sidebar recent build history rows, manual Refresh command, and status-bar indicator.
- Correlation between the current Git commit and Cloudflare builds, polling, and automatic push detection.
- Terminal build notifications and failure log viewing.
- End-to-end validation against a live Cloudflare account.

## Connect a Cloudflare account

1. Create a user-scoped token at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) with two permissions:
   - **Workers Builds Configuration: Edit**
   - **Workers Scripts: Read**
2. Run **Cloudflare Builds: Connect Cloudflare** from the Command Palette and paste the token.
3. Run **Cloudflare Builds: Select Worker** to pick the Worker and triggers for the current workspace.

The extension verifies both permissions before saving the token. Running **Cloudflare Builds: Disconnect** deletes the token from `SecretStorage` and clears the saved workspace selection.

## Security model

- **SecretStorage only**: API tokens are stored exclusively in VS Code `SecretStorage`. Workspace state stores only non-secret selection metadata.
- **Read-only API calls**: Cloudflare requests are strictly read-only, use bounded response sizes and timeouts, and never mutate account or Worker resources.
- **Trusted workspaces**: Git and `gh` subprocesses run only in trusted workspaces and never invoke a shell.
- **Redaction and no telemetry**: Tokens, authorization headers, account IDs, Worker tags, trigger UUIDs, environment values, logs, and raw API error bodies are excluded from UI surfaces and diagnostics. The extension collects no telemetry.

See [SECURITY.md](./SECURITY.md) for vulnerability reporting instructions.

## Self-hosting

Cloudflare Builds is not published to a marketplace, so self-hosting means building a `.vsix` package from source and installing it in your local editor. Nothing is hosted as a service: the extension runs inside VS Code and talks straight from your editor to the Cloudflare API with your token.

1. Clone the repository and install dependencies (requires Node.js 20 or later, npm 10 or later, and VS Code 1.95.0 or later):

   ```sh
   git clone https://github.com/madscientist111/Cloudflare-Builds-VSX.git
   cd Cloudflare-Builds-VSX
   npm ci
   ```

2. Run the checks, extension tests, and packager to produce the `.vsix` file:

   ```sh
   npm run package
   ```

   This runs `npm run check`, `npm run test:extension`, and `vsce package --no-dependencies`, writing `cloudflare-builds-0.0.1.vsix` to the repository root.

3. Install the package with the VS Code CLI, or choose **Install from VSIX...** from the Extensions view menu:

   ```sh
   code --install-extension cloudflare-builds-0.0.1.vsix
   ```

4. Open your project in VS Code, run **Cloudflare Builds: Connect Cloudflare** from the Command Palette to paste your Cloudflare API token, and then run **Cloudflare Builds: Select Worker** to bind the workspace to a Worker and its triggers.

### Good to know

- **No network service**: The extension does not listen on a port or run a separate backend. It makes read-only requests directly from your editor to the Cloudflare API.
- **Token scope and storage**: Use a user-scoped Cloudflare API token granted only **Workers Builds Configuration: Edit** and **Workers Scripts: Read**. The token is stored exclusively in VS Code `SecretStorage`, while workspace state holds only non-secret selection metadata.
- **Workspace trust**: GitHub repository detection and Worker discovery invoke local `git` (and `gh` when available) without a shell and run only in trusted workspaces.

## Development

Requires Node.js 20 or later, npm 10 or later, and VS Code 1.95.0 or later.

```sh
npm ci
npm run check
npm run test:extension
npm run package
```

`npm run check` runs ESLint, TypeScript type checking, Vitest unit tests, and the production esbuild bundle. `npm run package` produces a local `.vsix` file you can install in VS Code.

## Licence

Apache-2.0
