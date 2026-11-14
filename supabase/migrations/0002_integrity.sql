-- 0002_integrity.sql — قيود لا تكفيها CHECK العادية (الخطة §8.3)

-- 1) سجل التدقيق والنتائج المعتمدة: إضافة فقط
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'السجل % للإضافة فقط', tg_table_name using errcode = 'P0001';
end $$;

create trigger audit_append_only before update or delete on admin_audit_logs
  for each row execute function forbid_mutation();
create trigger revisions_append_only before update or delete on election_revisions
  for each row execute function forbid_mutation();
create trigger sheets_immutable before update or delete on ballot_sheets
  for each row execute function forbid_mutation();
create trigger choices_immutable before update or delete on ballot_choices
  for each row execute function forbid_mutation();
create trigger links_immutable before update or delete on ballot_identity_links
  for each row execute function forbid_mutation();
create trigger participation_immutable before update or delete on voter_participation
  for each row execute function forbid_mutation();

-- 2) لا إدخال أوراق إلا والصندوق مفتوح ضمن الوقت (وقت الخادم)
create function guard_ballot_insert() returns trigger language plpgsql as $$
declare e elections;
begin
  select * into e from elections where id = new.election_id;
  if e.box_status <> 'open' or now() < e.starts_at or now() > e.ends_at then
    raise exception 'الصندوق غير مفتوح' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sheets_guard before insert on ballot_sheets
  for each row execute function guard_ballot_insert();
create trigger choices_guard before insert on ballot_choices
  for each row execute function guard_ballot_insert();

-- 3) الربط بالهوية ممنوع نهائياً في السرية القوية
create function guard_identity_link() returns trigger language plpgsql as $$
begin
  if (select privacy_level from elections where id = new.election_id) <> 'restricted_administrative' then
    raise exception 'ممنوع تخزين ربط الهوية في السرية القوية' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger links_guard before insert on ballot_identity_links
  for each row execute function guard_identity_link();

-- 4) قفل إعدادات الانتخابات بعد الجدولة/البدء
create function guard_election_update() returns trigger language plpgsql as $$
begin
  if old.box_status <> 'draft' and (
       new.privacy_level   is distinct from old.privacy_level
    or new.type            is distinct from old.type
    or new.tie_policy      is distinct from old.tie_policy
    or new.conflict_policy is distinct from old.conflict_policy
    or new.starts_at       is distinct from old.starts_at and old.box_status <> 'scheduled'
    or new.ends_at         is distinct from old.ends_at   and old.box_status not in ('scheduled', 'paused')
  ) then
    raise exception 'إعدادات الانتخابات مقفلة بعد الاعتماد' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger elections_guard before update on elections
  for each row execute function guard_election_update();

create function guard_election_delete() returns trigger language plpgsql as $$
begin
  if old.box_status <> 'draft' then
    raise exception 'لا يُحذف إلا المسودات؛ استخدم الإلغاء' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger elections_no_delete before delete on elections
  for each row execute function guard_election_delete();

-- 5) قفل الأقسام والمرشحين بعد الخروج من المسودة
--    الاستثناء: انسحاب مرشح (withdrawn) وقرارات مراجعة المقترحات قبل الفتح
create function guard_children() returns trigger language plpgsql as $$
declare eid uuid; st box_status;
begin
  eid := coalesce(new.election_id, old.election_id);
  select box_status into st from elections where id = eid;
  if st = 'draft' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'candidates' and tg_op = 'UPDATE'
     and new.status = 'withdrawn'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  if tg_table_name = 'candidates' and tg_op = 'UPDATE' and st = 'scheduled'
     and old.status = 'pending' and new.status in ('approved', 'rejected') then
    return new;
  end if;
  if tg_table_name = 'candidates' and tg_op = 'INSERT' and st = 'scheduled'
     and new.status = 'pending' then
    return new;  -- مقترحات الطلاب تدخل Pending فقط
  end if;
  raise exception 'الأقسام والمرشحون مقفلون (حالة الصندوق: %)', st using errcode = 'P0001';
end $$;
create trigger sections_guard before insert or update or delete on election_sections
  for each row execute function guard_children();
create trigger candidates_guard before insert or update or delete on candidates
  for each row execute function guard_children();
