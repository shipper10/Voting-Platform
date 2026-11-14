-- بيانات تجريبية للتجربة المحلية فقط (supabase db reset يحمّلها تلقائياً). لا تُشغَّل على الإنتاج.
insert into allowed_students (university_id, full_name)
select (1000 + g)::text, 'طالب تجريبي ' || g from generate_series(1, 30) g
on conflict do nothing;
