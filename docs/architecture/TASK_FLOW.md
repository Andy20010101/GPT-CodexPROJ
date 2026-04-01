# Task Flow

The system is designed for frozen inputs and explicit evidence handoff.

## Proposed Flow

1. Capture requirement bundle.
2. Freeze architecture and contract boundaries.
3. Prepare review prompt inputs and file attachments.
4. Call the Review Plane through `chatgpt-web-bridge`.
5. Export markdown and structured review output.
6. Feed the reviewed result into the execution agent.
7. Run acceptance checks and evidence collation.

## Near-Term Scope

Only step 4 and the service boundary needed for step 5 are implemented in this repository. The remaining flow is documented to avoid accidental architecture drift while the control plane is still a skeleton.
