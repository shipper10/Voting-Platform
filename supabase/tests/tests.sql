-- اختبارات قاعدة البيانات — معايير القبول §14. تُشغَّل ضمن معاملة واحدة ثم تُثبَّت بيانات الاختبارات التزامنية.
\set ON_ERROR_STOP on

create schema t;
create function t.as_(r text, uid uuid default null) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  if r <> 'postgres' then execute format('set local role %I', r); end if;
end $$;
-- يتوقع فشل الاستعلام ويحوي رسالته الجزء frag
create function t.err(q text, frag text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%' || frag || '%' then return; end if;
    raise exception 'خطأ غير متوقع لـ [%]: % (المطلوب: %)', q, sqlerrm, frag;
  end;
  raise exception 'كان يجب أن يفشل: %', q;
end $$;
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

create table t.ctx (k text primary key, v text);

do $$
declare
  mgr uuid := '00000000-0000-0000-0000-00000000000a';
  res uuid := '00000000-0000-0000-0000-00000000000b';
  ap1 uuid := '00000000-0000-0000-0000-00000000000c';
  ap2 uuid := '00000000-0000-0000-0000-00000000000d';
  aud uuid := '00000000-0000-0000-0000-00000000000e';
  sup uuid := '00000000-0000-0000-0000-00000000000f';
  e1 uuid; e2 uuid; sa uuid; sb uuid; pres uuid; c1 uuid; c2 uuid; c3 uuid; b1 uuid; b2 uuid; b3 uuid;
  r jsonb; ch jsonb; n int; rid uuid; rq uuid; sec_rank uuid; sec_star uuid; e3 uuid; p1 uuid; p2 uuid; p3 uuid;
begin
  -- ───── إعداد ─────
  insert into auth.users (id) values (mgr), (res), (ap1), (ap2), (aud), (sup);
  -- مالك واحد (mgr) + مشرف آخر (aud)؛ بقية المستخدمين ليسوا مشرفين
  insert into admin_users (user_id, display_name, is_owner) values (mgr, 'owner', true), (aud, 'second', false);
  insert into allowed_students (university_id) select 'S' || g from generate_series(1, 9) g;
  insert into allowed_students (university_id, status) values ('FROZEN1', 'frozen');

  -- ───── المدير ينشئ انتخابات سرية قوية ─────
  perform t.as_('authenticated', mgr);
  insert into elections (title, type, starts_at, ends_at, created_by)
    values ('ليدر', 'leadership', now() - interval '1 hour', now() + interval '1 day', mgr) returning id into e1;
  insert into election_sections (election_id, title, kind, display_order) values (e1, 'الرئيس والنائب', 'explicit_roles', 1) returning id into sa;
  insert into election_sections (election_id, title, kind, allow_abstain, seats, max_choices) values (e1, 'الأمانة المالية', 'top_n', true, 2, 1) returning id into sb;
  insert into candidates (election_id, section_id, name) values (e1, sa, 'أ') returning id into c1;
  insert into candidates (election_id, section_id, name) values (e1, sa, 'ب') returning id into c2;
  insert into candidates (election_id, section_id, name) values (e1, sa, 'ج') returning id into c3;
  insert into candidates (election_id, section_id, name) values (e1, sb, 'د') returning id into b1;
  insert into candidates (election_id, section_id, name) values (e1, sb, 'هـ') returning id into b2;

  -- قبل الفتح: الصندوق مغلق، والمسودة غير ظاهرة للعامة
  perform t.as_('service_role');
  r := cast_ballot(e1, 'S1', 'key-key-key-key-0001', '[]');
  assert r ->> 'status' = 'closed', 'قبل الفتح يجب أن يرفض';
  perform t.as_('anon');
  select count(*) into n from elections; assert n = 0, 'المسودة يجب ألا تظهر للعامة';

  perform t.as_('authenticated', mgr);
  perform set_box_status(e1, 'scheduled', 'اعتماد');
  select count(*) into n from election_revisions where election_id = e1; assert n = 1, 'لقطة إعدادات';
  perform t.err($q$update elections set tie_policy = 'declare_tie' where id = $q$ || quote_literal(e1), 'مقفلة');
  perform t.err($q$insert into candidates (election_id, section_id, name) values ('$q$ || e1 || $q$', '$q$ || sa || $q$', 'متأخر')$q$, 'مقفلون');
  perform t.err($q$delete from candidates where id = '$q$ || c1 || $q$'$q$, 'مقفلون');
  perform t.err($q$select set_box_status('$q$ || e1 || $q$', 'closed', 'x')$q$, 'السبب إجباري');
  perform t.err($q$select set_box_status('$q$ || e1 || $q$', 'closed', 'سبب كافٍ')$q$, 'انتقال غير مسموح');
  perform set_box_status(e1, 'open', 'فتح الصندوق');

  -- ───── تصويت صحيح ─────
  perform t.as_('service_role');
  ch := jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', c2, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'abstain', true));
  r := cast_ballot(e1, 'S1', 'key-key-key-key-0001', ch);
  assert r ->> 'status' = 'ok' and r ->> 'receipt' ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$', 'تصويت صحيح: ' || r::text;
  -- نفس المفتاح = إعادة محاولة: لا إيصال ولا ورقة جديدة
  r := cast_ballot(e1, 'S1', 'key-key-key-key-0001', ch);
  assert r ->> 'status' = 'already_recorded' and not r ? 'receipt', 'إعادة المحاولة';
  -- مفتاح مختلف = رسالة عامة (لا كشف أن الرقم صوّت)
  r := cast_ballot(e1, 'S1', 'key-key-key-key-0002', ch);
  assert r ->> 'status' = 'not_allowed', 'تكرار بمفتاح مختلف';
  assert cast_ballot(e1, 'NOPE', 'key-key-key-key-0003', ch) ->> 'status' = 'not_allowed', 'رقم غير موجود';
  assert cast_ballot(e1, 'FROZEN1', 'key-key-key-key-0004', ch) ->> 'status' = 'not_allowed', 'رقم مجمّد';
  assert cast_ballot(e1, 'S2', 'short', ch) ->> 'status' = 'invalid_ballot', 'مفتاح قصير';
  perform t.as_('postgres');
  select count(*) into n from voter_participation where election_id = e1; assert n = 1, 'مشاركة واحدة';
  select count(*) into n from ballot_sheets where election_id = e1; assert n = 1, 'ورقة واحدة';
  select count(*) into n from ballot_choices where election_id = e1; assert n = 3, 'صفوف الاختيار: ' || n;
  assert (select university_id from ballot_sheets where election_id = e1) = 'S1', 'الورقة مرتبطة بالرقم';

  -- ───── أوراق غير صالحة ─────
  perform t.as_('service_role');
  assert cast_ballot(e1, 'S2', 'key-key-key-key-0010', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', c1, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'abstain', true))) ->> 'detail' = 'duplicate_candidate', 'نفس المرشح للمنصبين';
  assert cast_ballot(e1, 'S2', 'key-key-key-key-0011', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'abstain', true),
    jsonb_build_object('section_id', sb, 'abstain', true))) ->> 'detail' = 'abstain_not_allowed', 'امتناع غير مسموح';
  assert cast_ballot(e1, 'S2', 'key-key-key-key-0012', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', b1, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'abstain', true))) ->> 'detail' = 'invalid_candidate', 'مرشح من قسم آخر';
  assert cast_ballot(e1, 'S2', 'key-key-key-key-0013', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', c2, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', b1), jsonb_build_object('candidate_id', b2))))) ->> 'detail' = 'choice_count', 'أكثر من المسموح';
  assert cast_ballot(e1, 'S2', 'key-key-key-key-0014', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', c1, 'role', 'president')))))
    ->> 'detail' = 'ballot_sections', 'قسم ناقص';
  perform t.as_('postgres');
  select count(*) into n from voter_participation where election_id = e1; assert n = 1, 'الأوراق الباطلة لا تُسجّل مشاركة';

  -- ───── الذرية: فشل أثناء إدراج الاختيارات لا يترك مشاركة ─────
  create function t.boom() returns trigger language plpgsql as $f$ begin
    if new.candidate_id = (select v::uuid from t.ctx where k = 'boom') then raise exception 'boom'; end if; return new; end $f$;
  insert into t.ctx values ('boom', b1::text);
  create trigger zz_boom before insert on ballot_choices for each row execute function t.boom();
  perform t.as_('service_role');
  begin
    perform cast_ballot(e1, 'S3', 'key-key-key-key-0020', jsonb_build_array(
      jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
        jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', c3, 'role', 'vice'))),
      jsonb_build_object('section_id', sb, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', b1)))));
    raise exception 'كان يجب أن يفشل';
  exception when others then
    assert sqlerrm = 'boom', 'خطأ متوقع boom: ' || sqlerrm;
  end;
  perform t.as_('postgres');
  select count(*) into n from voter_participation where election_id = e1 and university_id = 'S3'; assert n = 0, 'الذرية: لا مشاركة بلا ورقة';
  select count(*) into n from ballot_sheets where election_id = e1; assert n = 1, 'الذرية: لا ورقة يتيمة';
  drop trigger zz_boom on ballot_choices;

  -- ───── أصوات إضافية لاختبار الفرز لاحقاً ─────
  perform t.as_('service_role');
  perform cast_ballot(e1, 'S3', 'key-key-key-key-0030', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c2, 'role', 'president'), jsonb_build_object('candidate_id', c1, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', b1)))));
  assert cast_ballot(e1, 'S4', 'key-key-key-key-0031', jsonb_build_array(
    jsonb_build_object('section_id', sa, 'selections', jsonb_build_array(
      jsonb_build_object('candidate_id', c1, 'role', 'president'), jsonb_build_object('candidate_id', c3, 'role', 'vice'))),
    jsonb_build_object('section_id', sb, 'selections', jsonb_build_array(jsonb_build_object('candidate_id', b2))))) ->> 'status' = 'ok';

  -- ───── عدم قابلية التعديل ─────
  perform t.as_('postgres');
  perform t.err('update ballot_choices set rating = 1', 'للإضافة فقط');
  perform t.err('delete from ballot_sheets', 'للإضافة فقط');
  perform t.err('delete from voter_participation', 'للإضافة فقط');
  perform t.err('update admin_audit_logs set reason = null', 'للإضافة فقط');
  insert into t.ctx values ('e1', e1::text), ('sa', sa::text), ('sb', sb::text), ('c1', c1::text), ('c2', c2::text),
    ('c3', c3::text), ('b1', b1::text), ('b2', b2::text);
end $$;
