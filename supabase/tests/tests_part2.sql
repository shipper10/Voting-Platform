\set ON_ERROR_STOP on
-- ───── الكتلة 2: الإغلاق، RLS، النتائج ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; outsider uuid := '00000000-0000-0000-0000-00000000000b';
  e1 uuid := (select v::uuid from t.ctx where k = 'e1');
  n int; rid uuid; rows_ int;
begin
  perform t.as_('anon');
  perform t.err('select * from voter_participation', 'permission denied');
  perform t.err('select * from ballot_choices', 'permission denied');
  perform t.err('select * from ballot_sheets', 'permission denied');
  perform t.err('select * from allowed_students', 'permission denied');
  perform t.err('select cast_ballot(''' || e1 || ''', ''S5'', ''key-key-key-key-0040'', ''[]'')', 'permission denied');
  -- مستخدم مسجّل لكنه ليس مشرفاً: لا شيء
  perform t.as_('authenticated', outsider);
  select count(*) into n from allowed_students; assert n = 0, 'غير المشرف لا يرى الطلاب';
  perform t.err('select set_box_status(''' || e1 || ''', ''paused'', ''محاولة'')', 'غير مصرح');
  perform t.err('select import_students(''[]'')', 'غير مصرح');
  perform t.as_('authenticated', mgr);
  perform t.err('select * from ballot_choices', 'permission denied');
  perform t.err('select * from voter_participation', 'permission denied');
  perform t.err('update elections set box_status = ''closed''', 'permission denied');
  perform t.err('select * from export_choices(''' || e1 || ''')', 'بعد إغلاق');
  select (election_turnout(e1) ->> 'participated')::int into n; assert n = 3, 'المشاركة: ' || n;
  perform set_box_status(e1, 'paused', 'إيقاف مؤقت');
  perform t.as_('service_role');
  assert cast_ballot(e1, 'S5', 'key-key-key-key-0041', '[]') ->> 'status' = 'closed', 'متوقف مؤقتاً';
  perform t.as_('authenticated', mgr);
  perform set_box_status(e1, 'open', 'استئناف');
  perform set_box_status(e1, 'closed', 'انتهى الوقت');
  perform t.as_('service_role');
  assert cast_ballot(e1, 'S5', 'key-key-key-key-0042', '[]') ->> 'status' = 'closed', 'بعد الإغلاق';
  perform t.as_('postgres');
  perform t.err('insert into ballot_sheets (election_id, university_id, receipt_hash) values (''' || e1 || ''', ''S5'', ''zz'')', 'الصندوق غير مفتوح');

  perform t.as_('authenticated', mgr);
  select count(*) into rows_ from export_choices(e1); assert rows_ = 9, 'عدد الصفوف: ' || rows_;
  rid := submit_results(e1, '{"sections": []}', 'v1');
  perform t.as_('anon');
  select count(*) into n from election_results; assert n = 0, 'النتائج لا تظهر قبل النشر';
  perform t.as_('authenticated', mgr);
  perform publish_results(rid);
  perform t.err('select submit_results(''' || e1 || ''', ''{}'', ''v1'')', 'منشورة بالفعل');
  perform t.as_('anon');
  select count(*) into n from election_results; assert n = 1, 'النتائج المنشورة تظهر للعامة';
  perform t.as_('postgres');
  select count(*) into n from admin_audit_logs where action like 'results:%'; assert n = 2, 'تدقيق النتائج';
  select count(*) into n from admin_audit_logs where action like 'box_status:%'; assert n >= 5, 'تدقيق الحالة';
end $$;

-- ───── الكتلة 3: المشرفون (المالك يضيف) وجولة الإعادة ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; aud uuid := '00000000-0000-0000-0000-00000000000e';
  newadm uuid := '00000000-0000-0000-0000-00000000000f'; e1 uuid := (select v::uuid from t.ctx where k = 'e1');
  sa uuid := (select v::uuid from t.ctx where k = 'sa'); c1 uuid := (select v::uuid from t.ctx where k = 'c1');
  c2 uuid := (select v::uuid from t.ctx where k = 'c2'); c3 uuid := (select v::uuid from t.ctx where k = 'c3');
  ro uuid; n int; s2 uuid; ca uuid;
begin
  -- مشرف غير مالك لا يضيف مشرفين
  perform t.as_('authenticated', aud);
  perform t.err('select add_admin(''' || newadm || ''', ''x'')', 'للمالك فقط');
  -- لكنه يعمل كمشرف كامل
  assert (select count(*) from allowed_students) > 0, 'المشرف يرى الطلاب';
  -- المالك يضيف ثم يعطّل
  perform t.as_('authenticated', mgr);
  perform add_admin(newadm, 'جديد');
  perform t.err('select set_admin_active(''' || mgr || ''', false)', 'لا تعطّل حسابك');
  perform t.as_('authenticated', newadm);
  assert (select count(*) from allowed_students) > 0, 'المشرف الجديد يعمل';
  perform t.as_('authenticated', mgr);
  perform set_admin_active(newadm, false);
  perform t.as_('authenticated', newadm);
  assert (select count(*) from allowed_students) = 0, 'المعطّل لا يرى شيئاً';

  -- جولة إعادة: على قسم الرئاسة بين مرشحين، لا تُنقل الأصوات
  perform t.as_('authenticated', mgr);
  perform t.err('select create_runoff(''' || e1 || ''', ''' || sa || ''', array[''' || c1 || '''::uuid], 1, ''تعادل'', now(), now() + interval ''1 day'')', 'غير صالحة');
  ro := create_runoff(e1, sa, array[c1, c2], 1, 'تعادل على الرئاسة', now(), now() + interval '2 days');
  assert (select runoff_of from elections where id = ro) = e1, 'ارتباط بالأصلية';
  assert (select box_status from elections where id = ro) = 'draft', 'مسودة';
  select count(*) into n from candidates where election_id = ro; assert n = 2, 'مرشحان فقط';
  perform t.as_('postgres');
  select count(*) into n from ballot_sheets where election_id = ro; assert n = 0, 'لا أصوات منقولة';
  perform t.as_('authenticated', mgr);
  assert (select kind from election_sections where election_id = ro) = 'single';
  perform set_box_status(ro, 'scheduled', 'اعتماد'); perform set_box_status(ro, 'open', 'فتح');
  select id into s2 from election_sections where election_id = ro;
  select id into ca from candidates where election_id = ro and name = 'أ';
  perform t.as_('service_role');
  -- ناخب S1 صوّت في الأصلية لكنه يستطيع التصويت في الإعادة (انتخابات مستقلة)
  assert cast_ballot(ro, 'S1', 'key-key-key-key-0070', jsonb_build_array(jsonb_build_object('section_id', s2,
    'selections', jsonb_build_array(jsonb_build_object('candidate_id', ca))))) ->> 'status' = 'ok', 'التصويت في الإعادة';
  perform t.as_('postgres');
  assert (select count(*) from ballot_sheets where election_id = e1) = 3, 'الجولة الأولى لم تتغير';
end $$;

-- ───── الكتلة 4: الترتيب والنجوم وخيار "أخرى" ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; e uuid; sr uuid; ss uuid; so uuid;
  p1 uuid; p2 uuid; p3 uuid; q1 uuid; q2 uuid; o1 uuid; pend uuid;
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, starts_at, ends_at, created_by)
    values ('اسم الدفعة', 'name_proposals', now() - interval '1 hour', now() + interval '1 day', mgr) returning id into e;
  insert into election_sections (election_id, title, kind, max_choices) values (e, 'ترتيب', 'ranked', 3) returning id into sr;
  insert into election_sections (election_id, title, kind, allow_abstain) values (e, 'تقييم', 'stars', true) returning id into ss;
  insert into election_sections (election_id, title, kind, allow_other, min_choices) values (e, 'متعدد', 'multi', true, 0) returning id into so;
  insert into candidates (election_id, section_id, name) values (e, sr, 'اسم1') returning id into p1;
  insert into candidates (election_id, section_id, name) values (e, sr, 'اسم2') returning id into p2;
  insert into candidates (election_id, section_id, name) values (e, sr, 'اسم3') returning id into p3;
  insert into candidates (election_id, section_id, name) values (e, ss, 'نجمة1') returning id into q1;
  insert into candidates (election_id, section_id, name) values (e, ss, 'نجمة2') returning id into q2;
  insert into candidates (election_id, section_id, name) values (e, so, 'خيار1') returning id into o1;
  insert into candidates (election_id, section_id, name, status) values (e, so, 'مقترح طالب', 'pending') returning id into pend;
  perform set_box_status(e, 'scheduled', 'اعتماد');
  perform t.err('select set_box_status(''' || e || ''', ''open'', ''فتح'')', 'مقترحات معلقة');
  perform review_proposal(pend, 'rejected', 'يخالف الشروط');
  perform set_box_status(e, 'open', 'فتح');
  perform t.as_('service_role');
  assert cast_ballot(e, 'S1', 'key-key-key-key-0060', jsonb_build_array(
    jsonb_build_object('section_id', sr, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', p1, 'rank', 1), jsonb_build_object('candidate_id', p2, 'rank', 3))),
    jsonb_build_object('section_id', ss, 'abstain', true), jsonb_build_object('section_id', so, 'selections', '[]'::jsonb))) ->> 'detail' = 'rank_invalid';
  assert cast_ballot(e, 'S1', 'key-key-key-key-0061', jsonb_build_array(
    jsonb_build_object('section_id', sr, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', p1, 'rank', 1))),
    jsonb_build_object('section_id', ss, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', q1, 'rating', 6))),
    jsonb_build_object('section_id', so, 'selections', '[]'::jsonb))) ->> 'detail' = 'rating_invalid';
  assert cast_ballot(e, 'S1', 'key-key-key-key-0062', jsonb_build_array(
    jsonb_build_object('section_id', sr, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', p1, 'rank', 1))),
    jsonb_build_object('section_id', ss, 'abstain', true),
    jsonb_build_object('section_id', so, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', pend))))) ->> 'detail' = 'invalid_candidate';
  assert cast_ballot(e, 'S1', 'key-key-key-key-0063', jsonb_build_array(
    jsonb_build_object('section_id', sr, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', p2, 'rank', 1), jsonb_build_object('candidate_id', p1, 'rank', 2))),
    jsonb_build_object('section_id', ss, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', q1, 'rating', 5), jsonb_build_object('candidate_id', q2, 'rating', 2))),
    jsonb_build_object('section_id', so, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', o1)), 'other_text', '  اسم مقترح  '))) ->> 'status' = 'ok';
  perform t.as_('postgres');
  assert (select count(*) from ballot_choices where election_id = e and other_text = 'اسم مقترح') = 1, 'نص أخرى يُقصّ ويُحفظ';
  perform t.as_('service_role');
  assert cast_ballot(e, 'S2', 'key-key-key-key-0064', jsonb_build_array(
    jsonb_build_object('section_id', sr, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', p1, 'rank', 1)), 'other_text', 'ممنوع'),
    jsonb_build_object('section_id', ss, 'abstain', true), jsonb_build_object('section_id', so, 'selections', '[]'::jsonb))) ->> 'detail' = 'other_not_allowed';
end $$;

-- ───── الكتلة 5: إدارة الطلاب ─────
do $$
declare mgr uuid := '00000000-0000-0000-0000-00000000000a'; r jsonb; n int;
begin
  perform t.as_('authenticated', mgr);
  perform t.err('insert into allowed_students (university_id) values (''HACK1'')', 'permission denied');
  r := import_students('[{"university_id":"N1","full_name":"أ","status":"active"},{"university_id":"S1","full_name":"محدّث","status":"active"}]');
  assert (r ->> 'new')::int = 1 and (r ->> 'updated')::int = 1, 'استيراد: ' || r::text;
  perform t.err('select set_student_status(''N1'', ''frozen'', '''')', 'غير صالحة');
  perform set_student_status('N1', 'frozen', 'سبب التجميد');
  perform t.as_('postgres');
  assert (select status from allowed_students where university_id = 'N1') = 'frozen';
  select count(*) into n from admin_audit_logs where action in ('students:import', 'student:frozen'); assert n = 2, 'تدقيق الطلاب';
end $$;

-- ───── الكتلة 6: تهيئة اختبار التزامن والإغلاق بوقت الخادم ─────
do $$
declare mgr uuid := '00000000-0000-0000-0000-00000000000a'; e uuid; s uuid; c uuid; d uuid;
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, starts_at, ends_at, created_by)
    values ('تزامن', 'referendum', now() - interval '1 hour', now() + interval '8 seconds', mgr) returning id into e;
  insert into election_sections (election_id, title, kind) values (e, 'سؤال', 'yes_no') returning id into s;
  insert into candidates (election_id, section_id, name) values (e, s, 'نعم') returning id into c;
  insert into candidates (election_id, section_id, name) values (e, s, 'لا') returning id into d;
  perform set_box_status(e, 'scheduled', 'اعتماد'); perform set_box_status(e, 'open', 'فتح');
  perform t.as_('postgres');
  insert into t.ctx values ('conc_e', e::text), ('conc_s', s::text), ('conc_c', c::text);
end $$;

-- ───── الكتلة 7: مقترحات الطلاب ─────
do $$
declare mgr uuid := '00000000-0000-0000-0000-00000000000a'; e uuid; s uuid; n int; r jsonb;
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, starts_at, ends_at, created_by)
    values ('مقترحات', 'name_proposals', now() - interval '1 hour', now() + interval '1 day', mgr) returning id into e;
  insert into election_sections (election_id, title, kind) values (e, 'اختر', 'single') returning id into s;
  insert into candidates (election_id, section_id, name) values (e, s, 'الأول');
  perform t.as_('service_role');
  assert submit_proposal(e, 'S1', 'اسم') ->> 'status' = 'closed', 'المسودة لا تقبل مقترحات';
  perform t.as_('authenticated', mgr);
  perform set_box_status(e, 'scheduled', 'مرحلة المقترحات');
  perform t.as_('service_role');
  assert submit_proposal(e, 'S1', 'نور') ->> 'status' = 'ok';
  assert submit_proposal(e, 'S2', '  نور ') ->> 'status' = 'duplicate', 'تكرار';
  assert submit_proposal(e, 'NOPE', 'جديد') ->> 'status' = 'not_allowed';
  assert submit_proposal(e, 'S2', 'x') ->> 'status' = 'invalid';
  assert submit_proposal(e, 'S1', 'اسم2') ->> 'status' = 'ok';
  assert submit_proposal(e, 'S1', 'اسم3') ->> 'status' = 'ok';
  assert submit_proposal(e, 'S1', 'اسم4') ->> 'status' = 'limit', 'حد 3 مقترحات';
  perform t.as_('anon');
  select count(*) into n from candidates where election_id = e; assert n = 1, 'المعلّقة لا تظهر للعامة: ' || n;
  perform t.as_('authenticated', mgr);
  select count(*) into n from pending_proposals(e); assert n = 3, 'المشرف يرى المعلّقة';
  perform t.as_('anon');
  perform t.err('select * from pending_proposals(''' || e || ''')', 'permission denied');
  perform t.as_('authenticated', mgr);
  perform t.err('select withdraw_candidate(''' || (select id from candidates where election_id = e and name = 'الأول') || ''', '''')', 'السبب إجباري');
  perform withdraw_candidate((select id from candidates where election_id = e and name = 'الأول'), 'انسحاب المرشح');
  assert (select status from candidates where election_id = e and name = 'الأول') = 'withdrawn', 'سحب';
end $$;
