# Phase 3B6B.10 — current-MDM and live trust-boundary preflight (design only)

**Decision: LIVE_TRUST_PREFLIGHT_DESIGN_PASS** — the plan below is ready for Control Plane review.

This document is a *plan*. It is **not** an authorization to run anything. In writing it, no Claude candidate command, `claude -p`,
`doctor`, `auth status`, `sudo`, `profiles`, MDM inventory, key generation, permit/attestation issuance, live-gate change, merge or deploy was
performed. Provider calls **0**. Candidate executions **0**. Runtime MDM admission is still **BLOCKED**; live execution is still **NOT AUTHORIZED**.

## In one page (plain language)

We want to run Claude Code 2.1.292 **once**, on a throw-away folder with two dummy files, and check it behaves inside the fence we built.
The offline machinery for that is finished and reviewed. What is still missing is mostly **who vouches for what, and when**:

1. **"Is any company-managed policy active on this Mac right now?"** We checked once (2026-10-07) and the answer was "no". That was a day or more ago.
   Before the real call a person must check again, and the check needs the Mac's administrator password, so **only the human can do it**.
2. **How does the program learn that the human checked?** Today it cannot: the real program path is hard-wired to answer "blocked", and the only way
   to feed it a "pass" is a test-only back door that is deliberately refused for real use. A **small new piece of code** is needed. This is the single
   biggest gap, and it is honest to say a human readback alone cannot close it.
3. **One ticket, one use.** A "launch permit" lets exactly one run happen and is torn up when used (already built and tested). Someone still has to
   decide where the ticket book lives and who writes the ticket.
4. **Two likely stumbling blocks found while writing this plan** (details in section F): the program is currently strict enough that the *normal* messages a real
   Claude Code prints (a "rate limit" status message and a "system" status message) and a newer Sonnet name would probably make the single call end as "UNKNOWN" and use up
   the ticket. These should be decided **before** the call, using only information already in the repository.
5. **Recommendation: the simple route.** A person does a fresh readback right before the call, the person (not the AI agent) runs the command and watches,
   and the record is checked against the GitHub-pinned review. No signing keys, no new service. The price is honest: this protects against the AI and against mistakes,
   **not** against malware already running as you.

## A. Exact baseline

| Item | Value |
| --- | --- |
| Repository / PR | `augusliang23-web/Micro-SaaS-Command-Center` #24, OPEN / Draft / unmerged |
| Starting HEAD | `c9fc16fe69e700731780a98c138ef1515e5b2555` |
| Control Plane review | 5464362938 (state COMMENTED, on exactly that commit) |
| Working tree before | clean; GitHub reports no CI checks (all test counts quoted below are local offline reports, not CI) |
| This change | one new document; the commit is reported on the PR |

Terms: **MDM** = a company-style device-management profile that can force settings onto a Mac. **Managed policy** = settings such as those that Claude Code
obeys without asking you. **TCB (trusted computing base)** = the small set of things we agree to trust (here: the exact Claude program we verified by fingerprint).
**Attestation** = a signed-style statement "this was true at this time". **Permit** = a one-time launch ticket.

## B. Current MDM evidence gap

### What we have (historical, preserved, not re-run here)

| Evidence | When | What it showed |
| --- | --- | --- |
| Review 5439750877 (human, privileged) | 2026-10-07 08:38 UTC | Complete device-wide profile inventory: exit 0, coverage COMPLETE, the Claude managed domain ABSENT |
| Review 5449763219 | 2026-10-07 23:49 UTC | Admission PASS from a chain: domain absent, managed-settings files absent, auth route claude.ai / first-party / **Pro** before and after, server-managed policy not available to Pro plans, its cache file `~/.claude/remote-settings.json` absent, user settings unchanged |
| Review 5453075906 | 2026-10-08 07:18 UTC | Offline lifecycle contract PASS, **live HOLD**: says explicitly that historical admission is not a fresh host readback and asks for a fresh readback or a scoped trusted attestation |
| Phase 3B6B.9 document | 2026-10-08 | Non-privileged check: the managed-settings files and managed-preference plists were absent; current effective MDM state and current auth route were **not observed** |

### What is missing

Nothing below can be satisfied by pointing at an old review. Each is a *time-of-launch* fact:

1. **Current effective absence** of a Claude-domain profile on this Mac (the 2026-10-07 readback is history, and nobody has observed since).
2. **Changes since then:** whether any profile was installed or removed after 08:38 UTC on 2026-10-07 (unknown).
3. **Current sign-in route:** claude.ai / first-party / Pro is the historical observation; the candidate's own status at launch time has not been observed.
4. **Current cache and file state** (settings files, the server-managed cache file, managed-preference plists): last checked 2026-10-08.
5. **A way to hand any of this to the program** (section D). Even a perfect fresh readback has no entry point today.

### Classification the program must apply

| Class | Meaning | Runtime result |
| --- | --- | --- |
| A. Historical verified absence | Approved past observation | Context only; **never** admission |
| B. Current effective absence | Fresh human readback COMPLETE + Claude domain ABSENT, plus the non-privileged checks absent, for *this* launch | May support admission, for that launch only |
| C. Change since last verification | Any difference in profile count, file presence/metadata, cache presence, auth route or binary fingerprint | **BLOCKED** until a new readback |
| D. Unverifiable or contradictory | Any command failing, partial coverage, an unreadable path, or a present Claude policy | **BLOCKED** (UNKNOWN stays BLOCKED) |

## C. Human-operated verification plan (proposed; *not executed*, needs separate approval)

Everything privileged is done by the person at the Mac. The agent never sees a password, never runs `sudo`, and the raw profile text is never saved.

| Step | Who | What | Allowed output |
| --- | --- | --- | --- |
| 0 | Control Plane | Authorizes this exact run in writing, naming the HEAD, permit id and the validity window (the *operator/Control Plane* chooses the window per run; no default is baked into code) | Review comment |
| 1 | Human | The **same command class already approved in review 5439750877**: `/usr/bin/sudo /usr/bin/profiles show -type configuration -all -output stdout-xml`, piped straight into an in-memory summarizer; the password is typed only into the real `Password:` prompt | `PROFILES_EXIT`, `COVERAGE`, `CLAUDE_DOMAIN` (three words, nothing else) |
| 2 | Program (non-privileged, no sign-in) | Metadata-only look at: `/Library/Application Support/ClaudeCode/managed-settings.json`, `…/managed-settings.d`, `…/managed-mcp.json`, the managed-preference plists, `~/.claude/remote-settings.json` — present / absent only, contents never opened | per-path ABSENT / PRESENT |
| 3 | Program, inside the approved live step | The candidate's own version, help and sign-in status (these *do* run the candidate and so belong to the live step, not to this planning phase); must show the pinned version and fingerprint and claude.ai / first-party / Pro | normalized fields only |
| 4 | Human | Records the three words from step 1 and the time into the launch envelope (section D) | — |
| 5 | Program | Repeats step 2 and step 3 immediately before launch and again after the run | same |
| 6 | Human (recommended) | One more privileged readback **after** the run, before anyone calls the result final | three words |

**Honest limit.** Step 1 is a *point-in-time* fact. The program cannot repeat it by itself (it needs the administrator password), so between steps 1 and 6 the only
automatic protection is step 2 (a Claude-domain profile normally leaves a managed-preference plist on disk, but that is a strong hint, not proof). The run is a
few minutes long; a profile installed and removed inside that window is a residual risk Control Plane should either accept or close with step 6.

## D. Trust / attestation recommendation

| Criterion | **A. Human fresh readback** (recommended first) | **B. Independently authenticated attestation** |
| --- | --- | --- |
| Security adequacy for *one* synthetic-fixture call | Adequate: it is what established the earlier PASS; a human is the only party able to run the privileged command | Stronger against tampering, but protects against threats that are not what this call is testing |
| Complexity | Low | High: an issuer, a signing key, a verifier, revocation, custody, rotation |
| New infrastructure | None (one small loader, below) | Yes — keys and a service the project does not have |
| Permissions | Admin password typed by the person | Same readback still feeds the issuer, plus key custody |
| Repeatability | Manual per run (minutes) | Good for many unattended runs |
| Freshness | By construction: done right before the launch | Needs a validity rule (a lifetime decision nobody has made) |
| Failure handling | Any doubt → BLOCKED; redo the readback | More failure modes (signer down, key lost) |
| Needed now? | **Yes** | **No** — defer until runs become routine or unattended |

**Recommendation: Approach A for the first real call.** Do not build B yet.

**But A is not implementable with today's code.** The reviewed offline code can validate an attestation and a permit, yet its real runtime path accepts neither:
with no injected dependencies the admission source is a constant "blocked", the live gate a constant `false`, the trust policy trusts nobody, and the only way to inject a "pass"
is the test seam that is refused unless everything points to a fake home and fake spawn. That is correct and must stay. So the gap is explicit:

**Minimum new implementation (separate, reviewed task; roughly one small module):**
1. A **launch envelope** the human creates once per run in one fixed private folder (proposed next to the candidate: `~/.local/share/cc-qualification/…`, mode 0700, owned by you). It holds the
   attestation (the three readback words, time, candidate/version/hash, scope, host, an issuer label such as `OPERATOR_LOCAL`, validity window, the four invalidation conditions) and the permit (id, `maxProviderCalls: 1`, same bindings).
2. Real, non-test sources for the existing gates that read *only* that envelope: admission, trust policy (one trusted issuer label), permit and ledger.
   "Authentic" here can only mean **right folder, right owner, right mode, signed off by the person** — see the limit below.
3. **Host binding** via a stable machine identifier read without privileges (for example the hardware UUID from `ioreg`), stored only as a hash.
4. **Revocation** = a marker file the operator can drop in the ledger; anything unreadable counts as revoked.
5. **The live gate as a human act**: the program proceeds only when a person types an exact confirmation phrase (naming the run id and the first 8 characters of the permit hash) at a real terminal. An AI tool session has no terminal, so this is a cheap
   technical separation between "operator ran it" and "the agent ran it". It is a speed bump, not a lock (an agent could in principle fake a terminal), so the written Control Plane authorization must also say "operator runs, agent does not".

**What this does not give you (stated plainly):** anything the AI or another program running *as your own user account* can write, it can also forge — including the
envelope and the evidence. Approach A is therefore secure against a **mistake or a misbehaving model**, not against **malware already running as you**. For a single throw-away call on dummy files
this is a reasonable, auditable trade, but Control Plane must accept it explicitly. If it will not, Approach B (or a hardware-backed signer) becomes necessary and is a larger project.

## E. Single-use permit — operational plan

| Requirement | Already built and tested (offline) | Still needs setup / new code |
| --- | --- | --- |
| Exact host, candidate (2.1.292 + SHA-256), scope, `maxProviderCalls = 1` | Yes: `validateLaunchPermit` checks all; anything else blocks | A real host identifier source; a real issuer label |
| Validity window | Required in the document; missing / expired / not-yet-valid blocks; **no default lifetime exists** | Control Plane chooses it per run |
| Authenticity | Via an injected check; default trusts nothing | A real check (section D: location + owner + mode + operator act) |
| Atomic single use | Yes: `consumeLaunchPermit` creates a marker with exclusive create, syncs it and the folder, **before** the launch; 12 racing processes → exactly one winner | Nothing |
| No replay across restart | Yes (marker is on disk; a crashed or empty marker still counts as used) | The ledger must stay put |
| No reuse after a failed start | Yes (consumed before spawn; the one-call budget of 1 is spent too) | Nothing |
| No retry / fallback provider or model | Yes: no second launch path; the launch arguments are the one fixed canonical set | Nothing |
| Fixed trusted ledger location | Takes any private folder you pass; there is no fixed default (deliberately) | **Pick one fixed location** (proposal: a `ledger` folder beside the candidate folder, 0700) and hard-wire it in the real source |
| Issuer | None (nothing issues permits) | **The human operator**, by writing the envelope after the readback. No automatic issuer |

Because a *burned* permit is never reusable, a run that ends UNKNOWN costs the permit and a fresh Control Plane authorization. That is by design (no retry), but it is why section F matters.

## F. Lifecycle postcondition readiness

**Accepted contract (3B6B.8, unchanged):** trust the exact verified Claude program; require authoritative tool / protocol / model proof; then check bounded conditions after it exits.
The earlier "see every short-lived process and message" requirement was retired and is **not** revived. Sampling may catch *positive* violations; it never proves nothing happened in between.

| Minimum check for the one call | Implemented offline | Real-host evidence |
| --- | --- | --- |
| Exact parent program identity (path, owner, mode, SHA-256) | Yes | Fingerprint verified historically; never observed at a real launch by this harness |
| Matching foreground exit observed | Yes | None |
| Canonical restricted launch arguments + allow-listed environment | Yes (exact vector, exact environment) | None |
| Exactly five tools: Read, Edit, Write, Glob, Grep; any extra → FAIL | Yes | **None**: the real startup message of 2.1.292 has never been parsed by this checker |
| Correct model and sign-in route | Yes, with a closed list of accepted model names | **Unknown**, see R1 |
| No forbidden process / no shell / no network tool observed | Yes (sampling) | None |
| No surviving attributable background process; no lingering unapproved Unix socket; final inspection must succeed | Yes (2 s quiet inside a 5 s window) | None; depends on a macOS system library probe and `lsof` |
| No saved session / transcript | Yes | None |
| No file or folder escape; exactly one allowed file change (`target.txt`) | Yes | None |
| Bounded final inspection succeeds, else UNKNOWN | Yes | None |

**Two likely first-real-call failures found while writing this plan (both fail *safe*, but each would burn the only permit):**

- **R1 — model name.** The model check accepts only the exact names `sonnet`, `claude-sonnet-5` and `opus`. The current Sonnet generation is identified as `claude-sonnet-5-5`. If the candidate reports that,
  the result is UNKNOWN (`EFFECTIVE_MODEL_NOT_PROVEN`) even though the right model ran. Fix needs a reviewed **exact-name** addition (still no fuzzy matching) or an explicit Control Plane statement that UNKNOWN is acceptable; the true label can only be learned by the call itself or from published model documentation.
- **R2 — harmless extra messages.** The previous real runs (Claude 2.1.260, committed evidence `…phase3b4-final-live-smoke.json` and the post-auth one) printed `rate_limit_event` and a `system` status message. The one-call checker treats **any** message type it does not know as UNKNOWN, so those ordinary
  messages would make a perfectly good run end UNKNOWN. Fix is an exact-type allow-list for content-free informational events (their content ignored), decided from the already-committed evidence, with no new inference.

Both are small offline changes and should be made, reviewed and tested **before** any permit is issued.

## G. Evidence authenticity requirements

| Question | Answer |
| --- | --- |
| What does the local SHA-256 prove? | Only that the record was not changed *by accident* (`UNAUTHENTICATED_LOCAL_EVIDENCE`). Anyone who can edit it can recompute the hash. It is **not** a signature. |
| Is the default trust anchor still fail-closed? | Yes; it authenticates nothing, so the strict reader answers BLOCKED today. Unchanged. |
| What must be true for a record to count for the first real smoke? | See below. |

**Minimum viable trusted confirmation (no keys, no service):**
1. The **operator** (a person) starts the command, sees the run's printed summary, and the record's SHA-256 is displayed in the terminal.
2. The agent commits the sanitized record and its commit marker to PR #24; the commit SHA pins every byte (a Git commit hash covers file contents).
3. The **Control Plane review** (authenticated by GitHub, pinned to that commit ID) quotes the same SHA-256 and the decision. That GitHub-held review is the independent record the agent cannot rewrite.
4. Before accepting, the reviewer checks that the record's run id, candidate, scope, budget 1, attestation hash and permit hash match what was authorized (the strict reader's expectation list), and that the commit marker exists.

What human approval **can** establish: the readback really happened, the person intended exactly one run, and the person saw the same hash Control Plane reviewed.
What it **cannot** establish: that a process running as your own account did not forge files, or that a later reader can tell a genuine record from a forgery without trusting the folder. That needs a signing key held outside the evidence
folder (Approach B). It is not needed for one witnessed call and must not be faked with a made-up anchor. Also unchanged: a future signer must sign only after *confirmed* publication.

## H. Minimum prerequisites before one real call

Each item: **N** necessary before the first real call? **I** already implemented? **H** can a bounded human procedure do it? **C** new code? **D** deferrable?

| # | Requirement | N | I | H | C | D |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| 1 | Control Plane approves this plan at an exact HEAD (section K) | yes | n/a | yes | no | no |
| 2 | Fresh privileged MDM readback right before launch (three normalized words) | yes | no | **yes (only a human can)** | no | no |
| 3 | Real entry point that turns the envelope into admission / permit / live gate (replaces the constant-blocked defaults without the test back door) | yes | **no** | no | **yes (small)** | no |
| 4 | Human-typed live confirmation on a real terminal | yes | no | yes | yes (tiny) | no |
| 5 | Fixed ledger location, host id, revocation marker | yes | partly (ledger logic, validation) | yes (set up) | yes (tiny) | no |
| 6 | Handle R1 (model name) and R2 (informational events) | yes | no | no | **yes (small)** | no |
| 7 | Attestation + permit validation, atomic single use, evidence atomic write and commit marker | yes | **yes** | — | no | no |
| 8 | Operator runs and witnesses the call; hash quoted in the review | yes | no | yes | tiny (print the hash) | no |
| 9 | Second human readback after the run, before the result is final | recommended | no | yes | no | yes (if the window risk is accepted) |
| 10 | Separate Control Plane authorization for the live call after another exact-HEAD review | yes | n/a | yes | no | no |

## I. What can safely be deferred

- Approach B: signing keys, an attestation issuer service, a verifier and key rotation.
- A non-sampling or event-complete process/IPC monitor (explicitly retired).
- Calls 2 and 3 and the full three-call negative suite; the known three-call evidence-serialization defect (it hides a FAIL as UNKNOWN; it cannot create a PASS).
- Repeating the `doctor` / remote-policy check: the account is a Pro plan (not eligible for server-managed policy) and the cache file's absence is part of the non-privileged check.
- Defending against clock rollback, multiple ledgers, unattended runs, the Docker sign-in bridge and any Orchestrator or Run-button wiring.

## J. Remaining risks

1. **Same-user trust:** envelope, ledger and evidence are protected by file permissions and a human, not by cryptography.
2. **Point-in-time readback:** a profile appearing during the run window is only caught by the non-privileged checks (and by step 6 if adopted).
3. **First-real-host unknowns:** R1, R2, the real startup message, the macOS process probe and `lsof` have never run against 2.1.292; any can yield UNKNOWN and spend the permit.
4. **Operator/agent separation is procedural** (a terminal prompt is a speed bump).
5. **Host clock** governs validity windows.
6. **Durability** relies on the filesystem honouring sync and exclusive-create semantics.
7. A passing offline suite is not evidence of real Claude behaviour (it is labelled `OFFLINE_SIMULATION` for that reason).

## K. Required Control Plane approval

Control Plane decides, in writing, before any human step or live call:
1. Accept **Approach A** and its same-user residual risk (or require Approach B).
2. Choose the validity-window rule per run (nothing is defaulted in code), the ledger location, the host-identifier source and the revocation marker convention.
3. Decide whether the post-run readback (C step 6) is required.
4. Decide R1 (add reviewed exact model name vs accept UNKNOWN) and R2 (exact-type allow-list of informational events).
5. Authorize the small implementation task (items 3–6 and 8 in section H), offline only, then review that exact HEAD.
6. Authorize the exact human commands (the one named in section C) and who runs them.
7. After that review, give the separate live authorization naming HEAD, permit id, scope and window.

## L. Final decision

**LIVE_TRUST_PREFLIGHT_DESIGN_PASS** — the operational preflight plan is ready for Control Plane review.

It does **not** mean: current MDM verified, a live permit issued, a trusted attestation established, real Claude execution authorized, or the real lifecycle qualified.
Nothing was executed; this is a document only. No executable code, historical evidence or the default live gate was changed.
