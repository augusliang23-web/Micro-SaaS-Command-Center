# Phase 3B6B.7 — macOS native lifecycle collector feasibility

Overall result: **NATIVE_LIFECYCLE_COLLECTOR_BLOCKED**.
Contract decision: **C — NATIVE_COLLECTOR_NOT_FEASIBLE** under the currently
approved full contract and this gate's privilege/entitlement restrictions.
Observed 2026-10-08 (Asia/Singapore). This is documentation only. Native
generation/observed-origin capabilities are stronger than ps, but complete
descendant executable/ancestry coverage and transient IPC remain unproven.

## Baseline and preserved scope

Starting local and remote PR #24 HEAD:
`ff53f100aff25db736dc7895e565fe84c6d44808`; worktree initially clean; PR
OPEN / Draft / unmerged. The existing offline lifecycle contract is preserved:
unknown descendant/identity/ancestry/visibility stays UNKNOWN, prohibited
execution FAIL, observed attributable survivor BLOCKED, disappearance is not
exit proof, reparenting retains attribution, generations cannot merge on PID
reuse. Managed-policy historical PASS evidence remains unchanged.

No collector, observer, harness, production adapter, Orchestrator, Run API,
UI, dependency or deployment code changed. Default live admission remains
LIVE_EXECUTION_NOT_AUTHORIZED. Helper approval inventory remains empty. No
Claude command, candidate execution, provider call or inference occurred.

## Host, sources and availability evidence

Host: macOS **27.0.1**, build **26A434**, arm64; installed Apple Command Line
Tools SDK **27.0** (`macosx27.0`). No installation or upgrade was performed.
Local SDK headers/man were read at the installed MacOSX.sdk root:

- usr/include/libproc.h: process listing/info/path/rusage declarations.
- usr/include/sys/proc_info.h: proc_bsdinfo, FD/socket flavors and sizes.
- usr/include/sys/resource.h: rusage_info_v0 process birth/exit tick fields.
- usr/include/sys/event.h and usr/share/man/man2/kqueue.2: process events,
  fork notification limitations and unsupported descendant tracking flags.
- usr/include/sys/sysctl.h and sys/proc.h: KERN_PROC current metadata;
  p_oppid is a ptrace-related field, not a supported universal birth record.
- usr/include/EndpointSecurity/ESClient.h and ESTypes.h: entitlement and
  privilege requirements, including the macOS 27 descendant-scoped API.

Public-source review was pinned to Apple XNU commit
`f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`:
[private process identity layout](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info_private.h),
[kernel process info](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c),
[kernel process identity](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_proc.c),
[process event definitions](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/event.h).
That source snapshot is not claimed to be the exact installed kernel revision;
local runtime checks, return sizes and SDK evidence qualify the observations.

| Evaluated mechanism | Evidence and limit |
| --- | --- |
| proc_listpids / PROC_ALL_PIDS | Runtime list contained the owned live fixture; point-in-time enumeration, not a birth/exit event log |
| proc_pidinfo / PROC_PIDTBSDINFO | Runtime returned the expected 136 bytes; PID/PPID/PGID and start seconds/microseconds matched the fixture |
| proc_pid_rusage / RUSAGE_INFO_V0 | Runtime succeeded with nonzero ri_proc_start_abstime; stronger birth-time metadata than ps lstart |
| proc_pidpath | Runtime resolved the owned executed /bin/sleep fixture; no unrelated executable enumeration/hashing |
| PROC_PIDUNIQIDENTIFIERINFO (17) | Runtime returned 56 bytes using Apple's published private layout; kernel unique process/parent IDs and version fields available on this host |
| sysctl KERN_PROC_PID | Own-process metadata size/data query succeeded; current snapshot, not complete origin/event history |
| getsid/getpgid | Owned detached fixture session/group observed directly; scalar queries still need generation/race checking |
| kqueue EVFILT_PROC | Non-root fixture fork and matching parent/child exit events observed; recursive discovery is not complete |
| proc_pidinfo PROC_PIDLISTFDS | Current socket descriptor type observed on owned holder; no transient FD-history stream |
| lsof -nP -U -a -p owned PID | Positive Unix listener snapshots and postconditions observed; SAMPLING_ONLY |
| EndpointSecurity | Header/documentation assessment only; no client creation, entitlement request or permission change |

## Generation and executable identity

The strongest tested generation component is the kernel's 64-bit p_uniqueid
with p_idversion, not PID/name/second-resolution lstart. The private-layout ABI
was checked against its published 56-byte size, and identities were stable on
repeated reads and after controlled reparenting. Its private SDK status means
future use needs exact-host/version qualification and fail-closed ABI/error
handling, not an assumed portable third-party contract.

Public BSD start time has microsecond fields. The rusage birth clock uses Mach
absolute ticks; local timebase query returned numerator **125**, denominator
**3** for conversion to nanoseconds. This reports clock units, not guaranteed
nanosecond birth precision. No fake timing precision or actual same-PID reuse
observation is claimed. Existing synthetic PID-reuse tests still pass.

Owned fixture executable path was resolved/canonicalized and its disk bytes
hashed. Read-only codesign verification of /bin/sleep exited 0; diagnostic
identifier was the expected com.apple.sleep. This demonstrates metadata/hash/
signature availability for an attributable fixture, not actual Claude helper
approval or universal binding of disk bytes to a concurrently changing image.
Future attribution must bracket these reads with generation/exec-version checks;
paths alone cannot prove loaded-image identity. No unrelated host binary was hashed.

## Ancestry, detachment and the decisive process gap

A controlled supervisor forked a fixed /bin/sleep fixture with a detached
session. Before supervisor exit, direct PPID and original parent unique ID
matched. After the supervisor exited and the child reparented to launchd:

- PPID became 1.
- Child unique ID/version and BSD birth tuple remained stable.
- Original parent unique ID/version remained matched to the saved supervisor.
- Matching explicit kqueue exit events were observed for supervisor and child.
- Owned child was gone after cleanup; no persistent fixture remained.

Thus original-parent identity can positively support a direct detached origin
even when current PPID no longer points to it. It is stronger than current PPID
polling. Already observed ancestry can be retained. It does not reconstruct an
unobserved multi-hop chain through parents that have already disappeared.

The limiting counterexample was tested separately: **three** directly spawned
short-lived /usr/bin/true fixtures completed and were reaped before metadata
inspection. kqueue produced **one coalesced fork notification**, with **no child
PID** in its returned data. Subsequent BSD info could not recover those exited
children's executable metadata. Local event.h explicitly documents that the
child PID is not returned in the kevent and that NOTE_TRACK/NOTE_CHILD tracking
is unsupported; the local kqueue man describes fork/exit notifications, not a
complete recursively named birth history.

Consequently, faster libproc snapshots and explicit exits improve observed
identity but do not prove that every descendant/executable was captured. A fork
notification without fully resolved births must remain UNKNOWN. Registering an
exit watch after discovering a child also leaves a pre-registration gap.
Suspending the initial parent before subscription would not by itself close
recursive child discovery/coalescing or exec-history gaps. No such launch change
was made. Unknown disconnected origins remain UNKNOWN; no birth proof was invented.

This is why option B is not selected: it says PROCESS_COMPLETE with only IPC
revision outstanding. Here **process completeness is also unresolved**. The
private original-parent capability must not be overstated as a full birth log.

## IPC feasibility and explicit unimplemented proposal

No qualified complete transient Unix/socket/cross-session event mechanism was
established within the allowed non-root/no-EndpointSecurity-entitlement scope.
libproc FD info, sysctl and lsof are snapshots. kqueue on known descriptors
provides readiness/lifecycle signals, not discovery of every descendant's
transient endpoint creation/use. No polling absence is relabelled COMPLETE.

Persistent endpoint feasibility was tested with a host-owned Unix socket
inherited by a fixed /bin/sleep holder from its controlled supervisor:

- Owned listener was visible before and after the **actual supervisor exit**.
- An unrelated pre-existing fixture socket was visible in its own process and
  did not appear among the target holder's sockets.
- The holder's matching explicit exit event was observed.
- Its socket was no longer observed after holder exit; fixtures and paths were removed.
- Dead-process metadata query returned 0 with errno **3 / ESRCH**. That is an
  observation error, not a complete no-socket proof.

Under the existing contract, the surviving owned unapproved endpoint would
BLOCK. These positive fixture snapshots establish only persistent/postcondition
capability; they do not establish absence of short-lived or cross-session use.

**Proposed IPC delta, NOT IMPLEMENTED OR APPROVED:** within the exact approved
Claude parent and separately approved internal-only helper identities, tolerate
trusted transient internal IPC without requiring a complete history of every
creation. Still prohibit model-controlled socket/network authority, MCP/browser
authority, cross-session messaging and background/session worker endpoints.
Require a bounded stable postcondition of no attributable unapproved listener/
endpoint/worker surviving foreground exit. Positive violations BLOCK/FAIL as
appropriate; unknown ownership, endpoint role or visibility remains UNKNOWN.
Existing tool/protocol/source/session restrictions would remain independently
required. No endpoint may be called vendor-internal merely because Claude owns it.

Before that delta could qualify, independent tests would need identified
internal-only transient examples, persistent/reparented holders, cross-session
and task-controlled endpoints, unrelated endpoints, collection errors and cleanup
stability. This gate's positive socket fixtures are not that complete approval.
**An IPC-only delta does not fix the separate process-birth coverage gap.**

## Native-first privileged alternative, not exercised

Installed macOS 27 ESClient.h declares **es_new_descendants_client** for recursive
descendant-scoped events, including existing/future descendants. Its notes say
root and TCC approval are not required, but the EndpointSecurity client
entitlement **is still required**. This is not equivalent to saying all
EndpointSecurity APIs require root: the ordinary es_new_client path separately
has root/entitlement/TCC failure cases in the headers.

Apple documents the [EndpointSecurity client entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.endpoint-security.client).
The user explicitly excludes that entitlement in this gate. No ES client was
created, entitlement inspected/requested, or global event subscription attempted.
Header presence is not a runtime qualification of the descendant API. DTrace
privilege, root/sudo, kernel extensions and security-setting changes were likewise
excluded and not attempted. Any alternative privileged/entitled boundary needs
a new Control Plane decision; it is not authorized by this result.

## Probe trust boundary, validation and remaining evidence

Native probes used the already installed system Python/ctypes/select bindings,
Apple libraries and fixed host-owned fixture coordination. Child exec payloads
were fixed OS /bin/sleep or /usr/bin/true, with a minimal system PATH, no shell
wrapper, no project/task material and no network access. Unix sockets used private
temporary fixture directories. Only owned/self metadata was queried in detail;
PID enumeration was not promoted to process ownership. Raw process IDs, paths,
UUIDs, socket payloads and unrelated host metadata were not persisted here.

One initial exit wait consumed the supervisor's event before the child's and
did not prove child completion. The final probe used a bounded loop matching
the child's own exit event and confirmed cleanup. This probe correction is not
hidden as a collector PASS. No actual PID reuse was forced on the host. No new
native collector test module exists because option C requires documentation only.

| Local validation | Passed | Failed |
| --- | ---: | ---: |
| Existing lifecycle state machine | 29 | 0 |
| Existing Phase 3B6B qualification | 62 | 0 |
| Adapter fake executable | 28 | 0 |
| Smoke observer | 49 | 0 |
| Required existing offline total | **168** | **0** |

Native capability probes are reported individually above; they are not a
production collector test-suite PASS. Existing observer/harness passed node
--check. Documentation diff checks passed. No broader suite rerun or unrelated
fix was needed; its previously documented baseline failures are unchanged.
These are local offline validations, not CI.

Candidate read-only recheck: SHA256
`97a01e5bc74a199e67189435d0331ea3a24eac2e07db4b76d9148c5b0386138f`,
canonical regular file, nlink 1, mode 0500. No candidate execution or bytes/
permissions/installation change. Provider calls/inference **0 / 0**, candidate
execution **0**, auth mutation **0**, secrets/Keychain inspection **no**,
sudo/root **0**, package installation **0**, security-setting change **0**,
real MCP/SSH/browser/Orchestrator activation **0**, merge/deploy **no**.

Remaining architectural blocker: an approved source of complete process birth/
exec/ancestry evidence and qualified IPC evidence, or an explicit reviewed
contract/trust-boundary revision covering both gaps. No weakened observer or
collector was implemented. Live lifecycle admission stays BLOCKED; real -p
remains NOT AUTHORIZED. Continue existing Draft PR #24 only.
