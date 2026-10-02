import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20261001230633_progress_photo_original_staging_jpeg_publication.sql", "utf8",
);

test("first forward migration keeps staging private and admits existing Sharp formats", () => {
  assert.match(sql, /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(sql, /public = false and file_size_limit = 20971520/);
  assert.match(sql, /p_format not in \('jpeg', 'png', 'webp'\)/);
  assert.doesNotMatch(sql, /'image\/heic'|'heic'\)/);
  assert.match(sql, /private\.require_own_active_student_relationship\(\)/);
  assert.match(sql, /gen_random_uuid\(\)::text \|\| '\/' \|\| gen_random_uuid\(\)::text/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /revoke all on function public\.begin_own_progress_photo_upload/);
  assert.match(sql, /grant execute on function public\.begin_own_progress_photo_upload[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /p_(?:student|owner|user|object|path|bucket)_/);
});
