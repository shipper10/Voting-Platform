# منصة انتخابات الدفعة — Batch Voting Platform V2

تنفيذ «الخطة الهندسية والتشغيلية النهائية V2»: ليدر وأمانات، اسم الدفعة والمقترحات، استفتاءات، وجولات إعادة. **التصويت غير مجهول** (مرتبط بالرقم الجامعي) ويُعلَن ذلك للناخب، والإدارة بمشرف واحد غالباً.

**التقنيات:** Next.js 15 + Tailwind + Supabase (PostgreSQL/Auth) + Vercel.

## ما الذي نُفِّذ
| المجال | المكان |
|---|---|
| المخطط، القيود، الأرشفة بدل الحذف | `supabase/migrations/0001–0002` |
| التصويت الذري + Idempotency + منع التكرار + وقت الخادم | `cast_ballot` في `0003` |
| مشرف واحد (المالك) + إمكانية إضافة مشرفين بصلاحيات متساوية | `0003` + `/admin/admins` |
| مقترحات الطلاب (اسم الدفعة) + مراجعة المشرف | `0006` + `/propose/[id]` |
| تحقق الإيصال، تقرير CSV/Excel، سجل الحوادث، سحب مرشح | `/verify`، `/admin/elections/[id]` |
| جولة إعادة لقسم تعادل (لا تُنقل الأصوات) | `create_runoff` + لوحة النتائج |
| RLS مغلق افتراضياً | `0004` |
| استيراد الطلاب مع تدقيق | `0005` + `src/lib/csv.ts` |
| محرك الفرز (Top-2، رئيس/نائب، تعادل، بوردا، نجوم) | `src/lib/tally` |
| واجهة الطالب (جوال أولاً، RTL، مراجعة، إيصال) | `src/app/vote` |
| لوحة اللجنة (MFA، دورة الحياة، النتائج، جولات الإعادة، المشرفون) | `src/app/admin` |

## التشغيل
```bash
cp .env.example .env.local      # املأ مفاتيح Supabase
npm install
# طبّق supabase/migrations/*.sql بالترتيب (Supabase CLI: supabase db push)
npm run dev
```
أول مشرف: أنشئ مستخدماً في Supabase Auth ثم أضف صفاً في `admin_users` و`admin_roles` (انظر `docs/OPERATIONS.md`).

## تجربة محلية سريعة
`supabase/seed.sql` يضيف 30 طالباً تجريبياً (1001–1030) عند `supabase db reset`.

## الاختبارات
```bash
npm test            # الفرز، CSV، الخلط، محدد المعدل
npm run test:db     # PostgreSQL مؤقت: الذرية، التزامن، RLS، المشرفون، جولة الإعادة
npm run typecheck && npm run build
```

## الوثائق
- [`docs/PLAN_REVIEW.md`](docs/PLAN_REVIEW.md) — ملاحظات مراجعة الخطة
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — القرارات المفتوحة (§16) والقيم الافتراضية المختارة
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — نموذج التهديدات والمخاطر المتبقية
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — النشر والتشغيل والإطلاق

> لا تُطلق انتخابات حقيقية قبل مراجعة أمنية مستقلة واختبار ضغط (الخطة §14).
