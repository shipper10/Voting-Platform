-- 0004_rls.sql — كل شيء مغلق افتراضياً. مشرف واحد غالباً: كل المشرفين النشطين بصلاحيات متساوية (المالك فقط يضيف مشرفين).

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ───── قراءة عامة (للطلاب عبر anon) — فقط ما يُعرض في واجهة التصويت ─────
grant select on elections, election_sections, candidates, election_results to anon, authenticated;

create policy public_read_elections on elections for select to anon, authenticated
  using (box_status in ('scheduled', 'open', 'paused', 'closed'));
create policy public_read_sections on election_sections for select to anon, authenticated
  using (exists (select 1 from elections e where e.id = election_id and e.box_status in ('scheduled', 'open', 'paused', 'closed')));
create policy public_read_candidates on candidates for select to anon, authenticated
  using (status in ('approved', 'withdrawn')
         and exists (select 1 from elections e where e.id = election_id and e.box_status in ('scheduled', 'open', 'paused', 'closed')));
create policy public_read_results on election_results for select to anon, authenticated
  using (status = 'published');

-- ───── المشرفون (authenticated) ─────
grant select on admin_users to authenticated;
create policy admin_self on admin_users for select to authenticated using (user_id = auth.uid() or is_admin());

grant select, insert on elections to authenticated;
create policy admin_read_elections on elections for select to authenticated using (is_admin());
create policy admin_insert_elections on elections for insert to authenticated
  with check (is_admin() and box_status = 'draft' and results_status = 'none' and locked_at is null);
-- تغيير الحالة حصراً عبر set_box_status: صلاحية التعديل على أعمدة الإعدادات فقط
grant update (title, description, results_visibility, starts_at, ends_at, tie_policy, conflict_policy, min_turnout) on elections to authenticated;
create policy admin_update_elections on elections for update to authenticated using (is_admin()) with check (is_admin());
grant delete on elections to authenticated;
create policy admin_delete_elections on elections for delete to authenticated using (is_admin());

grant select, insert, update, delete on election_sections, candidates to authenticated;
create policy admin_read_sections on election_sections for select to authenticated using (is_admin());
create policy admin_write_sections on election_sections for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_read_candidates on candidates for select to authenticated using (is_admin());
create policy admin_write_candidates on candidates for all to authenticated using (is_admin()) with check (is_admin());

-- قائمة الطلاب: القراءة للمشرف؛ الكتابة عبر import_students/set_student_status (مع تدقيق)
grant select on allowed_students to authenticated;
create policy admin_students on allowed_students for select to authenticated using (is_admin());

grant select on admin_audit_logs, election_revisions, election_results, incident_log, proposal_reviews to authenticated;
grant insert on incident_log to authenticated;
create policy admin_read_logs on admin_audit_logs for select to authenticated using (is_admin());
create policy admin_read_revisions on election_revisions for select to authenticated using (is_admin());
create policy admin_read_results on election_results for select to authenticated using (is_admin());
create policy admin_incidents_read on incident_log for select to authenticated using (is_admin());
create policy admin_incidents_write on incident_log for insert to authenticated with check (is_admin() and created_by = auth.uid());
create policy admin_reviews_read on proposal_reviews for select to authenticated using (is_admin());

-- لا سياسات إطلاقاً (إغلاق تام) على: voter_participation, ballot_sheets, ballot_choices.
-- الوصول عبر الدوال المحمية فقط.

-- ───── الدوال ─────
grant execute on function cast_ballot(uuid, text, text, jsonb), validate_ballot(uuid, jsonb) to service_role;
grant execute on function receipt_recorded(uuid, text) to anon, authenticated, service_role;
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function
  set_box_status(uuid, box_status, text), review_proposal(uuid, candidate_status, text),
  election_turnout(uuid), export_choices(uuid), submit_results(uuid, jsonb, text),
  publish_results(uuid), add_admin(uuid, text), set_admin_active(uuid, boolean),
  create_runoff(uuid, uuid, uuid[], int, text, timestamptz, timestamptz)
to authenticated;
