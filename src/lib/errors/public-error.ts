export type PublicErrorCode = string;

export class PublicError extends Error {
  readonly cause?: unknown;

  constructor(
    public readonly code: PublicErrorCode,
    publicMessage: string,
    cause?: unknown,
  ) {
    super(publicMessage);
    this.name = "PublicError";
    Object.defineProperty(this, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: false,
    });
  }
}

export function createPublicRepositoryError(
  code: PublicErrorCode,
  publicMessage: string,
  cause?: unknown,
): PublicError {
  return new PublicError(code, publicMessage, cause);
}

export function isPublicError(error: unknown): error is PublicError {
  return error instanceof PublicError;
}

export function getPublicErrorMessage(error: unknown, fallback: string): string {
  return isPublicError(error) ? error.message : fallback;
}

export function isSessionExpiredError(error: unknown): boolean {
  return isPublicError(error) && error.code === "session_expired";
}
