#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  EXPECTED_FINAL_FINGERPRINT,
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_PROJECT_REF,
  HISTORICAL_MIGRATIONS,
  buildManifest,
  splitAndTrim,
} from "./perf-06-migration-manifest.mjs";

const PgClient = pg.Client;
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const operationRoot = resolve(repositoryRoot, "supabase/operations/qa/perf-06-atomic");
const EXPECTED_BASELINE_FINGERPRINT = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";
const QA_COMMIT_CONFIRMATION = `COMMIT PERF-06 QA ${EXPECTED_PROJECT_REF} BASELINE ${EXPECTED_BASELINE_FINGERPRINT} MANIFEST ${EXPECTED_MANIFEST_SHA256} FINAL ${EXPECTED_FINAL_FINGERPRINT}`;
const LOCAL_COMMIT_CONFIRMATION = `COMMIT PERF-06 LOCAL ${EXPECTED_PROJECT_REF} BASELINE ${EXPECTED_BASELINE_FINGERPRINT} MANIFEST ${EXPECTED_MANIFEST_SHA256} FINAL ${EXPECTED_FINAL_FINGERPRINT}`;
const GLOBAL_TIMEOUT_MS = 120_000;
const INTERRUPT_GRACE_MS = 1_000;
const VERIFIER_CONNECTION_TIMEOUT_MS = 5_000;
const VERIFIER_QUERY_TIMEOUT_MS = 5_000;
const VERIFIER_LOCK_TIMEOUT_MS = 2_000;
const VERIFIER_IDLE_TIMEOUT_MS = 10_000;
const VERIFIER_POLL_INTERVAL_MS = 50;
const LOCAL_UNREACHABLE_VERIFIER_PORT = 1;
const LOCAL_VERIFIER_CONNECTION_TIMEOUT_MS = 100;
const BACKEND_UNCONFIRMED_NOTICE = "PERF06 runner INDETERMINATE backend_status=unconfirmed; process remains pending";
const DATA_COUNT_RELATIONS = [
  "exercise_entries",
  "exercises",
  "profiles",
  "routines",
  "training_cycle_days",
  "training_cycle_exercises",
  "training_cycle_routines",
  "training_cycles",
  "training_daily_readiness",
  "training_exercise_lineages",
  "training_sessions",
  "training_workout_readiness",
];
const ALLOWED_INJECTIONS = new Set([
  "precheck",
  "migration-intermediate",
  "scenario-a",
  "scenario-f-state",
  "scenario-g-intermediate",
  "fixture",
  "postcheck",
  "timeout",
  "signal-hold",
  "connection-before-commit",
  "connection-during-commit",
  "backend-close-hold",
  "diagnostic-hold",
  "missing-milestone",
]);

const TRANSITIONS = {
  not_connected: new Set(["connected", "outcome_unknown"]),
  connected: new Set(["transaction_open", "connection_closed", "outcome_unknown"]),
  transaction_open: new Set(["commit_requested", "rollback_confirmed", "outcome_unknown"]),
  commit_requested: new Set(["commit_confirmed", "outcome_unknown"]),
  commit_confirmed: new Set(["connection_closed", "outcome_unknown"]),
  rollback_confirmed: new Set(["connection_closed", "outcome_unknown"]),
  outcome_unknown: new Set(["connection_closed"]),
  connection_closed: new Set(),
};

const SAVEPOINT_SQL = Object.fromEntries(
  [..."ABCDEFGHI"].map((letter) => [letter, {
    create: `SAVEPOINT perf06_scenario_${letter.toLowerCase()}`,
    rollback: `ROLLBACK TO SAVEPOINT perf06_scenario_${letter.toLowerCase()}`,
    release: `RELEASE SAVEPOINT perf06_scenario_${letter.toLowerCase()}`,
  }]),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitize(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/\S+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, "[REDACTED_UUID]")
    .replace(/(password|token|secret)=\S+/giu, "$1=[REDACTED]");
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function settleWithin(promise, milliseconds) {
  const timeout = Symbol("timeout");
  return Promise.race([promise, delay(milliseconds).then(() => timeout)]).then((value) => ({ value, timedOut: value === timeout }));
}

function destroyClientSocket(client) {
  const stream = client.connection?.stream;
  if (stream) stream.destroy();
}

class VerifierTimeoutError extends Error {
  constructor(operation) {
    super(`Read-only verifier operation timed out: ${operation}`);
    this.name = "VerifierTimeoutError";
  }
}

async function boundedVerifierOperation(operation, milliseconds, label) {
  const promise = Promise.resolve().then(operation);
  promise.catch(() => {});
  const settled = await settleWithin(promise, milliseconds);
  if (settled.timedOut) throw new VerifierTimeoutError(label);
  return settled.value;
}

async function verifierQuery(verifier, label, text, values = [], timeoutMs = VERIFIER_QUERY_TIMEOUT_MS) {
  return boundedVerifierOperation(
    () => verifier.query({ text, values, query_timeout: timeoutMs }),
    timeoutMs + 250,
    label,
  );
}

async function startVerifierTransaction(verifier, timeoutMs = VERIFIER_QUERY_TIMEOUT_MS) {
  await verifierQuery(verifier, "begin", "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY", [], timeoutMs);
  await verifierQuery(verifier, "statement_timeout", `SET LOCAL statement_timeout = '${timeoutMs}ms'`, [], timeoutMs);
  await verifierQuery(verifier, "lock_timeout", `SET LOCAL lock_timeout = '${Math.min(VERIFIER_LOCK_TIMEOUT_MS, timeoutMs)}ms'`, [], timeoutMs);
  await verifierQuery(verifier, "idle_in_transaction_session_timeout", `SET LOCAL idle_in_transaction_session_timeout = '${Math.max(VERIFIER_IDLE_TIMEOUT_MS, timeoutMs * 2)}ms'`, [], timeoutMs);
  await verifierQuery(verifier, "application_name", "SET LOCAL application_name = 'organizatech-perf-06-read-only-verifier'", [], timeoutMs);
}

async function waitForPrincipalBackendToClose(verifier, backendPid, options = {}) {
  if (!Number.isInteger(backendPid)) return;
  const timeoutMs = options.queryTimeoutMs ?? VERIFIER_QUERY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? VERIFIER_POLL_INTERVAL_MS;
  while (true) {
    await verifierQuery(verifier, "pg_stat_clear_snapshot", "select pg_catalog.pg_stat_clear_snapshot()", [], timeoutMs);
    const result = await verifierQuery(
      verifier,
      "pg_stat_activity",
      "select exists(select 1 from pg_catalog.pg_stat_activity where pid = $1::integer and pid <> pg_catalog.pg_backend_pid()) as residual",
      [backendPid],
      timeoutMs,
    );
    if (result.rows[0].residual === false) return;
    await delay(pollIntervalMs);
  }
}

async function closeVerifier(verifier, timeoutMs = VERIFIER_QUERY_TIMEOUT_MS) {
  try {
    await boundedVerifierOperation(() => verifier.end(), timeoutMs, "end");
    return true;
  } catch {
    destroyClientSocket(verifier);
    return false;
  }
}

let backendUnconfirmedNoticeEmitted = false;

async function remainPendingWhenBackendCannotBeConfirmed() {
  process.exitCode = 1;
  if (!backendUnconfirmedNoticeEmitted) {
    backendUnconfirmedNoticeEmitted = true;
    process.stderr.write(`${BACKEND_UNCONFIRMED_NOTICE}\n`);
  }
  const keepAlive = setInterval(() => {}, 60_000);
  keepAlive.ref();
  await new Promise(() => {});
}

function parseArguments(argv) {
  const options = {
    mode: "",
    projectRef: "",
    commit: false,
    confirmation: "",
    execute: false,
    generateOnly: false,
    localValidation: false,
    injection: "",
    verifierUnreachable: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--commit") options.commit = true;
    else if (argument === "--execute") options.execute = true;
    else if (argument === "--generate-only") options.generateOnly = true;
    else if (argument === "--local-validation") options.localValidation = true;
    else if (argument === "--inject-verifier-unreachable") options.verifierUnreachable = true;
    else if (["--mode", "--project-ref", "--confirm", "--inject-failure"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--mode") options.mode = value;
      else if (argument === "--project-ref") options.projectRef = value;
      else if (argument === "--confirm") options.confirmation = value;
      else options.injection = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  invariant(options.mode === "qa", "--mode qa is mandatory");
  invariant(options.projectRef === EXPECTED_PROJECT_REF, `--project-ref ${EXPECTED_PROJECT_REF} is mandatory`);
  invariant(options.execute !== options.generateOnly, "Choose exactly one of --execute or --generate-only");
  if (options.commit) {
    const expected = options.localValidation ? LOCAL_COMMIT_CONFIRMATION : QA_COMMIT_CONFIRMATION;
    invariant(options.confirmation === expected, "Persistent mode requires the exact literal confirmation");
  } else invariant(!options.confirmation, "--confirm is invalid without --commit");
  invariant(!options.injection || ALLOWED_INJECTIONS.has(options.injection), "Unknown failure injection");
  invariant(!options.injection || options.localValidation, "Failure injection is restricted to --local-validation");
  invariant(
    !options.verifierUnreachable
      || (options.localValidation && new Set(["backend-close-hold", "connection-during-commit"]).has(options.injection)),
    "Unreachable verifier injection is restricted to the two approved local incident probes",
  );
  return options;
}

function parseConnection(options) {
  const raw = process.env.PERF_06_DATABASE_URL;
  invariant(raw, "PERF_06_DATABASE_URL is required for --execute");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PERF_06_DATABASE_URL is not a valid PostgreSQL URL");
  }
  invariant(new Set(["postgres:", "postgresql:"]).has(url.protocol), "Only a direct PostgreSQL URL is accepted");
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  const port = Number(url.port || "5432");
  const qaHost = `db.${EXPECTED_PROJECT_REF}.supabase.co`;
  const queryKeys = [...url.searchParams.keys()];
  invariant(username === "postgres" && password, "The connection must authenticate as postgres with a non-empty password");
  invariant(queryKeys.length === 1 && queryKeys[0] === "sslmode", "The connection URL must contain only the approved sslmode parameter");
  invariant(!/pooler|prod/iu.test(url.hostname), "Pooler and PROD endpoints are forbidden");
  if (options.localValidation) {
    invariant(new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname), "Local validation accepts loopback PostgreSQL only");
    invariant(url.searchParams.get("sslmode") === "disable", "Local validation requires sslmode=disable");
    invariant(database.startsWith("perf06_"), "Local validation requires a disposable perf06_ database");
  } else {
    invariant(url.hostname === qaHost && port === 5432 && database === "postgres", "The QA connection must be the exact direct project database endpoint");
    invariant(url.searchParams.get("sslmode") === "verify-full", "QA requires sslmode=verify-full");
  }
  return {
    host: url.hostname,
    port,
    user: username,
    password,
    database,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    ssl: options.localValidation ? false : { rejectUnauthorized: true, servername: qaHost },
  };
}

function loadNamedQueries(filename) {
  const source = readFileSync(resolve(operationRoot, filename), "utf8");
  invariant(!/^\\[^\n]+/mu.test(source), `${filename} contains a forbidden client metacommand`);
  const matches = [...source.matchAll(/^-- PERF06_QUERY ([a-z0-9_]+)\n([\s\S]*?)(?=^-- PERF06_QUERY [a-z0-9_]+\n|(?![\s\S]))/gmu)];
  const queries = {};
  for (const match of matches) {
    const [, name, sql] = match;
    const statements = splitAndTrim(sql.trim());
    invariant(statements.length === 1, `${filename}:${name} must contain exactly one statement`);
    invariant(!queries[name], `${filename}:${name} is duplicated`);
    queries[name] = statements[0];
  }
  invariant(Object.keys(queries).length > 0, `${filename} has no named queries`);
  return { queries, source };
}

function buildPlan() {
  const { manifest, historicalCount, perfCount, hash } = buildManifest(repositoryRoot);
  invariant(historicalCount === 255 && perfCount === 81 && manifest.length === 24, "Manifest cardinality gate failed");
  invariant(hash === EXPECTED_MANIFEST_SHA256, "Manifest hash gate failed");
  const prechecks = loadNamedQueries("prechecks.sql");
  const scenarios = loadNamedQueries("scenarios.sql");
  const postchecks = loadNamedQueries("postchecks.sql");
  const fingerprintSql = splitAndTrim(readFileSync(resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql"), "utf8"));
  invariant(fingerprintSql.length === 1, "Fingerprint must be one native query");
  const planHash = sha256([
    hash,
    sha256(prechecks.source),
    sha256(scenarios.source),
    sha256(postchecks.source),
    sha256(fingerprintSql[0]),
  ].join("|"));
  return {
    manifest,
    historical: manifest.slice(0, HISTORICAL_MIGRATIONS.length),
    perf: manifest.slice(HISTORICAL_MIGRATIONS.length),
    prechecks: prechecks.queries,
    scenarios: scenarios.queries,
    postchecks: postchecks.queries,
    fingerprintSql: fingerprintSql[0],
    manifestHash: hash,
    planHash,
  };
}

function exactJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasExactKeys(value, expectedKeys) {
  return value && typeof value === "object"
    && exactJson(Object.keys(value).sort(), [...expectedKeys].sort());
}

function validDataCounts(value) {
  return hasExactKeys(value, DATA_COUNT_RELATIONS)
    && DATA_COUNT_RELATIONS.every((relation) => Number.isSafeInteger(Number(value[relation])) && Number(value[relation]) >= 0);
}

function dataCountsEqual(actual, expected) {
  return validDataCounts(actual) && validDataCounts(expected)
    && DATA_COUNT_RELATIONS.every((relation) => Number(actual[relation]) === Number(expected[relation]));
}

function finalDataCountsMatch(actual, baseline, pending) {
  return validDataCounts(actual) && validDataCounts(baseline)
    && DATA_COUNT_RELATIONS.every((relation) => {
      const increment = relation === "training_exercise_lineages" ? pending : 0;
      return Number(actual[relation]) === Number(baseline[relation]) + increment;
    });
}

function partialApplicationMatches(value, expected) {
  const keys = [
    "history_absent",
    "identity_function_absent",
    "invariant_function_absent",
    "lineage_function_absent",
    "perf_index_absent",
    "perf_triggers_absent",
  ];
  return hasExactKeys(value, keys) && keys.every((key) => value[key] === expected);
}

function historyMatchesManifest(historyRows, manifest) {
  if (!Array.isArray(historyRows) || historyRows.length !== manifest.length) return false;
  return historyRows.every((row, index) => row.version === manifest[index].version
    && row.name === manifest[index].name
    && exactJson(row.statements, manifest[index].statements));
}

function completePrecheck(precheck) {
  return precheck?.complete === true
    && precheck.fingerprint?.count === 346
    && precheck.fingerprint?.hash === EXPECTED_BASELINE_FINGERPRINT
    && new Set([0, 2]).has(precheck.pending)
    && Number.isSafeInteger(precheck.exerciseCount)
    && precheck.exerciseCount > 0
    && precheck.markerCount === 0
    && precheck.incompatibleCount === 0
    && precheck.fixtureFree === true
    && precheck.diagnosticPresent === true
    && precheck.diagnosticCount === 0
    && typeof precheck.diagnosticHash === "string"
    && precheck.diagnosticHash.length === 64
    && precheck.diagnosticConsumers === 0
    && partialApplicationMatches(precheck.partialApplication, true)
    && validDataCounts(precheck.dataCounts)
    && typeof precheck.ownerId === "string"
    && precheck.ownerId.length > 0
    && typeof precheck.routineId === "string"
    && precheck.routineId.length > 0;
}

async function collectStateSnapshot(runQuery, plan) {
  const partialApplication = (await runQuery("partial_application", plan.prechecks.partial_application)).rows[0];
  const fingerprintResult = await runQuery("fingerprint", plan.fingerprintSql);
  const overall = fingerprintResult.rows.find((row) => row.category === "OVERALL");
  const historyPresent = partialApplication.history_absent === false;
  const historyRows = historyPresent
    ? (await runQuery("history", plan.postchecks.history)).rows.map((row) => ({
      version: row.version,
      name: row.name,
      statements: row.statements,
    }))
    : [];
  const lineageState = (await runQuery("lineage_state", plan.postchecks.lineage_state)).rows[0];
  const lineageCounts = (await runQuery("lineage_counts", plan.prechecks.lineage_counts)).rows[0];
  const fixtures = (await runQuery("fixtures", plan.postchecks.fixtures)).rows[0];
  const diagnostic = (await runQuery("diagnostic", plan.postchecks.diagnostic)).rows[0];
  const diagnosticHash = (await runQuery("diagnostic_hash", plan.prechecks.diagnostic_hash)).rows[0].diagnostic_hash;
  const diagnosticConsumers = (await runQuery("diagnostic_consumers", plan.prechecks.diagnostic_consumers)).rows[0].consumer_count;
  const incompatibleCount = (await runQuery("incompatible_lineages", plan.prechecks.incompatible_lineages)).rows[0].incompatible_count;
  const dataCounts = (await runQuery("data_counts", plan.prechecks.data_counts)).rows[0].counts;
  const catalogValid = (await runQuery("catalog", plan.scenarios.catalog)).rows[0].valid;
  const completeStateValid = historyPresent
    ? (await runQuery("complete_state", plan.scenarios.complete_state)).rows[0].valid
    : false;
  return {
    fingerprint: { count: Number(overall?.item_count), hash: overall?.sha256 },
    partialApplication,
    historyPresent,
    historyRows,
    historyStatements: historyRows.reduce((sum, row) => sum + (Array.isArray(row.statements) ? row.statements.length : 0), 0),
    pending: lineageState.pending,
    markerCount: lineageState.markers,
    exerciseCount: lineageCounts.exercise_count,
    incompatibleCount,
    fixtureFree: fixtures.valid,
    diagnosticPresent: diagnostic.present,
    diagnosticCount: diagnostic.row_count,
    diagnosticHash,
    diagnosticConsumers,
    dataCounts,
    catalogValid,
    completeStateValid,
  };
}

function rollbackSnapshotMatches(snapshot, precheck) {
  return completePrecheck(precheck)
    && snapshot.fingerprint?.count === 346
    && snapshot.fingerprint?.hash === EXPECTED_BASELINE_FINGERPRINT
    && snapshot.historyPresent === false
    && exactJson(snapshot.historyRows, [])
    && snapshot.historyStatements === 0
    && partialApplicationMatches(snapshot.partialApplication, true)
    && snapshot.pending === precheck.pending
    && snapshot.exerciseCount === precheck.exerciseCount
    && snapshot.markerCount === 0
    && snapshot.incompatibleCount === 0
    && snapshot.fixtureFree === true
    && snapshot.diagnosticPresent === true
    && snapshot.diagnosticCount === 0
    && snapshot.diagnosticHash === precheck.diagnosticHash
    && snapshot.diagnosticConsumers === 0
    && dataCountsEqual(snapshot.dataCounts, precheck.dataCounts);
}

function finalSnapshotMatches(snapshot, precheck, plan) {
  return completePrecheck(precheck)
    && snapshot.fingerprint?.count === 377
    && snapshot.fingerprint?.hash === EXPECTED_FINAL_FINGERPRINT
    && snapshot.historyPresent === true
    && historyMatchesManifest(snapshot.historyRows, plan.manifest)
    && snapshot.historyStatements === 336
    && partialApplicationMatches(snapshot.partialApplication, false)
    && snapshot.pending === 0
    && snapshot.exerciseCount === precheck.exerciseCount
    && snapshot.markerCount === precheck.pending
    && snapshot.incompatibleCount === 0
    && snapshot.fixtureFree === true
    && snapshot.diagnosticPresent === true
    && snapshot.diagnosticCount === 0
    && snapshot.diagnosticHash === precheck.diagnosticHash
    && snapshot.diagnosticConsumers === 0
    && finalDataCountsMatch(snapshot.dataCounts, precheck.dataCounts, precheck.pending)
    && snapshot.catalogValid === true
    && snapshot.completeStateValid === true;
}

class IncidentError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "IncidentError";
    this.reason = reason;
  }
}

class InterruptGate {
  constructor() {
    this.reason = "";
    this.promise = new Promise((resolvePromise) => { this.resolve = resolvePromise; });
  }

  request(reason) {
    if (this.reason) return;
    this.reason = reason;
    this.resolve(reason);
  }
}

function isConnectionFailure(error) {
  const code = error && typeof error === "object" ? error.code : "";
  const message = error instanceof Error ? error.message : String(error);
  return new Set(["ECONNRESET", "EPIPE", "57P01", "57P02", "57P03"]).has(code)
    || /connection terminated|connection closed|socket|client has already been closed/iu.test(message);
}

class AtomicOperation {
  constructor(options, plan, connection) {
    this.options = options;
    this.plan = plan;
    this.connection = connection;
    this.client = new PgClient(connection);
    this.state = "not_connected";
    this.stateHistory = [this.state];
    this.blocked = false;
    this.gate = new InterruptGate();
    this.backendPid = null;
    this.milestones = [];
    this.precheck = null;
    this.terminal = "";
    this.mainCloseAttempted = false;
    this.client.on("error", () => this.gate.request("connection_loss"));
  }

  transition(next) {
    invariant(TRANSITIONS[this.state].has(next), `Invalid lifecycle transition ${this.state} -> ${next}`);
    this.state = next;
    this.stateHistory.push(next);
  }

  mark(name) {
    if (this.options.injection === "missing-milestone" && name === "scenario_E") return;
    this.milestones.push(name);
  }

  throwIfInterrupted() {
    if (this.gate.reason) throw new IncidentError(this.gate.reason);
  }

  async query(text, values = [], { expectedError = false } = {}) {
    invariant(!this.blocked, "Query attempted after an unexpected error");
    this.throwIfInterrupted();
    const databasePromise = this.client.query({ text, values });
    databasePromise.catch(() => {});
    const outcome = await Promise.race([
      databasePromise.then((result) => ({ result }), (error) => ({ error })),
      this.gate.promise.then((reason) => ({ interrupted: reason })),
    ]);
    if (outcome.interrupted) throw new IncidentError(outcome.interrupted);
    if (outcome.error) {
      if (isConnectionFailure(outcome.error)) throw new IncidentError("connection_loss");
      if (!expectedError) this.blocked = true;
      throw outcome.error;
    }
    return outcome.result;
  }

  async control(text) {
    return this.client.query(text);
  }

  async connect() {
    const connectPromise = this.client.connect();
    connectPromise.catch(() => {});
    const outcome = await Promise.race([
      connectPromise.then(() => ({ connected: true }), (error) => ({ error })),
      this.gate.promise.then((reason) => ({ interrupted: reason })),
    ]);
    if (outcome.interrupted) throw new IncidentError(outcome.interrupted);
    if (outcome.error) throw new IncidentError(isConnectionFailure(outcome.error) ? "connection_loss" : "connect_failed");
    this.transition("connected");
    const backend = await this.query("select pg_catalog.pg_backend_pid()::integer as backend_pid");
    this.backendPid = backend.rows[0].backend_pid;
    this.mark("connection");
  }

  async begin() {
    await this.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");
    this.transition("transaction_open");
    const statementTimeout = this.options.localValidation
      && (this.options.injection === "timeout" || this.options.injection === "signal-hold")
      ? "SET LOCAL statement_timeout = '2s'"
      : "SET LOCAL statement_timeout = '15s'";
    await this.query(statementTimeout);
    await this.query("SET LOCAL lock_timeout = '5s'");
    await this.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    await this.query("SET LOCAL application_name = 'organizatech-perf-06-native-runner'");
    await this.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organizatech:qa:PERF-06:fjjebhaqtrdbpxzxztmh', 0))");
  }

  async fingerprint() {
    const result = await this.query(this.plan.fingerprintSql);
    const overall = result.rows.find((row) => row.category === "OVERALL");
    invariant(overall, "Fingerprint OVERALL row is missing");
    return { count: Number(overall.item_count), hash: overall.sha256 };
  }

  async collectPrecheck() {
    const identity = (await this.query(this.plan.prechecks.identity)).rows[0];
    invariant(identity.current_user === "postgres" && identity.session_user === "postgres", "PostgreSQL identity gate failed");
    invariant(identity.isolation_level === "read committed" && identity.read_only === "off", "Transaction mode gate failed");
    invariant(identity.server_version_num === 170006, "PostgreSQL 17.6 is mandatory");
    if (this.options.localValidation) invariant(identity.database_name.startsWith("perf06_"), "Local database identity gate failed");
    else invariant(identity.database_name === "postgres" && identity.tls_active === true, "QA database/TLS gate failed");

    const partial = (await this.query(this.plan.prechecks.partial_application)).rows[0];
    invariant(Object.values(partial).every(Boolean), "History or PERF-06 is partially applied");
    const fingerprint = await this.fingerprint();
    invariant(fingerprint.count === 346 && fingerprint.hash === EXPECTED_BASELINE_FINGERPRINT, "Baseline fingerprint gate failed");
    const lineage = (await this.query(this.plan.prechecks.lineage_counts)).rows[0];
    invariant(new Set([0, 2]).has(lineage.pending) && lineage.exercise_count > 0, "Pending lineage cardinality gate failed");
    const markerCount = (await this.query(this.plan.prechecks.marker_count)).rows[0].marker_count;
    invariant(markerCount === 0, "Global PERF-06R marker gate failed");
    const incompatibleCount = (await this.query(this.plan.prechecks.incompatible_lineages)).rows[0].incompatible_count;
    invariant(incompatibleCount === 0, "Incompatible lineage gate failed");
    const fixture = (await this.query(this.plan.prechecks.fixture_identity)).rows[0];
    invariant(fixture?.owner_id && fixture?.routine_id, "Fixture identity source is unavailable");
    const fixtureFree = (await this.query(this.plan.postchecks.fixtures)).rows[0].valid;
    invariant(fixtureFree === true, "PERF-06 fixtures exist before execution");
    const diagnosticPresent = (await this.query(this.plan.prechecks.diagnostic_exists)).rows[0].diagnostic_exists;
    invariant(diagnosticPresent === true, "Diagnostic table is absent");
    const diagnosticCount = (await this.query(this.plan.prechecks.diagnostic_count)).rows[0].diagnostic_count;
    invariant(diagnosticCount === 0, "Diagnostic table is not empty");
    const diagnosticHash = (await this.query(this.plan.prechecks.diagnostic_hash)).rows[0].diagnostic_hash;
    invariant(typeof diagnosticHash === "string" && diagnosticHash.length === 64, "Diagnostic structure hash failed");
    const diagnosticConsumers = (await this.query(this.plan.prechecks.diagnostic_consumers)).rows[0].consumer_count;
    invariant(diagnosticConsumers === 0, "Diagnostic table has consumers");
    const dataCounts = (await this.query(this.plan.prechecks.data_counts)).rows[0].counts;
    return {
      complete: false,
      fingerprint,
      pending: lineage.pending,
      exerciseCount: lineage.exercise_count,
      markerCount,
      incompatibleCount,
      ownerId: fixture.owner_id,
      routineId: fixture.routine_id,
      fixtureFree,
      diagnosticPresent,
      diagnosticCount,
      diagnosticHash,
      diagnosticConsumers,
      partialApplication: partial,
      dataCounts,
    };
  }

  async prechecksAndLocks() {
    const initial = await this.collectPrecheck();
    if (this.options.injection === "precheck") throw new Error("Injected precheck failure");
    this.mark("prechecks_read_only");
    await this.query(this.plan.prechecks.lock_diagnostic);
    await this.query(this.plan.prechecks.lock_auth_users);
    await this.query(this.plan.prechecks.lock_exercises);
    await this.query(this.plan.prechecks.lock_dependents);
    const locked = await this.collectPrecheck();
    invariant(exactJson(locked, initial), "Prechecks changed while locks were acquired");
    this.precheck = Object.freeze({ ...locked, complete: true });
    invariant(completePrecheck(this.precheck), "Complete locked precheck gate failed");
    this.mark("locks");
    if (this.options.injection === "backend-close-hold") {
      const hold = this.client.query("select pg_catalog.pg_sleep(7)");
      hold.catch(() => {});
      await delay(50);
      this.destroySocket();
      throw new IncidentError("controlled_backend_close_hold");
    }
    if (this.options.injection === "diagnostic-hold") await this.query("select pg_catalog.pg_sleep(3)");
    if (this.options.injection === "timeout" || this.options.injection === "signal-hold") {
      const timeoutSetting = (await this.query("select current_setting('statement_timeout') as statement_timeout")).rows[0].statement_timeout;
      invariant(timeoutSetting === "2s", "Local interruption statement timeout gate failed");
      await this.query("select pg_catalog.pg_sleep(3)");
    }
  }

  async bootstrapHistory() {
    await this.query("create schema if not exists supabase_migrations");
    await this.query("create table if not exists supabase_migrations.schema_migrations (version text not null primary key)");
    await this.query("alter table supabase_migrations.schema_migrations add column if not exists statements text[]");
    await this.query("alter table supabase_migrations.schema_migrations add column if not exists name text");
    for (const row of this.plan.historical) {
      await this.query(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3::text[])",
        [row.version, row.name, row.statements],
      );
    }
    const history = await this.query("select count(*)::integer as versions, coalesce(sum(cardinality(statements)), 0)::integer as statements from supabase_migrations.schema_migrations");
    invariant(history.rows[0].versions === 18 && history.rows[0].statements === 255, "Historical bootstrap gate failed");
    this.mark("history_18");
  }

  async executePerfMigrations() {
    for (let migrationIndex = 0; migrationIndex < this.plan.perf.length; migrationIndex += 1) {
      const row = this.plan.perf[migrationIndex];
      for (let statementIndex = 0; statementIndex < row.statements.length; statementIndex += 1) {
        await this.query(row.statements[statementIndex]);
        if (this.options.injection === "migration-intermediate" && migrationIndex === 1 && statementIndex === 9) {
          throw new Error("Injected intermediate migration failure");
        }
      }
      await this.query(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3::text[])",
        [row.version, row.name, row.statements],
      );
      this.mark(`migration_${row.version}`);
    }
  }

  async setActor(actorId) {
    await this.query(this.plan.scenarios.set_actor, [actorId ?? ""]);
  }

  async withScenario(letter, callback) {
    const sql = SAVEPOINT_SQL[letter];
    await this.query(sql.create);
    let callbackError;
    try {
      await callback();
    } catch (error) {
      callbackError = error;
    } finally {
      if (this.state === "transaction_open" && !this.gate.reason) {
        try {
          await this.control(sql.rollback);
          await this.control(sql.release);
        } catch (cleanupError) {
          callbackError ??= cleanupError;
        }
      }
    }
    if (callbackError) {
      if (!(callbackError instanceof IncidentError)) this.blocked = true;
      throw callbackError;
    }
    this.mark(`scenario_${letter}`);
  }

  async expectSqlState(savepointName, text, values, expectedCode) {
    invariant(/^perf06_[a-z0-9_]+$/u.test(savepointName), "Unsafe savepoint identifier");
    const create = `SAVEPOINT ${savepointName}`;
    const rollback = `ROLLBACK TO SAVEPOINT ${savepointName}`;
    const release = `RELEASE SAVEPOINT ${savepointName}`;
    await this.query(create);
    let observed = "";
    try {
      await this.query(text, values, { expectedError: true });
    } catch (error) {
      if (error instanceof IncidentError) throw error;
      observed = error && typeof error === "object" ? error.code : "";
    }
    await this.control(rollback);
    await this.control(release);
    if (observed !== expectedCode) {
      this.blocked = true;
      throw new Error(`Expected SQLSTATE ${expectedCode} was not observed`);
    }
  }

  compensationStatements() {
    const compensation = this.plan.perf.find((row) => row.version === "20260811035542");
    invariant(compensation, "Compensation migration is missing");
    return compensation.statements;
  }

  async runCompensation() {
    for (const statement of this.compensationStatements()) await this.query(statement);
  }

  async scenarios() {
    const query = this.plan.scenarios;
    const owner = this.precheck.ownerId;
    const routine = this.precheck.routineId;

    await this.withScenario("A", async () => {
      invariant((await this.query(query.catalog)).rows[0].valid === true, "Scenario A catalog gate failed");
      if (this.options.injection === "scenario-a") throw new Error("Injected scenario A failure");
    });

    await this.withScenario("B", async () => {
      const exercise = randomUUID();
      await this.setActor(null);
      await this.expectSqlState("perf06_b_null", query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_b_null__"], "42501");
      await this.setActor(randomUUID());
      await this.expectSqlState("perf06_b_other", query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_b_other__"], "42501");
    });

    await this.withScenario("C", async () => {
      const exercise = randomUUID();
      await this.setActor(owner);
      await this.query(query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_c__"]);
      invariant((await this.query(query.lineage_for_exercise, [owner, exercise])).rows[0].lineage_count === 1, "Scenario C lineage gate failed");
      if (this.options.injection === "fixture") throw new Error("Injected fixture failure");
    });
    invariant((await this.query(query.fixture_absent)).rows[0].valid === true, "Scenario C fixture cleanup failed");

    await this.withScenario("D", async () => {
      const exercise = randomUUID();
      await this.setActor(owner);
      await this.query("SAVEPOINT perf06_d_write");
      await this.query(query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_d__"]);
      await this.query("ROLLBACK TO SAVEPOINT perf06_d_write");
      await this.query("RELEASE SAVEPOINT perf06_d_write");
      invariant((await this.query(query.lineage_for_exercise, [owner, exercise])).rows[0].lineage_count === 0, "Scenario D rollback gate failed");
    });

    await this.withScenario("E", async () => {
      const exercise = randomUUID();
      await this.setActor(owner);
      await this.query(query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_e__"]);
      await this.query(query.delete_lineage, [exercise]);
      await this.query(query.touch_exercise, [exercise]);
      invariant((await this.query(query.lineage_for_exercise, [owner, exercise])).rows[0].lineage_count === 1, "Scenario E repair gate failed");
    });

    await this.withScenario("F", async () => {
      const exercise = randomUUID();
      await this.setActor(owner);
      await this.query(query.insert_exercise, [exercise, owner, routine, "__perf06_fixture_f__"]);
      await this.expectSqlState("perf06_f_identity", query.update_exercise_owner, [exercise, randomUUID()], "42501");
      await this.query("SAVEPOINT perf06_f_delete");
      await this.query("SET LOCAL ROLE authenticated");
      await this.setActor(owner);
      await this.expectSqlState("perf06_f_delete_expected", query.delete_lineage, [exercise], "42501");
      await this.control("ROLLBACK TO SAVEPOINT perf06_f_delete");
      await this.control("RELEASE SAVEPOINT perf06_f_delete");
      await this.query("SAVEPOINT perf06_f_owner");
      await this.query("SET LOCAL ROLE authenticated");
      await this.setActor(owner);
      await this.expectSqlState("perf06_f_owner_expected", query.update_lineage_owner, [exercise, randomUUID()], "42501");
      await this.control("ROLLBACK TO SAVEPOINT perf06_f_owner");
      await this.control("RELEASE SAVEPOINT perf06_f_owner");
      await this.query("SAVEPOINT perf06_f_rebind");
      await this.query("SET LOCAL ROLE authenticated");
      await this.setActor(owner);
      const rebindSql = this.options.injection === "scenario-f-state"
        ? "do $$ begin raise exception using errcode = '42501', message = 'injected'; end $$"
        : query.rebind_legacy_lineage;
      const rebindValues = this.options.injection === "scenario-f-state" ? [] : [exercise, randomUUID()];
      await this.expectSqlState("perf06_f_rebind_expected", rebindSql, rebindValues, "23514");
      await this.control("ROLLBACK TO SAVEPOINT perf06_f_rebind");
      await this.control("RELEASE SAVEPOINT perf06_f_rebind");
    });

    await this.withScenario("G", async () => {
      const fixture = {
        exercise: randomUUID(),
        cycle: randomUUID(),
        cycleRoutine: randomUUID(),
        cycleDay: randomUUID(),
        cycleExercise: randomUUID(),
        lineage: randomUUID(),
      };
      await this.setActor(owner);
      await this.query(query.insert_exercise, [fixture.exercise, owner, routine, "__perf06_fixture_g_legacy__"]);
      await this.query(query.conflict_legacy_lineage, [owner, fixture.exercise]);
      if (this.options.injection === "scenario-g-intermediate") await this.query("select * from public.__perf06_missing_relation__");
      await this.query(query.insert_cycle, [fixture.cycle, owner, "__perf06_fixture_g_cycle__"]);
      await this.query(query.insert_cycle_routine, [fixture.cycleRoutine, owner, fixture.cycle, "__perf06_fixture_g_routine__"]);
      await this.query(query.insert_cycle_day, [fixture.cycleDay, owner, fixture.cycle, fixture.cycleRoutine]);
      await this.query(query.insert_scoped_lineage, [fixture.lineage, owner]);
      await this.query(query.insert_cycle_exercise, [fixture.cycleExercise, owner, fixture.cycle, fixture.cycleDay, "__perf06_fixture_g_scoped__", fixture.lineage]);
      await this.query(query.bind_scoped_lineage, [fixture.lineage, fixture.cycleExercise]);
      invariant((await this.query(query.verify_scenario_g, [fixture.exercise, fixture.lineage, fixture.cycleExercise])).rows[0].valid === true, "Scenario G flow gate failed");
    });

    await this.withScenario("H", async () => {
      const markerStart = (await this.query(query.marker_count)).rows[0].marker_count;
      await this.runCompensation();
      invariant((await this.query(query.marker_count)).rows[0].marker_count === markerStart, "Scenario H no-op gate failed");

      await this.query("SAVEPOINT perf06_h_two");
      const first = randomUUID();
      const second = randomUUID();
      await this.setActor(owner);
      await this.query(query.insert_exercise, [first, owner, routine, "__perf06_fixture_h_one__"]);
      await this.query(query.insert_exercise, [second, owner, routine, "__perf06_fixture_h_two__"]);
      await this.query(query.delete_lineages_for_two, [first, second]);
      await this.runCompensation();
      invariant((await this.query(query.verify_two_marked, [first, second])).rows[0].marker_count === 2, "Scenario H two-lineage gate failed");
      await this.query("ROLLBACK TO SAVEPOINT perf06_h_two");
      await this.query("RELEASE SAVEPOINT perf06_h_two");

      await this.query("SAVEPOINT perf06_h_one");
      const only = randomUUID();
      await this.setActor(owner);
      await this.query(query.insert_exercise, [only, owner, routine, "__perf06_fixture_h_cardinality_one__"]);
      await this.query(query.delete_lineage, [only]);
      const statements = this.compensationStatements();
      const compensationBlockIndex = statements.findIndex((statement) => /^do \$perf_06r\$/imu.test(statement));
      invariant(compensationBlockIndex >= 0, "Compensation validation block is missing");
      for (const statement of statements.slice(0, compensationBlockIndex)) await this.query(statement);
      await this.expectSqlState("perf06_h_one_expected", statements[compensationBlockIndex], [], "23514");
      await this.control("ROLLBACK TO SAVEPOINT perf06_h_one");
      await this.control("RELEASE SAVEPOINT perf06_h_one");
    });

    await this.withScenario("I", async () => {
      invariant((await this.query(query.complete_state)).rows[0].valid === true, "Scenario I complete-state gate failed");
    });
  }

  expectedMilestones(includeTerminal = false) {
    const values = [
      "connection",
      "prechecks_read_only",
      "locks",
      "history_18",
      ...this.plan.perf.map((row) => `migration_${row.version}`),
      ...[..."ABCDEFGHI"].map((letter) => `scenario_${letter}`),
      "postchecks",
    ];
    if (includeTerminal) values.push(this.options.commit ? "commit" : "rollback");
    return values;
  }

  assertMilestones(includeTerminal = false) {
    invariant(JSON.stringify(this.milestones) === JSON.stringify(this.expectedMilestones(includeTerminal)), "Ordered lifecycle milestone gate failed");
  }

  async postchecks() {
    if (this.options.injection === "postcheck") throw new Error("Injected postcheck failure");
    const lineage = (await this.query(this.plan.postchecks.lineage_state)).rows[0];
    invariant(lineage.pending === 0 && lineage.markers === this.precheck.pending, "Final lineage gate failed");
    const beforeNoop = lineage.markers;
    await this.runCompensation();
    invariant((await this.query(this.plan.postchecks.lineage_state)).rows[0].markers === beforeNoop, "Second compensation is not a no-op");
    const snapshot = await collectStateSnapshot((label, text, values = []) => this.query(text, values), this.plan);
    invariant(finalSnapshotMatches(snapshot, this.precheck, this.plan), "Complete final snapshot gate failed");
    this.mark("postchecks");
    this.assertMilestones(false);
  }

  destroySocket() {
    destroyClientSocket(this.client);
  }

  async terminalAction() {
    if (!this.options.commit) {
      await this.query("ROLLBACK");
      this.transition("rollback_confirmed");
      this.terminal = "ROLLBACK";
      this.mark("rollback");
      return;
    }
    this.transition("commit_requested");
    if (this.options.injection === "connection-before-commit") {
      this.destroySocket();
      throw new IncidentError("connection_loss_before_commit");
    }
    if (this.options.injection === "connection-during-commit") {
      const stream = this.client.connection?.stream;
      if (stream?.pause) stream.pause();
      const commitPromise = this.client.query("COMMIT");
      commitPromise.catch(() => {});
      await delay(50);
      this.destroySocket();
      throw new IncidentError("connection_loss_during_commit");
    }
    try {
      await this.query("COMMIT");
    } catch (error) {
      if (error instanceof IncidentError || isConnectionFailure(error)) throw new IncidentError("commit_result_unknown");
      throw error;
    }
    this.transition("commit_confirmed");
    this.terminal = "COMMIT";
    this.mark("commit");
  }

  async closeMain() {
    if (this.state === "connection_closed") return true;
    if (this.mainCloseAttempted) return false;
    this.mainCloseAttempted = true;
    const closePromise = this.client.end().then(
      () => ({ confirmed: true }),
      () => ({ confirmed: false }),
    );
    const closed = await settleWithin(closePromise, INTERRUPT_GRACE_MS);
    if (!closed.timedOut && closed.value.confirmed === true) {
      this.transition("connection_closed");
      return true;
    }
    this.destroySocket();
    if (this.state !== "outcome_unknown" && TRANSITIONS[this.state].has("outcome_unknown")) this.transition("outcome_unknown");
    return false;
  }

  async rollbackAfterFailure() {
    if (this.state !== "transaction_open") return false;
    try {
      const rollback = await settleWithin(this.control("ROLLBACK"), INTERRUPT_GRACE_MS);
      if (rollback.timedOut) return false;
      this.transition("rollback_confirmed");
      return true;
    } catch {
      return false;
    }
  }

  async run() {
    await this.connect();
    await this.begin();
    await this.prechecksAndLocks();
    await this.bootstrapHistory();
    await this.executePerfMigrations();
    await this.scenarios();
    await this.postchecks();
    await this.terminalAction();
    this.assertMilestones(true);
    const mainClosed = await this.closeMain();
    if (!mainClosed) throw new IncidentError("main_connection_close_unconfirmed");
    return { terminal: this.terminal, stateHistory: this.stateHistory };
  }

  async recover(error) {
    let incident = error instanceof IncidentError || Boolean(this.gate.reason) || isConnectionFailure(error) || this.state === "commit_requested";
    this.blocked = true;
    const rolledBack = await this.rollbackAfterFailure();
    if (!rolledBack && !new Set(["commit_confirmed", "rollback_confirmed", "connection_closed"]).has(this.state)) {
      if (TRANSITIONS[this.state].has("outcome_unknown")) this.transition("outcome_unknown");
      this.destroySocket();
    }
    const mainClosed = await this.closeMain();
    incident ||= !mainClosed;
    if (!incident) return { incident: false, classification: "INDETERMINATE" };
    const verifierConnection = this.options.verifierUnreachable
      ? { ...this.connection, port: LOCAL_UNREACHABLE_VERIFIER_PORT }
      : this.connection;
    const verificationDependencies = this.options.verifierUnreachable
      ? { connectionTimeoutMs: LOCAL_VERIFIER_CONNECTION_TIMEOUT_MS }
      : undefined;
    const verification = await verifyIncidentOutcome(
      verifierConnection,
      this.backendPid,
      this.plan,
      this.precheck,
      verificationDependencies,
    );
    if (verification.backendGone && this.state === "outcome_unknown") this.transition("connection_closed");
    return { incident: true, classification: verification.classification };
  }
}

async function verifyIncidentOutcome(connection, backendPid, plan, precheck, dependencies = {}) {
  const connectionTimeoutMs = dependencies.connectionTimeoutMs ?? VERIFIER_CONNECTION_TIMEOUT_MS;
  const verifier = dependencies.verifier ?? new PgClient({
    ...connection,
    application_name: "organizatech-perf-06-read-only-verifier",
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: VERIFIER_QUERY_TIMEOUT_MS,
  });
  const queryTimeoutMs = dependencies.queryTimeoutMs ?? VERIFIER_QUERY_TIMEOUT_MS;
  let backendGone = !Number.isInteger(backendPid);
  let transactionOpen = false;
  let classification = "INDETERMINATE";
  try {
    await boundedVerifierOperation(() => verifier.connect(), connectionTimeoutMs, "connect");
    await startVerifierTransaction(verifier, queryTimeoutMs);
    transactionOpen = true;
    await waitForPrincipalBackendToClose(verifier, backendPid, {
      pollIntervalMs: dependencies.pollIntervalMs,
      queryTimeoutMs,
    });
    backendGone = true;
    const snapshot = await collectStateSnapshot(
      (label, text, values = []) => verifierQuery(verifier, label, text, values, queryTimeoutMs),
      plan,
    );
    classification = classifySnapshot({ ...snapshot, backendGone }, precheck, plan);
  } catch {
    classification = "INDETERMINATE";
    destroyClientSocket(verifier);
    transactionOpen = false;
  }
  if (transactionOpen) {
    try {
      await verifierQuery(verifier, "rollback", "ROLLBACK", [], queryTimeoutMs);
      transactionOpen = false;
    } catch {
      classification = "INDETERMINATE";
      destroyClientSocket(verifier);
    }
  }
  const verifierClosed = await closeVerifier(verifier, queryTimeoutMs);
  if (!verifierClosed) classification = "INDETERMINATE";
  if (!backendGone && Number.isInteger(backendPid)) await remainPendingWhenBackendCannotBeConfirmed();
  return { classification, backendGone, verifierClosed };
}

function classifySnapshot(snapshot, precheck, plan) {
  if (snapshot?.backendGone !== true) return "INDETERMINATE";
  if (rollbackSnapshotMatches(snapshot, precheck)) return "ROLLED_BACK_VERIFIED";
  if (finalSnapshotMatches(snapshot, precheck, plan)) return "COMMITTED_VERIFIED_AFTER_INTERRUPTION";
  return "INDETERMINATE";
}

async function execute(options, plan) {
  const connection = parseConnection(options);
  const operation = new AtomicOperation(options, plan, connection);
  const onSigint = () => operation.gate.request("SIGINT");
  const onSigterm = () => operation.gate.request("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  const timeoutMs = options.localValidation && (options.injection === "timeout" || options.verifierUnreachable)
    ? 750
    : GLOBAL_TIMEOUT_MS;
  const timeout = setTimeout(() => operation.gate.request("timeout"), timeoutMs);
  try {
    const result = await operation.run();
    if (operation.gate.reason) throw new IncidentError(operation.gate.reason);
    return { nominal: true, ...result };
  } catch (error) {
    const recovery = await operation.recover(error);
    if (recovery.incident) return { nominal: false, classification: recovery.classification, error };
    throw error;
  } finally {
    clearTimeout(timeout);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const plan = buildPlan();
  if (options.generateOnly) {
    process.stdout.write(`PERF06 native plan VERIFIED manifest=${plan.manifestHash} plan=${plan.planHash}\n`);
    return;
  }
  const result = await execute(options, plan);
  if (!result.nominal) {
    const prefix = result.classification === "INDETERMINATE" ? "INDETERMINATE" : "INTERRUPTED";
    process.stderr.write(`PERF06 runner ${prefix} outcome=${result.classification}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`PERF06 runner PASS terminal=${result.terminal} manifest=${plan.manifestHash} plan=${plan.planHash}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`PERF06 runner FAIL: ${sanitize(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}

export {
  LOCAL_COMMIT_CONFIRMATION,
  QA_COMMIT_CONFIRMATION,
  AtomicOperation,
  buildPlan,
  classifySnapshot,
  closeVerifier,
  collectStateSnapshot,
  execute,
  finalSnapshotMatches,
  parseArguments,
  parseConnection,
  remainPendingWhenBackendCannotBeConfirmed,
  rollbackSnapshotMatches,
  verifyIncidentOutcome,
  waitForPrincipalBackendToClose,
};
