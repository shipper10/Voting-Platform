import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import type { TallyResult } from "@/lib/tally";
import { BOX_LABEL, KIND_LABEL, RESULTS_LABEL, TYPE_LABEL } from "@/lib/labels";
import {
  addCandidate, addIncident, addSection, changeStatus, computeResults, createRunoff, publishResults, reviewProposal, withdrawCandidate,
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
  const { sb } = await requireAdmin();
  const { data: e } = await sb.from("elections").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [{ data: sections }, { data: cands }, { data: results }, { data: pendingRows }, { data: incidents }, turnout] = await Promise.all([
    sb.from("election_sections").select("*").eq("election_id", id).order("display_order"),
    sb.from("candidates").select("id,section_id,name,status").eq("election_id", id).order("display_order"),
    sb.from("election_results").select("id,status,report_sha256,rules_version,result,created_at").eq("election_id", id).order("created_at", { ascending: false }),
    sb.rpc("pending_proposals", { p_election: id }),
    sb.from("incident_log").select("id,kind,description,created_at").eq("election_id", id).order("created_at", { ascending: false }),
    sb.rpc("election_turnout", { p_election: id }),
  ]);
  const t = turnout.data as { eligible: number; participated: number } | null;
  const editable = e.box_status === "draft";
  const mgr = true;
  const pending = (pendingRows ?? []) as { candidate_id: string; name: string; proposed_by: string | null }[];

  return (
    <div className="space-y-4">
      <Link href="/admin" className="text-sm underline">← لوحة التحكم</Link>
      <h1 className="text-xl font-bold">{e.title}</h1>
      <p className="text-sm text-slate-600">{TYPE_LABEL[e.type]} · الصندوق: {BOX_LABEL[e.box_status]} · النتائج: {RESULTS_LABEL[e.results_status]}</p>
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
            <ul className="text-sm">{cands?.filter((c) => c.section_id === s.id).map((c) => <li key={c.id} className="py-1">{c.name} <span className="text-xs text-slate-500">({c.status})</span>
              {!editable && c.status === "approved" && (
                <form action={withdrawCandidate} className="mt-1 flex gap-2"><input type="hidden" name="election_id" value={id} /><input type="hidden" name="candidate_id" value={c.id} />
                  <input name="reason" required minLength={3} placeholder="سبب السحب" className="input" /><button className="btn-danger">سحب</button></form>)}</li>)}</ul>
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
            <form key={c.candidate_id} action={reviewProposal} className="flex flex-wrap gap-2">
              <input type="hidden" name="election_id" value={id} /><input type="hidden" name="candidate_id" value={c.candidate_id} />
              <span className="w-full">{c.name} <span className="text-xs text-slate-500" dir="ltr">({c.proposed_by})</span></span>
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
          {results?.[0]?.status !== "published" && (
            <form action={computeResults}><input type="hidden" name="election_id" value={id} />
              <button className="btn-primary w-full">{results?.length ? "إعادة احتساب النتائج" : "احتساب النتائج من الأصوات الخام"}</button></form>
          )}
          {results?.map((r) => {
            const res = r.result as TallyResult;
            return (
              <div key={r.id} className="space-y-2 border-t pt-2 text-sm">
                <p>الحالة: {RESULTS_LABEL[r.status]} · أوراق: {res.totalBallots} · قواعد v{r.rules_version}</p>
                <p className="break-all text-xs" dir="ltr">sha256 {r.report_sha256}</p>
                {res.sections.map((sec) => (
                  <div key={sec.sectionId} className="rounded-xl bg-slate-50 p-2">
                    <b>{sec.title}</b>: {sec.winners.map((w) => `${w.position === "president" ? "الرئيس " : w.position === "vice" ? "النائب " : ""}${w.name}`).join("، ") || "—"}
                    {sec.tie && (
                      <form action={createRunoff} className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-2">
                        <p>تعادل بين: {sec.tie.candidateIds.map((cid) => cands?.find((c) => c.id === cid)?.name).join("، ")} (مقاعد: {sec.tie.seatsAtStake})</p>
                        <input type="hidden" name="election_id" value={id} /><input type="hidden" name="section_id" value={sec.sectionId} />
                        <input type="hidden" name="candidate_ids" value={sec.tie.candidateIds.join(",")} /><input type="hidden" name="seats" value={sec.tie.seatsAtStake} />
                        <input name="reason" required minLength={3} placeholder="سبب الإعادة" className="input" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="datetime-local" name="starts_at" required className="input" dir="ltr" />
                          <input type="datetime-local" name="ends_at" required className="input" dir="ltr" />
                        </div>
                        <button className="btn-ghost w-full">إنشاء جولة إعادة (مسودة)</button>
                      </form>
                    )}
                  </div>
                ))}
                {r.status === "under_review" && <form action={publishResults}><input type="hidden" name="election_id" value={id} /><input type="hidden" name="result_id" value={r.id} /><button className="btn-primary w-full">نشر النتائج</button></form>}
              </div>
            );
          })}
        </section>
      )}
      {results?.length ? <a className="btn-ghost w-full" href={`/admin/elections/${id}/export`}>تنزيل تقرير النتائج (CSV/Excel)</a> : null}

      <section className="card space-y-2">
        <h2 className="font-semibold">سجل الحوادث</h2>
        {incidents?.map((i) => <p key={i.id} className="text-sm"><b>{i.kind}</b>: {i.description}</p>)}
        <form action={addIncident} className="space-y-2"><input type="hidden" name="election_id" value={id} />
          <select name="kind" className="input"><option value="outage">انقطاع خدمة</option><option value="technical_error">خطأ تقني</option><option value="complaint">شكوى</option><option value="impersonation_report">بلاغ انتحال</option><option value="procedural_correction">تصحيح إجرائي</option></select>
          <input name="description" required minLength={3} placeholder="الوصف" className="input" /><button className="btn-ghost w-full">تسجيل</button></form>
      </section>
    </div>
  );
}
