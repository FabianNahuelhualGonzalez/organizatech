import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const EXPECTED_PROJECT_REF = "fjjebhaqtrdbpxzxztmh";
export const EXPECTED_MANIFEST_SHA256 = "2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848";
export const EXPECTED_BASELINE_FINGERPRINT = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";
export const EXPECTED_FINAL_FINGERPRINT = "833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9";

export const HISTORICAL_MIGRATIONS = [
  "20260513000001_add_exercise_day.sql",
  "20260527000002_training_sessions_source_of_truth.sql",
  "20260531000001_training_cycles.sql",
  "20260604000001_training_cycle_scoped_model.sql",
  "20260604000002_training_cycle_scoped_policy_fix.sql",
  "20260605000001_training_cycle_scoped_session_entries_contract.sql",
  "20260607000001_training_cycle_scoped_snapshot_source.sql",
  "20260608000001_training_daily_readiness.sql",
  "20260609000001_fix_training_daily_readiness_rpc_ambiguity.sql",
  "20260610000001_training_exercise_lineage.sql",
  "20260620000001_training_workout_readiness.sql",
  "20260706000001_profile_avatar_fields.sql",
  "20260706000002_profile_personal_fields.sql",
  "20260707000001_profile_phone_number.sql",
  "20260709000001_p0_d1_harden_training_session_entries_writes.sql",
  "20260713000001_p0_h_profile_avatar_hardening.sql",
  "20260718000001_exercise_entries_observation.sql",
  "20260718000002_exercise_entries_observation_legacy_lineage.sql",
];

export const PERF_06_MIGRATIONS = [
  "20260810225819_perf_06a_security_hardening.sql",
  "20260810230014_perf_06c_rls_initplan.sql",
  "20260810230028_perf_06b_exercise_entries_user_session_created_id_index.sql",
  "20260811035538_ensure_legacy_exercise_lineage_invariant.sql",
  "20260811035542_reconcile_legacy_exercise_lineages.sql",
  "20260811190144_perf_06r_daily_readiness_acl_normalization.sql",
];

const EXPECTED_STATEMENT_COUNTS = new Map([
  ["20260513000001_add_exercise_day.sql", 1],
  ["20260527000002_training_sessions_source_of_truth.sql", 13],
  ["20260531000001_training_cycles.sql", 15],
  ["20260604000001_training_cycle_scoped_model.sql", 77],
  ["20260604000002_training_cycle_scoped_policy_fix.sql", 18],
  ["20260605000001_training_cycle_scoped_session_entries_contract.sql", 7],
  ["20260607000001_training_cycle_scoped_snapshot_source.sql", 2],
  ["20260608000001_training_daily_readiness.sql", 15],
  ["20260609000001_fix_training_daily_readiness_rpc_ambiguity.sql", 1],
  ["20260610000001_training_exercise_lineage.sql", 32],
  ["20260620000001_training_workout_readiness.sql", 24],
  ["20260706000001_profile_avatar_fields.sql", 3],
  ["20260706000002_profile_personal_fields.sql", 2],
  ["20260707000001_profile_phone_number.sql", 1],
  ["20260709000001_p0_d1_harden_training_session_entries_writes.sql", 19],
  ["20260713000001_p0_h_profile_avatar_hardening.sql", 15],
  ["20260718000001_exercise_entries_observation.sql", 6],
  ["20260718000002_exercise_entries_observation_legacy_lineage.sql", 4],
  ["20260810225819_perf_06a_security_hardening.sql", 24],
  ["20260810230014_perf_06c_rls_initplan.sql", 22],
  ["20260810230028_perf_06b_exercise_entries_user_session_created_id_index.sql", 1],
  ["20260811035538_ensure_legacy_exercise_lineage_invariant.sql", 25],
  ["20260811035542_reconcile_legacy_exercise_lineages.sql", 4],
  ["20260811190144_perf_06r_daily_readiness_acl_normalization.sql", 5],
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Direct FSM port of pkg/parser/{token,state}.go at Supabase CLI v2.113.0.
// Like strings.TrimRight(token, ";") followed by strings.TrimSpace, comments
// remain part of statement arrays and a final comment-only token is preserved.
export function splitAndTrim(source) {
  const ready = () => ({ kind: "ready" });
  const isIdentifierRune = (char) => /[\p{L}\p{N}_$]/u.test(char);
  const isBeginAtomic = (data) => {
    const atomic = "ATOMIC";
    let offset = data.length - atomic.length;
    if (offset < 0 || data.slice(offset).toUpperCase() !== atomic) return false;
    if (offset > 0 && isIdentifierRune(Array.from(data.slice(0, offset)).at(-1) ?? "")) return false;
    const prefix = data.slice(0, offset).trimEnd();
    offset = prefix.length - "BEGIN".length;
    if (offset < 0 || prefix.slice(offset).toUpperCase() !== "BEGIN") return false;
    if (offset === 0) return true;
    return !isIdentifierRune(Array.from(prefix.slice(0, offset)).at(-1) ?? "");
  };
  const nextReady = (char, data) => {
    if (char === "$") return { kind: "tag", offset: data.length - 1 };
    if (char === "'" || char === '"') return { kind: "quote", delimiter: char, escape: false };
    if (char === "-") return { kind: "comment" };
    if (char === "/") return { kind: "block", depth: 0 };
    if (char === "\\") return { kind: "escape" };
    if (char === ";") return null;
    if (char === "(") return { kind: "atomic", previous: ready(), delimiter: ")" };
    if ((char === "c" || char === "C") && isBeginAtomic(data)) {
      return { kind: "atomic", previous: ready(), delimiter: "END" };
    }
    return ready();
  };
  const transition = (state, char, data) => {
    if (state.kind === "ready") return nextReady(char, data);
    if (state.kind === "comment") {
      return char === "-" ? { kind: "dollar", delimiter: "\n" } : nextReady(char, data);
    }
    if (state.kind === "block") {
      const window = data.slice(-2);
      if (window === "/*") return { ...state, depth: state.depth + 1 };
      if (state.depth === 0) return nextReady(char, data);
      if (window === "*/") return state.depth === 1 ? ready() : { ...state, depth: state.depth - 1 };
      return state;
    }
    if (state.kind === "quote") {
      if (state.escape) return char === state.delimiter ? { ...state, escape: false } : nextReady(char, data);
      return char === state.delimiter ? { ...state, escape: true } : state;
    }
    if (state.kind === "dollar") return data.endsWith(state.delimiter) ? ready() : state;
    if (state.kind === "tag") {
      if (char === "$") return { kind: "dollar", delimiter: data.slice(state.offset) };
      return /[\p{L}\p{N}_]/u.test(char) ? state : nextReady(char, data);
    }
    if (state.kind === "escape") return ready();
    if (state.kind === "atomic") {
      const current = transition(state.previous, char, data);
      const previous = current ?? state.previous;
      if (previous.kind === "ready" && data.slice(-state.delimiter.length).toUpperCase() === state.delimiter) return ready();
      return { ...state, previous };
    }
    throw new Error(`Unknown SplitAndTrim state: ${state.kind}`);
  };

  const statements = [];
  let state = ready();
  let start = 0;
  for (let index = 0; index < source.length;) {
    const char = String.fromCodePoint(source.codePointAt(index));
    const end = index + char.length;
    state = transition(state, char, source.slice(start, end));
    if (state === null) {
      const token = source.slice(start, end).replace(/;+$/u, "").trim();
      if (token) statements.push(token);
      start = end;
      state = ready();
    }
    index = end;
  }
  const tail = source.slice(start).replace(/;+$/u, "").trim();
  if (tail) statements.push(tail);
  return statements;
}

export function buildManifest(repositoryRoot) {
  const files = [...HISTORICAL_MIGRATIONS, ...PERF_06_MIGRATIONS];
  const manifest = files.map((file) => {
    const match = /^(\d{14})_(.+)\.sql$/u.exec(basename(file));
    if (!match) throw new Error(`Invalid migration filename: ${file}`);
    const statements = splitAndTrim(readFileSync(join(repositoryRoot, "supabase/migrations", file), "utf8"));
    const expected = EXPECTED_STATEMENT_COUNTS.get(file);
    if (statements.length !== expected) throw new Error(`${file}: expected ${expected} statements, found ${statements.length}`);
    return { version: match[1], name: match[2], statements };
  });
  const historicalCount = manifest.slice(0, HISTORICAL_MIGRATIONS.length).reduce((sum, row) => sum + row.statements.length, 0);
  const perfCount = manifest.slice(HISTORICAL_MIGRATIONS.length).reduce((sum, row) => sum + row.statements.length, 0);
  const hash = sha256(JSON.stringify(manifest));
  if (historicalCount !== 255 || perfCount !== 81 || manifest.length !== 24 || hash !== EXPECTED_MANIFEST_SHA256) {
    throw new Error(`Manifest mismatch: ${manifest.length} versions, ${historicalCount}+${perfCount} statements, ${hash}`);
  }
  return { manifest, historicalCount, perfCount, hash };
}
