# ZC-08A — Command Center Live Monitor (first, strictly read-only slice)

Issue #96. Development branch: zc/zc08a-live-monitor-readonly.

## What this Draft PR actually does

- Adds a third tab to the EXISTING V1 Command Center UI: **Live Monitor**.
- Uses only pre-existing GET /api/github/development-history, with exactly the registered project and existing client/server repo allowlist. No API or GitHub permission change.
- Browser checks every 30 seconds while monitor is visible and online. It avoids overlapping fetches, cancels on switch/unmount, and permits manual GitHub refresh=1.
- The current server cache is FIVE MINUTES. The 30 seconds is a local CHECK cadence, NOT proof of 30-second GitHub freshness. The UI shows the source fetchedAt and local check time separately.
- Shows PR changes by observed GitHub updatedAt, never inferred Agent activity. Agent execution, exact-HEAD GitHub CI and Codex Review are deliberately UNKNOWN / NOT_CHECKED until reviewed ZC08B telemetry.
- No provider, agent, saved-state mutation, GitHub write, merge, deploy, local Mac change or network call beyond the existing local GET endpoint.

## What it cannot yet show

- PR #36/#37 in the separate cc-h15a-claude-dispatch-lab repository. The current real GitHub history allowlist includes ONLY augusliang23-web/pm-dashboard.
- A live Codex Desktop terminal or Antigravity's actual file edits. GitHub PR comments are not Agent heartbeat evidence.
- Actual Mac Dock installation, a currently running local service, Safari verification or unattended 24-hour execution.

## Future ZC-08B (separate security-approved task)

Build a narrow GET-only source for ZC PR #36/#37, exact-HEAD CI, Codex review status, evidence time and agent execution visibility limits. Prefer a lightweight bounded endpoint, not repeatedly downloading the entire multi-year development history every 30 seconds. No tokens/secrets/raw logs.

## Mac one-click opening — existing Issue #86 is the authority

The root start-command-center.command currently points to localhost:3000 in npm development mode from the script's owning checkout. Prior localhost:4001 was used for a synthetic adapter, not the canonical UI. It is not safe to assume any currently installed Mac Dock icon or desktop shortcut targets the reviewed runtime.

Issue #86 already describes safe clean-main activation and the guarded double-click launcher cutover. Do not overwrite the old launcher or dirty checkout, retarget shortcuts, stop listeners, install anything on the Mac, or create background daemons here. A separate owner-side local audit must verify paths, ports, alias metadata and rollback, create a NEW user-facing entry only when safe, and complete Safari validation. Dock pinning follows validated activation.

## Gates

- ZC08A_CLIENT_DRAFT: code candidate only.
- Offline unit tests, TypeScript lint/build, independent QA and human Safari acceptance are not yet established.
- ZC08B_REAL_ZC_TELEMETRY: blocked; no additional repo permission yet.
- LOCAL_DOCK_LAUNCHER: not installed; user Mac unchanged.
- Merge/deploy/provider/agent: not authorized.
- Stop at READY_FOR_REVIEW.
