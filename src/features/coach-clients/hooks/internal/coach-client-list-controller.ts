/** Private mechanics for the two Coach client lists; every factory call owns independent state. */
type ListIssue = "invalid_input" | "invalid_response" | "forbidden"
  | "operation_stale" | "aborted" | "timeout" | "unavailable";
type TotalField = "totalPending" | "totalActive";
type ListPhase = "idle" | "loading" | "loading-next" | "ready" | "error" | "disposed";
interface Position { readonly id: string }
interface ListQuery<Cursor> {
  readonly query: string;
  readonly limit: number;
  readonly cursor: Cursor | null;
}
type ListPage<Item, Cursor, Total extends TotalField> = Readonly<Record<Total, number>> & {
  readonly serverNow: string;
  readonly matchingCount: number;
  readonly items: readonly Item[];
  readonly nextCursor: Cursor | null;
};
type ListSnapshot<Item, Cursor, Total extends TotalField> = Readonly<Record<Total, number | null>> & {
  readonly query: string;
  readonly pageSize: number;
  readonly phase: ListPhase;
  readonly items: readonly Item[];
  readonly serverNow: string | null;
  readonly matchingCount: number | null;
  readonly nextCursor: Cursor | null;
  readonly issue: ListIssue | null;
};
interface ListController<Item, Cursor, Total extends TotalField> {
  getSnapshot(): ListSnapshot<Item, Cursor, Total>;
  subscribe(listener: (snapshot: ListSnapshot<Item, Cursor, Total>) => void): () => void;
  setQuery(raw: string): boolean;
  load(): Promise<boolean>;
  reload(): Promise<boolean>;
  canLoadNext(): boolean;
  loadNext(): Promise<boolean>;
  invalidate(): boolean;
  dispose(): void;
}
interface ListInput<Item, Cursor, Total extends TotalField> {
  readonly source: {
    list(query: ListQuery<Cursor>, options: { readonly signal: AbortSignal }): Promise<ListPage<Item, Cursor, Total>>;
  };
  readonly isCurrent: () => boolean;
  readonly pageSize?: number;
}
/** Static field codecs only: no lifecycle policies, endpoint registry or authorization callbacks. */
interface ListShape<Item extends Cursor, Cursor extends Position, Total extends TotalField> {
  readonly totalField: Total;
  readonly copyItem: (value: unknown) => Item;
  readonly copyCursor: (value: unknown) => Cursor;
  readonly timestamp: (value: Cursor) => string;
}
interface ListRequest<Item, Cursor> {
  readonly epoch: number;
  readonly query: ListQuery<Cursor>;
  readonly prior: readonly Item[];
  readonly abort: AbortController;
  readonly settle: (value: boolean) => void;
}

const emptyItems: readonly never[] = Object.freeze([]);
const invalidResponse = Object.freeze({ code: "invalid_response" });

/** Preserve each public total field without another snapshot cache or fictitious business fields. */
function totalMetadata<Total extends TotalField, Value extends number | null>(field: Total, value: Value) {
  return Object.freeze({ [field]: value }) as Readonly<Record<Total, Value>>;
}

function validQuery(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
    else bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
    if (bytes > 254) return false;
  }
  return true;
}

// Defensive allowlist copying at a validated port, not another SDK/authorization parser.
export function readCoachClientListField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") throw invalidResponse;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) throw invalidResponse;
  return descriptor.value;
}
export function readCoachClientListString(value: unknown, key: string): string {
  const result = readCoachClientListField(value, key);
  if (typeof result !== "string") throw invalidResponse;
  return result;
}
export function rejectCoachClientListPage(): never { throw invalidResponse; }

/** Source validates civil/timezone syntax. Preserve microseconds and offsets for keyset ordering. */
function micros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw invalidResponse;
  const milliseconds = Date.parse(match[1] + match[3]);
  if (!Number.isSafeInteger(milliseconds)) throw invalidResponse;
  return BigInt(milliseconds) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(6, "0"));
}
export function readCoachClientListTimestamp(value: unknown, key: string): string {
  const result = readCoachClientListString(value, key);
  micros(result);
  return result;
}
function compare<Cursor extends Position>(left: Cursor, right: Cursor, timestamp: (value: Cursor) => string): number {
  const delta = micros(timestamp(left)) - micros(timestamp(right));
  return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidResponse;
  return value === 0 ? 0 : value;
}

function copyPage<Item extends Cursor, Cursor extends Position, Total extends TotalField>(
  value: unknown, query: ListQuery<Cursor>, prior: readonly Item[], shape: ListShape<Item, Cursor, Total>,
): ListPage<Item, Cursor, Total> {
  const serverNow = readCoachClientListTimestamp(value, "serverNow");
  const total = count(readCoachClientListField(value, shape.totalField));
  const matchingCount = count(readCoachClientListField(value, "matchingCount"));
  const rawItems = readCoachClientListField(value, "items");
  if (!Array.isArray(rawItems)) throw invalidResponse;
  const length = count(readCoachClientListField(rawItems, "length"));
  if (length > query.limit || length > matchingCount || matchingCount > total) throw invalidResponse;
  const ids = new Set(prior.map((item) => item.id));
  const items: Item[] = [];
  let previous = query.cursor;
  for (let index = 0; index < length; index += 1) {
    const item = shape.copyItem(readCoachClientListField(rawItems, String(index)));
    micros(shape.timestamp(item));
    if (item.id.length === 0 || ids.has(item.id)
      || (previous !== null && compare(item, previous, shape.timestamp) >= 0)) throw invalidResponse;
    ids.add(item.id);
    previous = item;
    items.push(item);
  }
  const rawCursor = readCoachClientListField(value, "nextCursor");
  const nextCursor = rawCursor === null ? null : shape.copyCursor(rawCursor);
  if (nextCursor !== null && (nextCursor.id.length === 0 || items.length === 0
    || compare(nextCursor, items[items.length - 1], shape.timestamp) !== 0)) throw invalidResponse;
  // No accumulated.length <= matchingCount assertion: membership may change between calls.
  return Object.freeze({ ...totalMetadata(shape.totalField, total), serverNow, matchingCount, items: Object.freeze(items), nextCursor });
}

function issueFrom(error: unknown): ListIssue {
  try {
    const code = readCoachClientListField(error, "code");
    switch (code) {
      case "invalid_input": case "invalid_response": case "forbidden": case "operation_stale":
      case "aborted": case "timeout": case "unavailable": return code;
    }
  } catch { /* Never inspect or expose messages, getters or arbitrary source errors. */ }
  return "unavailable";
}

export function createCoachClientListController<Item extends Cursor, Cursor extends Position, Total extends TotalField>(
  input: ListInput<Item, Cursor, Total>,
  shape: ListShape<Item, Cursor, Total>,
): ListController<Item, Cursor, Total> {
  type Snapshot = ListSnapshot<Item, Cursor, Total>;
  type Request = ListRequest<Item, Cursor>;
  const pageSize = input.pageSize === undefined ? 25 : input.pageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new RangeError("invalid_input");
  const source = input.source;
  const isCurrent = input.isCurrent;
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let epoch = 0;
  let active: Request | null = null;
  let disposed = false;
  let checking = false;
  let notifying = false;
  let hasFirstPage = false;

  function empty(query: string, phase: ListPhase,
    issue: ListIssue | null): Snapshot {
    return Object.freeze({ ...totalMetadata(shape.totalField, null), query, pageSize, phase, items: emptyItems, serverNow: null,
      matchingCount: null, nextCursor: null, issue });
  }
  let snapshot = empty("", "idle", null);

  function cancel(request: Request | null) {
    if (!request) return;
    request.settle(false);
    request.abort.abort();
  }

  function emit() {
    if (notifying) return;
    notifying = true;
    try {
      for (const listener of Array.from(listeners)) {
        if (!listeners.has(listener)) continue;
        if (!disposed) live(false);
        try { listener(snapshot); } catch { /* Subscriber failures are not transport failures. */ }
      }
    } finally {
      notifying = false;
      if (disposed) listeners.clear();
    }
  }

  function stop(issue: ListIssue | null, notify: boolean) {
    if (disposed) return;
    disposed = true;
    epoch += 1;
    hasFirstPage = false;
    snapshot = empty("", "disposed", issue);
    const previous = active;
    active = null;
    cancel(previous);
    if (notify) emit();
    if (!notifying) listeners.clear();
  }

  function live(notify = true): boolean {
    if (disposed) return false;
    if (checking) { stop("operation_stale", false); return false; }
    checking = true;
    let current = false;
    try { current = isCurrent() === true; } catch { /* Fail closed for an unusable owner guard. */ }
    finally { checking = false; }
    if (!current) stop("operation_stale", notify);
    return !disposed;
  }

  function isActive(request: Request): boolean {
    return live() && active === request && epoch === request.epoch && snapshot.query === request.query.query;
  }

  async function execute(request: Request) {
    if (!isActive(request)) { request.settle(false); return; }
    try {
      const result = await source.list(request.query, Object.freeze({ signal: request.abort.signal }));
      if (!isActive(request)) { request.settle(false); return; }
      let page: ListPage<Item, Cursor, Total>;
      try { page = copyPage(result, request.query, request.prior, shape); }
      catch { throw invalidResponse; }
      if (!isActive(request)) { request.settle(false); return; }
      active = null;
      hasFirstPage = true;
      const ready: Snapshot = Object.freeze({ ...totalMetadata(shape.totalField, page[shape.totalField]), query: request.query.query, pageSize,
        phase: "ready", items: Object.freeze([...request.prior, ...page.items]), serverNow: page.serverNow,
        matchingCount: page.matchingCount, nextCursor: page.nextCursor, issue: null });
      snapshot = ready;
      emit();
      request.settle(live() && epoch === request.epoch && snapshot === ready);
    } catch (error: unknown) {
      if (!isActive(request)) { request.settle(false); return; }
      const issue = issueFrom(error);
      if (!isActive(request)) { request.settle(false); return; }
      if (issue === "forbidden" || issue === "operation_stale") stop(issue, true);
      else {
        active = null;
        snapshot = Object.freeze({ ...snapshot, phase: "error", issue });
        emit();
      }
      request.settle(false);
    }
  }

  function requestPage(next: boolean, replace: boolean): Promise<boolean> {
    if (notifying || !live() || !validQuery(snapshot.query)) return Promise.resolve(false);
    if (active !== null && !replace) return Promise.resolve(false);
    if (next && (!hasFirstPage || snapshot.nextCursor === null)) return Promise.resolve(false);
    const query: ListQuery<Cursor> = Object.freeze({ query: snapshot.query, limit: pageSize,
      cursor: next ? snapshot.nextCursor : null });
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((accept) => { resolve = accept; });
    let settled = false;
    const request: Request = {
      epoch: ++epoch, query, prior: next ? snapshot.items : emptyItems, abort: new AbortController(),
      settle: (value) => { if (!settled) { settled = true; resolve(value); } },
    };
    const previous = active;
    active = request;
    if (!next) hasFirstPage = false;
    snapshot = Object.freeze({ ...snapshot, phase: next ? "loading-next" : "loading",
      nextCursor: next ? snapshot.nextCursor : null, issue: null });
    cancel(previous);
    if (isActive(request)) emit();
    // Listeners may synchronously invalidate before the source dispatch; execute checks again.
    void execute(request);
    return promise;
  }

  function setQuery(raw: string): boolean {
    if (!live()) return false;
    if (typeof raw !== "string") return false;
    const valid = validQuery(raw);
    if (snapshot.query === raw) return invalidate() && valid;
    epoch += 1;
    hasFirstPage = false;
    snapshot = empty(raw, valid ? "idle" : "error", valid ? null : "invalid_input");
    const previous = active;
    active = null;
    cancel(previous);
    emit();
    return live() && snapshot.query === raw && valid;
  }

  function invalidate(): boolean {
    if (!live()) return false;
    const valid = validQuery(snapshot.query);
    if (active === null && snapshot.items.length === 0 && snapshot.serverNow === null
      && snapshot.phase === (valid ? "idle" : "error") && snapshot.issue === (valid ? null : "invalid_input")) return true;
    epoch += 1;
    hasFirstPage = false;
    snapshot = empty(snapshot.query, valid ? "idle" : "error", valid ? null : "invalid_input");
    const previous = active;
    active = null;
    cancel(previous);
    emit();
    return live();
  }

  return Object.freeze({
    getSnapshot: () => { live(false); return snapshot; },
    subscribe: (listener: (value: Snapshot) => void) => {
      if (live() && typeof listener === "function") listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setQuery,
    load: () => requestPage(false, false),
    reload: () => requestPage(false, true),
    canLoadNext: () => live() && active === null && hasFirstPage && snapshot.nextCursor !== null,
    loadNext: () => requestPage(true, false),
    invalidate,
    dispose: () => stop(null, true),
  });
}
