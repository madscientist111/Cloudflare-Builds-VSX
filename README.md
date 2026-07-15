# Cloudflare Builds

Cloudflare Builds is a desktop VS Code-compatible extension for monitoring Cloudflare Workers Builds associated with the current GitHub workspace.

> The extension is under active development and does not connect to Cloudflare yet.

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
