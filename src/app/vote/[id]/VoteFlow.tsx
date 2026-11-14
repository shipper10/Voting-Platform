"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { seededShuffle } from "@/lib/shuffle";
import { NOT_ANONYMOUS_NOTICE, VOTE_ERRORS } from "@/lib/labels";

type Cand = { id: string; name: string; bio: string | null; image_url: string | null };
type Section = {
  id: string; title: string; kind: string; allow_abstain: boolean; allow_other: boolean;
  min_choices: number; max_choices: number | null; seats: number; candidates: Cand[];
};
export type VoteElection = {
  id: string; title: string; description: string | null; sections: Section[];
};
type Sel = { candidate_id: string; role?: "president" | "vice"; rating?: number; rank?: number };
type Answer = { abstain: boolean; selections: Sel[]; other: string };
type Phase = "intro" | "section" | "review" | "sending" | "done" | "recorded";

const safe = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

const emptyAnswer = (): Answer => ({ abstain: false, selections: [], other: "" });

/** يتحقق في الواجهة فقط لتحسين التجربة — المرجع الوحيد هو الخادم/قاعدة البيانات */
function sectionError(s: Section, a: Answer): string | null {
  if (a.abstain) return null;
  const n = a.selections.length;
  const extra = a.other.trim() ? 1 : 0;
  switch (s.kind) {
    case "explicit_roles":
      return a.selections.some((x) => x.role === "president") && a.selections.some((x) => x.role === "vice") ? null : "اختر الرئيس والنائب";
    case "single": case "yes_no": return n + extra === 1 ? null : "اختر خياراً واحداً";
    case "top_n": case "multi":
      if (n + extra < s.min_choices) return `اختر ${s.min_choices} على الأقل`;
      if (n > (s.max_choices ?? s.seats)) return "تجاوزت الحد الأقصى";
      return null;
    case "ranked": return n >= Math.max(1, s.min_choices) ? null : "رتّب خياراً واحداً على الأقل";
    case "stars": return n >= Math.max(1, s.min_choices) ? null : "قيّم خياراً واحداً على الأقل";
  }
  return null;
}

export default function VoteFlow({ election }: { election: VoteElection }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [idx, setIdx] = useState(0);
  const [uid, setUid] = useState("");
  const [pledge, setPledge] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  const draftKey = `draft:${election.id}`;

  // بذرة الخلط ومسودة الاختيارات (في الجلسة فقط؛ لا تُرسل ولا تُسجَّل كأصوات ولا تحوي الرقم الجامعي)
  useEffect(() => {
    let s = safe.get(`seed:${election.id}`);
    if (!s) { s = rid(); safe.set(`seed:${election.id}`, s); }
    setSeed(s);
    const d = safe.get(draftKey);
    if (d) { try { setAnswers(JSON.parse(d)); } catch { /* ignore */ } }
  }, [election.id, draftKey]);
  useEffect(() => { if (phase !== "done") safe.set(draftKey, JSON.stringify(answers)); }, [answers, draftKey, phase]);

  const sections = useMemo(
    () => election.sections.map((s) => ({ ...s, candidates: seededShuffle(s.candidates, `${seed}:${s.id}`) })),
    [election.sections, seed],
  );
  const sec = sections[idx];
  const ans = (id: string) => answers[id] ?? emptyAnswer();
  const set = (id: string, fn: (a: Answer) => Answer) => setAnswers((p) => ({ ...p, [id]: fn(p[id] ?? emptyAnswer()) }));

  const unitIdOk = uid.trim().length >= 2;

  async function submit() {
    setPhase("sending"); setError(null);
    let key = safe.get(`idem:${election.id}`);
    if (!key) { key = rid() + rid(); safe.set(`idem:${election.id}`, key); }
    const choices = sections.map((s) => {
      const a = ans(s.id);
      return a.abstain
        ? { section_id: s.id, abstain: true, selections: [] }
        : { section_id: s.id, selections: a.selections.map((x) => ({ candidate_id: x.candidate_id, role: x.role, rating: x.rating, rank: x.rank })),
            ...(a.other.trim() ? { other_text: a.other.trim() } : {}) };
    });
    try {
      const res = await fetch("/api/vote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electionId: election.id, universityId: uid, idempotencyKey: key, choices }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.status === "ok") {
        setReceipt(j.receipt); safe.del(draftKey); safe.del(`idem:${election.id}`); safe.del(`seed:${election.id}`); setUid(""); setPhase("done");
      } else if (res.ok && j.status === "already_recorded") {
        safe.del(draftKey); safe.del(`idem:${election.id}`); setUid(""); setPhase("recorded");
      } else {
        // أخطاء قطعية (ليست شبكة): نبدّل المفتاح لأن الطلب لم يُقبل
        if (res.status !== 500) safe.del(`idem:${election.id}`);
        setError(VOTE_ERRORS[j.error as string] ?? VOTE_ERRORS.server); setPhase("review");
      }
    } catch {
      // انقطاع شبكة: نُبقي المفتاح نفسه لإعادة المحاولة بأمان، ولا نُعلن نجاحاً
      setError("تعذّر الاتصال بالخادم. لم نتأكد من تسجيل صوتك؛ أعد المحاولة (لن يُحتسب صوتك مرتين)."); setPhase("review");
    }
  }

  if (phase === "done") {
    return (
      <div className="card space-y-4 text-center">
        <h1 className="text-2xl font-bold text-emerald-700">تم تسجيل صوتك ✓</h1>
        <p>احتفظ بإيصالك. يظهر هذه المرة فقط ولا يكشف اختيارك.</p>
        <p className="select-all rounded-xl bg-slate-100 py-4 text-3xl font-mono tracking-widest" dir="ltr">{receipt}</p>
        <button className="btn-ghost w-full" onClick={() => receipt && navigator.clipboard?.writeText(receipt)}>نسخ الإيصال</button>
        <Link href="/" className="btn-primary w-full">العودة للرئيسية</Link>
      </div>
    );
  }
  if (phase === "recorded") {
    return (
      <div className="card space-y-4 text-center">
        <h1 className="text-2xl font-bold text-emerald-700">صوتك مسجَّل ✓</h1>
        <p>تأكّد الخادم من تسجيل صوتك في المحاولة السابقة. لا يمكن عرض الإيصال مرة ثانية.</p>
        <Link href="/" className="btn-primary w-full">العودة للرئيسية</Link>
      </div>
    );
  }

  const total = sections.length;
  const progress = phase === "intro" ? 0 : phase === "section" ? idx + 1 : total + 1;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-xl font-bold">{election.title}</h1>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={total + 1} aria-valuenow={progress}>
          <div className="h-full bg-indigo-700 transition-all" style={{ width: `${(progress / (total + 1)) * 100}%` }} />
        </div>
        {phase === "section" && <p className="text-sm text-slate-600">القسم {idx + 1} من {total}</p>}
      </header>

      {phase === "intro" && (
        <div className="card space-y-4">
          {election.description && <p>{election.description}</p>}
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{NOT_ANONYMOUS_NOTICE}</p>
          <div>
            <label className="label" htmlFor="uid">الرقم الجامعي</label>
            <input id="uid" className="input" inputMode="numeric" autoComplete="off" dir="ltr" value={uid} onChange={(e) => setUid(e.target.value)} />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={pledge} onChange={(e) => setPledge(e.target.checked)} />
            <span>أقرّ بأن الرقم الجامعي المُدخل رقمي أنا، وأنني لم أصوّت من قبل في هذا الاستحقاق.</span>
          </label>
          <button className="btn-primary w-full" disabled={!pledge || !unitIdOk} onClick={() => { setIdx(0); setPhase("section"); }}>ابدأ</button>
        </div>
      )}

      {phase === "section" && sec && (
        <div className="space-y-3">
          <SectionView s={sec} a={ans(sec.id)} onChange={(fn) => set(sec.id, fn)} />
          {sectionError(sec, ans(sec.id)) && <p className="text-sm text-rose-700" role="alert">{sectionError(sec, ans(sec.id))}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => (idx === 0 ? setPhase("intro") : setIdx(idx - 1))}>السابق</button>
            <button className="btn-primary flex-1" disabled={!!sectionError(sec, ans(sec.id))}
              onClick={() => (idx === total - 1 ? setPhase("review") : setIdx(idx + 1))}>
              {idx === total - 1 ? "مراجعة" : "التالي"}
            </button>
          </div>
        </div>
      )}

      {(phase === "review" || phase === "sending") && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">مراجعة اختياراتك</h2>
          {sections.map((s, i) => {
            const a = ans(s.id);
            const name = (id: string) => s.candidates.find((c) => c.id === id)?.name ?? "";
            return (
              <div key={s.id} className="card">
                <div className="flex items-center justify-between"><b>{s.title}</b>
                  <button className="text-sm text-indigo-700 underline" onClick={() => { setIdx(i); setPhase("section"); }}>تعديل</button></div>
                <ul className="mt-2 space-y-1 text-sm">
                  {a.abstain && <li>امتناع</li>}
                  {!a.abstain && [...a.selections].sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0)).map((x) => (
                    <li key={x.candidate_id + (x.role ?? "")}>
                      {x.role === "president" ? "الرئيس: " : x.role === "vice" ? "النائب: " : x.rank ? `${x.rank}. ` : ""}{name(x.candidate_id)}{x.rating ? ` — ${x.rating}★` : ""}
                    </li>
                  ))}
                  {!a.abstain && a.other.trim() && <li>أخرى: {a.other.trim()}</li>}
                </ul>
              </div>
            );
          })}
          {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
          <button className="btn-primary w-full" disabled={phase === "sending"} onClick={submit}>
            {phase === "sending" ? "جارٍ الإرسال…" : "تأكيد وإرسال الصوت"}
          </button>
          <p className="text-center text-xs text-slate-500">لن يُعلن النجاح إلا بعد تأكيد الخادم. بعد الإرسال لا يمكن التعديل.</p>
        </div>
      )}
    </div>
  );
}

function CandidateCard({ c, children, selected }: { c: Cand; children?: React.ReactNode; selected?: boolean }) {
  return (
    <div className={`card flex items-center gap-3 ${selected ? "border-indigo-600 ring-2 ring-indigo-200" : ""}`}>
      {c.image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.image_url} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 rounded-full object-cover" />}
      <div className="min-w-0 flex-1"><p className="font-semibold">{c.name}</p>{c.bio && <p className="text-sm text-slate-600">{c.bio}</p>}</div>
      {children}
    </div>
  );
}

function SectionView({ s, a, onChange }: { s: Section; a: Answer; onChange: (fn: (a: Answer) => Answer) => void }) {
  const limit = s.kind === "single" || s.kind === "yes_no" ? 1 : (s.max_choices ?? s.seats);
  const chosen = (id: string) => a.selections.find((x) => x.candidate_id === id);
  const toggle = (id: string) => onChange((p) => {
    const has = p.selections.some((x) => x.candidate_id === id);
    let selections = has ? p.selections.filter((x) => x.candidate_id !== id) : [...p.selections, { candidate_id: id }];
    if (!has && limit === 1) selections = [{ candidate_id: id }];       // اختيار واحد: يستبدل
    if (selections.length > limit) return p;
    return { ...p, abstain: false, selections };
  });
  const setRole = (role: "president" | "vice", id: string) => onChange((p) => ({
    ...p, abstain: false,
    selections: [...p.selections.filter((x) => x.role !== role && x.candidate_id !== id), { candidate_id: id, role }],
  }));
  const toggleRank = (id: string) => onChange((p) => {
    const cur = [...p.selections].sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));
    const has = cur.some((x) => x.candidate_id === id);
    const next = has ? cur.filter((x) => x.candidate_id !== id) : [...cur, { candidate_id: id }];
    return { ...p, abstain: false, selections: next.map((x, i) => ({ candidate_id: x.candidate_id, rank: i + 1 })) };
  });
  const setStar = (id: string, rating: number) => onChange((p) => ({
    ...p, abstain: false,
    selections: [...p.selections.filter((x) => x.candidate_id !== id), { candidate_id: id, rating }],
  }));

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-lg font-semibold">{s.title}</legend>
      {s.kind === "explicit_roles" ? (
        (["president", "vice"] as const).map((role) => (
          <div key={role} className="space-y-2">
            <p className="font-medium">{role === "president" ? "اختر الرئيس" : "اختر النائب"}</p>
            {s.candidates.map((c) => {
              const mine = a.selections.find((x) => x.role === role)?.candidate_id === c.id;
              const other = a.selections.find((x) => x.role !== role && x.role)?.candidate_id === c.id;
              return (
                <button key={c.id} type="button" disabled={other} aria-pressed={mine} onClick={() => setRole(role, c.id)} className="block w-full text-right disabled:opacity-40">
                  <CandidateCard c={c} selected={mine}><span aria-hidden>{mine ? "●" : "○"}</span></CandidateCard>
                </button>
              );
            })}
          </div>
        ))
      ) : s.kind === "ranked" ? (
        <>
          <p className="text-sm text-slate-600">اضغط على الخيارات بحسب أفضليتك؛ الأول ضغطاً هو الأفضل. اضغط مجدداً للإلغاء.</p>
          {s.candidates.map((c) => {
            const r = chosen(c.id)?.rank;
            return (
              <button key={c.id} type="button" aria-pressed={!!r} onClick={() => toggleRank(c.id)} className="block w-full text-right">
                <CandidateCard c={c} selected={!!r}><span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 font-bold">{r ?? "·"}</span></CandidateCard>
              </button>
            );
          })}
        </>
      ) : s.kind === "stars" ? (
        s.candidates.map((c) => (
          <CandidateCard key={c.id} c={c}>
            <div className="flex gap-1" role="radiogroup" aria-label={`تقييم ${c.name}`} dir="ltr">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={chosen(c.id)?.rating === n} aria-label={`${n} من 5`}
                  onClick={() => setStar(c.id, n)} className={`h-10 w-10 rounded-lg text-xl ${(chosen(c.id)?.rating ?? 0) >= n ? "bg-amber-400" : "bg-slate-100"}`}>★</button>
              ))}
            </div>
          </CandidateCard>
        ))
      ) : (
        <>
          {limit > 1 && <p className="text-sm text-slate-600">يمكنك اختيار حتى {limit}.</p>}
          {s.candidates.map((c) => {
            const on = !!chosen(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => toggle(c.id)} className="block w-full text-right">
                <CandidateCard c={c} selected={on}><span aria-hidden>{on ? (limit === 1 ? "●" : "☑") : (limit === 1 ? "○" : "☐")}</span></CandidateCard>
              </button>
            );
          })}
        </>
      )}
      {s.allow_other && !a.abstain && (
        <div><label className="label">أخرى (اختياري)</label>
          <input className="input" maxLength={200} value={a.other} onChange={(e) => onChange((p) => ({ ...p, other: e.target.value }))} /></div>
      )}
      {s.allow_abstain && (
        <button type="button" aria-pressed={a.abstain} className={a.abstain ? "btn-primary w-full" : "btn-ghost w-full"}
          onClick={() => onChange((p) => ({ abstain: !p.abstain, selections: [], other: "" }))}>
          {a.abstain ? "✓ ممتنع عن هذا القسم" : "امتناع / تخطي هذا القسم"}
        </button>
      )}
    </fieldset>
  );
}
