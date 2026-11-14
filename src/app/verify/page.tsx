import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** التحقق من أن إيصالاً مسجَّل (لا يكشف الاختيار ولا صاحبه) */
export default async function Verify({ searchParams }: { searchParams: Promise<{ e?: string; r?: string }> }) {
  const { e, r } = await searchParams;
  const sb = await supabaseServer();
  const { data: elections } = await sb.from("elections").select("id,title").in("box_status", ["open", "paused", "closed"]).order("starts_at", { ascending: false });
  let result: boolean | null = null;
  if (e && r) { const { data } = await sb.rpc("receipt_recorded", { p_election: e, p_receipt: r }); result = data === true; }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">التحقق من الإيصال</h1>
      <form className="card space-y-3">
        <select name="e" className="input" defaultValue={e}>{elections?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <input name="r" className="input" dir="ltr" placeholder="XXXX-XXXX-XXXX" defaultValue={r} />
        <button className="btn-primary w-full">تحقق</button>
      </form>
      {result !== null && <p className={`card ${result ? "text-emerald-700" : "text-rose-700"}`}>{result ? "الإيصال مسجَّل ✓" : "لا يوجد إيصال بهذه البيانات"}</p>}
      <Link href="/" className="btn-ghost w-full">رجوع</Link>
    </div>
  );
}
