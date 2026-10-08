# Phase 3B6B.9 — one-call live readiness

Decision: **ONE_CALL_LIVE_READINESS_BLOCKED**.
Managed-policy runtime decision: **MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED**.
Observed 2026-10-08 (Asia/Singapore). This attempt stops at the task's section 2
current-state admission condition. No admission bypass or one-call execution
path was implemented. Provider calls/inference **0 / 0**; real Claude -p **0**;
all candidate commands **0**.

## Exact baseline and verified review chain

Starting local and PR #24 HEAD:
`5b88611cc3bdd4ab4328c613363d2e6e414f9dfa`; worktree initially clean;
PR OPEN / Draft / unmerged. Direct GitHub API readback verified:

- [5439750877](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5439750877):
  owner-approved human device-wide MDM readback, PROFILES_EXIT=0 /
  COVERAGE=COMPLETE / CLAUDE_DOMAIN=ABSENT, submitted 2026-10-07T08:38:44Z.
- [5449763219](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5449763219):
  managed-policy PASS at f67053c41b96724157981705d6f4981bf8ed1e8e,
  based on endpoint evidence, observed Pro route, cache absence and semantic
  stability. That approved historical conclusion is preserved.
- [5453075906](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/pull/24#pullrequestreview-5453075906):
  offline Host-TCB contract PASS / LIVE HOLD at the exact starting HEAD;
  identifies both runtime policy admission and isolated one-call mode as
  unresolved blockers. Requires fresh host readback or an explicitly scoped
  trusted attestation; authorizes offline work only.

The earlier failed profile attempt is not reinterpreted as current state.
The later human PASS remains valid evidence of that historical observation.
The missing fact is current applicability/freshness, not review existence or
evidence precedence. No historical file was modified.

## Safe current-state checks

Only no-follow path/ancestor metadata was inspected; no policy/cache/settings or
credential contents were opened. Missing paths were distinguished from errors,
symlink ancestors and non-directory ancestors.

| Source | Current normalized observation |
| --- | --- |
| System managed-settings.json | ABSENT |
| System managed-settings.d | ABSENT |
| System managed-mcp.json | ABSENT |
| System managed-preference plist | ABSENT |
| Current-user system managed-preference plist | ABSENT |
| HOME managed-preference plist | ABSENT |
| Default-user remote-settings.json | ABSENT |
| Config/profile selector environment override | No checked selector name present |
| Current effective device-wide Claude MDM domain | NOT OBSERVED / UNKNOWN |
| Current authenticated/provider/subscription route | NOT OBSERVED / UNKNOWN; historical approved route retained separately |

No contradictory present file/cache was observed. That absence does not prove
the unobserved effective MDM/auth facts. No default-HOME substitution, copied
configuration or Pro-subscription assumption was used to manufacture admission.
No real CLI status probe was launched while endpoint admission remained unresolved.

Official [Anthropic managed-settings documentation](https://code.claude.com/docs/en/managed-settings)
distinguishes the macOS managed preference domain from file-based settings.
Public [CFPreferencesAppValueIsForced](https://developer.apple.com/documentation/corefoundation/cfpreferencesappvalueisforced(_:_:))
tests a specified key; this is not evidence that every applicable managed key
in every effective scope is absent. No complete, independently qualified
nonprivileged effective-domain absence mechanism was established here. A
limited key probe or defaults-domain listing must not substitute for that proof.
No CF preference value/policy payload was read.

## Runtime admission design and stop

A narrow future admission must conjunct:

1. Verified owner Control Plane evidence chain for this repository/candidate.
2. Authoritative current effective MDM absence, or a genuinely trusted current
   attestation with explicit host, execution scope, issuance/validity and
   invalidation conditions. Those conditions must be reviewed, not silently
   invented by changing an old review timestamp or choosing an arbitrary TTL.
3. Fresh safe file/drop-in/managed-MCP/supporting preference metadata all absent.
4. Fresh default-user cache absence and expected configuration context.
5. Fresh authoritative claude.ai / firstParty / Pro semantic route evidence
   obtained only after the endpoint prerequisite safely allows CLI startup.
6. Rechecks immediately before launch and after completion; any present,
   changed, unreadable, expired, contradictory or unknown required fact blocks.

Historical approval cannot unconditionally replace current effective-policy
proof. Reviews 5439750877 and 5449763219 do not supply a newly issued host/time/
execution-scoped attestation for this gate. Review 5453075906 explicitly asks
for that missing runtime reconciliation; it does not itself assert a fresh host
policy readback. No such attestation was fabricated.

Because current authoritative effective MDM absence is unresolved and a new
privileged profile inventory/diagnostic is prohibited, the task's explicit
STOP condition applies. The actual runtime inspector remains BLOCKED. Its
existing profiles/defaults probes were not invoked. No unconditional PASS,
policy content interpretation, helper execution or source-presence exception
was added.

## One-call scope — design only, not ready

The independent one-call path is **NOT IMPLEMENTED / NOT QUALIFIED** in this
stopped attempt. The existing full three-phase entrypoint must not be reused
for a single live call. Proposed boundary, for a later resumed scope:

- Separate qualification-only entrypoint and result schema, never fall through
  into runPhase3B6BQualification calls 2/3.
- MAX_SMOKE_PROVIDER_CALLS=1, cumulative pre-spawn accounting, failed start
  consumes budget, zero retries/continuations/fallbacks. No resetting within scope.
- Minimal host-owned input.txt and target.txt fixture; target.txt alone may
  change to exactly PHASE3B6B_SMOKE_EDITED plus one newline. No real project data,
  secret, executable fixture, Git operation or verifier handoff.
- Same pinned candidate/canonical restricted argv/positive environment/five-tool
  authority, model/auth/protocol proof, session checks, source/diff guard and
  Host-TCB process/IPC postconditions; minimized output only.
- Require MANAGED_POLICY_RUNTIME_ADMISSION_PASS and ONE_CALL_SMOKE_READINESS_PASS
  independently, followed by separate exact-scope live authorization. A budget
  of one is a ceiling, not launch authorization.

No smoke fixture was created, no one-call budget implementation/tests were
added, and no claim is made that the proposed path is ready. Full-suite
MAX_PROVIDER_CALLS=3 and all existing gates remain unchanged.

## Retained validation, safety and remaining proof

Existing local offline validation was rerun without changing executable code:

| Suite | Passed | Failed |
| --- | ---: | ---: |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| Existing total | **177** | **0** |
| New one-call readiness tests | NOT RUN / NOT ADDED | NOT APPLICABLE |

Existing observer/harness syntax and documentation diff checks passed. These
are local offline checks, not CI, and do not prove one-call readiness. No
unrelated baseline suite fixes were made.

Only this evidence document changed. Candidate/legacy installations, harness,
lifecycle observer, tests, production adapter/Orchestrator, Run API, UI and
deployment configuration are unchanged. No candidate version/help/auth/doctor/
interactive/-p command, auth mutation, secrets/Keychain inspection, sudo/root/
profiles/MDM inventory, package install, EndpointSecurity change, real MCP/browser/
Git/SSH/Orchestrator activation, merge or deploy occurred.

The accepted Host-TCB residual risk remains as documented in
[3B6B.8](agent-console-phase3b6b8-host-tcb-postcondition-contract.md): trusted
short-lived internal activity can be unobserved; model-controlled authority,
persistent escape and filesystem escape are not accepted. No full transient
history claim is made.

First supply/qualify the missing current effective-policy evidence or explicit
trusted scoped attestation under a new Control Plane scope. Then resume the
offline isolated one-call implementation/tests. Fresh real candidate/model/
authority/lifecycle/session/filesystem proof remains real-only and separately
authorized. Default LIVE_EXECUTION_NOT_AUTHORIZED remains BLOCKED; PR #24 stays
Draft and unmerged.
