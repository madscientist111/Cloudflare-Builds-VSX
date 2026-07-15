# Security Policy

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include API tokens, build logs, account identifiers, or other confidential data in an issue.

Use [GitHub private vulnerability reporting](https://github.com/madscientist111/Cloudflare-Builds-VSX/security/advisories/new). If a credential may have been exposed, revoke it before submitting the report.

## Data-handling commitments

- Cloudflare API tokens are stored only through VS Code `SecretStorage`.
- Tokens, authorization headers, environment values, and build-token metadata must not be written to diagnostics or fixtures.
- Build logs are displayed locally and are not persisted by default.
- The extension does not collect product telemetry.
- Subprocess execution is disabled in untrusted workspaces and never uses a shell.

## Supported versions

The project is pre-release. Security fixes are applied to the latest revision until the first public version is published.
