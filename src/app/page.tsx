import Link from "next/link";
import { hasSupabaseEnv, supabaseServer } from "@/lib/supabase/server";
import { BOX_LABEL, PRIVACY_LABEL, TYPE_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!hasSupabaseEnv()) {
    return <p className="card">لم تُضبط متغيرات البيئة بعد. انظر ‎.env.example‎ و README.</p>;
  }
  const sb = await supabaseServer();
  const { data: elections } = await sb
    .from("elections")
    .select("id,title,type,box_status,results_status,privacy_level,starts_at,ends_at")
    .order("starts_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">انتخابات الدفعة</h1>
      {!elections?.length && <p className="card text-slate-600">لا توجد استحقاقات معلنة حالياً.</p>}
      {elections?.map((e) => (
        <div key={e.id} className="card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-semibold">{e.title}</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{BOX_LABEL[e.box_status]}</span>
          </div>
          <p className="text-sm text-slate-600">{TYPE_LABEL[e.type]} · {PRIVACY_LABEL[e.privacy_level]}</p>
          <p className="text-sm text-slate-600" dir="ltr" style={{ textAlign: "right" }}>
            {new Date(e.starts_at).toLocaleString("ar-SD")} → {new Date(e.ends_at).toLocaleString("ar-SD")}
          </p>
          <div className="flex gap-2">
            {e.box_status === "open" && <Link className="btn-primary flex-1" href={`/vote/${e.id}`}>صوّت الآن</Link>}
            {e.results_status === "published" && <Link className="btn-ghost flex-1" href={`/results/${e.id}`}>النتائج</Link>}
          </div>
        </div>
      ))}
      <p className="pt-4 text-center text-sm"><Link href="/admin" className="text-slate-500 underline">دخول اللجنة</Link></p>
    </div>
  );
}
