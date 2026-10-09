# Phase 3B6B.10A — offline protocol compatibility and human MDM runbook

**Decision: OFFLINE_COMPATIBILITY_PREFLIGHT_PASS** — ready for Control Plane review.

This is offline work only. It does **not** authorize running the MDM command, issuing a permit or attestation, or any real Claude inference.
Provider calls **0**. Candidate executions **0**. No `sudo`, `profiles`, `doctor`, `auth status` or `claude -p` was run, no password was requested, no key was created,
and the MDM command and summarizer in section 7 were **written but not run**. Runtime MDM admission stays `MANAGED_POLICY_RUNTIME_ADMISSION_BLOCKED`;
live execution stays `LIVE_EXECUTION_NOT_AUTHORIZED`.

## In plain language

Two things were likely to waste the single launch ticket on the first real call. I looked at each:

- **The model name (R1).** Published Anthropic documentation confirms that `claude-sonnet-5-5` is the real, exact ID of Sonnet 5.5, and Claude Code's documentation says the `sonnet` shortcut points to it.
  That is enough to recognise this one exact name as "Sonnet" — **in the one-call path only**. Whether the candidate will actually report that name is still unobserved.
- **Extra status messages (R2).** Our old records only kept the *names* of message kinds, not their contents, and one kind (`system`) did not keep its sub-type. Published documentation shows several `system` sub-types
  (hooks, background tasks, subagent tasks) that are exactly the things the fence is meant to catch. So there is not enough evidence to say "these are harmless", and **I changed nothing** there. The checker still ends such a run as UNKNOWN.
- **The human MDM check (R3).** A complete, ready-to-review command and a fail-closed summary of its result are drafted below. Nobody has run them.

## 1. Exact baseline

| Item | Value |
| --- | --- |
| PR | #24, OPEN / Draft / unmerged |
| Starting HEAD | `f8ba651d5087b9013112db152baf782d1aad7c21` |
| Control Plane review | 5464554410 (on exactly that commit) |
| Working tree before | clean |
| Ending HEAD | the commit containing this document (parent = the starting HEAD; hash reported on the PR) |

## 2. R1 — model identifier

| Evidence | What it shows | Weight |
| --- | --- | --- |
| Repository: committed 3B4 evidence (Claude 2.1.260) | The accepted label then was `claude-sonnet-5`; a run's label list also showed `<synthetic>` placeholders | Real, but a different CLI version |
| [Anthropic model overview](https://platform.claude.com/docs/en/models/overview) | Claude Sonnet 5.5's API ID and alias are `claude-sonnet-5-5`; every ID is a pinned snapshot; `claude-sonnet-5` is a legacy model | Authoritative for "this exact string is a Sonnet model" |
| [Claude Code model configuration](https://code.claude.com/docs/en/model-config) | On the Anthropic API the `sonnet` alias resolves to `claude-sonnet-5-5`; "aliases … update over time" | Authoritative for the *current* release, not necessarily the pinned 2.1.292 binary |
| Candidate binary | **Not inspected**, not executed (static string search was considered and declined; it would not prove the label the API returns) | — |

**Decision: `MODEL_LABEL_SUPPORTED_EXACT` (one label), runtime label still not observed.** The documentation establishes what the string *is*. It cannot establish what 2.1.292 will *report*.

**Code changed (additive, default-preserving):**
- `scripts/claudeLiveSmoke.mjs`: `createSmokeObserver(…, { additionalModelFamilies })`. The option is validated: each entry must be `claude-<family>-<n>[-<n>]` and may map only to *its own* family (a Sonnet label can never mean Opus), at most four entries, no wildcards, no placeholders, no overlap with the closed list. Matching stays exact-string; there is no substring or prefix matching.
- `scripts/phase3b6bSyntheticNegativeQualification.mjs`: `createQualificationObserver` passes the option through (two lines).
- `scripts/phase3b6bOneCallSmoke.mjs`: passes `{ 'claude-sonnet-5-5': 'sonnet' }`, and only there.
- **Unchanged by default:** the three-call harness and the 3B4 diagnostic still treat `claude-sonnet-5-5` as UNKNOWN (tested). The production parser and adapter were not touched.

Preserved: authoritative execution metadata is still required; an unknown label is UNKNOWN; a recognised wrong family (`opus`) is FAIL; conflicting labels are CONFLICT; placeholders are SYNTHETIC; usage metadata alone never proves the model.
One honest side effect: an *unrecognised* Opus label such as `claude-opus-5-5` is UNKNOWN (fails safe) rather than FAIL; I did not widen the list beyond what was asked.

**Remaining uncertainty:** 2.1.292 may report `claude-sonnet-5` (accepted), `claude-sonnet-5-5` (now accepted), or something else, e.g. a dated snapshot (UNKNOWN, permit spent).

## 3. R2 — informational stream events

**What the committed evidence actually contains** (`…phase3b4-final-live-smoke.json` and the post-auth record, both Claude **2.1.260**, plus the 3B4 architecture note):

- Message *kinds* in first-seen order: `system:init`, `rate_limit_event`, `assistant`, `user`, `system`, `result`.
- That is all. **No field names, no sub-type for the second `system` message, no raw payload, and no position beyond first-seen order.**

**Published documentation** ([Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) and the published type file) confirms that rate-limit messages and many `system` sub-types exist, but the pages I could read were truncated and gave no field-level shapes
(one extract even named the rate-limit kind differently from the observed `rate_limit_event`, so I did not rely on it). The listed `system` families include **hook started/progress/response, task started/progress/updated/notification, background-tasks-changed, commands-changed, session-state-changed** — several of which are the very authorities this fence forbids.

**Decision: `EVENT_SHAPES_NOT_PROVEN`. No allow-list was added.** A blanket "any `system` message is fine" would hide hooks and tasks; and for `rate_limit_event` neither the structure nor the allowed position for 2.1.292 is evidenced.
Required by the task: only narrowly defined events supported by evidence. There are none, so I documented the gap instead.

**What stays strict (tested, section 6):** both kinds are UNKNOWN before `init`, between messages and after the final result; an "informational-looking" event carrying a tool is UNKNOWN; one that carries a provider/auth override or a different session id is **FAIL**; malformed and unknown kinds are UNKNOWN.

**To close the gap safely (needs separate authorization):** a recording-only change that stores, for every message, a sanitized *shape fingerprint* (kind, sub-type, sorted key names, ordinal, "session id matches" yes/no — never values). It relaxes nothing, and it means that if the first real call ends UNKNOWN, the permit buys exact evidence for a narrow, reviewed allow-list. The alternative is a Control Plane-supplied exact schema for 2.1.292.

## 4. Evidence supporting each decision — summary

R1: two Anthropic documentation pages (identity of the string; alias behaviour) + the existing 2.1.260 record (precedent for an exact versioned label). R2: committed evidence is too thin (names only) and published documentation is truncated and lists security-bearing sub-types.

## 5. Changes made

Three small additive edits to qualification/diagnostic scripts (above) and new tests. No production code, parser, adapter, Orchestrator, Run API, UI or historical evidence changed.

## 6. Regression test results (local offline; not CI)

| Suite | Passed | Failed |
| --- | ---: | ---: |
| One-call (69 prior + 6 new) | 75 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification (three-call contract) | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer (3B4) | 49 | 0 |
| **Total** | **252** | **0** |

New tests (A–P): the exact Sonnet 5.5 label is accepted as Sonnet (assistant, resolved init label and usage) and the full harness passes with it; the default three-call and diagnostic behaviour is unchanged; 11 near-miss and unknown labels never become Sonnet; wrong family is FAIL; conflicts are CONFLICT; placeholders and usage-only evidence do not prove the model;
the extension rejects wrong-family, wildcard, overlap, placeholder, oversize and prototype inputs; rate-limit and `system` events remain UNKNOWN before init / after result / carrying a tool, provider-override, auth-override and foreign-session events FAIL; malformed and unknown kinds are UNKNOWN;
the five-tool inventory, forbidden-tool FAIL and budgets (1 and 3) are unchanged. Mutation check: removing the family guard, adding the label to the global closed list (32 failures), substring matching, and skipping validation were all caught.
`node --check` passes on every modified script and the test file; `git diff --check` is clean.

## 7. Proposed human MDM procedure (for review — **not run**)

**Purpose:** establish current device-wide Claude managed-policy status shortly before a future real smoke call. **Who:** the Mac's owner, in Terminal.app (zsh). The agent never sees a password and runs none of this.
**Command class:** the one already approved in review 5439750877: `sudo profiles show -type configuration -all -output stdout-xml`.

**Rules that make it safe**
- The password is typed only at the macOS `Password:` prompt that `sudo` itself shows. If no such prompt appears, stop: do not type it anywhere else (an earlier attempt sent it to the wrong place).
- `sudo -k` forces a fresh prompt, so cached credentials cannot stand in for a real authentication.
- The command's **own** exit status is captured by assigning its output to a variable (`raw="$(…)"; rc=$?`), not through a pipe, so a failing `profiles` cannot be hidden behind a succeeding summarizer.
- The raw profile text lives only in a shell variable inside a subshell and is discarded; nothing is written to disk, nothing is printed, no `tee`, no `set -x`.
- `stderr` is discarded (the prompt uses the terminal directly); only the six normalized lines below are ever shown.
- Coverage is **COMPLETE only when** all of these hold: the command ran under `sudo` and exited 0, the output is non-empty and no larger than 8,000,000 characters, and `plutil -lint` accepts it as a well-formed XML property list. Otherwise it is PARTIAL or FAILED. This is what "all installed profiles, run as root" means in the `profiles` manual page.
- Malformed XML, an empty answer, a failure, a timeout or Ctrl-C all end as **not COMPLETE**. Ctrl-C ends the whole subshell and prints nothing: **no six lines = BLOCKED**.

**Step R0 — self-test, no `sudo` (safe to do first):**

```zsh
/usr/bin/plutil -lint -s - <<<'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>'; print -r -- "wellformed_exit=$? (expect 0)"
/usr/bin/plutil -lint -s - <<<'<plist><dict></plist>' >/dev/null 2>&1;                                                    print -r -- "malformed_exit=$? (expect nonzero)"
```

**Step R1 — the readback (the only privileged step):**

```zsh
(
  emulate -L zsh; set +x +v
  run_utc="$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  raw="$(/usr/bin/sudo -k -- /usr/bin/profiles show -type configuration -all -output stdout-xml 2>/dev/null)"; rc=$?
  coverage=PARTIAL; form=NON_XML; domain=UNKNOWN
  if [[ "$rc" != 0 ]]; then coverage=FAILED; form=NONE
  elif (( ${#raw} == 0 )); then form=EMPTY
  elif (( ${#raw} > 8000000 )); then form=TOO_LARGE
  elif /usr/bin/plutil -lint -s - <<<"$raw" >/dev/null 2>&1; then coverage=COMPLETE; form=XML_PLIST
  fi
  if [[ $coverage == COMPLETE ]]; then
    /usr/bin/grep -qiF -- 'com.anthropic.claudecode' <<<"$raw"; g=$?
    case $g in 0) domain=PRESENT;; 1) domain=ABSENT;; *) domain=UNKNOWN;; esac
  fi
  unset raw
  # Metadata-only presence check of the other policy sources (contents are never opened).
  files=ABSENT
  for p in "/Library/Application Support/ClaudeCode/managed-settings.json" "/Library/Application Support/ClaudeCode/managed-settings.d" \
           "/Library/Application Support/ClaudeCode/managed-mcp.json" "/Library/Managed Preferences/com.anthropic.claudecode.plist" \
           "/Library/Managed Preferences/$USER/com.anthropic.claudecode.plist" "$HOME/Library/Managed Preferences/com.anthropic.claudecode.plist" \
           "$HOME/.claude/remote-settings.json"; do
    err="$(LC_ALL=C /usr/bin/stat -f %N -- "$p" 2>&1 >/dev/null)"; src=$?
    if (( src == 0 )); then files=PRESENT
    elif [[ "$err" != *"No such file or directory"* && $files != PRESENT ]]; then files=UNKNOWN
    fi
  done
  if   [[ $rc == 0 && $coverage == COMPLETE && $domain == ABSENT && $files == ABSENT ]]; then overall=CURRENT_ABSENCE_OBSERVED
  elif [[ $domain == PRESENT ]]; then overall=BLOCKED_PRESENT
  elif [[ $domain == ABSENT && $files == PRESENT ]]; then overall=BLOCKED_CONTRADICTORY
  else overall=BLOCKED_UNKNOWN; fi
  print -rl -- "RUN_UTC=$run_utc" "PROFILES_EXIT=${rc:-NONE}" "COVERAGE=$coverage (form=$form)" "CLAUDE_DOMAIN=$domain" "MANAGED_FILES=$files" "OVERALL=$overall"
)
```

**Reading the result — only these six lines may be copied to the Control Plane (never the raw output, never anything else):**

| `OVERALL` | Meaning | Next step |
| --- | --- | --- |
| `CURRENT_ABSENCE_OBSERVED` | Fresh, complete readback: no Claude domain and no other policy source present | May support admission **for one launch**; still not authorization |
| `BLOCKED_PRESENT` | A Claude policy domain was found (conservative: any match anywhere in the inventory) | Stop; do not run |
| `BLOCKED_CONTRADICTORY` | Readback says absent but a policy file exists | Stop; investigate |
| `BLOCKED_UNKNOWN` | Anything else: failed, partial, malformed, empty, oversize, unreadable path | Stop; ambiguity is BLOCKED |

**Ambiguity handling.** Any doubt is `BLOCKED_UNKNOWN`. A false "present" (for example another vendor profile that mentions the Claude domain name) blocks safely and goes to Control Plane; it is never treated as a pass. Run it **again after** the future call; both runs must be `CURRENT_ABSENCE_OBSERVED`.
If the password was typed anywhere other than the `sudo` prompt, treat it as exposed and change it.

**Unverified assumptions (all fail closed, none can create a false pass):**
- That `plutil -lint -s -` reads standard input as documented (R0 checks this).
- What `profiles` prints on a Mac with **no** profiles at all. If it prints a sentence rather than XML, the result is `PARTIAL`/`BLOCKED_UNKNOWN` even though the Mac is clean. Control Plane would then decide, after the human reports only the `form=` word, whether a separately reviewed rule for that exact case is acceptable.
- That a managed Claude profile leaves its domain text in this inventory (the earlier approved readback relied on the same assumption).
- The summarizer has **not been tested**. Recommended next step: test the lint/grep/stat logic against synthetic fixtures offline (no `sudo`) before a human uses it.

## 8. Remaining trust requirements (unchanged — not built here)

A real, reviewed way to hand the human readback to the program (an operator envelope loader), a real permit issuer and fixed ledger, host binding, and a trust anchor. Local file ownership, folder permissions, a typed confirmation and a GitHub commit are **not** independent cryptographic authenticity.
Approach A remains a human-witnessed diagnostic path, not authorization-grade evidence. The default trust anchor and the default admission and live gates are unchanged and BLOCKED.

## 9. Residual first-call risks

1. The candidate may report a model label that is still unrecognised (UNKNOWN; permit spent).
2. Ordinary `rate_limit_event` / `system` messages will make the call UNKNOWN until an evidence-based allow-list exists (R2).
3. The macOS process probe, `lsof` and the real tool-inventory message have never run against 2.1.292.
4. The MDM readback is a point-in-time fact; the profile-count/empty-inventory wording is unverified.
5. Same-user trust limits (section 8).

## 10. Next Control Plane approval required

1. Review R1 (accept the exact label in the one-call path only, or revert the three small edits).
2. Choose the R2 route: authorize the recording-only shape-fingerprint change, or supply an exact 2.1.292 schema for a narrow allow-list.
3. Review the MDM snippet; if accepted, authorize offline fixture testing of its logic (no `sudo`), then separately authorize the human run.
4. Everything in the 3B6B.10 plan still applies (envelope loader, permit issuer, fixed ledger, host binding, trust-anchor decision), followed by a separate exact-head live authorization.

**Final decision: OFFLINE_COMPATIBILITY_PREFLIGHT_PASS.** It does not authorize MDM execution, permit issuance or real Claude inference.
