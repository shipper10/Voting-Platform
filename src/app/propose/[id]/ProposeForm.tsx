"use client";
import { useState } from "react";

const MSG: Record<string, string> = {
  ok: "تم استلام مقترحك وسيُراجَع قبل عرضه ✓",
  duplicate: "هذا الاسم مقترح بالفعل.",
  limit: "بلغت الحد الأقصى (3 مقترحات).",
  closed: "باب المقترحات مغلق.",
  not_allowed: "تعذّر قبول المشاركة بهذه البيانات.",
  invalid: "الاسم قصير أو طويل جداً.",
};

export default function ProposeForm({ electionId }: { electionId: string }) {
  const [uid, setUid] = useState(""); const [name, setName] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ electionId, universityId: uid, name }) });
      const j = await r.json().catch(() => ({}));
      const key = j.status ?? j.error;
      setMsg(MSG[key] ?? "تعذّر الإرسال، أعد المحاولة."); if (key === "ok") setName("");
    } catch { setMsg("تعذّر الاتصال، أعد المحاولة."); }
    setBusy(false);
  }
  return (
    <form onSubmit={send} className="card space-y-3">
      <div><label className="label" htmlFor="uid">الرقم الجامعي</label><input id="uid" className="input" dir="ltr" inputMode="numeric" value={uid} onChange={(e) => setUid(e.target.value)} required /></div>
      <div><label className="label" htmlFor="nm">اسمك المقترح</label><input id="nm" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required /></div>
      {msg && <p className="rounded-xl bg-slate-100 p-3 text-sm" role="status">{msg}</p>}
      <button className="btn-primary w-full" disabled={busy}>إرسال المقترح</button>
    </form>
  );
}
