import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { BOX_LABEL, RESULTS_LABEL, TYPE_LABEL } from "@/lib/labels";
import { createElection, signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { sb, isOwner } = await requireAdmin();
  const { error } = await searchParams;
  const { data: elections } = await sb.from("elections").select("id,title,type,box_status,results_status,starts_at").order("created_at", { ascending: false });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">لوحة التحكم</h1>
        <form action={signOut}><button className="text-sm underline">خروج</button></form></div>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      <nav className="flex gap-2"><Link className="btn-ghost flex-1" href="/admin/students">قائمة الطلاب</Link>{isOwner && <Link className="btn-ghost flex-1" href="/admin/admins">المشرفون</Link>}</nav>

      {elections?.map((e) => (
        <Link key={e.id} href={`/admin/elections/${e.id}`} className="card block">
          <b>{e.title}</b>
          <p className="text-sm text-slate-600">{TYPE_LABEL[e.type]} · {BOX_LABEL[e.box_status]} · نتائج: {RESULTS_LABEL[e.results_status]}</p>
        </Link>
      ))}

      {(
        <form action={createElection} className="card space-y-3">
          <h2 className="font-semibold">انتخابات جديدة</h2>
          <input name="title" required placeholder="العنوان" className="input" />
          <select name="type" className="input"><option value="leadership">ليدر وأمانات</option><option value="name_proposals">اسم الدفعة والمقترحات</option><option value="referendum">استفتاء</option></select>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">البداية</label><input type="datetime-local" name="starts_at" required className="input" dir="ltr" /></div>
            <div><label className="label">النهاية</label><input type="datetime-local" name="ends_at" required className="input" dir="ltr" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">سياسة التعادل</label><select name="tie_policy" className="input"><option value="runoff">جولة إعادة</option><option value="declare_tie">إعلان التعادل</option></select></div>
            <div><label className="label">تعارض الرئيس/النائب</label><select name="conflict_policy" className="input"><option value="separate">فصل تام (الافتراضي)</option><option value="cumulative">جمع تراكمي</option></select></div>
          </div>
          <button className="btn-primary w-full">إنشاء مسودة</button>
        </form>
      )}
    </div>
  );
}
