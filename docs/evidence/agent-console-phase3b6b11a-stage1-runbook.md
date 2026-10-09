# Phase 3B6B.11A — Stage 1 human MDM runbook (final offline patch)

**Status: PROPOSED ONLY. NOT AUTHORIZED TO RUN.** A person may run the commands below only after Control Plane has authorized them in writing at an exact commit (see "Authorization").
Nothing in this document was executed against a real Mac: no `sudo`, no `profiles`, no host policy inspection, no Claude candidate command, no provider call.
Runtime MDM admission stays **BLOCKED**; live execution stays **NOT AUTHORIZED**. Stage 1 is **diagnostic only**: it can never admit anything.

This runbook **replaces** the command blocks in the 3B6B.10A, 10B and 10C documents. The hash `dd5d58ce…1626` used in the 3B6B.11 review belonged to the *old* normalizer and must not be reused.

## What changed in this patch

1. **Fingerprint fix.** The `profiles` manual names the device-level key `_computerLevel`; the code looked for `_computerlevel`, so a real inventory would have been reported as `COMPUTERLEVEL=ABSENT`.
   The fingerprint now recognises the documented spelling and the old lowercase one (case-insensitively), reports which one it saw (`SPELLING=DOCUMENTED|LOWERCASE|OTHER_CASE|NONE`) and counts the other top-level keys (`OTHER_ROOT_KEYS`, for per-user entries — names are never printed).
   If more than one spelling is present the answer is `AMBIGUOUS` and nothing below it is inspected. This is **diagnostic only**: coverage, schema trust and every admission decision still use the exact key from a branded schema; the success words and the empty approved-schema registry are unchanged.
2. **Sudo safety.** Visible authentication first, non-interactive capture second, automatic credential cleanup on every exit path, and a written recovery procedure.
3. **Executable identity.** Exact Git commit, a clean worktree, the new normalizer hash and a verified absolute Node path — all checked by a read-only pre-check before any password is requested.

## Pinned identities

| Item | Value |
| --- | --- |
| Worktree | `~/Developer/worktrees/command-center-agent-console-p3b6b-negative-proof` |
| Git commit to run | the 40-hex commit **named in Control Plane's written authorization** (this document cannot name the commit that contains it; the pre-check refuses anything else) |
| Normalizer SHA-256 | `31aeaddc984b4b6091b3cca8c9030b5769adbb2648197ae165568dbd988b56a5` |
| Superseded (do not use) | `656c2f3940bc288bedca8f996434b7adc7b5cb4efbfd6f66f786412bbc1d7cec` (Stage 1 run #1), `dd5d58ce47670e9b6db27848ea48ecdf39442d397992bc087897e0ecbf4d1626` |
| Node executable | `/opt/homebrew/Cellar/node@20/20.20.2/bin/node` (the real file behind `/opt/homebrew/opt/node@20/bin/node`; regular file, not a symlink, owner `augusliang`, mode `r-xr-xr-x`) |
| Node version / SHA-256 | `v20.20.2` / `edc0c98fee8947a04913cb45cf80e7341653b0ea9e907ff3dc50d7fdaedda1d2` |
| Git | `/usr/bin/git` |

The normalizer script and the Node binary are both owned by the same user account that runs them. Pinning them detects accidental or unexpected change; it is **not** protection against malware already running as you.

## Authorization

Control Plane's written authorization must state: the exact commit, the normalizer hash above, the Node identity above, who runs it, and that the terminal is macOS **Terminal.app** (not the Claude app's built-in terminal, which the assistant can read). The assistant must not read any terminal during the run.

## Step 0 — read-only pre-check (no password)

First set the commit from the authorization on its own line (replace the example with the real 40 characters):

```zsh
STAGE1_WANT_HEAD=0000000000000000000000000000000000000000
```

Then paste:

```zsh
(
  emulate -L zsh
  fail() { print -r -- "PRECHECK=FAIL:$1"; exit 1; }
  cd ~/Developer/worktrees/command-center-agent-console-p3b6b-negative-proof || fail repo_path
  (( ${#STAGE1_WANT_HEAD} == 40 )) && [[ "$STAGE1_WANT_HEAD" != *[^0-9a-f]* ]] || fail want_head_format
  [[ "$(/usr/bin/git rev-parse HEAD)" == "$STAGE1_WANT_HEAD" ]] || fail head_mismatch
  [[ -z "$(/usr/bin/git status --porcelain)" ]] || fail worktree_not_clean
  [[ "$(/usr/bin/shasum -a 256 scripts/phase3b6bMdmReadbackNormalizer.mjs | /usr/bin/cut -d' ' -f1)" == 31aeaddc984b4b6091b3cca8c9030b5769adbb2648197ae165568dbd988b56a5 ]] || fail normalizer_hash
  [[ -f /opt/homebrew/Cellar/node@20/20.20.2/bin/node && ! -L /opt/homebrew/Cellar/node@20/20.20.2/bin/node && -x /opt/homebrew/Cellar/node@20/20.20.2/bin/node ]] || fail node_path
  [[ "$(/opt/homebrew/Cellar/node@20/20.20.2/bin/node --version)" == v20.20.2 ]] || fail node_version
  [[ "$(/usr/bin/shasum -a 256 /opt/homebrew/Cellar/node@20/20.20.2/bin/node | /usr/bin/cut -d' ' -f1)" == edc0c98fee8947a04913cb45cf80e7341653b0ea9e907ff3dc50d7fdaedda1d2 ]] || fail node_hash
  print -r -- "PRECHECK=PASS"
)
```

Proceed **only** if it prints exactly `PRECHECK=PASS`. Any `PRECHECK=FAIL:…` means stop and report that one line.

## Step 1 — the only privileged step (paste as one block)

```zsh
(
  emulate -L zsh
  unset raw rc
  trap '/usr/bin/sudo -k >/dev/null 2>&1' EXIT
  trap 'exit 130' INT TERM HUP
  cd ~/Developer/worktrees/command-center-agent-console-p3b6b-negative-proof || exit 1
  /usr/bin/sudo -k
  /usr/bin/sudo -v || { print -r -- "STOP: sudo did not authenticate"; exit 1; }
  raw="$(/usr/bin/sudo -n -- /usr/bin/profiles show -type configuration -all -output stdout-xml 2>/dev/null)"; rc=$?
  /usr/bin/sudo -k
  print -rn -- "$raw" | /opt/homebrew/Cellar/node@20/20.20.2/bin/node scripts/phase3b6bMdmReadbackNormalizer.mjs --rc="$rc"
  unset raw
)
```

How it behaves:
- `sudo -v` shows the genuine `Password:` prompt. **Type the password there and nowhere else.** The capture then uses `sudo -n`, which never prompts (it fails instead), so there is no hidden prompt inside a captured command.
- The raw profile text exists only in the subshell's memory (`raw`) and is piped straight to the normalizer. Nothing is written to disk or printed. stderr from `profiles` is discarded.
- The command's own exit status is stored in `rc` before anything else runs; the normalizer receives it with `--rc`.
- An `EXIT` trap runs `sudo -k` on every way out (normal end, `STOP`, Ctrl-C, terminal hang-up). Ctrl-C/terminate/hang-up turn into an exit, so no later line of the block can run.
- The block is a subshell: if you see a continuation prompt (`subsh>`, `cmdsubst>`) the paste was incomplete — press **Ctrl-C** and do not type anything else.

## Expected safe output (exactly twelve lines)

```
RUN_UTC=2026-…Z
PROFILES_EXIT=0
COVERAGE=UNQUALIFIED (form=XML_PLIST)
CLAUDE_DOMAIN=UNKNOWN (scan=SCANNED)
MANAGED_FILES=NOT_INSPECTED
SCHEMA_FINGERPRINT=ROOT=dict;ROOT_KEYS=1-4;COMPUTERLEVEL=array;SPELLING=DOCUMENTED;OTHER_ROOT_KEYS=0;ENTRIES=1-4;ENTRIES_ALL_DICT=true;ENTRIES_HAVE_PROFILEIDENTIFIER=true
SCHEMA_TRUST=NONE
HOST_MODE=DISABLED
OVERALL=BLOCKED_REAL_HOST_MODE_DISABLED
FORMAT_CLASS=XML_PLIST_VALID
FORMAT_DETAIL=size=<=4K;lines=6-20;first=LT;xml_decl=true;plist_open=true;plist_close=true;dict=true;leading_text=false;trailing_text=false;extracted_parses=true;non_text=false;phrase_no_profiles=false;phrase_error=false;phrase_usage=false;phrase_sudo=false;parse_reason=NONE;parse_at=NONE
EXTRACTED_FINGERPRINT=ROOT=dict;ROOT_KEYS=1-4;COMPUTERLEVEL=array;SPELLING=DOCUMENTED;OTHER_ROOT_KEYS=0;ENTRIES=1-4;ENTRIES_ALL_DICT=true;ENTRIES_HAVE_PROFILEIDENTIFIER=true
```

- `scan=SCANNED` with `UNKNOWN` means the output was read and no Claude-domain mention was found; it still proves nothing about completeness. `PRESENT` / `BLOCKED_PRESENT` means the Claude domain was mentioned.
- If `profiles` prints something that is not a clean XML property list (as in Stage 1 run #1: `PROFILES_EXIT=0`, `COVERAGE=PARTIAL (form=MALFORMED)`, `SCHEMA_FINGERPRINT=ROOT=NONE`), the three `FORMAT_*` lines say what kind of text it was — plain text, XML with extra text before or after it, truncated XML, or a broken body — using fixed words, yes/no flags and size buckets only. They are **recording only**: they never change the verdict, and a "no profiles" style sentence is not evidence that no managed policy applies. See `agent-console-phase3b6b11b-mdm-output-diagnosis.md`.
- Stage 1 cannot print `CURRENT_ABSENCE_OBSERVED`, `MANAGED_POLICY_RUNTIME_ADMISSION_PASS` or `LIVE_EXECUTION_AUTHORIZED`; `SYNTHETIC_ABSENCE_OBSERVED` is unreachable from the command line. It can never authorize live inference.

## What to copy, what never to share

- **Copy to the assistant/Control Plane:** only the twelve lines, as text.
- **Never share:** the administrator password; raw profile text; screenshots of the Terminal window or its scrollback; the contents of the `raw` variable; any output line outside the twelve lines (errors, stack traces, prompts).

## Stop conditions

Stop and report in words (not by pasting the output) if: Step 0 does not print `PRECHECK=PASS`; the terminal is not Terminal.app; `sudo -v` shows anything other than one `Password:` prompt; after pressing Return at a password prompt you see a normal shell prompt, `command not found`, or your typed characters echoed (treat the password as exposed — close the window and change it in System Settings); nothing returns after about a minute; the output is not exactly the twelve expected lines; `PROFILES_EXIT` is not `0`; or `OVERALL` is `BLOCKED_PRESENT`. Do not re-run without Control Plane's say-so.

## Interruption, partial execution and manual recovery

| Situation | What happened | What to do |
| --- | --- | --- |
| Ctrl-C or `STOP` before/at the password prompt | Nothing privileged ran; the `EXIT` trap already ran `sudo -k` | Nothing more |
| Interrupted during the capture | The subshell exited, the trap ran `sudo -k`, `raw` is gone, nothing printed | Treat as blocked; do the recovery check below |
| Terminal closed or crashed mid-run | The trap may not have run; admin credentials may stay cached for up to 5 minutes | Open a new Terminal window and do the recovery below |
| Fewer than twelve lines, or extra text | Unreliable | Do not paste it; report in words |
| Incomplete paste (`subsh>` prompt) | Nothing ran | Ctrl-C |

Recovery (no password needed):

```zsh
/usr/bin/sudo -k          # drop this window's cached credentials
/usr/bin/sudo -K          # drop every cached credential for your account, any window
/usr/bin/sudo -n true >/dev/null 2>&1 && print -r -- "STILL_CACHED" || print -r -- "NOT_CACHED"
```

`NOT_CACHED` is the required end state. Then close the Terminal window.

## Assumptions that need real macOS verification (all fail closed)

The real XML structure (including per-user top-level keys; the old schema model allows only a fixed key list, so a real per-user inventory would read as an unrecognised structure); the output for zero profiles; that `-all` as root is complete in the required sense; that a managed Claude profile leaves its domain text in the inventory;
that `sudo -n` reuses the credentials from `sudo -v` here (including Touch ID setups); and that the pinned Node and Git behave as recorded. The seven managed-policy file locations are **not** inspected in Stage 1.
