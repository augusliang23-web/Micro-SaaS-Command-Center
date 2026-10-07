# Phase 3B6B.3A — trusted GPG verifier prerequisite

Decision: **GPG_PREREQUISITE_PASS**. Observed 2026-10-07 (Asia/Singapore).
This qualifies the verifier only; Claude candidate provenance was not resumed.

## Baseline

| Field | Observed value |
| --- | --- |
| PR #24 starting HEAD | `ddd16cb1f6512d9fa07ac62a62ae17b0b48c0f1c` |
| PR status | OPEN / Draft / unmerged |
| Homebrew command | `/opt/homebrew/bin/brew` |
| Homebrew prefix | `/opt/homebrew` |
| Homebrew version | 7.0.8 |
| Existing GPG / gpg2 | Neither found on PATH or expected Homebrew paths |
| Claude command | `/opt/homebrew/bin/claude` |
| Claude version before / after | `2.1.260 (Claude Code)` / same; exit 0 both |
| Claude SHA-256 before / after | `3c269f66801028823e24a63ced9fdd3988cb86cf85fccd9f03f87e463b9d3e3c` / same |

## Bounded package operation

Reviewed `brew info gnupg`, `brew deps gnupg`, formula JSON and a dry-run install.
Formula: `homebrew/core/gnupg`, version 2.5.24, bottled, initially not installed.
Candidate opt prefix: `/opt/homebrew/opt/gnupg`.
Direct required dependencies: gnutls, libassuan, libgcrypt, libgpg-error, libksba,
libusb, npth, pinentry, readline and gettext. The dependency closure also includes
ca-certificates, gmp, json-c, libidn2, libtasn1, libunistring, nettle and p11-kit.
The actual install needed the following 13 dependency formulae; the remainder
were already available. No optional software was manually installed.

| Newly installed dependency | Version |
| --- | --- |
| gmp | 6.3.0 |
| gnutls | 3.8.13_2 |
| libassuan | 3.0.2 |
| libgcrypt | 1.12.4 |
| libgpg-error | 1.61 |
| libidn2 | 2.3.8 |
| libksba | 1.8.1 |
| libtasn1 | 4.21.0 |
| libusb | 1.0.30 |
| nettle | 4.0 |
| npth | 1.8 |
| p11-kit | 0.26.5 |
| pinentry | 1.3.3 |

Installed `gnupg` 2.5.24 via existing Homebrew with
`HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_INSTALL_UPGRADE=1`, and
`HOMEBREW_NO_INSTALL_CLEANUP=1`. No brew upgrade, cleanup, autoremove, cask
change, or Homebrew update was run. Comparing before/after formula inventories
confirmed exactly gnupg plus those 13 additions and no changes to existing formula
versions. No unrelated upgrade or unexpected package mutation was observed.

## Executable and disposable keyring qualification

| Check | Result |
| --- | --- |
| Command resolution | `/opt/homebrew/bin/gpg` |
| Canonical executable | `/opt/homebrew/Cellar/gnupg/2.5.24/bin/gpg` |
| GPG version | `gpg (GnuPG) 2.5.24`; libgcrypt 1.12.4 |
| File type | Regular executable after resolving Homebrew launcher |
| Mode | 0555; not group/world writable |
| Trusted prefix | Canonical path inside `/opt/homebrew/Cellar/gnupg/` |
| Disposable GNUPGHOME | Created in private temporary storage; mode 0700 |
| Local command | Exact canonical GPG with explicit `--homedir` and GNUPGHOME, `--version` only |
| Local result | Exit 0, expected GnuPG version observed |
| Temporary keyring removal | Confirmed removed in finally cleanup |
| Normal user keyring | `~/.gnupg` absent before and after; no contents inspected, no key imports or intentional timestamp writes |

The launcher may be Homebrew's normal symlink; the qualified target is its
canonical regular executable. No user/repository shim or PATH configuration
change was used. No Anthropic release key, candidate manifest or candidate binary
was downloaded or imported in this gate.

## Scope, validation and safety

Only this evidence note changed in the repository. The harness frozen version,
production adapter, Orchestrator, UI, Run API, auth and governance are unchanged.
The earlier blocked provenance note remains historical evidence. The original
dirty checkout is untouched. Documentation diff reviewed; `git diff --check`
passed. No project code/test execution or CI claim.

Claude version and SHA checks passed before/after. GPG is now available for a
separately authorized resumption of Phase 3B6B.3; this result does not qualify
Claude 2.1.292 or authorize further candidate work.

| Safety boundary | Result |
| --- | --- |
| Current Claude install/upgrade | NO |
| Claude candidate download/execution | 0 / 0 |
| Claude inference/provider calls/doctor | 0 / 0 / 0 |
| Claude auth mutation/credentials inspected | 0 / NO |
| Anthropic key import/normal keyring use | 0 / NO |
| MCP/SSH auth/Orchestrator | 0 / 0 / 0 |
| Merge/deploy | NO |

PR #24 remains Draft.
