import { requireAdmin } from "@/lib/admin";
import type { TallyResult } from "@/lib/tally";

export const dynamic = "force-dynamic";
const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** تقرير النتائج CSV (يُفتح في Excel): القسم، المرشح، النتيجة، الفائز */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb } = await requireAdmin();
  const [{ data: e }, { data: r }] = await Promise.all([
    sb.from("elections").select("title,starts_at,ends_at,tie_policy,min_turnout").eq("id", id).maybeSingle(),
    sb.from("election_results").select("result,report_sha256,rules_version,status").eq("election_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!e || !r) return new Response("لا نتائج", { status: 404 });
  const res = r.result as TallyResult;
  const rows: unknown[][] = [
    ["الانتخابات", e.title], ["البداية", e.starts_at], ["النهاية", e.ends_at], ["الأوراق", res.totalBallots],
    ["حالة النتائج", r.status], ["قواعد الفرز", r.rules_version], ["SHA-256", r.report_sha256], [],
    ["القسم", "المرشح", "النتيجة", "فائز", "ممتنعون"],
  ];
  for (const s of res.sections) {
    const winners = new Set(s.winners.map((w) => w.candidateId));
    for (const x of s.roleStandings ? s.roleStandings.president : s.standings) rows.push([s.title, x.name, x.score, winners.has(x.candidateId) ? "نعم" : "", s.abstentions]);
    if (s.roleStandings) for (const x of s.roleStandings.vice) rows.push([s.title + " (نائب)", x.name, x.score, winners.has(x.candidateId) ? "نعم" : "", ""]);
    if (s.tie) rows.push([s.title, "تعادل", s.tie.candidateIds.length, "", ""]);
  }
  const body = "﻿" + rows.map((r2) => r2.map(esc).join(",")).join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="results-${id}.csv"`, "Cache-Control": "no-store" } });
}
