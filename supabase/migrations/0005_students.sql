-- 0005_students.sql — إدارة قائمة الطلاب مع تدقيق (الخطة §13)

-- استيراد/تحديث دفعة طلاب: [{university_id, full_name, status}] — ذري ومُدقَّق
create function import_students(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new int; n_upd int;
begin
  perform require_role('election_manager', 'super_admin');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'مدخلات غير صالحة' using errcode = 'P0001';
  end if;
  select count(*) into n_new from jsonb_array_elements(p_rows) r
    where not exists (select 1 from allowed_students s where s.university_id = r ->> 'university_id');
  insert into allowed_students (university_id, full_name, status)
  select r ->> 'university_id', nullif(r ->> 'full_name', ''), coalesce(r ->> 'status', 'active')
  from jsonb_array_elements(p_rows) r
  on conflict (university_id) do update set full_name = excluded.full_name, status = excluded.status;
  n_upd := jsonb_array_length(p_rows) - n_new;
  perform log_admin('students:import', 'allowed_students', null, null, jsonb_build_object('new', n_new, 'updated', n_upd));
  return jsonb_build_object('new', n_new, 'updated', n_upd);
end $$;

-- تجميد/تفعيل رقم (مع سبب)
create function set_student_status(p_id text, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role('election_manager', 'super_admin');
  if p_status not in ('active', 'frozen') or p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'مدخلات غير صالحة' using errcode = 'P0001';
  end if;
  update allowed_students set status = p_status where university_id = p_id;
  if not found then raise exception 'رقم غير موجود' using errcode = 'P0001'; end if;
  perform log_admin('student:' || p_status, 'student', p_id, p_reason);
end $$;

revoke all on function import_students(jsonb), set_student_status(text, text, text) from public, anon;
grant execute on function import_students(jsonb), set_student_status(text, text, text) to authenticated;
