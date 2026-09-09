# Architecture

```text
React UI -> /api/state -> loopback state router -> data/app-state.json
React UI -> /api/github/* -> loopback GitHub router -> read-only GitHub CLI queries
CodexHandoffPanel -> /api/bridge/codex-handoffs -> local allowlist
  -> CodexHandoffService -> Codex App Server
```

The state router accepts only loopback browser origins and persists validated
local JSON. It is local persistence, not a shared system of record or evidence
of an approval.

The GitHub router accepts only loopback browser origins and exposes repository
and pull-request reads. It does not create Issues, change labels, approve,
merge, deploy, or otherwise write GitHub state.

The V0.4 handoff route is available only in local development, requires the
expected loopback origin and a server-side local allowlist, and routes through
the Codex App Server. Its proposal capability is a read-only repository
inspection. Visible dashboard state and handoff text are not authoritative
approval or execution evidence.

The provider-facing `/api/bridge/chatgpt-advice` and
`/api/bridge/extract-features` routes remain protected. Provider behavior,
workspace-write execution, GitHub writes, authentication, deployment, and
release actions are outside onboarding and require separate authorization.
