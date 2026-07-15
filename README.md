# Cloudflare Builds

Cloudflare Builds is a desktop VS Code-compatible extension for monitoring Cloudflare Workers Builds associated with the current GitHub workspace.

> The extension is under active development. Account connection works; Worker discovery and build monitoring are being implemented next.

## Connect securely

Use **Cloudflare Builds: Connect Cloudflare** and enter a user-scoped Cloudflare API token with:

- **Workers Builds Configuration: Edit**
- **Workers Scripts: Read**

The extension validates both permissions before storing the token in VS Code `SecretStorage`. Non-secret account identity is stored only in extension workspace state. **Disconnect** removes both.

Create and revoke tokens from [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens).

## Development

Requirements: Node.js 20 or later and npm 10 or later.

```sh
npm ci
npm run check
npm run test:extension
npm run package
```

## Security

Never place Cloudflare API tokens in workspace settings, source files, fixtures, or issue reports. Secure account storage will use VS Code `SecretStorage`.

See [the implementation plan](./plan.txt) for the MVP scope and security constraints.
