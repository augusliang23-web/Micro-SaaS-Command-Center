# Phase 3B6B.10B — offline event diagnostics and MDM fixture verification

**Decision: OFFLINE_DIAGNOSTICS_MDM_PASS** — ready for Control Plane review.

Offline work only. It does **not** authorize running the MDM command, issuing a permit or attestation, or any real Claude inference.
Provider calls **0**. Candidate executions **0**. No `sudo`, `profiles`, `doctor`, `auth status` or `claude -p` was run; no password was requested; no key was created.
Runtime MDM admission stays `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED`; live execution stays `LIVE_EXECUTION_NOT_AUTHORIZED`.

## In plain language

1. **Event diagnostics (Part A).** If the first real Claude call ends "UNKNOWN" because it printed a kind of message we do not recognise, we now keep a tiny, safe
   "fingerprint" of each message — its position, its kind from a fixed list, whether it carried security-relevant fields — and **nothing else**. It is a note-taker, not a gatekeeper:
   it cannot let anything through, and it cannot hold anything back.
2. **MDM check (Part B).** The earlier draft shell snippet is replaced by a small program that was tested on made-up inputs. The key lesson: *a well-formed XML file does not prove
   the list of installed profiles is complete.* Without a reviewed description of what `profiles` really prints, the program refuses to say "no policy found". Today it can only say
   "blocked: format not reviewed", and it prints a harmless description of the format so a human reviewer can qualify it. Nothing was run on a real Mac.

## 1. Baseline

| Item | Value |
| --- | --- |
| PR | #24, OPEN / Draft / unmerged |
| Starting HEAD | `f6ad755defbaa3a6c1374c7827ef2e5b5dca7c7a` |
| Control Plane review | 5465429018 (on exactly that commit) |
| Working tree before | clean |
| Ending HEAD | the commit containing this document (parent = the starting HEAD; hash reported on the PR) |

## 2. Part A — event shape diagnostics (recording only)

**Module:** `scripts/phase3b6bOneCallShapeRecorder.mjs`; wired only into the one-call path (`runSmokeCall`). The production parser, adapter, the three-call harness and the event-admission rules are **unchanged**.

**What is recorded, per message (at most 64 messages; extra ones are only counted):**

| Field | Values (closed lists, booleans or buckets) |
| --- | --- |
| `ordinal` | 1, 2, 3 … (bounded integer) |
| `stage` | `BEFORE_INIT`, `INIT`, `ACTIVE`, `AFTER_RESULT` |
| `type` | `system`, `assistant`, `user`, `result`, `rate_limit_event`, `OTHER`, `NONE`, `MALFORMED` |
| `subtype` | the 19 recognised sub-types (for example `init`, `status`, `hook_started`, `task_started`, `success`), else `OTHER` or `NONE` |
| `sessionMatch` | `true` / `false` / `null` (no session field) — a comparison result only |
| `sensitive` | 12 booleans: whether the message *has* tools, mcp_servers, plugins, agents, apiProvider, authMethod, permissionMode, cwd, model, permission_denials, a tool-use block, a tool-result block |
| `keyCountBucket`, `sizeBucket` | `0 / 1-4 / 5-8 / 9-16 / 17+`, and `<=256 … <=1M / OVERSIZE` |

**Safeguards.** Never stored: raw payloads, field names other than the 12 fixed presence flags, values, session ids (compared, never kept), file paths, credentials, prompt or model text, or the unrecognised sub-type/type text (it becomes `OTHER`).
Lines over 1 MiB are not parsed. A broken line is `MALFORMED`. The recorder cannot throw into the run (its own `try/catch`, plus a guard at the call site and a safe snapshot), and the serializer re-projects the record through the existing closed vocabulary, redacting anything outside it.
The diagnostics sit in the same evidence record and are covered by its integrity binding, but the PASS rule never reads them.

**Admission preserved (tests):** a recorder that throws at creation, throws on every line, returns nothing or returns garbage leaves the result unchanged. `rate_limit_event`, a non-init `system` status, a hook event or an unknown sub-type — placed after `init`, before `init` or after the result — all remain **UNKNOWN**
(and their fingerprint says exactly which stage). Provider override, auth override and a foreign session id remain **FAIL**; a tool-bearing look-alike remains non-PASS; forbidden tools, extra tools and lifecycle violations remain FAIL. A mutation that let the observer skip `rate_limit_event` failed 2 tests; one that let a recorder error propagate failed 1.

## 3. Part B — MDM readback logic, verified on synthetic fixtures only

**Module:** `scripts/phase3b6bMdmReadbackNormalizer.mjs` — pure functions plus a thin command-line adapter. It contains no process launching, no network and no environment input (a test asserts this). It was **never run against real `profiles` output**.

**What it does**
- Takes the command's **own exit code** and its output text from the caller; the shell captures the code before anything else.
- Parses the output with a strict XML property-list reader (no entities, no CDATA, no internal DOCTYPE, duplicate keys rejected, depth/node/size limits). Anything unusual is malformed.
- Treats **any** mention of `com.anthropic.claudecode` — in keys, values, nested items or decoded data blobs (three text encodings) — as PRESENT. Other `anthropic` mentions or nested policy payloads inside data blobs make the answer UNKNOWN, never ABSENT.
- Inspects the seven policy sources by `lstat` on **every ancestor**: an absent final entry counts as ABSENT only if all earlier components were verified plain directories; a symlinked or non-directory ancestor, an unreadable path or an unexpected error is UNKNOWN; a symlink (even dangling) at the policy path is PRESENT.
- Decides with a fixed table; every uncertainty maps to a BLOCKED word.

**The completeness rule (the important one).** A well-formed plist proves *syntax only*. `COMPLETE` coverage requires all of: the command exited 0 with no signal or timeout, the output is non-empty and under the size cap, it parses, and **a reviewed schema** that the caller supplies recognises its structure
(inventory key, required entry keys, no unexpected root keys; an empty inventory counts only if the schema says so explicitly). A schema counts as reviewed only if it carries an integer review id. The real command-line entry supplies **no** schema, so today the best real answer is `BLOCKED_SCHEMA_UNQUALIFIED`, together with
a schema fingerprint made of fixed words (root kind, key-count bucket, whether the two expected names are present, whether all entries are dictionaries). `CURRENT_ABSENCE_OBSERVED` can occur only with a reviewed schema, a complete inventory, no Claude domain, and all seven sources verified absent.

**Fixture results (15 tests, all synthetic, in-memory fake filesystem):**

| Scenario | Result |
| --- | --- |
| Complete inventory + reviewed (synthetic) schema + clean metadata | `CURRENT_ABSENCE_OBSERVED` (the only PASS path; proves the machinery, not the real format) |
| Same inventory, no reviewed schema (9 invalid-schema variants) | `BLOCKED_SCHEMA_UNQUALIFIED` |
| Well-formed but semantically partial (extra root key, missing entry key, wrong types, missing inventory key, empty inventory, root array/string/empty dict, mixed entries) | `PARTIAL`, never PASS |
| Malformed XML (24 variants incl. truncation, entities, CDATA, DOCTYPE entity, duplicate key, depth bomb, NUL, trailing junk, wrong version) | rejected |
| Empty / missing / non-string / oversize output | never complete |
| Permission denied, exit 1/2, sudo failure text, timeout (exit 142), kill (137), `timedOut`, signal, missing/NaN/negative/string status | `FAILED`, never PASS |
| Claude domain present (profile id, display name, upper case, nested key, UTF-16 LE/BE and Latin-1 data blobs, text inside failed or malformed output) | `BLOCKED_PRESENT` |
| Other Anthropic reference, nested policy payload in a blob | `BLOCKED_UNKNOWN` |
| Readback "absent" but any of the 7 sources present | `BLOCKED_CONTRADICTORY` (each source tested) |
| Symlinked policy file, dangling link, symlinked ancestor, symlinked home, non-directory ancestor | present or UNKNOWN, never absent |
| EACCES, EPERM, EIO, ELOOP, ENOTDIR, ETIMEDOUT, no code, thrown non-Error, throwing stat | UNKNOWN |
| Non-canonical paths | UNKNOWN |
| Hostile inputs (null, getters that throw, missing filesystem) | never throws, never PASS |
| 192-combination false-PASS matrix | exactly 2 PASS combinations: the synthetic complete inventory with exit 0, a reviewed schema and a clean filesystem |
| Output sanitization | 7 closed-vocabulary lines; profile names, ids, "secrets", paths and key names never appear |

Mutation check (each reintroduced and restored): schema not required (3 failing tests), exit status ignored (3), ancestor symlink ignored (1), any filesystem error treated as absent (1), data blobs not scanned (2), contradiction not detected (3), duplicate keys allowed (1), domain text in malformed output ignored (1). One mutant was equivalent: dropping the "other Anthropic reference" check alone still yields UNKNOWN because the scan state already blocks ABSENT — two independent guards.

## 4. Proposed human runbook (updated; **not authorized to run, not run**)

Supersedes the shell-only snippet in `agent-console-phase3b6b10a-compatibility-mdm-runbook.md`.

**Who / where:** the Mac's owner, in Terminal.app (zsh), at the repository checkout. The agent never sees a password and runs none of this. The password is typed only at `sudo`'s own `Password:` prompt; if it does not appear, stop.

```zsh
raw="$(/usr/bin/perl -e 'alarm 180; exec @ARGV' -- /usr/bin/sudo -k -- /usr/bin/profiles show -type configuration -all -output stdout-xml 2>/dev/null)"; rc=$?
print -rn -- "$raw" | node scripts/phase3b6bMdmReadbackNormalizer.mjs --rc="$rc"
unset raw rc
```

How each requirement is met: the command's own status is captured by assignment before any other command runs (`rc=$?`), not through a pipe; the perl wrapper ends a hung `sudo` after 180 seconds (an operational limit Control Plane may change, status 142); raw text lives only in a shell variable and a pipe (a here-string is deliberately avoided because zsh can spill large ones to a temporary file);
stderr is discarded; the program prints seven normalized lines and nothing else; **no seven lines = BLOCKED**.

**Two human stages.** Stage 1 (first authorized run) can only produce `BLOCKED_SCHEMA_UNQUALIFIED` plus the schema fingerprint — that is the point: the fingerprint, not a pass, is what Control Plane reviews. A later offline task would then add a reviewed schema (recorded with that review's id), and only then can a later human run reach `CURRENT_ABSENCE_OBSERVED`. Run it again after any future call; both results must agree.

| Class | Items |
| --- | --- |
| **Proven** (by reviews/documents or by language rules) | The command class was already approved and run once by a human (review 5439750877); no raw profile data was ever stored in the repository; assigning a command substitution to a variable yields that command's exit status (shell language rule, not re-tested here) |
| **Synthetic offline validation** (this phase) | Parser strictness, domain/reference/blob scanning, path and ancestor inspection, exit/timeout/failure handling, the decision table, no-PASS-without-reviewed-schema, closed-vocabulary output |
| **Assumptions that need real macOS verification** | The real XML structure of `profiles show -all` (including the `_computerlevel` and `ProfileIdentifier` names used only for the fingerprint); what it prints when **no** profiles exist; that "-all as root" is complete in the sense required; that a managed Claude profile leaves its domain text in this inventory; that the seven paths are the only relevant sources; that `/Library/Managed Preferences` is readable without privilege (otherwise UNKNOWN); that `perl alarm … exec` and `sudo -k` behave as described; that `node` is on the PATH |

## 5. Remaining human-only verification and blockers before live execution

- Human, once separately authorized: the privileged readback (stage 1), then Control Plane review of the fingerprint and a reviewed schema (stage 2).
- Still unbuilt and unauthorized: the real operator envelope loader, permit issuer and fixed ledger, host binding, a real trust anchor, the live-gate mechanism.
- Event allow-list (R2) remains absent: a real call may still end UNKNOWN; its fingerprint will now say why, and the permit is still spent.
- Real 2.1.292 behaviour (model label, tool-inventory message, process probe, `lsof`) has never been observed.
- Same-user trust limits remain: file ownership, folder permissions, a typed confirmation and a GitHub commit are not independent cryptographic authenticity.

## 6. Changed files and tests (local offline; not CI)

New: `scripts/phase3b6bOneCallShapeRecorder.mjs`, `scripts/phase3b6bMdmReadbackNormalizer.mjs`, `test/agent-console-phase3b6b10b-mdm-fixtures.test.mjs`, this document.
Modified: `scripts/phase3b6bOneCallSmoke.mjs` (recorder wiring, vocabulary), `test/agent-console-phase3b6b9a-one-call-smoke.test.mjs` (7 new diagnostic tests).
Unchanged: production code, parser and adapter, the three-call harness, the Host-TCB lifecycle observer, all historical evidence, the default gates.

| Suite | Passed | Failed |
| --- | ---: | ---: |
| One-call (75 prior + 7 new diagnostic tests) | 82 | 0 |
| New MDM fixture tests | 15 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification (three-call) | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **274** | **0** |

`node --check` passes on every new or modified script and test; `git diff --check` is clean.

**Final decision: OFFLINE_DIAGNOSTICS_MDM_PASS.** It does not authorize real MDM commands, permit issuance or Claude inference.
