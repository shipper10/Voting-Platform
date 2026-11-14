-- 0003_functions.sql — الصلاحيات، دورة حياة الانتخابات، التصويت الذري، النتائج، الوصول الاستثنائي

-- ───────── أدوات مساعدة ─────────
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users u where u.user_id = auth.uid() and u.active);
$$;

create function require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
end $$;

create function require_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_users u where u.user_id = auth.uid() and u.active and u.is_owner) then
    raise exception 'للمالك فقط' using errcode = '42501';
  end if;
end $$;

create function log_admin(p_action text, p_target_type text, p_target_id text, p_reason text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into admin_audit_logs (actor, action, target_type, target_id, reason, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_reason, coalesce(p_details, '{}'));
$$;

create function sha256_hex(t text) returns text language sql immutable as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex');
$$;

-- لقطة إعدادات الانتخابات (للتدقيق)
create function election_snapshot(p_election uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'election', (select to_jsonb(e) - 'locked_at' - 'box_status' - 'results_status' from elections e where e.id = p_election),
    'sections', coalesce((select jsonb_agg(to_jsonb(s) order by s.display_order, s.id) from election_sections s where s.election_id = p_election), '[]'),
    'candidates', coalesce((select jsonb_agg(to_jsonb(c) - 'created_at' order by c.section_id, c.display_order, c.id) from candidates c where c.election_id = p_election), '[]')
  );
$$;

-- ───────── دورة حياة الصندوق ─────────
create function set_box_status(p_election uuid, p_new box_status, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e elections; ok boolean; n_rev int; snap jsonb; bad text;
begin
  perform require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'السبب إجباري' using errcode = 'P0001';
  end if;
  select * into e from elections where id = p_election for update;
  if not found then raise exception 'انتخابات غير موجودة'; end if;

  ok := (e.box_status, p_new) in (
    ('draft','scheduled'), ('scheduled','draft'), ('scheduled','open'),
    ('open','paused'), ('paused','open'), ('open','closed'), ('paused','closed'),
    ('draft','cancelled'), ('scheduled','cancelled'), ('open','cancelled'), ('paused','cancelled'));
  if not ok then
    raise exception 'انتقال غير مسموح: % → %', e.box_status, p_new using errcode = 'P0001';
  end if;

  if p_new = 'draft' and exists (select 1 from voter_participation where election_id = p_election) then
    raise exception 'لا رجوع إلى المسودة بعد وجود مشاركات' using errcode = 'P0001';
  end if;

  if p_new = 'scheduled' then
    -- لكل قسم مرشح معتمد واحد على الأقل (اثنان للرئيس/النائب)
    select s.title into bad
    from election_sections s
    where s.election_id = p_election
      and (select count(*) from candidates c where c.section_id = s.id and c.status = 'approved')
          < case when s.kind = 'explicit_roles' then 2 else 1 end
    limit 1;
    if bad is not null and e.type <> 'name_proposals' then
      raise exception 'القسم "%" لا يملك مرشحين كافين', bad using errcode = 'P0001';
    end if;
    if not exists (select 1 from election_sections where election_id = p_election) then
      raise exception 'لا أقسام في الانتخابات' using errcode = 'P0001';
    end if;
    select coalesce(max(revision_no), 0) + 1 into n_rev from election_revisions where election_id = p_election;
    snap := election_snapshot(p_election);
    insert into election_revisions (election_id, revision_no, snapshot, sha256, created_by)
    values (p_election, n_rev, snap, sha256_hex(snap::text), auth.uid());
    update elections set locked_at = now() where id = p_election;
  end if;

  if p_new = 'open' and e.type = 'name_proposals' then
    if exists (select 1 from candidates where election_id = p_election and status = 'pending') then
      raise exception 'توجد مقترحات معلقة لم تُراجع' using errcode = 'P0001';
    end if;
  end if;

  update elections set box_status = p_new where id = p_election;
  perform log_admin('box_status:' || p_new::text, 'election', p_election::text, p_reason,
                    jsonb_build_object('from', e.box_status, 'to', p_new));
end $$;

-- مراجعة مقترح (Pending → approved/rejected)
create function review_proposal(p_candidate uuid, p_decision candidate_status, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_decision not in ('approved', 'rejected') or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'قرار/سبب غير صالح' using errcode = 'P0001';
  end if;
  update candidates set status = p_decision where id = p_candidate and status = 'pending';
  if not found then raise exception 'المقترح ليس معلقاً' using errcode = 'P0001'; end if;
  insert into proposal_reviews (candidate_id, reviewer, decision, reason) values (p_candidate, auth.uid(), p_decision, p_reason);
  perform log_admin('proposal:' || p_decision::text, 'candidate', p_candidate::text, p_reason);
end $$;

-- ───────── التحقق من ورقة الاقتراع ─────────
-- شكل p_choices:
--  [{ "section_id": uuid, "abstain": bool?, "other_text": text?,
--     "selections": [{ "candidate_id": uuid, "role": "president|vice"?, "rating": 1-5?, "rank": n? }] }]
-- يعيد نص الخطأ أو NULL إن كانت صحيحة. لا يُدرج شيئاً.
create function validate_ballot(p_election uuid, p_choices jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s election_sections; item jsonb; sel jsonb; n int; sels jsonb; ab boolean; oth text;
  cids uuid[]; ranks int[]; k int; extra int; pres uuid; vice uuid;
begin
  if p_choices is null or jsonb_typeof(p_choices) <> 'array' then return 'ballot_format'; end if;
  -- كل قسم يظهر مرة واحدة بالضبط
  if (select count(*) from jsonb_array_elements(p_choices) x) <> (select count(*) from election_sections where election_id = p_election)
     or (select count(distinct x ->> 'section_id') from jsonb_array_elements(p_choices) x) <> (select count(*) from election_sections where election_id = p_election)
  then return 'ballot_sections'; end if;

  for s in select * from election_sections where election_id = p_election loop
    select x into item from jsonb_array_elements(p_choices) x where x ->> 'section_id' = s.id::text;
    if item is null then return 'ballot_sections'; end if;
    ab   := coalesce((item ->> 'abstain')::boolean, false);
    oth  := nullif(btrim(item ->> 'other_text'), '');
    sels := coalesce(item -> 'selections', '[]');
    if jsonb_typeof(sels) <> 'array' then return 'ballot_format'; end if;
    n := jsonb_array_length(sels);

    if ab then
      if not s.allow_abstain or n > 0 or oth is not null then return 'abstain_not_allowed'; end if;
      continue;
    end if;
    if oth is not null then
      if not s.allow_other or length(oth) > 200 then return 'other_not_allowed'; end if;
      if n > 0 and s.kind <> 'multi' then return 'other_not_allowed'; end if;
    end if;

    -- كل مرشح تابع للقسم ومعتمد، ولا تكرار
    cids := array(select (x ->> 'candidate_id')::uuid from jsonb_array_elements(sels) x);
    if cardinality(cids) <> (select count(distinct c) from unnest(cids) c) then return 'duplicate_candidate'; end if;
    if exists (select 1 from unnest(cids) c where not exists (
        select 1 from candidates cd where cd.id = c and cd.section_id = s.id and cd.status = 'approved')) then
      return 'invalid_candidate';
    end if;

    if s.kind = 'explicit_roles' then
      select count(*) into k from jsonb_array_elements(sels) x where x ->> 'role' in ('president', 'vice');
      if n <> 2 or k <> 2 then return 'roles_required'; end if;
      select (x ->> 'candidate_id')::uuid into pres from jsonb_array_elements(sels) x where x ->> 'role' = 'president';
      select (x ->> 'candidate_id')::uuid into vice from jsonb_array_elements(sels) x where x ->> 'role' = 'vice';
      if pres is null or vice is null or pres = vice then return 'same_candidate_both_roles'; end if;
    else
      if exists (select 1 from jsonb_array_elements(sels) x where x ->> 'role' is not null) then return 'role_not_allowed'; end if;
    end if;

    extra := (select case when oth is null then 0 else 1 end);
    case s.kind
      when 'top_n', 'multi' then
        if n + extra < s.min_choices
           or n > coalesce(s.max_choices, s.seats) then return 'choice_count'; end if;
      when 'single', 'yes_no' then
        if (n + extra) <> 1 then return 'choice_count'; end if;
      when 'ranked' then
        if n < s.min_choices or n > coalesce(s.max_choices, n) then return 'choice_count'; end if;
        ranks := array(select (x ->> 'rank')::int from jsonb_array_elements(sels) x order by 1);
        if exists (select 1 from jsonb_array_elements(sels) x where x ->> 'rank' is null) then return 'rank_required'; end if;
        if ranks <> array(select generate_series(1, n)) then return 'rank_invalid'; end if;
      when 'stars' then
        if n < s.min_choices or n > coalesce(s.max_choices, n) then return 'choice_count'; end if;
        if exists (select 1 from jsonb_array_elements(sels) x
                   where x ->> 'rating' is null or (x ->> 'rating')::int not between 1 and 5) then return 'rating_invalid'; end if;
      else null;
    end case;
    if s.kind not in ('ranked') and exists (select 1 from jsonb_array_elements(sels) x where x ->> 'rank' is not null) then return 'rank_not_allowed'; end if;
    if s.kind <> 'stars' and exists (select 1 from jsonb_array_elements(sels) x where x ->> 'rating' is not null) then return 'rating_not_allowed'; end if;
  end loop;
  return null;
end $$;

-- ───────── التصويت الذري ─────────
-- يُستدعى من الخادم بمفتاح service_role فقط. كل شيء في معاملة واحدة:
-- أي فشل ⇒ لا مشاركة ولا ورقة.
-- المخرجات: {status: ok|already_recorded|not_allowed|closed|invalid_ballot, receipt?, detail?}
create function cast_ballot(p_election uuid, p_university_id text, p_idempotency_key text, p_choices jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e elections; err text; v_sheet uuid; v_receipt text; v_idem text; c jsonb; sel jsonb; v_rows int;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    return jsonb_build_object('status', 'invalid_ballot', 'detail', 'idempotency_key');
  end if;
  v_idem := sha256_hex(p_idempotency_key);

  -- قفل مشترك على الانتخابات: يمنع الإغلاق/الإيقاف أثناء الحفظ
  select * into e from elections where id = p_election for share;
  if not found or e.box_status <> 'open' or now() < e.starts_at or now() > e.ends_at then
    return jsonb_build_object('status', 'closed');
  end if;

  if not exists (select 1 from allowed_students where university_id = p_university_id and status = 'active') then
    return jsonb_build_object('status', 'not_allowed');
  end if;

  err := validate_ballot(p_election, p_choices);
  if err is not null then
    return jsonb_build_object('status', 'invalid_ballot', 'detail', err);
  end if;

  insert into voter_participation (election_id, university_id, idempotency_hash)
  values (p_election, p_university_id, v_idem)
  on conflict (election_id, university_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- إعادة محاولة بنفس المفتاح ⇒ نجاح سابق (لا نعيد الإيصال)؛ غير ذلك ⇒ رسالة عامة
    if exists (select 1 from voter_participation
               where election_id = p_election and university_id = p_university_id and idempotency_hash = v_idem) then
      return jsonb_build_object('status', 'already_recorded');
    end if;
    return jsonb_build_object('status', 'not_allowed');
  end if;

  v_receipt := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_receipt := substr(v_receipt, 1, 4) || '-' || substr(v_receipt, 5, 4) || '-' || substr(v_receipt, 9, 4);
  insert into ballot_sheets (election_id, university_id, receipt_hash) values (p_election, p_university_id, sha256_hex(v_receipt))
  returning id into v_sheet;

  for c in select * from jsonb_array_elements(p_choices) loop
    if coalesce((c ->> 'abstain')::boolean, false) then
      insert into ballot_choices (sheet_id, election_id, section_id, abstain)
      values (v_sheet, p_election, (c ->> 'section_id')::uuid, true);
      continue;
    end if;
    for sel in select * from jsonb_array_elements(coalesce(c -> 'selections', '[]')) loop
      insert into ballot_choices (sheet_id, election_id, section_id, candidate_id, role, rating, rank)
      values (v_sheet, p_election, (c ->> 'section_id')::uuid, (sel ->> 'candidate_id')::uuid,
              sel ->> 'role', (sel ->> 'rating')::smallint, (sel ->> 'rank')::smallint);
    end loop;
    if nullif(btrim(c ->> 'other_text'), '') is not null then
      insert into ballot_choices (sheet_id, election_id, section_id, other_text)
      values (v_sheet, p_election, (c ->> 'section_id')::uuid, btrim(c ->> 'other_text'));
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'receipt', v_receipt);
end $$;

-- التحقق من إدراج إيصال (دون كشف الاختيار)
create function receipt_recorded(p_election uuid, p_receipt text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ballot_sheets where election_id = p_election and receipt_hash = sha256_hex(upper(btrim(p_receipt))));
$$;

-- ───────── المشاركة والنتائج ─────────
create function election_turnout(p_election uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return jsonb_build_object(
    'eligible', (select count(*) from allowed_students where status = 'active'),
    'participated', (select count(*) from voter_participation where election_id = p_election),
    'sheets', (select count(*) from ballot_sheets where election_id = p_election));
end $$;

-- الاختيارات الخام للفرز — بعد الإغلاق فقط، بلا أي هوية
create function export_choices(p_election uuid) returns table (
  sheet_id uuid, section_id uuid, candidate_id uuid, role text, rating smallint, rank smallint, other_text text, abstain boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  if (select box_status from elections where id = p_election) <> 'closed' then
    raise exception 'الفرز بعد إغلاق الصندوق فقط' using errcode = 'P0001';
  end if;
  return query
    select c.sheet_id, c.section_id, c.candidate_id, c.role, c.rating, c.rank, c.other_text, c.abstain
    from ballot_choices c where c.election_id = p_election order by c.sheet_id, c.section_id, c.id;
end $$;

create function submit_results(p_election uuid, p_result jsonb, p_rules_version text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  perform require_admin();
  if (select box_status from elections where id = p_election) <> 'closed' then
    raise exception 'الصندوق لم يُغلق' using errcode = 'P0001';
  end if;
  if exists (select 1 from election_results where election_id = p_election and status = 'published') then
    raise exception 'نتائج منشورة بالفعل' using errcode = 'P0001';
  end if;
  -- إعادة الاحتساب تستبدل المسودة السابقة قيد المراجعة (تبقى في سجل التدقيق)
  delete from election_results where election_id = p_election and status = 'under_review';
  insert into election_results (election_id, rules_version, result, report_sha256, submitted_by)
  values (p_election, p_rules_version, p_result, sha256_hex(p_result::text), auth.uid()) returning id into rid;
  update elections set results_status = 'under_review' where id = p_election;
  perform log_admin('results:computed', 'election', p_election::text, null,
                    jsonb_build_object('result_id', rid, 'sha256', sha256_hex(p_result::text)));
  return rid;
end $$;

create function publish_results(p_result uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r election_results;
begin
  perform require_admin();
  select * into r from election_results where id = p_result for update;
  if r.status <> 'under_review' then raise exception 'ليست قيد المراجعة' using errcode = 'P0001'; end if;
  update election_results set status = 'published', published_by = auth.uid(), published_at = now() where id = p_result;
  update elections set results_status = 'published' where id = r.election_id;
  perform log_admin('results:published', 'election', r.election_id::text, null, jsonb_build_object('result_id', p_result));
end $$;

-- ───────── المشرفون (المالك فقط) ─────────
create function add_admin(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  insert into admin_users (user_id, display_name) values (p_user, p_name)
  on conflict (user_id) do update set active = true, display_name = excluded.display_name;
  perform log_admin('admin:add', 'admin', p_user::text, null);
end $$;

create function set_admin_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  if p_user = auth.uid() then raise exception 'لا تعطّل حسابك' using errcode = 'P0001'; end if;
  update admin_users set active = p_active where user_id = p_user and not is_owner;
  if not found then raise exception 'لا يمكن تعديل هذا الحساب' using errcode = 'P0001'; end if;
  perform log_admin('admin:' || case when p_active then 'enable' else 'disable' end, 'admin', p_user::text, null);
end $$;

-- ───────── جولة إعادة ─────────
-- تنشئ انتخابات جديدة (مسودة) مرتبطة بالأصلية، بقسم واحد ومرشحين محددين. لا تُنقل الأصوات.
create function create_runoff(p_election uuid, p_section uuid, p_candidates uuid[], p_seats int,
                              p_reason text, p_starts timestamptz, p_ends timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare e elections; s election_sections; new_e uuid; new_s uuid; c candidates;
begin
  perform require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'السبب إجباري' using errcode = 'P0001'; end if;
  select * into e from elections where id = p_election;
  if e.box_status <> 'closed' then raise exception 'الصندوق لم يُغلق' using errcode = 'P0001'; end if;
  select * into s from election_sections where id = p_section and election_id = p_election;
  if not found then raise exception 'قسم غير موجود' using errcode = 'P0001'; end if;
  if cardinality(p_candidates) < 2 or p_seats < 1 or p_seats >= cardinality(p_candidates) then
    raise exception 'مرشحون/مقاعد غير صالحة' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_candidates) x where not exists (select 1 from candidates where id = x and section_id = p_section)) then
    raise exception 'مرشح لا يتبع القسم' using errcode = 'P0001';
  end if;
  insert into elections (title, description, type, starts_at, ends_at, tie_policy, conflict_policy, runoff_of, runoff_reason, runoff_created_by, created_by)
  values ('جولة إعادة: ' || e.title || ' — ' || s.title, e.description, e.type, p_starts, p_ends, e.tie_policy, e.conflict_policy,
          p_election, p_reason, auth.uid(), auth.uid()) returning id into new_e;
  insert into election_sections (election_id, title, kind, seats, min_choices, max_choices, allow_abstain)
  values (new_e, s.title, case when p_seats = 1 then 'single'::section_kind else 'top_n'::section_kind end,
          p_seats, 1, case when p_seats = 1 then null else p_seats end, s.allow_abstain)
  returning id into new_s;
  for c in select * from candidates where id = any (p_candidates) order by display_order, id loop
    insert into candidates (election_id, section_id, name, bio, image_url, display_order)
    values (new_e, new_s, c.name, c.bio, c.image_url, c.display_order);
  end loop;
  perform log_admin('runoff:created', 'election', new_e::text, p_reason, jsonb_build_object('original', p_election, 'section', p_section));
  return new_e;
end $$;
