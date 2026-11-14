-- 0004_rls.sql — كل شيء مغلق افتراضياً (الخطة §9)

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
grant select on admin_users, admin_roles to authenticated;
create policy self_admin on admin_users for select to authenticated using (user_id = auth.uid() or has_role('super_admin'));
create policy self_roles on admin_roles for select to authenticated using (user_id = auth.uid() or has_role('super_admin'));

grant select, insert on elections to authenticated;
create policy admin_read_elections on elections for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor', 'results_officer'));
create policy mgr_insert_elections on elections for insert to authenticated with check (has_role('election_manager', 'super_admin') and box_status = 'draft' and results_status = 'none' and locked_at is null);
-- تغيير الحالة يتم حصراً عبر set_box_status؛ نمنع تعديل الحالات مباشرة
create policy mgr_update_elections on elections for update to authenticated
  using (has_role('election_manager', 'super_admin')) with check (has_role('election_manager', 'super_admin'));
grant update (title, description, privacy_level, results_visibility, starts_at, ends_at, tie_policy, conflict_policy, min_turnout, runoff_reason)
  on elections to authenticated;
grant delete on elections to authenticated;
create policy mgr_delete_elections on elections for delete to authenticated using (has_role('election_manager', 'super_admin'));

grant select, insert, update, delete on election_sections, candidates to authenticated;
create policy admin_read_sections on election_sections for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor', 'results_officer'));
create policy mgr_write_sections on election_sections for all to authenticated
  using (has_role('election_manager', 'super_admin')) with check (has_role('election_manager', 'super_admin'));
create policy admin_read_candidates on candidates for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor', 'results_officer'));
create policy mgr_write_candidates on candidates for all to authenticated
  using (has_role('election_manager', 'super_admin')) with check (has_role('election_manager', 'super_admin'));

-- قائمة الطلاب: قراءة للمدير فقط؛ الكتابة عبر import_students/set_student_status (مع تدقيق)
grant select on allowed_students to authenticated;
create policy mgr_students on allowed_students for select to authenticated
  using (has_role('election_manager', 'super_admin'));

grant select on admin_audit_logs, election_revisions, election_results, incident_log, proposal_reviews, identity_access_requests to authenticated;
grant insert on incident_log to authenticated;
create policy auditor_read_logs on admin_audit_logs for select to authenticated using (has_role('super_admin', 'auditor'));
create policy auditor_read_revisions on election_revisions for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor'));
create policy staff_read_results on election_results for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor', 'results_officer'));
create policy staff_incidents_read on incident_log for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor'));
create policy staff_incidents_write on incident_log for insert to authenticated with check (has_role('super_admin', 'election_manager', 'auditor') and created_by = auth.uid());
create policy staff_reviews_read on proposal_reviews for select to authenticated using (has_role('super_admin', 'election_manager', 'auditor'));
create policy access_req_read on identity_access_requests for select to authenticated
  using (requested_by = auth.uid() or has_role('privacy_approver', 'auditor'));

-- لا سياسات إطلاقاً (إغلاق تام) على: voter_participation, ballot_sheets, ballot_choices,
-- ballot_identity_links, identity_access_approvals. الوصول عبر الدوال المحمية فقط.

-- ───── الدوال ─────
-- الخادم (مفتاح service_role) فقط: التصويت
grant execute on function cast_ballot(uuid, text, text, jsonb), validate_ballot(uuid, jsonb) to service_role;
-- مفتوحة للجميع: التحقق من وجود إيصال (لا تكشف الاختيار)
grant execute on function receipt_recorded(uuid, text) to anon, authenticated, service_role;
-- المشرفون (التحقق من الدور داخل الدالة)
grant execute on function
  has_role(admin_role[]), set_box_status(uuid, box_status, text), review_proposal(uuid, candidate_status, text),
  election_turnout(uuid), export_choices(uuid), submit_results(uuid, jsonb, text), approve_results(uuid),
  publish_results(uuid), request_identity_access(uuid, text), decide_identity_access(uuid, boolean, text),
  reveal_identity_links(uuid)
to authenticated;
-- سياسات RLS تستدعي has_role() بصلاحية المستدعي
grant execute on function has_role(admin_role[]) to anon;
