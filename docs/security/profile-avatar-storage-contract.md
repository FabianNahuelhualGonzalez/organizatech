# Profile avatar storage contract

## Canonical model

- Bucket: `profile-avatars`.
- Visibility: private. It must never use public URLs.
- One object per authenticated user: `<auth.uid()>/avatar`.
- `profiles.avatar_path`: `NULL` or exactly `<profiles.id>/avatar`.
- Maximum final file size: 2 MB.
- Allowed final MIME types: `image/jpeg`, `image/png`, `image/webp`.
- Signed URL lifetime: 3600 seconds.

The browser repository derives the object path from the authenticated user. UI
callers cannot provide a filename, object path, owner id, or signed URL target.
Storage policies independently enforce the same exact object name for SELECT,
INSERT, UPDATE, and DELETE.

## Browser behavior

The avatar editor crops the selected source and exports a 512 x 512 JPEG before
upload. Upload replaces the same private object with `upsert: true`. The profile
row stores only the canonical object path and update timestamp. Signed URLs are
kept in React state, refreshed after resume or image failure, and are never
written to localStorage or sessionStorage.

Rendering uses the signed URL while valid and falls back to the profile initial
or user icon when loading or renewal fails.

## Delete and replacement consistency

Delete derives the canonical path from the authenticated user, removes that
single object, and then clears `profiles.avatar_path`. Replacement uploads the
new bytes to the same canonical object before updating the profile timestamp.

Supabase Storage and Postgres do not share a distributed transaction. A failure
between those operations can leave an orphan object or a temporarily broken
profile reference. Full compensation/reconciliation is intentionally deferred
to P1; operators should retain the read-only integrity diagnostics.

## Release gate

The P0-H migration must run in QA before Production. Its prechecks must pass
without rewriting data: private bucket, exact limit/MIME set, canonical profile
paths and objects, no orphan objects, and no broken references. Production must
repeat the same prechecks immediately before applying the migration.

Manual QA requires two authenticated users:

1. User A uploads and reads only `<A>/avatar`.
2. User B cannot sign, upload, update, or delete `<A>/avatar`.
3. Both users can replace and delete only their own canonical object.
4. Alternate filenames, extensions, subdirectories, SVG, and files over 2 MB
   are rejected.
5. Avatar renewal after signed URL expiry, app resume, logout, and account
   switching preserves isolation and renders the expected fallback.
