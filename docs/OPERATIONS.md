# التشغيل والإطلاق

## إعداد Supabase
1. أنشئ مشروعاً، ثم طبّق `supabase/migrations/*.sql` بالترتيب.
2. فعّل MFA (TOTP) في Auth. عطّل التسجيل الذاتي (Sign-ups).
3. أنشئ أول مشرف (SQL editor):
```sql
insert into admin_users (user_id, display_name, is_owner) values ('<auth user uuid>', 'الاسم', true);
```
4. لإضافة مشرف آخر لاحقاً: أنشئ حسابه في Supabase Auth، ثم من صفحة «المشرفين» (للمالك) أدخل UUID.

## Vercel
- متغيرات: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (سري)، `ADMIN_REQUIRE_MFA`.
- حدّ المعدل في الكود في الذاكرة فقط؛ للإنتاج أضف Vercel WAF/Upstash.
- لا تسجّل أجسام الطلبات في سجلات Vercel (تحوي الرقم الجامعي والاختيارات).

## قبل الإطلاق (§14)
- [ ] مراجعة قواعد الفرز واللائحة
- [ ] اختبار ضغط عند الإغلاق، واختبار استعادة نسخة احتياطية وإعادة الاحتساب
- [ ] اختبار على Telegram in-app browser وشبكات بطيئة وقارئ شاشة
- [ ] قرار مدة الاحتفاظ وسياسة شكاوى الانتحال
- [ ] انتخابات تجريبية ثم إطلاق تدريجي
