# ZC Pilot intake implementation plan

Spec: ../specs/2026-11-01-zc-pilot-intake-design.md. Issue #105 freezes scope; owner explicitly opted out of intermediate approvals. Implement inline; one independent reviewer at the end.

1. Contract/service tests first: reject scope/version escalation, absent vs recorded status, repeat/concurrent creation, malformed and duplicate evidence, uncertain write. Implement immutable `TASK`, `issueBody`, `validateTask`, `createIntakeService({github,allowWrite})` with `read()` and `create()`.
2. Adapter and HTTP boundary tests first: exact repository metadata, complete pagination, fixed POST and no retry, target-base drift, Host/Origin/token/method/JSON/size guards. Implement `createGithubAdapter({request})`, `createPilotServer({service,port})`; no external calls in tests.
3. Static UI: create and refresh buttons, truthful separate intake/worker/test/UAT states; render all external data as text. Exercise browser journey against live GitHub using the existing session.
4. No-install exact-head CI, documentation and Draft PR; independently review actual diff and focused tests. Fix clear findings with regression evidence, maximum two review/fix rounds. No merge/deploy.

Review focus: duplicate/ambiguous POST, edited issue body/source lookalikes, head drift, forged browser request, misleading worker or acceptance claims. No additional product architecture.
