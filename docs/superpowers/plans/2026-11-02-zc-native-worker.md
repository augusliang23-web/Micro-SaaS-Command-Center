# Native worker plan — Issue #108

Owner explicitly selected autonomous inline execution. Spec: ../specs/2026-11-02-zc-native-worker-design.md.

1. RED/GREEN native boundary tests: environment allowlist, per-invocation profile TOML, native account/catalog/quota checks, correct message/tool classification and exact patch validation. Implement nativeClient.mjs; one patch-only turn, deadline, no automatic provider retry.
2. RED/GREEN real journal/replay and job-stage tests. Implement nativeJob.mjs: fixed grant, authenticated GitHub reservation/evidence, independent clone/branch, approved test preparation, exact CSS application, fixed offline test and tree match to existing PR. Source/command inputs never come from browser text.
3. Add bounded GitHub #107 comment and PR96 metadata operations, strict job GET/POST with existing Host/Origin/CSRF controls. UI uses local job status and evidence links; no UAT or approval inference.
4. Run offline exact-head CI and one independent review; fix material low-risk findings within two rounds. Only then enable one real Safari job, retain actual native/source/test evidence and review changed risks. Keep all PRs Draft.

Review focus: unintended provider billing/tool surfaces; scope escape via patch/paths/git; duplicate/uncertain invocation; unsafe execution of generated test code; false RUNNING/PASS/UAT claims. Existing PM tests are trusted/read-only; model may only propose the exact CSS line.
