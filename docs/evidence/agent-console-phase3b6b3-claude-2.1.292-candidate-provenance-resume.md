# Phase 3B6B.3 resume — exact candidate provenance

Decision: **CLAUDE_2_1_292_CANDIDATE_PROVENANCE_UNKNOWN**.
Observed 2026-10-07 (Asia/Singapore). Actual provider calls: **0**.

This record supersedes the missing-GPG blocker for this resumed attempt. It does
not overwrite the earlier BLOCKED record or claim full candidate qualification.

## Baseline

| Field | Result |
| --- | --- |
| PR #24 starting HEAD | `ab34f9eeec5b4aca63bd0fbfce58ba2ea104f3a2` |
| PR state | OPEN / Draft / unmerged |
| Remote main | `25692a9a1fdedaf82910630fb767589aa5dccddf` |
| Legacy Claude | `/opt/homebrew/bin/claude` |
| Legacy version before | `2.1.260 (Claude Code)`, exit 0 |
| Legacy SHA before | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Qualified GPG | `/opt/homebrew/Cellar/gnupg/2.5.24/bin/gpg`; GnuPG 2.5.24 |

## Signing key and manifest

A new temporary GNUPGHOME was created with mode 0700. The canonical qualified GPG
executable was used with explicit `--homedir` and GNUPGHOME, never the normal user
keyring. The downloaded public key was imported only there.

| Check | Result |
| --- | --- |
| Fingerprint | `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE` |
| Exact approved fingerprint match | YES |
| Detached manifest verification | PASS; GPG exit 0; exactly one VALIDSIG tied to approved fingerprint |
| Manifest version | `2.1.292` |
| Platform | `darwin-arm64` |
| Binary field | `claude` (basename; manifest does not contain a full URL) |
| Signed expected SHA-256 | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| Signed expected size | 235017328 bytes |

No manifest field was parsed or trusted before detached verification succeeded.
Only exact-version official artifacts were used:

- [Release public key](https://downloads.claude.ai/keys/claude-code.asc)
- [2.1.292 manifest](https://downloads.claude.ai/claude-code-releases/2.1.292/manifest.json)
- [Detached signature](https://downloads.claude.ai/claude-code-releases/2.1.292/manifest.json.sig)
- [darwin-arm64 binary](https://downloads.claude.ai/claude-code-releases/2.1.292/darwin-arm64/claude)

The URL combines exact version/platform and signed binary basename using the
official download layout, corroborated by previously read official installer text
(`VERSION/PLATFORM/claude`). The installer was never executed. No stable/latest,
floating release, cask or third-party binary source selected the candidate. The
signed manifest is the checksum/size authority, not installer channel metadata.

## Candidate filesystem and integrity

| Check | Result |
| --- | --- |
| Canonical path class | `$HOME/.local/share/cc-qualification/claude/2.1.292/claude` |
| Canonical identity | Resolved path equals created path; no alias/symlink ancestors accepted |
| Candidate directory | Current-user owned, mode 0700, outside repository and PATH |
| Executable | Regular file; not symlink; nlink 1 |
| Executable mode | 0500; no group/world write |
| Actual size | 235017328 bytes; exact signed match |
| Actual SHA before native checks | `97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f` |
| SHA match | YES |
| Final SHA after native checks | Same signed SHA; unchanged |
| Candidate directory contents | Only `claude`; no launcher or executable sibling |

The path is represented generically to avoid an unnecessary HOME username. The
actual absolute canonical path was used for all verification. No auth/config was
copied; no PATH/alias change, repository binary or Git LFS addition occurred.

## macOS signing and STOP condition

| Check | Result |
| --- | --- |
| `codesign --verify --strict --verbose=2` | PASS, exit 0 |
| TeamIdentifier | `Q6L2SF6YDW` |
| Leaf authority | `Developer ID Application: Anthropic PBC (Q6L2SF6YDW)` |
| Certificate chain | Developer ID Certification Authority → Apple Root CA |
| Identity comparison | Anthropic PBC identity and team match the legacy approved executable's signing metadata |
| `spctl --assess --type execute --verbose=4` | Exit **3**; accepted/notarized confirmation not observed |
| Gatekeeper/notarization admission | **UNKNOWN / STOP** |

The native signature is valid and identifies Anthropic. That does not substitute
for the separately required acceptable Gatekeeper/notarization result. The spctl
result did not establish acceptance; this record does not assert that notarization
is absent or that the binary is malicious. No Gatekeeper bypass, override, signing
change, quarantine removal or candidate execution followed. No retries were used
to turn an ambiguous assessment into PASS.

## Non-inference execution and remaining checks

Candidate `--version`: **NOT RUN**. Candidate `--help`: **NOT RUN**.
Exact executed version and required CLI surface therefore remain **UNQUALIFIED**.
The manifest identifies version 2.1.292, but is not a substitute for its executed
version output. Required flag presence remains unchecked for print, output format,
verbose, session ID, model, effort, restricted, safe mode, tools/disallowed tools,
strict/empty MCP configuration, disabled slash commands, session persistence,
Chrome, permission mode and prompts.

Candidate execution count: **0**. No -p, doctor, auth, interactive, install/update,
plugin, MCP, agent/session or remote-control command was run. There is no
post-execution hash claim; final hash was rechecked after verification only.

## Legacy recheck and cleanup

Legacy `--version` after: **2.1.260 (Claude Code)**, exit 0.
Legacy SHA after: **3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c**.
Version and SHA remain exactly unchanged. Legacy probes used controlled PATH and
DISABLE_AUTOUPDATER=1 outside the repository. Current install was never updated,
replaced, reconfigured or copied.

Temporary GNUPGHOME and key/manifest/signature downloads were removed. Normal
`~/.gnupg` was absent before and after; no normal keyring contents were inspected.
The matching, signed candidate binary remains in its private non-PATH directory,
unexecuted and **not fully qualified**, for a separately authorized follow-up.

## Scope, validation and next gate

Only this new evidence note changed. Historical blocked evidence remains intact.
Harness VERSION, production adapter, Orchestrator, UI, Run API, auth and governance
are unchanged. Original dirty checkout is untouched. Documentation diff reviewed;
`git diff --check` passed. No project code or test runner was executed; no CI claim.

The next decision must resolve why macOS assessment did not establish acceptance,
using trusted diagnostics under a separately scoped gate. Do not bypass Gatekeeper
or proceed to metadata execution, harness migration or live negatives on this result.

| Safety boundary | Result |
| --- | --- |
| Provider calls / Claude inference | 0 / 0 |
| Doctor / candidate execution | 0 / 0 |
| Claude auth mutation / credentials or Keychain inspected | 0 / NO |
| Current Claude install change | NO |
| Anthropic public-key import | Disposable keyring only; normal keyring 0 |
| Project-controlled execution / MCP / SSH auth / Orchestrator | 0 / 0 / 0 / 0 |
| Merge/deploy | NO |

PR #24 remains Draft. UNKNOWN provenance is a reviewable result, not approval of
Claude 2.1.292 as the Host TCB baseline.
