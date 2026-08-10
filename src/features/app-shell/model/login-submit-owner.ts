export interface LoginSubmitOwner {
  readonly generation: number;
  readonly operationId: number;
}

export type LoginSubmitSettlement<T> =
  | { kind: "success"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export type LoginSubmitStartResult<T> =
  | {
    kind: "started";
    owner: LoginSubmitOwner;
    promise: Promise<LoginSubmitSettlement<T>>;
  }
  | { kind: "busy" };

export interface LoginSubmitOwnerController {
  acquire(): LoginSubmitOwner | null;
  start<T>(operation: (owner: LoginSubmitOwner) => Promise<T>): LoginSubmitStartResult<T>;
  isCurrent(owner: LoginSubmitOwner): boolean;
  settle<T>(
    owner: LoginSubmitOwner,
    request: Promise<T>,
  ): Promise<LoginSubmitSettlement<T>>;
  finalize(owner: LoginSubmitOwner): boolean;
  invalidate(): void;
  dispose(): void;
}

export function createLoginSubmitOwnerController(): LoginSubmitOwnerController {
  let generation = 0;
  let nextOperationId = 0;
  let currentOwner: LoginSubmitOwner | null = null;
  let disposed = false;

  function isCurrent(owner: LoginSubmitOwner): boolean {
    return !disposed &&
      currentOwner === owner &&
      owner.generation === generation;
  }

  function acquire(): LoginSubmitOwner | null {
    if (disposed || currentOwner) return null;

    const owner = Object.freeze({
      generation,
      operationId: ++nextOperationId,
    });
    currentOwner = owner;
    return owner;
  }

  async function settle<T>(
    owner: LoginSubmitOwner,
    request: Promise<T>,
  ): Promise<LoginSubmitSettlement<T>> {
    try {
      const value = await request;
      return isCurrent(owner) ? { kind: "success", value } : { kind: "stale" };
    } catch (error) {
      return isCurrent(owner) ? { kind: "error", error } : { kind: "stale" };
    }
  }

  function finalize(owner: LoginSubmitOwner): boolean {
    if (!isCurrent(owner)) return false;
    currentOwner = null;
    return true;
  }

  function start<T>(
    operation: (owner: LoginSubmitOwner) => Promise<T>,
  ): LoginSubmitStartResult<T> {
    const owner = acquire();
    if (!owner) return { kind: "busy" };

    let request: Promise<T>;
    try {
      request = Promise.resolve(operation(owner));
    } catch (error) {
      request = Promise.reject(error);
    }

    const promise = settle(owner, request).finally(() => {
      finalize(owner);
    });
    return { kind: "started", owner, promise };
  }

  function invalidate(): void {
    if (disposed) return;
    generation += 1;
    currentOwner = null;
  }

  function dispose(): void {
    if (disposed) return;
    generation += 1;
    currentOwner = null;
    disposed = true;
  }

  return {
    acquire,
    start,
    isCurrent,
    settle,
    finalize,
    invalidate,
    dispose,
  };
}
