import type {
  Ballot, Standing, SectionResult, TallyConfig, TallyResult, TallySection, Tie, TiePolicy,
} from "./types";

export * from "./types";
/** يُرفع عند أي تغيير في قواعد الفرز، ويُحفظ مع النتائج (الخطة §11) */
export const RULES_VERSION = "2.0.0";

type Scored = { id: string; name: string; score: number };

/** ترتيب تنازلي مع تجميع المتعادلين (نفس الدرجة بدقة) */
function groupByScore(items: Scored[]): Scored[][] {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const groups: Scored[][] = [];
  for (const it of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].score - it.score) < 1e-9) last.push(it);
    else groups.push([it]);
  }
  return groups;
}

/** يختار seats فائزين؛ إن قطع التعادل الحدّ الفاصل يعيد tie بدل اختيار تعسفي */
function pickSeats(items: Scored[], seats: number, policy: TiePolicy): { winners: Scored[]; tie?: Tie } {
  const groups = groupByScore(items);
  const winners: Scored[] = [];
  for (const g of groups) {
    const room = seats - winners.length;
    if (room <= 0) break;
    if (g.length <= room) winners.push(...g);
    else {
      return {
        winners,
        tie: { candidateIds: g.map((x) => x.id).sort(), seatsAtStake: room, resolution: policy },
      };
    }
  }
  return { winners };
}

const toStanding = (s: Scored, detail?: Record<string, number>): Standing => ({
  candidateId: s.id, name: s.name, score: s.score, ...(detail ? { detail } : {}),
});
const sortStandings = (xs: Standing[]) =>
  [...xs].sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));

function tallySection(sec: TallySection, ballots: Ballot[], cfg: TallyConfig): SectionResult {
  const notes: string[] = [];
  const res: SectionResult = {
    sectionId: sec.id, title: sec.title, kind: sec.kind, ballots: 0, abstentions: 0,
    standings: [], winners: [], notes,
  };
  const names = new Map(sec.candidates.map((c) => [c.id, c.name]));
  const zero = () => new Map(sec.candidates.map((c) => [c.id, 0]));
  const asScored = (m: Map<string, number>): Scored[] =>
    [...m].map(([id, score]) => ({ id, name: names.get(id) ?? id, score }));

  const mine = ballots.map((b) => b.sections[sec.id]).filter(Boolean);
  res.ballots = mine.length;
  res.abstentions = mine.filter((x) => x.abstain).length;
  const answered = mine.filter((x) => !x.abstain);

  const otherCounts = new Map<string, number>();
  for (const a of answered) for (const t of a.otherTexts) {
    const k = t.trim();
    if (k) otherCounts.set(k, (otherCounts.get(k) ?? 0) + 1);
  }
  if (otherCounts.size) {
    res.otherTexts = [...otherCounts].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }

  switch (sec.kind) {
    case "top_n":
    case "single":
    case "yes_no":
    case "multi": {
      const m = zero();
      for (const a of answered) for (const s of a.selections) m.set(s.candidateId, (m.get(s.candidateId) ?? 0) + 1);
      const scored = asScored(m);
      res.standings = sortStandings(scored.map((s) => toStanding(s)));
      const seats = sec.kind === "top_n" || sec.kind === "multi" ? sec.seats : 1;
      const { winners, tie } = pickSeats(scored.filter((s) => s.score > 0), seats, cfg.tiePolicy);
      const pos = sec.kind === "top_n" && sec.seats === 2 ? (["president", "vice"] as const) : null;
      res.winners = winners.map((w, i) => ({ candidateId: w.id, name: w.name, position: pos && !tie ? pos[i] : "seat" }));
      if (pos && tie) res.winners = res.winners.map((w) => ({ ...w, position: "seat" }));
      if (tie) res.tie = tie;
      else if (pos && winners.length === 2 && Math.abs(winners[0].score - winners[1].score) < 1e-9) {
        // تعادل على المركز الأول: كلاهما فائز لكن من الرئيس ومن النائب غير محسوم
        res.winners = res.winners.map((w) => ({ ...w, position: "seat" }));
        res.tie = { candidateIds: winners.map((w) => w.id).sort(), seatsAtStake: 1, resolution: cfg.tiePolicy };
        notes.push("تعادل على المركز الأول: توزيع منصبي الرئيس والنائب غير محسوم");
      }
      if (sec.candidates.length < seats) notes.push("عدد المرشحين أقل من عدد المقاعد");
      if (sec.candidates.length === 1) notes.push("مرشح منفرد");
      break;
    }
    case "explicit_roles": {
      const pres = zero(), vice = zero();
      for (const a of answered) for (const s of a.selections) {
        if (s.role === "president") pres.set(s.candidateId, (pres.get(s.candidateId) ?? 0) + 1);
        else if (s.role === "vice") vice.set(s.candidateId, (vice.get(s.candidateId) ?? 0) + 1);
      }
      const presScored = asScored(pres);
      const presPick = pickSeats(presScored, 1, cfg.tiePolicy);
      res.roleStandings = {
        president: sortStandings(presScored.map((s) => toStanding(s))),
        vice: [],
      };
      if (presPick.tie) {
        // لا يمكن حسم النائب قبل حسم الرئيس عند تعارض الترتيب
        res.tie = presPick.tie;
        res.roleStandings.vice = sortStandings(asScored(vice).map((s) => toStanding(s)));
        notes.push("تعادل في الرئاسة: يتوقف حسم النائب إلى ما بعد حسم الرئيس");
        break;
      }
      const president = presPick.winners[0];
      const viceScored: Scored[] = asScored(vice)
        .filter((s) => s.id !== president?.id)
        .map((s) => ({
          ...s,
          // الجمع التراكمي: أصوات الرئاسة لغير الفائز تُضاف لرصيده في النيابة (إن اعتمدته الدفعة مسبقاً)
          score: cfg.conflictPolicy === "cumulative" ? s.score + (pres.get(s.id) ?? 0) : s.score,
        }));
      res.roleStandings.vice = sortStandings(viceScored.map((s) => toStanding(s, cfg.conflictPolicy === "cumulative"
        ? { viceVotes: vice.get(s.id) ?? 0, presidentVotes: pres.get(s.id) ?? 0 } : undefined)));
      const vicePick = pickSeats(viceScored, 1, cfg.tiePolicy);
      if (president) res.winners.push({ candidateId: president.id, name: president.name, position: "president" });
      if (vicePick.winners[0]) res.winners.push({ candidateId: vicePick.winners[0].id, name: vicePick.winners[0].name, position: "vice" });
      if (vicePick.tie) res.tie = vicePick.tie;
      if (president && president.score === 0) notes.push("لا أصوات للرئاسة");
      res.standings = res.roleStandings.president;
      break;
    }
    case "ranked": {
      // بوردا: المركز r من n مرتّباً ⇒ (N − r + 1) حيث N عدد مرشحي القسم. الأوراق ذات الترتيب الجزئي مقبولة.
      const N = sec.candidates.length;
      const m = zero();
      for (const a of answered) for (const s of a.selections) {
        if (s.rank) m.set(s.candidateId, (m.get(s.candidateId) ?? 0) + (N - s.rank + 1));
      }
      const scored = asScored(m);
      res.standings = sortStandings(scored.map((s) => toStanding(s)));
      const { winners, tie } = pickSeats(scored, 1, cfg.tiePolicy);
      res.winners = winners.map((w) => ({ candidateId: w.id, name: w.name, position: "seat" }));
      if (tie) res.tie = tie;
      notes.push("طريقة الفرز: بوردا");
      break;
    }
    case "stars": {
      const sum = zero(), cnt = zero();
      for (const a of answered) for (const s of a.selections) {
        if (s.rating) {
          sum.set(s.candidateId, (sum.get(s.candidateId) ?? 0) + s.rating);
          cnt.set(s.candidateId, (cnt.get(s.candidateId) ?? 0) + 1);
        }
      }
      const scored: Scored[] = sec.candidates.map((c) => {
        const n = cnt.get(c.id) ?? 0;
        return { id: c.id, name: c.name, score: n ? Math.round(((sum.get(c.id) ?? 0) / n) * 1e6) / 1e6 : 0 };
      });
      res.standings = sortStandings(scored.map((s) => toStanding(s, { ratings: cnt.get(s.id) ?? 0, sum: sum.get(s.id) ?? 0 })));
      const { winners, tie } = pickSeats(scored.filter((s) => (cnt.get(s.id) ?? 0) > 0), 1, cfg.tiePolicy);
      res.winners = winners.map((w) => ({ candidateId: w.id, name: w.name, position: "seat" }));
      if (tie) res.tie = tie;
      notes.push("طريقة الفرز: متوسط التقييم");
      break;
    }
  }
  return res;
}

/**
 * يعيد احتساب النتائج من الاختيارات الخام فقط (الخطة §11) — دالة نقية قابلة للاختبار.
 * الامتناع يُحتسب في المشاركة ولا يدخل في الأصوات الصالحة للمرشحين.
 */
export function tally(cfg: TallyConfig, ballots: Ballot[]): TallyResult {
  return {
    rulesVersion: RULES_VERSION,
    totalBallots: ballots.length,
    turnoutValid: cfg.minTurnout == null || ballots.length >= cfg.minTurnout,
    sections: cfg.sections.map((s) => tallySection(s, ballots, cfg)),
  };
}

/** يحوّل صفوف export_choices إلى أوراق */
export interface ChoiceRow {
  sheet_id: string; section_id: string; candidate_id: string | null; role: string | null;
  rating: number | null; rank: number | null; other_text: string | null; abstain: boolean;
}
export function rowsToBallots(rows: ChoiceRow[]): Ballot[] {
  const bySheet = new Map<string, Ballot>();
  for (const r of rows) {
    let b = bySheet.get(r.sheet_id);
    if (!b) { b = { sheetId: r.sheet_id, sections: {} }; bySheet.set(r.sheet_id, b); }
    const sec = (b.sections[r.section_id] ??= { abstain: false, selections: [], otherTexts: [] });
    if (r.abstain) sec.abstain = true;
    else if (r.other_text) sec.otherTexts.push(r.other_text);
    else if (r.candidate_id) {
      sec.selections.push({
        candidateId: r.candidate_id,
        ...(r.role ? { role: r.role as "president" | "vice" } : {}),
        ...(r.rating != null ? { rating: r.rating } : {}),
        ...(r.rank != null ? { rank: r.rank } : {}),
      });
    }
  }
  return [...bySheet.values()];
}
