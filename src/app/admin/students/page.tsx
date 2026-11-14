import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { freezeStudent } from "../actions";
import StudentsImport from "./StudentsImport";

export const dynamic = "force-dynamic";

export default async function Students({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const { sb, has } = await requireAdmin();
  const { error, q } = await searchParams;
  if (!has("election_manager", "super_admin")) return <p className="card">غير مصرح.</p>;
  const [{ count }, { count: frozen }] = await Promise.all([
    sb.from("allowed_students").select("*", { count: "exact", head: true }),
    sb.from("allowed_students").select("*", { count: "exact", head: true }).eq("status", "frozen"),
  ]);
  // لا نعرض القائمة كاملة؛ بحث برقم محدد فقط (تقليل كشف البيانات)
  const found = q ? (await sb.from("allowed_students").select("university_id,full_name,status").eq("university_id", q.trim().toUpperCase())).data : null;
  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm underline">← لوحة التحكم</Link>
      <h1 className="text-xl font-bold">قائمة الطلاب</h1>
      <p className="text-sm text-slate-600">الإجمالي: {count ?? 0} · مجمّد: {frozen ?? 0}</p>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <StudentsImport />
      <form className="card space-y-2"><label className="label">بحث برقم جامعي</label>
        <input name="q" defaultValue={q} className="input" dir="ltr" /><button className="btn-ghost w-full">بحث</button></form>
      {found?.map((s) => (
        <form key={s.university_id} action={freezeStudent} className="card space-y-2">
          <p><b dir="ltr">{s.university_id}</b> {s.full_name} — {s.status === "active" ? "نشط" : "مجمّد"}</p>
          <input type="hidden" name="id" value={s.university_id} />
          <input type="hidden" name="status" value={s.status === "active" ? "frozen" : "active"} />
          <input name="reason" required minLength={3} placeholder="السبب" className="input" />
          <button className="btn-ghost w-full">{s.status === "active" ? "تجميد" : "تفعيل"}</button>
        </form>
      ))}
      {q && !found?.length && <p className="text-sm text-slate-600">لا نتيجة.</p>}
    </div>
  );
}
