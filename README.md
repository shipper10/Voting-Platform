# منصة انتخابات الدفعة — Batch Voting Platform V2

تنفيذ «الخطة الهندسية والتشغيلية النهائية V2»: ليدر وأمانات، اسم الدفعة والمقترحات، استفتاءات، جولات إعادة، بمستوى سرية يُحدَّد لكل انتخابات.

**التقنيات:** Next.js 15 + Tailwind + Supabase (PostgreSQL/Auth) + Vercel.

## ما الذي نُفِّذ
| المجال | المكان |
|---|---|
| المخطط، القيود، الأرشفة بدل الحذف | `supabase/migrations/0001–0002` |
| التصويت الذري + Idempotency + منع التكرار + وقت الخادم | `cast_ballot` في `0003` |
| سرية قوية / إدارية محدودة + الموافقة المزدوجة | `0002–0003` |
| RLS مغلق افتراضياً، الأدوار الخمسة | `0004` |
| استيراد الطلاب مع تدقيق | `0005` + `src/lib/csv.ts` |
| محرك الفرز (Top-2، رئيس/نائب، تعادل، بوردا، نجوم) | `src/lib/tally` |
| واجهة الطالب (جوال أولاً، RTL، مراجعة، إيصال) | `src/app/vote` |
| لوحة اللجنة (MFA، دورة الحياة، النتائج، الوصول الاستثنائي) | `src/app/admin` |

## التشغيل
```bash
cp .env.example .env.local      # املأ مفاتيح Supabase
npm install
# طبّق supabase/migrations/*.sql بالترتيب (Supabase CLI: supabase db push)
npm run dev
```
أول مشرف: أنشئ مستخدماً في Supabase Auth ثم أضف صفاً في `admin_users` و`admin_roles` (انظر `docs/OPERATIONS.md`).

## الاختبارات
```bash
npm test            # الفرز، CSV، الخلط، محدد المعدل
npm run test:db     # PostgreSQL مؤقت: الذرية، التزامن، السرية، RLS، الموافقة المزدوجة
npm run typecheck && npm run build
```

## الوثائق
- [`docs/PLAN_REVIEW.md`](docs/PLAN_REVIEW.md) — ملاحظات مراجعة الخطة
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — القرارات المفتوحة (§16) والقيم الافتراضية المختارة
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — نموذج التهديدات والمخاطر المتبقية
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — النشر والتشغيل والإطلاق

> لا تُطلق انتخابات حقيقية قبل مراجعة أمنية مستقلة واختبار ضغط (الخطة §14).
