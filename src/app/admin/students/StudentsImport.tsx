"use client";
import { useActionState, useState, useTransition } from "react";
import { importStudents, previewStudents } from "../actions";

export default function StudentsImport() {
  const [state, action, pending] = useActionState(previewStudents, {} as Awaited<ReturnType<typeof previewStudents>>);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const p = state.preview;
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">استيراد CSV</h2>
      <p className="text-xs text-slate-600">الأعمدة: university_id (أو «الرقم الجامعي»)، full_name، status (اختياري). الحد 1MB. ملفات XLSX: صدّرها CSV أولاً.</p>
      <form action={action} className="space-y-2">
        <input type="file" name="file" accept=".csv,text/csv" className="input" />
        <button className="btn-ghost w-full" disabled={pending}>{pending ? "…" : "معاينة"}</button>
      </form>
      {state.error && <p className="text-sm text-rose-700" role="alert">{state.error}</p>}
      {p && (
        <div className="space-y-2 text-sm">
          <p>صالح: <b>{p.valid.length}</b> · أخطاء: <b>{p.issues.length}</b> · مكرر داخل الملف: <b>{p.duplicates.length}</b></p>
          {[...p.issues, ...p.duplicates].slice(0, 20).map((i, k) => <p key={k} className="text-rose-700">سطر {i.line}: {i.reason} {i.raw ? `(${i.raw})` : ""}</p>)}
          <button className="btn-primary w-full" disabled={!p.valid.length || busy}
            onClick={() => start(async () => { const r = await importStudents(p.valid); setDone(r.error ? `خطأ: ${r.error}` : `تم: ${r.ok?.new} جديد، ${r.ok?.updated} محدّث`); })}>
            اعتماد استيراد {p.valid.length} رقم
          </button>
        </div>
      )}
      {done && <p className="text-sm text-emerald-700">{done}</p>}
    </div>
  );
}
