import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { KIND_LABEL } from "@/lib/labels";
import type { TallyResult } from "@/lib/tally";

export const dynamic = "force-dynamic";

export default async function PublicResults({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const [{ data: e }, { data: r }] = await Promise.all([
    sb.from("elections").select("title").eq("id", id).maybeSingle(),
    sb.from("election_results").select("result,report_sha256,published_at,rules_version").eq("election_id", id).eq("status", "published").maybeSingle(),
  ]);
  if (!e || !r) notFound();
  const res = r.result as TallyResult;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">نتائج: {e.title}</h1>
      <p className="text-sm text-slate-600">عدد الأوراق: {res.totalBallots}{res.turnoutValid ? "" : " — لم يتحقق الحد الأدنى للمشاركة"}</p>
      {res.sections.map((s) => (
        <section key={s.sectionId} className="card space-y-2">
          <h2 className="font-semibold">{s.title} <span className="text-xs text-slate-500">({KIND_LABEL[s.kind]})</span></h2>
          {s.winners.length > 0 && (
            <p className="rounded-xl bg-emerald-50 p-2 text-emerald-900">
              {s.winners.map((w) => `${w.position === "president" ? "الرئيس: " : w.position === "vice" ? "النائب: " : ""}${w.name}`).join(" — ")}
            </p>
          )}
          {s.tie && <p className="rounded-xl bg-amber-50 p-2 text-amber-900">تعادل بين {s.tie.candidateIds.length} مرشحين — {s.tie.resolution === "runoff" ? "تُجرى جولة إعادة" : "يُعلن التعادل وفق اللائحة"}</p>}
          <table className="w-full text-sm"><tbody>
            {(s.roleStandings ? s.roleStandings.president : s.standings).map((x) => (
              <tr key={x.candidateId} className="border-t"><td className="py-1">{x.name}</td><td className="py-1 text-left" dir="ltr">{x.score}</td></tr>
            ))}
          </tbody></table>
          <p className="text-xs text-slate-500">ممتنعون: {s.abstentions}</p>
        </section>
      ))}
      <p className="break-all text-xs text-slate-500" dir="ltr">sha256: {r.report_sha256} · rules v{r.rules_version}</p>
      <Link href="/" className="btn-ghost w-full">رجوع</Link>
    </div>
  );
}
