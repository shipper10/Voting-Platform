# التشغيل والإطلاق

## إعداد Supabase
1. أنشئ مشروعاً، ثم طبّق `supabase/migrations/*.sql` بالترتيب.
2. فعّل MFA (TOTP) في Auth. عطّل التسجيل الذاتي (Sign-ups).
3. أنشئ أول مشرف (SQL editor):
```sql
insert into admin_users (user_id, display_name) values ('<auth user uuid>', 'الاسم');
insert into admin_roles values ('<auth user uuid>', 'super_admin'), ('<auth user uuid>', 'election_manager');
```
4. بعد فصل الأدوار الحقيقي (مدير ≠ مسؤول نتائج ≠ معتمد خصوصية) وزّعها على أشخاص مختلفين.

## Vercel
- متغيرات: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (سري)، `ADMIN_REQUIRE_MFA`.
- حدّ المعدل في الكود في الذاكرة فقط؛ للإنتاج أضف Vercel WAF/Upstash.
- **السرية**: عطّل تسجيل جسم الطلبات، وقلّل مدة الاحتفاظ بسجلات Vercel/Supabase، وراجع `log_statement` (يجب أن يبقى `none`).

## الكشف الاستثنائي (سرية إدارية فقط)
`request_identity_access` ← موافقتان `decide_identity_access` ← `select * from reveal_identity_links('<request id>')` (جلسة صاحب الطلب).

## قبل الإطلاق (§14)
- [ ] مراجعة أمنية مستقلة لقواعد السرية والفرز
- [ ] اختبار ضغط عند الإغلاق، واختبار استعادة نسخة احتياطية وإعادة الاحتساب
- [ ] اختبار على Telegram in-app browser وشبكات بطيئة وقارئ شاشة
- [ ] قرار مدة الاحتفاظ وسياسة شكاوى الانتحال
- [ ] انتخابات تجريبية ثم إطلاق تدريجي
