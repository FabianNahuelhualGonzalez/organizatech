create index exercise_entries_session_user_lineage_created_id_idx
  on public.exercise_entries (session_id, user_id, exercise_lineage_id, created_at, id);
