# Coach — paid-period controller composition (local infrastructure)

## Scope and ownership

This increment connects the existing consumer-owned renewal draft to the four
audited paid-period RPC methods. It is local composition, not a mounted Coach
screen. The composition root, lockfile, invitation behavior, SQL and user training
data are unchanged. Pending/declined commercial choices are not payment commands
or unlink operations and are not persisted by this increment.

The pure controller owns an immutable confirmed read, the existing draft/undo,
one immutable dispatched intent and its reconciliation lifecycle. The runtime
only binds the existing verified principal, public configuration, explicit
renewal-row/relationship-episode mapping and strict civil-date/UUID validation.
It does not create Auth, inspect environment variables, invent a source baseline,
infer a relationship from a UI row id or calculate payment dates automatically.

## Integration boundary

- Create `createCoachPaidPeriodRuntime` per captured account + portal/generation
  and selected relationship. Supply both `connection.isCurrent` and
  `isSelectionCurrent`; a false result permanently invalidates that instance.
- The same latched guard protects consumer and repository Auth/transport
  boundaries. Dispose when leaving; disposal cannot roll back a dispatched write.
- Load confirmed data before opening a draft. Supply the explicit `confirm` or
  `correct` target and unchanged baseline version. Correction retains `periodId`.
- Editing or accepting the inner dates modal is local only. Only the outer
  explicit save sends the prepared payment command. Invalid dates, open dates
  modal, unchanged/cancelled draft and unpaid choices cannot send that command.
- Double save is single-flight. Cancellation does not erase an in-flight intent.
- A valid receipt is retained if the subsequent authoritative read fails. An
  uncertain response keeps the original request id and needs explicit operation
  reconciliation. Only an explicit absent receipt permits an explicit retry of
  that same immutable intent. No automatic retry or new request id is generated.
- The verified SDK repository retains its total timeout, DTO allowlist, exact
  identity and narrow RPC set. The controller does not expose raw error messages.

## Verification and handoff

Code, final local gates and independent GPT-5.6 Sol medium audit R2: PASS.
R1 found one LOW, fixed and independently verified closed. DOMAIN delivered five pure
controller files in immutable patch da52900bec1e25ea7f1aae0ecc82c02c993cb2436212bdcea99a89f1c267c196.
ROOT verified those hashes and preserved the producer's 22 baseline files before
integrating. The contract was transferred early only after being frozen. ROOT
owns runtime, SDK integration tests, test registration and final corrections.

The initial integrated full gates passed, but MAIN review found a freshness gap:
a matching receipt followed by SDK-valid pre-write facts could resolve the attempt.
Three added regressions reproduced it (two controller tests and one real SDK test).
ROOT now rejects unchanged receipt versions and prevents publishing absent or
pre-write-version reads after a receipt, retaining recorded for explicit refresh.
This follows the existing SQL ledger's changed-version/no-delete invariant; it
does not order UUIDs or reject a genuinely later period/version. DOMAIN stays
frozen; these bounded final corrections are declared in the ROOT audit increment.

SDK integration tests intercept every fetch using synthetic identities and an
`.invalid` host. They cover payload binding, successful confirm/correct + refresh,
snapshot mutation, bad identifiers, strict civil dates/undo, read failure versus
real absence, double click/cancel, uncertain receipts, exact retry, selection and
identity invalidation, disposal and total deadline. They do not simulate a real
database transaction or establish manual QA PASS.

Final sequential local gates after the freshness correction: 82 paid-period
tests (38 existing + 31 pure controller + 13 real SDK composition), 40 invitation
regressions, 144 domain regressions, full npm test including pre/post, lint, build,
typecheck and diff check PASS. Evidence lives in
`/tmp/organizatech-coach-paid-controller-root.DmN5uq/` (`*-r2.log`); original
pre-strengthening gates and the red/green regressions remain separate.
Independent GPT-5.6 Sol medium READ-ONLY audit R1 verified those gates and exact
integrity, then reproduced one LOW: unsafe access to unknown error.code could
throw and strand pending. The official repository already sanitizes errors, but
the controller now inspects only own data descriptors inside try/catch. Two new
pure regressions cover getters, inherited properties and throwing/revoked Proxy
in load/save/reconcile, preserving unknown errors as unavailable without leakage.
Red evidence is retained. After the fix: 84 paid tests (38 existing, 33 controller,
13 SDK), 40 invitation and 144 domain regressions, full npm test pre/main/post,
lint, build, typecheck and diff check PASS sequentially (`*-r3.log`, exit 0).
Independent R2 reproduced getter/inherited/Proxy/revoked/canonical cases and ran
84 focal tests plus diff check: PASS, no new findings. It verified the immutable
manifest, ten-file inventory, logs, 172/174 preserved baseline and protected files.
Report: `/tmp/organizatech-coach-paid-controller-root.DmN5uq/sol-audit-r2.md`.
Only this document and the controller integration note were updated after PASS;
post-audit-integrity records their new hashes and preserves the eight other files.

Remaining outside this increment: live authorized portfolio source and visible
mount, pending/declined persistence, monthly snapshots, email/notification worker,
student acceptance flow, owner commit/push, remote migrations and owner's manual
QA. Remote QA migrations require the exact separately presented inventory and
approval; no production action is included. Do not call the whole Coach feature
ready for QA solely because this local controller passes.
