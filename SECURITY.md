# Security Policy

## Supported Surface

Security fixes should target the latest `main` branch state unless maintainers explicitly announce another supported release line.

## Sensitive Areas

Be careful with:

- logged-in browser sessions used by `chatgpt-web-bridge`
- exported review artifacts and debug snapshots
- local environment files and bridge/browser endpoints
- self-improvement and recovery scripts that operate on live artifacts

Do not publish cookies, tokens, screenshots containing private data, or full local artifact bundles in public issues.

## Reporting

If you discover a vulnerability:

1. Avoid opening a public issue with exploit details.
2. Prefer a private GitHub security advisory or another private maintainer contact path if one is available.
3. Include a minimal reproduction, affected files or routes, impact, and any required local preconditions.
4. Scrub credentials, session identifiers, and private artifact contents before sharing logs.

## Scope Limits

This repository intentionally does not support:

- credential bypass
- CAPTCHA bypass
- browser-login automation as a security workaround
- access-circumvention features

Reports that depend on those behaviors should be framed as unsupported behavior, not accepted feature requests.
