# Phase 3B6B.11B — offline diagnosis of the Stage 1 "MALFORMED" result

**Decision: OFFLINE_MDM_DIAGNOSIS_PASS** — ready for Control Plane review.

Offline and synthetic only. No `sudo`, no `profiles`, no real Mac policy inspection, no file of the real device read, no Claude candidate command, no provider call. Runtime MDM admission stays **BLOCKED**; live execution stays **NOT AUTHORIZED**.
Every result below comes from made-up text shapes; nothing here says what the real Mac printed.

## What was reported (Stage 1 run #1, as relayed — not independently observed here)

```
PROFILES_EXIT=0
COVERAGE=PARTIAL   (form=MALFORMED)
CLAUDE_DOMAIN=UNKNOWN
SCHEMA_FINGERPRINT=ROOT=NONE
```
No raw output was kept, so the real text cannot be reconstructed.

**What those four facts do and do not tell us.** `form=MALFORMED` is only produced when the captured output was non-empty, not larger than 8 MB, and failed the strict plist parser (empty output would read `EMPTY`; huge output `TOO_LARGE`). Exit code 0 means the command itself did not fail.
They do **not** tell us whether the text was a sentence, XML with extra text, damaged XML, or valid XML the strict parser refused. `CLAUDE_DOMAIN=UNKNOWN` only says the domain name was not found in the text; for text that is not a clean plist the program can never say `ABSENT`.

## Baseline

| Item | Value |
| --- | --- |
| PR | #24, OPEN / Draft / unmerged |
| Starting HEAD | `05f53d9bcd7bc8924fcf754bf3fc009787f8a091` |
| Working tree before | clean |
| Ending HEAD | the commit containing this document (parent = the starting HEAD; hash reported on the PR) |
| New normalizer SHA-256 | `31aeaddc984b4b6091b3cca8c9030b5769adbb2648197ae165568dbd988b56a5` (the run #1 hash `656c2f39…` is superseded) |

## Root-cause hypotheses (ranked by what we know, none confirmed)

| # | Hypothesis | Fits the facts? | What would distinguish it (new `FORMAT_*` lines) |
| --- | --- | --- | --- |
| H1 | The command printed a **plain-text sentence** (for example a "no configuration profiles" style message) and exited 0 | Yes — plausible on a Mac with few or no profiles; the manual does not say what `show` prints when nothing is installed | `FORMAT_CLASS=PLAIN_TEXT`, `first=LETTER`, `plist_open=false`, perhaps `phrase_no_profiles=true` |
| H2 | **Valid XML with extra status text** before or after it | Yes — the parser rejects any text outside `<plist>…</plist>` by design | `XML_PLIST_WITH_LEADING_TEXT` / `…TRAILING_TEXT` / `…LEADING_AND_TRAILING_TEXT`, `extracted_parses=true`, `parse_reason=LEADING_TEXT` or `TRAILING_CONTENT`, plus an `EXTRACTED_FINGERPRINT` |
| H3 | Valid-looking XML containing something the **strict parser does not accept** (CDATA, an unknown element, a duplicate key inside a dictionary, a number or date in an unexpected format, nesting over 32 levels or over 200,000 nodes) | Yes | `XML_PLIST_MALFORMED_BODY` with `parse_reason=CDATA_OR_DECL / UNKNOWN_ELEMENT / DUPLICATE_KEY / BAD_SCALAR / LIMIT / BAD_ENTITY` and `parse_at` |
| H4 | **Truncated or damaged capture** (less likely with exit 0) | Possible | `XML_PLIST_TRUNCATED` or `parse_reason=TRUNCATED` with `parse_at=END` / `75-100` |
| H5 | **Non-text or mis-decoded bytes** | Unlikely | `BINARY_OR_NONTEXT`, `non_text=true` |
| H6 | Something else on standard output (a warning line, a tool banner) in front of or behind the XML | Folded into H2 / H1 | the same leading/trailing classes |

## Review of the existing XML parser

The parser is intentionally strict (no entities beyond the five standard ones and numeric references, no CDATA, no internal DOCTYPE subset, duplicate keys rejected, depth 32, 200,000 nodes, 8 MB, dates only as `YYYY-MM-DDTHH:MM:SSZ`, base64 data checked, nothing outside `<plist>…</plist>`).
That strictness is correct for a fail-closed gate, and **this task does not loosen it**: XML with text around it, plain text and every other uncertain shape remain BLOCKED. The only parser change is that a failure now carries a **closed-list reason** and a coarse position bucket (diagnostic only).

## Changes (all scoped, diagnostic only)

1. `parsePlistXml` returns `reason` (21 fixed words) and `at` (`0-25`, `25-50`, `50-75`, `75-100`, `END`) on failure. Acceptance behaviour is unchanged.
2. New `diagnoseFormat(stdout)` classifies the output into a fixed class: `XML_PLIST_VALID`, `XML_PLIST_WITH_LEADING_TEXT`, `…_WITH_TRAILING_TEXT`, `…_WITH_LEADING_AND_TRAILING_TEXT`, `XML_PLIST_MALFORMED_BODY`, `XML_PLIST_TRUNCATED`, `XML_LIKE_OTHER`, `PLAIN_TEXT`, `BINARY_OR_NONTEXT`, `EMPTY`, `TOO_LARGE`, `NONE`, `UNKNOWN`,
   with yes/no flags and buckets only (size, line count, first-character class, XML declaration present, `<plist>` open/close present, dictionary present, text before/after, whether the extracted XML parses, non-text bytes, and four generic word-presence hints: "no profiles", "error", "usage", "sudo/password").
   If the XML portion can be cut out and parses, its **schema fingerprint** is shown separately (`EXTRACTED_FINGERPRINT`).
3. The normalizer now prints **twelve** lines: the previous nine plus `FORMAT_CLASS`, `FORMAT_DETAIL` and `EXTRACTED_FINGERPRINT`.
4. The Stage 1 runbook (`agent-console-phase3b6b11a-stage1-runbook.md`) is updated in place: the pinned normalizer hash, twelve expected lines, an explanation of the new lines, and the superseded hashes. Its commands are unchanged and **still not authorized to run**.

**What the diagnosis can never do:** it is not read by any decision code (a test asserts the decision section only *assigns* it); it stores no raw text, line contents, key names, values, paths, names or ids; and it cannot make an uncertain result less blocked.
In particular a "no profiles" sentence, a phrase flag, or valid XML inside surrounding text changes **nothing**: coverage, schema trust, the domain verdict and the overall word are identical with or without them, and none of it is treated as evidence that no managed policy applies.

## Tests (local offline; not CI)

| Suite | Passed | Failed |
| --- | ---: | ---: |
| New format-diagnosis tests (`test/agent-console-phase3b6b11b-format-diagnosis.test.mjs`) | 8 | 0 |
| Stage 1 runbook / fingerprint (adapted) | 16 | 0 |
| MDM trust + isolation (adapted) | 12 | 0 |
| MDM fixtures (adapted) | 15 | 0 |
| One-call | 82 | 0 |
| Lifecycle | 33 | 0 |
| Phase 3B6B qualification | 67 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| **Total** | **310** | **0** |

`node --check` passes on every modified or new script and test; `git diff --check` is clean.

What the new tests cover: 25 synthetic shapes (valid plist; XML + trailing text; leading text; both; four plain-text variants including a "no profiles" sentence, an error, a usage message and sudo text; empty inventory in three forms; truncation at several points; broken body with bad entity, duplicate key, unknown element, CDATA and a depth bomb; XML-like non-plist; JSON-looking text; binary and mis-decoded text) each get the expected class and reason;
the reported Stage 1 facts fit seven different shapes **identically** in the first nine lines yet each gets its own `FORMAT_*` signature; no-profiles/phrase hints change no decision field; empty-inventory shapes stay unreviewed and never complete; a Claude-domain mention still blocks as PRESENT in every format;
all twelve output lines stay inside a closed vocabulary with sentinel secrets never appearing; parser behaviour is unchanged; and the command line, run under Node's permission sandbox with file reads denied, prints the twelve lines for plain text, XML with status text and valid XML and stays BLOCKED.
Mutation check (each reintroduced and restored; all caught): letting the "no profiles" flag decide coverage (2 failing tests), tolerating trailing text (6), storing raw text (1), tolerating leading text (1), mislabelling truncation (2).

## Remaining uncertainty

- What the real Mac printed is unknown; the hypotheses above are not ranked by evidence beyond "exit 0 and non-clean-plist".
- The real `profiles show -all` output when no profiles exist, and whether it adds status lines, is still undocumented (the man page says only that XML is written to the console).
- Even a clean parse would still need a Control Plane-approved schema, and the policy-file locations are still not inspected. Nothing here admits anything.

## Options for Control Plane (a decision, not an action)

1. **Re-run Stage 1 once** with the updated normalizer (new hash; same visible `sudo -v` / `sudo -n` safety). It would reveal which hypothesis holds without keeping any raw text. Needs a fresh written authorization naming the new commit and hash.
2. **Format discovery without administrator rights:** a human could run the same `profiles show … -output stdout-xml` *without* `sudo`, piped to the normalizer, to learn only the output format for the current user's profiles. It reads real device information (though unprivileged and shown only as fixed words) and so needs separate approval; it cannot say anything about the device-wide inventory.
3. **Do nothing yet.** Do **not** relax the parser to accept text around XML based on a guess: any such acceptance needs a reviewed design and evidence from a real sample.

**Final decision: OFFLINE_MDM_DIAGNOSIS_PASS.** It does not authorize any MDM command, permit, attestation or Claude inference.
