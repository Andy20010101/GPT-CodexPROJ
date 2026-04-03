# WSL Host Browser Attach

## Current blocker

The real proof blocker on April 3, 2026 is environment-specific:

- the bridge runs inside WSL
- Edge remote debugging runs on Windows
- WSL cannot assume Windows `127.0.0.1` works
- even when Windows localhost works, the WSL-visible host IP can still be blocked or reset

This means a valid Windows DevTools endpoint is necessary but not sufficient. The endpoint also has to be reachable from WSL.

## Start the browser and expose it to WSL

There are two layers in the common setup:

1. Chrome or Edge remote debugging on Windows localhost
2. a Windows-side bridge such as `netsh interface portproxy` so WSL can reach that endpoint

Example chain:

- Windows Chrome DevTools: `127.0.0.1:9224`
- WSL-visible bridge endpoint: `172.18.144.1:9225`
- bridge config: `BRIDGE_BROWSER_URL=http://172.18.144.1:9225`

## Start Edge with remote debugging

From Windows PowerShell:

```powershell
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  -ArgumentList '--remote-debugging-port=9223','--remote-debugging-address=0.0.0.0'
```

Use a dedicated profile if you want a predictable browser state.

If WSL cannot reach Windows localhost directly, expose it with Windows `portproxy` or an equivalent host-to-WSL forwarding rule.

## Verify on Windows first

```powershell
Invoke-WebRequest http://127.0.0.1:9223/json/version
Invoke-WebRequest http://127.0.0.1:9223/json/list
```

If these fail on Windows, the bridge cannot attach either. Typical causes:

- Edge was not started with `--remote-debugging-port`
- policy blocks remote debugging
- the wrong port was used

## Verify from WSL

Use the diagnostics API or direct curl:

```bash
curl -sS http://127.0.0.1:9223/json/version
curl -sS http://<windows-host-ip>:9223/json/version
curl -sS http://<windows-host-ip>:9223/json/list
```

The bridge candidate strategy tries:

1. explicitly configured endpoints
2. localhost endpoints
3. WSL host IP endpoints discovered from route gateway and `resolv.conf`

If localhost fails but host IP works, the bridge will select the host IP candidate.

If your real attach path is a portproxy endpoint such as `172.18.144.1:9225`, pass it explicitly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts --browser-url http://172.18.144.1:9225
```

## One-command check

With the bridge running:

```bash
npm run check:browser-attach --workspace @review-then-codex/chatgpt-web-bridge
```

Or directly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts
```

The script:

- lists discovered candidates
- probes each endpoint
- reports the selected candidate
- shows whether `/json/version` and `/json/list` are reachable
- tells you whether `openSession` preflight would pass

## Fallback strategy

The bridge does not silently switch endpoints. It probes and records each candidate, then selects one explicitly.

Recommendations are mapped to the observed failure:

- `start Edge with --remote-debugging-port`
- `check RemoteDebuggingAllowed policy`
- `use host IP instead of localhost`
- `enable mirrored networking or adjust firewall`
- `ensure correct user profile / target tab exists`

## When WSL still cannot attach

If Windows localhost works but WSL host IP does not:

- enable mirrored networking if your WSL setup supports it
- verify Windows firewall rules for the chosen debugging port
- verify the Windows `portproxy` rule still points at the active browser debugging port
- retry on another port such as `9222` or `9223`
- confirm the bridge is probing the Windows host IP, not just `127.0.0.1`

## Boundary

This repository currently supports host-local diagnostics for WSL-to-Windows browser attach. It does not provide a general remote browser proxy for other machines.
