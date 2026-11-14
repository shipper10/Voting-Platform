\set ON_ERROR_STOP on
-- ───── الكتلة 2: الإغلاق، RLS، تدفق النتائج ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; res uuid := '00000000-0000-0000-0000-00000000000b';
  e1 uuid := (select v::uuid from t.ctx where k = 'e1');
  n int; rid uuid; rows_ int;
begin
  perform t.as_('anon');
  perform t.err('select * from voter_participation', 'permission denied');
  perform t.err('select * from ballot_choices', 'permission denied');
  perform t.err('select * from ballot_sheets', 'permission denied');
  perform t.err('select * from allowed_students', 'permission denied');
  perform t.err('select cast_ballot(''' || e1 || ''', ''S5'', ''key-key-key-key-0040'', ''[]'')', 'permission denied');
  perform t.as_('authenticated', mgr);
  perform t.err('select * from ballot_choices', 'permission denied');
  perform t.err('select * from voter_participation', 'permission denied');
  perform t.err('select * from ballot_identity_links', 'permission denied');
  perform t.err('update elections set box_status = ''closed''', 'permission denied');
  perform t.err('select * from export_choices(''' || e1 || ''')', 'غير مصرح');
  select (election_turnout(e1) ->> 'participated')::int into n; assert n = 3, 'المشاركة: ' || n;
  perform set_box_status(e1, 'paused', 'إيقاف مؤقت');
  perform t.as_('service_role');
  assert cast_ballot(e1, 'S5', 'key-key-key-key-0041', '[]') ->> 'status' = 'closed', 'متوقف مؤقتاً';
  perform t.as_('authenticated', mgr);
  perform set_box_status(e1, 'open', 'استئناف');
  perform t.as_('authenticated', res);
  perform t.err('select * from export_choices(''' || e1 || ''')', 'بعد إغلاق');
  perform t.as_('authenticated', mgr);
  perform set_box_status(e1, 'closed', 'انتهى الوقت');
  perform t.as_('service_role');
  assert cast_ballot(e1, 'S5', 'key-key-key-key-0042', '[]') ->> 'status' = 'closed', 'بعد الإغلاق';
  perform t.as_('postgres');
  perform t.err('insert into ballot_sheets (election_id, receipt_hash) values (''' || e1 || ''', ''zz'')', 'الصندوق غير مفتوح');

  perform t.as_('authenticated', res);
  select count(*) into rows_ from export_choices(e1); assert rows_ = 9, 'عدد الصفوف: ' || rows_;
  rid := submit_results(e1, '{"sections": []}', 'v1');
  perform t.err('select approve_results(''' || rid || ''')', 'غير مصرح');
  perform t.as_('anon');
  select count(*) into n from election_results; assert n = 0, 'النتائج لا تظهر قبل النشر';
  perform t.as_('authenticated', mgr);
  perform t.err('select publish_results(''' || rid || ''')', 'غير معتمدة');
  perform approve_results(rid);
  perform publish_results(rid);
  perform t.as_('anon');
  select count(*) into n from election_results; assert n = 1, 'النتائج المنشورة تظهر للعامة';
  perform t.as_('postgres');
  select count(*) into n from admin_audit_logs where action like 'results:%'; assert n = 3, 'تدقيق النتائج';
  select count(*) into n from admin_audit_logs where action like 'box_status:%'; assert n >= 5, 'تدقيق الحالة';
end $$;

-- ───── الكتلة 3: السرية الإدارية والوصول الاستثنائي ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; ap1 uuid := '00000000-0000-0000-0000-00000000000c';
  ap2 uuid := '00000000-0000-0000-0000-00000000000d'; sup uuid := '00000000-0000-0000-0000-00000000000f';
  e uuid; s uuid; c1 uuid; c2 uuid; rq uuid; n int; strong uuid := (select v::uuid from t.ctx where k = 'e1');
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, privacy_level, starts_at, ends_at, created_by)
    values ('استفتاء إداري', 'referendum', 'restricted_administrative', now() - interval '1 hour', now() + interval '1 day', mgr) returning id into e;
  insert into election_sections (election_id, title, kind) values (e, 'هل توافق؟', 'yes_no') returning id into s;
  insert into candidates (election_id, section_id, name) values (e, s, 'نعم') returning id into c1;
  insert into candidates (election_id, section_id, name) values (e, s, 'لا') returning id into c2;
  perform set_box_status(e, 'scheduled', 'اعتماد'); perform set_box_status(e, 'open', 'فتح');
  perform t.as_('service_role');
  assert cast_ballot(e, 'S6', 'key-key-key-key-0050', jsonb_build_array(jsonb_build_object('section_id', s,
    'selections', jsonb_build_array(jsonb_build_object('candidate_id', c1))))) ->> 'status' = 'ok';
  assert cast_ballot(e, 'S7', 'key-key-key-key-0051', jsonb_build_array(jsonb_build_object('section_id', s,
    'selections', jsonb_build_array(jsonb_build_object('candidate_id', c1), jsonb_build_object('candidate_id', c2))))) ->> 'detail' = 'choice_count', 'نعم/لا اختيار واحد';
  perform t.as_('postgres');
  select count(*) into n from ballot_identity_links where election_id = e; assert n = 1, 'الربط محفوظ في السرية الإدارية';

  perform t.as_('authenticated', mgr);
  perform t.err('select request_identity_access(''' || strong || ''', ''سبب طويل كفاية'')', 'سرية قوية');
  perform t.as_('authenticated', sup);
  perform t.err('select request_identity_access(''' || strong || ''', ''سبب طويل كفاية'')', 'سرية قوية');

  perform t.as_('authenticated', mgr);
  perform t.err('select request_identity_access(''' || e || ''', ''قصير'')', 'violates check');
  rq := request_identity_access(e, 'شكوى موثقة رقم 12 عن تلاعب');
  perform t.err('select * from reveal_identity_links(''' || rq || ''')', 'لا موافقة مزدوجة');
  perform t.err('select decide_identity_access(''' || rq || ''', true, ''x'')', 'غير مصرح');
  perform t.as_('authenticated', ap1);
  perform decide_identity_access(rq, true, 'موافقة أولى');
  perform t.err('select decide_identity_access(''' || rq || ''', true, ''مكرر'')', 'duplicate key');
  perform t.as_('authenticated', mgr);
  perform t.err('select * from reveal_identity_links(''' || rq || ''')', 'لا موافقة مزدوجة');
  perform t.as_('authenticated', ap2);
  perform decide_identity_access(rq, true, 'موافقة ثانية');
  perform t.as_('authenticated', ap1);
  perform t.err('select * from reveal_identity_links(''' || rq || ''')', 'صاحب الطلب');
  perform t.as_('authenticated', mgr);
  select count(*) into n from reveal_identity_links(rq); assert n = 1, 'الكشف بعد موافقتين';
  perform t.err('select * from reveal_identity_links(''' || rq || ''')', 'لا موافقة مزدوجة');
  perform t.as_('postgres');
  select count(*) into n from admin_audit_logs where action = 'identity_access:revealed'; assert n = 1, 'كل كشف مُدقَّق';
  perform t.as_('authenticated', mgr);
  rq := request_identity_access(e, 'طلب آخر لاختبار الفصل');
  perform t.as_('postgres');
  insert into admin_roles values (mgr, 'privacy_approver');
  perform t.as_('authenticated', mgr);
  perform t.err('select decide_identity_access(''' || rq || ''', true, ''ذاتي'')', 'لا يوافق صاحب الطلب');
  perform t.as_('postgres');
  delete from admin_roles where user_id = mgr and role = 'privacy_approver';
end $$;

-- ───── الكتلة 4: الترتيب والنجوم وخيار "أخرى" ─────
do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a'; e uuid; sr uuid; ss uuid; so uuid;
  p1 uuid; p2 uuid; p3 uuid; q1 uuid; q2 uuid; o1 uuid; pend uuid;
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, privacy_level, starts_at, ends_at, created_by)
    values ('اسم الدفعة', 'name_proposals', 'strong_anonymous', now() - interval '1 hour', now() + interval '1 day', mgr) returning id into e;
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

-- ───── الكتلة 5: تهيئة اختبار التزامن والإغلاق بوقت الخادم ─────
do $$
declare mgr uuid := '00000000-0000-0000-0000-00000000000a'; e uuid; s uuid; c uuid; d uuid;
begin
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, privacy_level, starts_at, ends_at, created_by)
    values ('تزامن', 'referendum', 'strong_anonymous', now() - interval '1 hour', now() + interval '8 seconds', mgr) returning id into e;
  insert into election_sections (election_id, title, kind) values (e, 'سؤال', 'yes_no') returning id into s;
  insert into candidates (election_id, section_id, name) values (e, s, 'نعم') returning id into c;
  insert into candidates (election_id, section_id, name) values (e, s, 'لا') returning id into d;
  perform set_box_status(e, 'scheduled', 'اعتماد'); perform set_box_status(e, 'open', 'فتح');
  perform t.as_('postgres');
  insert into t.ctx values ('conc_e', e::text), ('conc_s', s::text), ('conc_c', c::text);
end $$;

-- ───── الكتلة 6: إدارة الطلاب ─────
do $$
declare mgr uuid := '00000000-0000-0000-0000-00000000000a'; aud uuid := '00000000-0000-0000-0000-00000000000e'; r jsonb; n int;
begin
  perform t.as_('authenticated', aud);
  perform t.err('select import_students(''[]'')', 'غير مصرح');
  perform t.err('insert into allowed_students (university_id) values (''HACK1'')', 'permission denied');
  perform t.as_('authenticated', mgr);
  r := import_students('[{"university_id":"N1","full_name":"أ","status":"active"},{"university_id":"S1","full_name":"محدّث","status":"active"}]');
  assert (r ->> 'new')::int = 1 and (r ->> 'updated')::int = 1, 'استيراد: ' || r::text;
  perform t.err('select set_student_status(''N1'', ''frozen'', '''')', 'غير صالحة');
  perform set_student_status('N1', 'frozen', 'سبب التجميد');
  perform t.as_('postgres');
  assert (select status from allowed_students where university_id = 'N1') = 'frozen';
  select count(*) into n from admin_audit_logs where action in ('students:import', 'student:frozen'); assert n = 2, 'تدقيق الطلاب';
end $$;
