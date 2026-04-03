# Browser Attach Diagnostics

## Why this exists

As of April 3, 2026, the main blocker for a fully real planning proof is not the planning lane itself. The blocker is browser attach from the WSL-hosted `chatgpt-web-bridge` into a Windows-hosted Edge DevTools endpoint.

The observed failure mode was:

- Edge remote debugging could be reachable on Windows `127.0.0.1:<port>`.
- The same endpoint could still be unreachable or reset from WSL when addressed through the Windows host IP.
- `openSession` would fail before any planning request was sent.

A concrete example is a bridged CDP chain such as:

- Windows Chrome DevTools on `127.0.0.1:9224`
- Windows `portproxy` forwarding that to a WSL-visible host endpoint such as `172.18.144.1:9225`
- bridge `browserURL` configured to `http://172.18.144.1:9225`

This layer hardens that prerequisite instead of extending planning, review, or execution business logic.

## Runtime flow

`openSession` now has a formal browser attach preflight before `puppeteer.connect({ browserURL })`.

1. Discover endpoint candidates.
2. Probe each candidate in order.
3. Materialize a structured diagnostic with artifacts.
4. Select the first attach-ready candidate.
5. Allow `openSession` to continue only if preflight passes.

The actual browser attach still uses Chrome DevTools Protocol through Puppeteer. This work does not replace CDP. It makes CDP endpoint discovery, probing, and failure reporting explicit.

## Candidate discovery

The bridge builds endpoint candidates from:

- `BRIDGE_BROWSER_URL`
- `BRIDGE_BROWSER_URL_CANDIDATES`
- `BRIDGE_BROWSER_CONNECT_URL`
- `CHATGPT_BROWSER_URL`
- localhost candidates for `127.0.0.1` and `localhost`
- WSL host IP candidates discovered from:
  - `/proc/net/route` default gateway
  - `/etc/resolv.conf` nameserver entries

Ports default to `9222,9223`, or come from `BRIDGE_BROWSER_PORTS`.

When the real attach path uses a non-default bridged port such as `9225`, the bridge should receive it explicitly through `BRIDGE_BROWSER_URL`, `BRIDGE_BROWSER_URL_CANDIDATES`, or the request body.

Each candidate records:

- `source`
- `reason`
- normalized `endpoint`
- `versionUrl`
- `listUrl`
- lifecycle state:
  - `candidate_discovered`
  - `candidate_reachable`
  - `candidate_selected`
  - `candidate_rejected`

## Probe sequence

Each candidate is probed with:

1. TCP connect test
2. `GET /json/version`
3. `GET /json/list`

The probe result records:

- `tcpReachable`
- `versionReachable`
- `listReachable`
- `browserInfo`
- `targetCount`
- `selectedTarget`
- `failureCategory`
- `recommendations`

## Failure categories

Attach failures are classified into:

- `TCP_UNREACHABLE`
- `DEVTOOLS_VERSION_UNREACHABLE`
- `DEVTOOLS_LIST_UNREACHABLE`
- `NO_ATTACHABLE_TARGETS`
- `REMOTE_DEBUGGING_DISABLED_OR_BLOCKED`
- `BROWSER_ENDPOINT_MISCONFIGURED`
- `HOST_NETWORK_UNREACHABLE`

This prevents `openSession` failures from collapsing into a generic bridge error.

## Artifacts

Artifacts are written under the bridge artifact root. In the default local layout that is:

```text
services/chatgpt-web-bridge/src/artifacts/diagnostics/
  browser-endpoints.json
  browser-attach-latest.json
  browser-attach-preflight-latest.json
  probes/
    <probeId>.json
```

Evidence metadata includes:

- `browser_endpoint_candidate`
- `browser_endpoint_probe`
- `browser_attach_diagnostic`
- `browser_attach_preflight`
- `browser_attach_readiness`

## Bridge API

The bridge now exposes:

- `GET /api/diagnostics/browser-endpoints`
- `GET /api/diagnostics/browser-attach`
- `POST /api/diagnostics/browser-attach/run`
- `GET /api/diagnostics/browser-attach/latest`

## Boundaries

This is a local host-attach hardening layer. It is not:

- a cross-machine browser relay
- a distributed CDP proxy
- a replacement for Windows-side browser policy or firewall setup
