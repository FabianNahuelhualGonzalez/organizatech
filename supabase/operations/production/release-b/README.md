# Release B - Production rollout for workout readiness v2

Supabase Production project ref:

```text
lzycxltqbrtsnwfdotqw
```

## Current Production status

Release B backend v2 is installed in Production.

The frontend still remains on the legacy readiness flow. The next phase is a separate controlled frontend integration. Do not re-run the apply script, do not run rollback, and do not modify Vercel from this bundle.

## Real Production execution results

### Precheck

```text
PROD_READINESS_V2_READY
legacy rows = 19
duplicate groups = 0
v2 objects absent
```

### Application

```text
02_apply_training_workout_readiness_v2.sql
Success. No rows returned
```

### Postcheck

```text
PROD_READINESS_V2_VERIFIED
training_workout_readiness_rows = 0
legacy rows = 19
```

### Additional service_role ACL check

```text
PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN
table ACL rows = 0
save RPC ACL rows = 0
link RPC ACL rows = 0
```

## Files

1. `01_precheck_readonly.sql`
   - Strictly read-only.
   - Returned `PROD_READINESS_V2_READY` before applying the backend migration.
   - Returns `PROD_READINESS_V2_ALREADY_PRESENT` if v2 is already fully installed.
   - Returns `PROD_READINESS_V2_BLOCKED` for invalid prerequisites, duplicates or partial/incompatible installation.

2. `02_apply_training_workout_readiness_v2.sql`
   - Production wrapper for `supabase/migrations/20260620_training_workout_readiness.sql`.
   - Wrapped in an explicit transaction.
   - Includes the reconciled `ON CONFLICT ON CONSTRAINT training_workout_readiness_user_attempt_key` hotfix.
   - Already executed successfully in Production. Do not execute again without a separate Architecture decision.

3. `03_postcheck_readonly.sql`
   - Strictly read-only.
   - Verifies table shape, all 11 real columns, constraints, exact foreign keys, indexes, trigger, RLS, policies, grants, RPC signatures, `SECURITY DEFINER`, `search_path`, named conflict target, legacy integrity, and explicit `service_role` ACL absence.
   - Returned `PROD_READINESS_V2_VERIFIED` after the successful application.

4. `04_emergency_rollback.sql`
   - Emergency rollback template for the backend v2 objects only.
   - Drops only `training_workout_readiness`, `save_training_workout_readiness_v2` and `link_training_workout_readiness_session_v2`.
   - Does not use `CASCADE` and does not touch legacy readiness.
   - Must not be executed unless Architecture explicitly authorizes it. Do not execute while any frontend path is using v2.

5. `05_service_role_acl_postcheck_readonly.sql`
   - Strictly read-only.
   - Mirrors the additional Production control executed after the main postcheck.
   - Verifies that `service_role` has no explicit ACL rows on the v2 table or either v2 RPC.
   - Returned `PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN` in Production.

## Historical sequence

```text
1. 01_precheck_readonly.sql returned PROD_READINESS_V2_READY.
2. 02_apply_training_workout_readiness_v2.sql executed successfully.
3. 03_postcheck_readonly.sql returned PROD_READINESS_V2_VERIFIED.
4. 05_service_role_acl_postcheck_readonly.sql returned PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN.
```

## Prohibitions

- Do not re-run `02_apply_training_workout_readiness_v2.sql` without a separate authorization.
- Do not run `04_emergency_rollback.sql` without explicit Architecture authorization.
- Do not run `supabase db push`.
- Do not run migration repair.
- Do not modify Vercel variables.
- Do not deploy frontend changes from this phase.
- Do not expose UUIDs, emails, payloads or personal data in reports.
