import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { BOX_LABEL, KIND_LABEL, PRIVACY_LABEL, RESULTS_LABEL, TYPE_LABEL } from "@/lib/labels";
import {
  addCandidate, addSection, changeStatus, computeResults, decideAccess, requestAccess, resultsStep, reviewProposal,
} from "../../actions";

export const dynamic = "force-dynamic";

const NEXT: Record<string, [string, string][]> = {
  draft: [["scheduled", "اعتماد وجدولة (يقفل الإعدادات)"], ["cancelled", "إلغاء"]],
  scheduled: [["open", "فتح الصندوق"], ["draft", "رجوع للمسودة"], ["cancelled", "إلغاء"]],
  open: [["paused", "إيقاف مؤقت"], ["closed", "إغلاق"], ["cancelled", "إلغاء"]],
  paused: [["open", "استئناف"], ["closed", "إغلاق"], ["cancelled", "إلغاء"]],
};

export default async function ElectionAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const { sb, has } = await requireAdmin();
  const { data: e } = await sb.from("elections").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: sections }, { data: cands }, { data: results }, { data: requests }, turnout] = await Promise.all([
    sb.from("election_sections").select("*").eq("election_id", id).order("display_order"),
    sb.from("candidates").select("id,section_id,name,status").eq("election_id", id).order("display_order"),
    sb.from("election_results").select("id,status,report_sha256,rules_version,created_at").eq("election_id", id).order("created_at", { ascending: false }),
    sb.from("identity_access_requests").select("id,reason,status,requested_by,created_at").eq("election_id", id).order("created_at", { ascending: false }),
    sb.rpc("election_turnout", { p_election: id }),
  ]);
  const t = turnout.data as { eligible: number; participated: number } | null;
  const editable = e.box_status === "draft";
  const mgr = has("election_manager", "super_admin");
  const pending = (cands ?? []).filter((c) => c.status === "pending");

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm underline">← لوحة التحكم</Link>
      <h1 className="text-xl font-bold">{e.title}</h1>
      <p className="text-sm text-slate-600">{TYPE_LABEL[e.type]} · {PRIVACY_LABEL[e.privacy_level]} · الصندوق: {BOX_LABEL[e.box_status]} · النتائج: {RESULTS_LABEL[e.results_status]}</p>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
      {t && <p className="card text-sm">المشاركة: <b>{t.participated}</b> من <b>{t.eligible}</b> مؤهل (أعداد فقط، بلا هويات)</p>}

      {mgr && NEXT[e.box_status] && (
        <section className="card space-y-2">
          <h2 className="font-semibold">التحكم</h2>
          {NEXT[e.box_status].map(([to, label]) => (
            <form key={to} action={changeStatus} className="flex gap-2">
              <input type="hidden" name="election_id" value={id} /><input type="hidden" name="to" value={to} />
              <input name="reason" required minLength={3} placeholder="السبب (إجباري)" className="input" />
              <button className={to === "cancelled" ? "btn-danger" : "btn-primary"}>{label}</button>
            </form>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">الأقسام والمرشحون</h2>
        {sections?.map((s) => (
          <div key={s.id} className="card space-y-2">
            <p><b>{s.title}</b> <span className="text-xs text-slate-500">{KIND_LABEL[s.kind]}{s.allow_abstain ? " · امتناع" : ""}{s.allow_other ? " · أخرى" : ""}</span></p>
            <ul className="text-sm">{cands?.filter((c) => c.section_id === s.id).map((c) => <li key={c.id}>{c.name} <span className="text-xs text-slate-500">({c.status})</span></li>)}</ul>
            {mgr && s.kind !== "yes_no" && (editable || e.box_status === "scheduled") && (
              <form action={addCandidate} className="flex gap-2">
                <input type="hidden" name="election_id" value={id} /><input type="hidden" name="section_id" value={s.id} />
                {!editable && <input type="hidden" name="status" value="pending" />}
                <input name="name" required placeholder="اسم المرشح/المقترح" className="input" />
                <button className="btn-ghost">إضافة</button>
              </form>
            )}
          </div>
        ))}
        {mgr && editable && (
          <form action={addSection} className="card space-y-2">
            <input type="hidden" name="election_id" value={id} />
            <input name="title" required placeholder="عنوان القسم" className="input" />
            <select name="kind" className="input">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <div className="grid grid-cols-3 gap-2">
              <input name="seats" type="number" min={1} placeholder="المقاعد" className="input" />
              <input name="min_choices" type="number" min={0} placeholder="أدنى" className="input" />
              <input name="max_choices" type="number" min={1} placeholder="أقصى" className="input" />
            </div>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="allow_abstain" /> السماح بالامتناع</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" name="allow_other" /> السماح بـ «أخرى»</label>
            <button className="btn-ghost w-full">إضافة قسم</button>
          </form>
        )}
      </section>

      {mgr && pending.length > 0 && (
        <section className="card space-y-2"><h2 className="font-semibold">مقترحات بانتظار المراجعة</h2>
          {pending.map((c) => (
            <form key={c.id} action={reviewProposal} className="flex flex-wrap gap-2">
              <input type="hidden" name="election_id" value={id} /><input type="hidden" name="candidate_id" value={c.id} />
              <span className="w-full">{c.name}</span>
              <input name="reason" required minLength={3} placeholder="السبب" className="input flex-1" />
              <button name="decision" value="approved" className="btn-primary">اعتماد</button>
              <button name="decision" value="rejected" className="btn-danger">رفض</button>
            </form>
          ))}
        </section>
      )}

      {e.box_status === "closed" && (
        <section className="card space-y-2">
          <h2 className="font-semibold">النتائج</h2>
          {has("results_officer") && !results?.some((r) => r.status !== "under_review") && (
            <form action={computeResults}><input type="hidden" name="election_id" value={id} /><button className="btn-primary w-full">احتساب النتائج من الأصوات الخام ورفعها للمراجعة</button></form>
          )}
          {results?.map((r) => (
            <div key={r.id} className="space-y-1 border-t pt-2 text-sm">
              <p>الحالة: {RESULTS_LABEL[r.status]} · قواعد v{r.rules_version}</p>
              <p className="break-all text-xs" dir="ltr">sha256 {r.report_sha256}</p>
              {mgr && r.status === "under_review" && <form action={resultsStep}><input type="hidden" name="election_id" value={id} /><input type="hidden" name="result_id" value={r.id} /><input type="hidden" name="step" value="approve" /><button className="btn-ghost">اعتماد (يلزم مشرف غير مُعِدّ النتائج)</button></form>}
              {mgr && r.status === "approved" && <form action={resultsStep}><input type="hidden" name="election_id" value={id} /><input type="hidden" name="result_id" value={r.id} /><input type="hidden" name="step" value="publish" /><button className="btn-primary">نشر</button></form>}
            </div>
          ))}
        </section>
      )}

      {e.privacy_level === "restricted_administrative" && (
        <section className="card space-y-2">
          <h2 className="font-semibold">وصول استثنائي للربط (موافقة شخصين)</h2>
          <form action={requestAccess} className="flex gap-2"><input type="hidden" name="election_id" value={id} />
            <input name="reason" required minLength={10} placeholder="السبب الموثق (10 أحرف+)" className="input" /><button className="btn-ghost">طلب</button></form>
          {requests?.map((r) => (
            <div key={r.id} className="border-t pt-2 text-sm"><p>{r.reason} — <b>{r.status}</b></p>
              {has("privacy_approver") && r.status === "pending" && (
                <form action={decideAccess} className="flex flex-wrap gap-2"><input type="hidden" name="election_id" value={id} /><input type="hidden" name="request_id" value={r.id} />
                  <input name="note" placeholder="ملاحظة" className="input flex-1" />
                  <button name="approve" value="yes" className="btn-primary">موافقة</button><button name="approve" value="no" className="btn-danger">رفض</button></form>)}
            </div>
          ))}
          <p className="text-xs text-slate-500">الكشف الفعلي يتم بدالة reveal_identity_links لصاحب الطلب بعد موافقتين (مرة واحدة، ومُدقَّق) — انظر docs/OPERATIONS.md.</p>
        </section>
      )}
    </div>
  );
}
