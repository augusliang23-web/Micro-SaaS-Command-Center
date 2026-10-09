# Phase 3B6B.3 — exact 2.1.292 candidate provenance gate

Decision: **CLAUDE_2_1_292_CANDIDATE_PROVENANCE_BLOCKED**.
Observed 2026-10-07 (Asia/Singapore). Provider calls: **0**.

## Blocking prerequisite

GPG was not available on PATH (`gpg`/`gpg2`) or in the common Homebrew,
`/usr/local/bin`, MacGPG2, Homebrew Cellar and application locations checked.
The required disposable GNUPGHOME import, exact fingerprint comparison, and
signed-manifest verification therefore could not be performed. This is a missing
tool prerequisite, not a bad signature or evidence of a compromised release.
No GPG installation or alternate verifier was substituted.

Stop occurred before downloading any candidate release artifact or executing the
candidate. No candidate directory, executable, launcher or temporary keyring was
created. No key was imported into the user's normal GPG keyring. A future attempt
needs an available trusted GPG executable, or separate authorization to provision
that prerequisite, and must start from signature verification again.

## Baseline

| Field | Observed value |
| --- | --- |
| PR #24 start HEAD | `0e2ad12dadb9b5f991ae59b4a7c8ad68c9f17b24` |
| PR #24 status at start | OPEN / Draft / unmerged |
| Remote main | `25692a9a1fdedaf82910630fb767589aa5dccddf` |
| Current executable | `/opt/homebrew/bin/claude` |
| Host platform | Darwin arm64 |
| Current version before | `2.1.260 (Claude Code)`; exit 0 |
| Current SHA-256 before | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| SHA after first version probe | Same SHA-256 |
| Current version after | `2.1.260 (Claude Code)`; exit 0 |
| Current SHA-256 after | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` |
| Current version/hash unchanged | YES |

Only the existing executable's `--version` was run before and after, using a
controlled child environment with `/usr/bin:/bin` and `DISABLE_AUTOUPDATER=1`,
outside the repository. No global PATH, alias, settings, cask or executable was
changed. Existing configuration/authentication files were not inspected or copied.

## Target and verification ledger

| Required item | Result |
| --- | --- |
| Exact target | 2.1.292; no newer version/channel substitution |
| Architecture | darwin-arm64 |
| Candidate path class | Proposed `$HOME/.local/share/cc-qualification/claude/2.1.292/claude`; outside repository and PATH; NOT CREATED |
| Expected public-key fingerprint | `31DD DE24 DDFA B679 F42D 7BD2 BAA9 29FF 1A7E CACE` |
| Observed fingerprint / match | NOT CHECKED; GPG unavailable |
| Manifest signature | NOT VERIFIED; admission stopped |
| Verified platform entry | NOT CHECKED; manifest was not downloaded or trusted |
| Signed expected binary SHA / size / location | UNKNOWN; no trusted manifest fields promoted |
| Candidate actual SHA / match | NOT AVAILABLE / NOT CHECKED |
| Regular file / nlink / permissions / canonical path | NOT CHECKED; no candidate file exists from this task |
| Symlink / hardlink / executable siblings | No candidate material created; candidate filesystem qualification NOT PERFORMED |
| macOS codesign / authority / team | NOT CHECKED; native tool is available, but signature gate stopped first |
| Gatekeeper / notarization | NOT CHECKED; native tool is available, but no candidate was downloaded |
| Candidate --version | NOT RUN |
| Candidate --help / required flags | NOT RUN / NOT CHECKED |
| Candidate hash unchanged after execution | NOT APPLICABLE; candidate execution 0 |

No missing field is recorded as PASS, absent policy, zero processes, or a verified
checksum. The manifest's binary location must be obtained from verified metadata
or other official exact-version metadata on a resumed gate; no URL is guessed here.

## Official sources and resumed sequence

Only the official documentation was read for verifier requirements:
[Anthropic signature verification](https://code.claude.com/docs/en/setup#verify-the-manifest-signature)
and [macOS signing/notarization](https://code.claude.com/docs/en/setup#platform-code-signatures).
These confirm the requested fingerprint and separate manifest integrity from native
code signing. They do not establish candidate provenance without performing checks.

Exact artifact sources specified for a future attempt, **not downloaded here**:

- [Manifest](https://downloads.claude.ai/claude-code-releases/2.1.292/manifest.json)
- [Detached signature](https://downloads.claude.ai/claude-code-releases/2.1.292/manifest.json.sig)
- [Release signing public key](https://downloads.claude.ai/keys/claude-code.asc)

Resume only with trusted GPG available: private owned directory and disposable
GNUPGHOME → exact key fingerprint → valid detached signature → trusted darwin-arm64
record → exact-version binary download → SHA/size/filesystem checks → valid
Anthropic macOS signature and acceptable Gatekeeper/notarization → exact candidate
`--version`/`--help` with updater disabled → candidate hash recheck → legacy
version/hash recheck. Candidate execution cannot precede provenance checks.
Do not use floating latest/stable, execute installer scripts, copy auth, or relax
any failed or unknown check. Candidate qualification does not migrate the harness.

## Repository scope, validation and safety

Only this evidence document changed. Production adapter, harness VERSION,
Orchestrator, UI, Run API, authentication and governance are unchanged. Historical
first-attempt JSON is unchanged. Original dirty checkout is untouched.
Documentation diff reviewed; `git diff --check` passed. No project tests or code
were run; this is a local documentation check, not CI.

| Safety boundary | Result |
| --- | --- |
| Install/upgrade current Claude | NO |
| Candidate binary downloads/executions | 0 / 0 |
| Claude inference / provider calls | 0 / 0 |
| Doctor, auth commands, install/update, plugin/agent/session/MCP commands | 0 |
| Auth mutation / credentials or Keychain inspection | 0 / NO |
| Normal GPG keyring mutation | 0 |
| Project-controlled execution / MCP / SSH auth / Orchestrator | 0 / 0 / 0 / 0 |
| Merge/deploy / Production/UAT/cloud execution | NO / NO |

PR #24 remains Draft. This blocked result is reviewable evidence, not authorization
for a candidate, migration, inference, or release.
