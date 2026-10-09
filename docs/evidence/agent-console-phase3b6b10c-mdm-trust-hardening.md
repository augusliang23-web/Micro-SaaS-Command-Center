# Phase 3B6B.10C — offline MDM safety and schema-trust hardening

**Decision: MDM_TRUST_HARDENING_PASS** — ready for Control Plane review.

Offline work only. It does **not** authorize running the MDM command, issuing a permit or attestation, approving a schema, or any real Claude inference.
Provider calls **0**. Candidate executions **0**. No `sudo`, `profiles`, `doctor`, `auth status` or `claude -p` was run; no password, key or credential was touched.
**No real Mac policy path was inspected in this phase**: the normalizer was never run in a mode that could read the host (see Part A for how that is now impossible).
Runtime MDM admission stays `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED`; live execution stays `LIVE_EXECUTION_NOT_AUTHORIZED`.

## In plain language

Control Plane's review of the last step found two problems, both in the MDM helper:

1. **It could look at the real Mac by default.** I once ran it as a smoke check and it read the metadata of seven real policy locations. That was outside what was allowed.
   Fix: the helper no longer contains *any* way to read the computer. It cannot open files, find your home folder or see environment variables. The only "filesystem" it accepts is a pretend one built in memory for tests. With no pretend filesystem it reports "not inspected" and "blocked".
   A test now proves this three ways, including running the program with Node's own permission lock that forbids reading any file outside the scripts folder.
2. **A "review number" typed into a settings description could pass for approval.** Fix: a number someone types proves nothing. Trust is now a private stamp that only two functions can give out: one for test-only schemas (whose success word is `SYNTHETIC_…`, never a real one), and one that checks a list of approved schemas
   committed to the repository. That list is **empty**, so no real schema is approved, and the real success word `CURRENT_ABSENCE_OBSERVED` can no longer be produced at all.

## 1. Baseline

| Item | Value |
| --- | --- |
| PR | #24, OPEN / Draft / unmerged |
| Starting HEAD | `6025dbb265f2377b0f507a41287eed2b4e834263` |
| Control Plane review | 5466095478 (on exactly that commit; records the scope deviation) |
| Working tree before | clean |
| Ending HEAD | the commit containing this document (parent = the starting HEAD; hash reported on the PR) |

## 2. Part A — offline isolation

| Change | Effect |
| --- | --- |
| `scripts/phase3b6bMdmReadbackNormalizer.mjs` no longer imports `node:fs` or `node:os` (only `node:path`, `node:crypto`, `node:url`) | It cannot read files, resolve a home directory or look up a user |
| `createSyntheticFs({dirs, files, symlinks, errors})`: in-memory model, branded in a module-private set | The only filesystem that `inspectPolicyPath` / `normalizeMdmReadback` accept. The real `fs`, wrappers, proxies, copies and prototype tricks are **not** accepted |
| No synthetic filesystem supplied | Policy files are `NOT_INSPECTED`, `HOST_MODE=DISABLED`, overall `BLOCKED_REAL_HOST_MODE_DISABLED` — **fail closed, no fallback** |
| `REAL_HOST_MODE = { enabled: false }` (frozen constant) | No flag, option, environment variable or argument turns it on; any extra command-line argument yields `BLOCKED_UNKNOWN` |
| Command line reads **standard input only** | No `home`/`user` lookups, no fixture switch, no schema switch |

**Proof of zero real-host reads (three independent layers):**
1. *Static:* exactly three imports; no `require`/`import()`, no `process.env`, no `homedir/userInfo/tmpdir`, no `fs.`/`statSync`/`readFileSync`/`openSync`…, no `child_process`/`spawn`, no network; the word `lstatSync` appears exactly twice (the synthetic definition and its single call site).
2. *Runtime instrumentation:* the real `fs` (sync and `fs.promises`) was wrapped during a 60+ call matrix of the normalizer API, the command-line adapter, path inspection (including handing it the real `fs`) and schema resolution — **zero calls recorded**.
3. *Operating-system-level denial:* the command line ran under Node's permission model (`--experimental-permission --allow-fs-read=<scripts folder>`). A sanity probe confirmed the sandbox really denies reading `/Library` (`ERR_ACCESS_DENIED`), and the program still ran correctly (9 lines, `MANAGED_FILES=NOT_INSPECTED`, `OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED`).
   Extra arguments (`--real-host`, `--fixture=…`, bad `--rc`) behaved the same way.

I did not repeat any real-host command, and I did not run the normalizer outside these controlled forms.

## 3. Part B — schema trust

**Two distinct trust classes, both module-private brands (not properties a caller can write):**

| Class | How it is obtained | What it can produce |
| --- | --- | --- |
| `SYNTHETIC_TEST_SCHEMA` | `createSyntheticTestSchema(descriptor)` (tests) | Coverage logic can be exercised; the success word is `SYNTHETIC_ABSENCE_OBSERVED` and only with a synthetic filesystem |
| `CONTROL_PLANE_APPROVED_SCHEMA` | `resolveControlPlaneApprovedSchema(descriptor)` — only if the descriptor's exact SHA-256 matches an entry of the committed `APPROVED_SCHEMA_REGISTRY` | Nothing yet: **the registry is empty and frozen**, so this always returns `null` |

- **A reviewId proves nothing.** The descriptor no longer has a review field that matters; plain objects — even carrying the real review ids 5466095478, 5465429018 or 5449763219 — are `SCHEMA_TRUST=NONE`, coverage `UNQUALIFIED`. Copies, spreads, prototype tricks, JSON round-trips, proxies and objects claiming `kind: CONTROL_PLANE_APPROVED_SCHEMA` are all untrusted.
- **Identity is the schema's content hash**, canonicalized (key order irrelevant) and independent of any review id.
- **What a future approval must bind** (`matchApproval`): the exact schema SHA-256; a lowercase 40-hex commit; a positive integer review id; the fixed source `GITHUB_CONTROL_PLANE_REVIEW`; the repository `augusliang23-web/Micro-SaaS-Command-Center`; and the command class `profiles show -type configuration -all -output stdout-xml`. Any missing or different field → not approved (13 variants tested on synthetic registries).
- **`CURRENT_ABSENCE_OBSERVED` is unreachable**: it now appears only in comments, and a matrix over schemas, exit codes, outputs and filesystems never produced it. Even an approved schema would only change the label, because the host mode is still disabled; the best possible outcome is `SYNTHETIC_ABSENCE_OBSERVED`, which no other module reads or accepts (checked statically across `scripts/`).
- **Current MDM stays BLOCKED**, the default admission is still the constant `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED`, and the live gate is still `false`.

## 4. Negative tests (all synthetic; local offline, not CI)

New file `test/agent-console-phase3b6b10c-mdm-trust.test.mjs` (12 tests) plus the adapted 10B fixtures (15 tests): static isolation; no-filesystem and non-synthetic-filesystem inputs (9 forms) all `NOT_INSPECTED`; switch-on attempts with no effect; zero instrumented reads; sandboxed command line; unbranded schemas with real review ids; forgery attempts (8 forms);
empty frozen registry; approval-binding failures (13); unreachable `CURRENT_ABSENCE_OBSERVED`; no other module consumes the outcome; preserved budgets 1 and 3, the Sonnet 5.5 one-call mapping, the five-tool list and the event recorder.
Mutation check (each reintroduced and restored; all caught): accepting any object with `lstatSync` (4 failing tests), trusting a self-asserted review id (2), reading the brand from a property (2), a pre-populated registry (2), ignoring the commit format (1) and the review source (1), letting a disabled host mode succeed (4), emitting `CURRENT_ABSENCE_OBSERVED` (6), accepting extra arguments (1), importing `fs` (1), reading the home directory (2), reporting files absent without inspecting (3).

## 5. Part C — updated human runbook (**proposed; not authorized; not run**)

Supersedes the runbook in the 10A/10B documents. **Nobody should run anything below until Control Plane authorizes it in writing.**

**What changed:** the program no longer looks at policy files at all. Stage 1 therefore reports only what the `profiles` output itself shows.

**Stage 1 — future human-only command** (Mac owner, Terminal.app, zsh, at the repository checkout; the password is typed only at `sudo`'s own `Password:` prompt):

```zsh
raw="$(/usr/bin/perl -e 'alarm 180; exec @ARGV' -- /usr/bin/sudo -k -- /usr/bin/profiles show -type configuration -all -output stdout-xml 2>/dev/null)"; rc=$?
print -rn -- "$raw" | node scripts/phase3b6bMdmReadbackNormalizer.mjs --rc="$rc"
unset raw rc
```

Expected output: nine closed-vocabulary lines ending `MANAGED_FILES=NOT_INSPECTED`, `SCHEMA_TRUST=NONE`, `HOST_MODE=DISABLED`, `OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED` (or `BLOCKED_PRESENT` if the Claude domain is mentioned). It **can** show: the command's exit status, whether the output is well-formed XML, a Claude-domain mention, and the schema fingerprint. It **cannot** show: that the inventory is complete, that policy files are absent, or that any schema is trusted. It can never admit anything.

| Step | Who | Needs |
| --- | --- | --- |
| 1. Authorize the stage-1 command in writing (HEAD, run window) | Control Plane | A GitHub review naming the exact commit |
| 2. Run it; copy only the nine lines | Human Mac owner | Admin password, typed only at the real prompt |
| 3. Review the fingerprint against the `profiles` manual and the output shape | Control Plane | The fingerprint only; no raw profile text |
| 4. Propose a schema descriptor; compute its hash with the offline function (`schemaSha256`) | Execution agent (offline) | No host access |
| 5. Review that exact descriptor and commit; post the approval | Control Plane | GitHub review at that commit |
| 6. Add one registry entry (`schemaSha256`, `commitSha`, `reviewId`, source, repository, command class) in a reviewed commit | Execution agent, then Control Plane review | The entry in code form |
| 7. Separately design and authorize a real-host metadata mode for the seven policy locations | Control Plane | New code review, allow-listed paths, `lstat` only, typed human confirmation, tests under the permission sandbox |

**Schema verification.** A schema is acceptable only if its exact hash is in the committed registry *and* the entry's commit, review id, source, repository and command class bind correctly. The code cannot call GitHub, so confirming that the cited review really exists, is by the Control Plane and is on that commit is a **human/procedural** step at the time the entry is added.

**Remaining limitations.**
- Even with an approved schema, success is `SYNTHETIC_…` until a real-host mode exists; no code path can say "current absence observed".
- Without step 7 the seven policy locations are simply not checked.
- The real `profiles` output format, the zero-profile output, "run as root is complete" semantics, `perl alarm … exec`, `sudo -k` and `node` on the PATH are unverified assumptions (all fail closed).
- Same-user trust limits: ownership, permissions, a typed confirmation and a GitHub commit are not independent cryptographic authenticity.

## 6. Test results (local offline; not CI)

| Suite | Passed | Failed |
| --- | ---: | ---: |
| New MDM trust and isolation tests | 12 | 0 |
| MDM fixture tests (adapted) | 15 | 0 |
| One-call | 82 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **286** | **0** |

`node --check` passes on every modified or new script and test; `git diff --check` is clean.

## 7. Live blockers (unchanged)

A human privileged readback and Control Plane schema approval; a real-host metadata mode (or an accepted alternative); the operator envelope loader, permit issuer, fixed ledger, host binding, trust anchor and live-gate mechanism; the event-shape question for a real call;
and real 2.1.292 behaviour, never observed.

**Final decision: MDM_TRUST_HARDENING_PASS.** It does not authorize real execution.
