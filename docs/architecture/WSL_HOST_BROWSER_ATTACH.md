# WSL Host Browser Attach

## Current blocker

The real proof blocker on April 3, 2026 is environment-specific:

- the bridge runs inside WSL
- Edge remote debugging runs on Windows
- WSL cannot assume Windows `127.0.0.1` works
- even when Windows localhost works, the WSL-visible host IP can still be blocked or reset

This means a valid Windows DevTools endpoint is necessary but not sufficient. The endpoint also has to be reachable from WSL.

## Supported local self-improvement baseline

For the currently supported local self-improvement mode, freeze one WSL-visible browser endpoint before the fresh run starts and keep it fixed for the whole run.

The current validated baseline is:

- browser endpoint: `http://172.18.144.1:9224`
- bridge endpoint: `http://127.0.0.1:3115`

If diagnostics prove that the real WSL-visible attach path is a different endpoint such as `http://172.18.144.1:9225`, use that endpoint consistently in `doctor`, `ensure`, `--prepare-only`, and `--run-id` resume commands. Do not switch between `9224` and `9225` mid-run.

## Start the browser and expose it to WSL

There are two layers in the common setup:

1. Chrome or Edge remote debugging on Windows localhost
2. a Windows-side bridge such as `netsh interface portproxy` so WSL can reach that endpoint

Example chain:

- Windows browser DevTools source: `127.0.0.1:9224`
- common WSL-visible direct endpoint: `172.18.144.1:9224`
- possible WSL-visible portproxy endpoint: `172.18.144.1:9225`
- bridge config: `BRIDGE_BROWSER_URL=<selected WSL-visible endpoint>`

## Start Edge with remote debugging

From Windows PowerShell:

```powershell
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  -ArgumentList '--remote-debugging-port=9224','--remote-debugging-address=0.0.0.0'
```

Use a dedicated profile if you want a predictable browser state.

If WSL cannot reach Windows localhost directly, expose it with Windows `portproxy` or an equivalent host-to-WSL forwarding rule.

## Verify on Windows first

```powershell
Invoke-WebRequest http://127.0.0.1:9224/json/version
Invoke-WebRequest http://127.0.0.1:9224/json/list
```

If these fail on Windows, the bridge cannot attach either. Typical causes:

- Edge was not started with `--remote-debugging-port`
- policy blocks remote debugging
- the wrong port was used

## Verify from WSL

Use the diagnostics API or direct curl:

```bash
curl -sS http://127.0.0.1:9224/json/version
curl -sS http://<windows-host-ip>:9224/json/version
curl -sS http://<windows-host-ip>:9224/json/list
```

The bridge candidate strategy tries:

1. explicitly configured endpoints
2. localhost endpoints
3. WSL host IP endpoints discovered from route gateway and `resolv.conf`
4. Windows `portproxy` listen ports discovered directly from `netsh interface portproxy show all`

If localhost fails but host IP works, the bridge will select the host IP candidate.

If your real attach path is a portproxy endpoint such as `172.18.144.1:9225`, pass it explicitly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts \
  --base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9225 \
  --startup-url https://chatgpt.com/
```

In the common case you do not need to hand-copy that port anymore. If the Windows `portproxy` rule exists, the bridge diagnostics can discover the WSL-visible listen port automatically.

Record the selected candidate before the fresh run starts and pass the same endpoint to the self-improvement bootstrap/run commands. Do not treat attach diagnostics as permission to hot-swap endpoints during an active run.

## One-command check

With the bridge running:

```bash
BRIDGE_BASE_URL=http://127.0.0.1:3115 \
  npm run check:browser-attach --workspace @gpt-codexproj/chatgpt-web-bridge
```

Or directly:

```bash
TMPDIR=/tmp npx tsx scripts/check-browser-attach.ts \
  --base-url http://127.0.0.1:3115 \
  --browser-endpoint http://172.18.144.1:9224 \
  --startup-url https://chatgpt.com/
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
- retry on another port only before the fresh run starts, then freeze the selected WSL-visible endpoint for that run
- confirm the bridge is probing the Windows host IP, not just `127.0.0.1`

## Boundary

This repository currently supports host-local diagnostics for WSL-to-Windows browser attach. It does not provide a general remote browser proxy for other machines.

For the complete supported operator workflow after attach is ready, continue with [`REAL_SELF_IMPROVEMENT_SOP.md`](/home/administrator/code/GPT-CodexPROJ/docs/architecture/REAL_SELF_IMPROVEMENT_SOP.md).
