import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { addAdmin, toggleAdmin } from "../actions";

export const dynamic = "force-dynamic";

/** إدارة المشرفين — للمالك فقط. الحساب يُنشأ أولاً في Supabase Auth ثم يُضاف هنا بمعرّفه (UUID). */
export default async function Admins({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { sb, isOwner } = await requireAdmin();
  if (!isOwner) redirect("/admin");
  const { error } = await searchParams;
  const { data: admins } = await sb.from("admin_users").select("user_id,display_name,is_owner,active").order("created_at");
  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm underline">← لوحة التحكم</Link>
      <h1 className="text-xl font-bold">المشرفون</h1>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      {admins?.map((a) => (
        <div key={a.user_id} className="card flex items-center justify-between gap-2">
          <div><b>{a.display_name ?? "—"}</b>{a.is_owner && " (المالك)"}<p className="break-all text-xs text-slate-500" dir="ltr">{a.user_id}</p></div>
          {!a.is_owner && (
            <form action={toggleAdmin}><input type="hidden" name="user_id" value={a.user_id} />
              <input type="hidden" name="active" value={a.active ? "no" : "yes"} />
              <button className="btn-ghost">{a.active ? "تعطيل" : "تفعيل"}</button></form>
          )}
        </div>
      ))}
      <form action={addAdmin} className="card space-y-2">
        <h2 className="font-semibold">إضافة مشرف</h2>
        <input name="user_id" required placeholder="UUID من Supabase Auth" className="input" dir="ltr" />
        <input name="name" required placeholder="الاسم" className="input" />
        <button className="btn-primary w-full">إضافة</button>
      </form>
    </div>
  );
}
