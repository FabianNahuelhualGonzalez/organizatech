export const POST_AUTH_NAVIGATION_TTL_MS = 10 * 60 * 1000;
const POST_AUTH_NAVIGATION_PREFIX = "organizatech:post-auth-navigation:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PostAuthNavigationDestination = "user-coach-profile";

export interface PostAuthNavigationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function persistPostAuthNavigationIntent(
  storage: PostAuthNavigationStorage,
  userId: string,
  destination: PostAuthNavigationDestination,
  now = Date.now(),
): boolean {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId || destination !== "user-coach-profile") return false;
  try {
    storage.setItem(keyFor(normalizedUserId), JSON.stringify({
      version: 1,
      ownerUserId: normalizedUserId,
      destination,
      createdAt: now,
    }));
    return true;
  } catch {
    return false;
  }
}

export function consumePostAuthNavigationIntent(
  storage: PostAuthNavigationStorage,
  userId: string,
  now = Date.now(),
): PostAuthNavigationDestination | null {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return null;
  const key = keyFor(normalizedUserId);
  let serialized: string | null = null;
  try {
    serialized = storage.getItem(key);
    storage.removeItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      value.version !== 1
      || value.ownerUserId !== normalizedUserId
      || value.destination !== "user-coach-profile"
      || typeof value.createdAt !== "number"
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt > now
      || now - value.createdAt > POST_AUTH_NAVIGATION_TTL_MS
    ) return null;
    return value.destination;
  } catch {
    return null;
  }
}

function keyFor(userId: string) {
  return `${POST_AUTH_NAVIGATION_PREFIX}${userId}`;
}

function normalizeUserId(value: string) {
  return UUID.test(value) ? value.toLowerCase() : null;
}
