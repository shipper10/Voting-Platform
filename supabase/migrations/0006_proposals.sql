-- 0006_proposals.sql — تقديم الطلاب مقترحات (اسم الدفعة) في مرحلة ما قبل الفتح (الخطة §6.2)
-- المقترح يدخل Pending ولا يظهر للعامة حتى يراجعه المشرف (review_proposal).

create function submit_proposal(p_election uuid, p_university_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e elections; v_name text := btrim(coalesce(p_name, '')); v_section uuid;
begin
  select * into e from elections where id = p_election;
  if not found or e.type <> 'name_proposals' or e.box_status <> 'scheduled' then
    return jsonb_build_object('status', 'closed');
  end if;
  if not exists (select 1 from allowed_students where university_id = p_university_id and status = 'active') then
    return jsonb_build_object('status', 'not_allowed');
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then return jsonb_build_object('status', 'invalid'); end if;
  select id into v_section from election_sections
    where election_id = p_election and kind in ('ranked', 'stars', 'single', 'multi') order by display_order, id limit 1;
  if v_section is null then return jsonb_build_object('status', 'closed'); end if;
  if (select count(*) from candidates where election_id = p_election and proposed_by = p_university_id) >= 3 then
    return jsonb_build_object('status', 'limit');
  end if;
  if exists (select 1 from candidates where section_id = v_section and lower(btrim(name)) = lower(v_name)
             and status in ('pending', 'approved')) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  insert into candidates (election_id, section_id, name, proposed_by, status)
  values (p_election, v_section, v_name, p_university_id, 'pending');
  return jsonb_build_object('status', 'ok');
end $$;

revoke all on function submit_proposal(uuid, text, text) from public, anon, authenticated;
grant execute on function submit_proposal(uuid, text, text) to service_role;

-- مقترحات بانتظار المراجعة مع مقدّمها (للمشرف فقط)
create function pending_proposals(p_election uuid) returns table (candidate_id uuid, name text, proposed_by text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return query select c.id, c.name, c.proposed_by from candidates c
    where c.election_id = p_election and c.status = 'pending' order by c.created_at;
end $$;
revoke all on function pending_proposals(uuid) from public, anon, authenticated;
grant execute on function pending_proposals(uuid) to authenticated;

-- سحب مرشح بعد بدء الإجراءات (لا حذف؛ يبقى صوته محفوظاً) مع سبب وتدقيق
create function withdraw_candidate(p_candidate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'السبب إجباري' using errcode = 'P0001'; end if;
  update candidates set status = 'withdrawn' where id = p_candidate and status = 'approved';
  if not found then raise exception 'لا يمكن سحب هذا المرشح' using errcode = 'P0001'; end if;
  perform log_admin('candidate:withdrawn', 'candidate', p_candidate::text, p_reason);
end $$;
revoke all on function withdraw_candidate(uuid, text) from public, anon, authenticated;
grant execute on function withdraw_candidate(uuid, text) to authenticated;
