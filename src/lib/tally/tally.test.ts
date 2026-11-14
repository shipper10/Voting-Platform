import { describe, expect, it } from "vitest";
import { tally, rowsToBallots, type Ballot, type TallyConfig, type TallySection } from "./index";

const cands = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));
const cfg = (sections: TallySection[], over: Partial<TallyConfig> = {}): TallyConfig =>
  ({ sections, tiePolicy: "runoff", conflictPolicy: "separate", ...over });
const ballot = (i: number, sections: Ballot["sections"]): Ballot => ({ sheetId: `s${i}`, sections });
const sel = (...ids: string[]) => ({ abstain: false, otherTexts: [], selections: ids.map((candidateId) => ({ candidateId })) });
const abstain = { abstain: true, otherTexts: [], selections: [] };

describe("top_n (الطريقة A: الأعلى أصواتاً)", () => {
  const sec: TallySection = { id: "L", title: "الليدر", kind: "top_n", seats: 2, candidates: cands("a", "b", "c") };
  it("الأول رئيس والثاني نائب", () => {
    const bs = [sel("a"), sel("a"), sel("b"), sel("b"), sel("a"), sel("c")].map((s, i) => ballot(i, { L: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.winners).toEqual([
      { candidateId: "a", name: "A", position: "president" },
      { candidateId: "b", name: "B", position: "vice" },
    ]);
    expect(r.tie).toBeUndefined();
  });
  it("تعادل على المركز الثاني يُعلَن ولا يُحسم تعسفاً", () => {
    const bs = [sel("a"), sel("a"), sel("a"), sel("b"), sel("c")].map((s, i) => ballot(i, { L: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.tie).toEqual({ candidateIds: ["b", "c"], seatsAtStake: 1, resolution: "runoff" });
    expect(r.winners.map((w) => w.candidateId)).toEqual(["a"]);
  });
  it("تعادل على المركز الأول يُفقد التسمية رئيس/نائب", () => {
    const bs = [sel("a"), sel("b")].map((s, i) => ballot(i, { L: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.tie).toEqual({ candidateIds: ["a", "b"], seatsAtStake: 1, resolution: "runoff" });
    expect(r.winners.every((w) => w.position === "seat")).toBe(true);
  });
  it("مرشح واحد فقط: يفوز ويُلاحَظ نقص المقاعد", () => {
    const one: TallySection = { ...sec, candidates: cands("a") };
    const r = tally(cfg([one]), [ballot(0, { L: sel("a") })]).sections[0];
    expect(r.winners.map((w) => w.candidateId)).toEqual(["a"]);
    expect(r.notes).toContain("عدد المرشحين أقل من عدد المقاعد");
  });
  it("لا أوراق: لا فائز ولا تعادل", () => {
    const r = tally(cfg([sec]), []).sections[0];
    expect(r.winners).toEqual([]);
    expect(r.tie).toBeUndefined();
  });
  it("الامتناع يُحصى ولا يُحتسب لمرشح", () => {
    const bs = [sel("a"), abstain, abstain].map((s, i) => ballot(i, { L: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.abstentions).toBe(2);
    expect(r.ballots).toBe(3);
    expect(r.standings.find((s) => s.candidateId === "a")?.score).toBe(1);
  });
});

describe("explicit_roles (الطريقة B: رئيس ونائب مباشرة)", () => {
  const sec: TallySection = { id: "R", title: "رئيس/نائب", kind: "explicit_roles", seats: 1, candidates: cands("a", "b", "c") };
  const vote = (p: string, v: string) => ({ abstain: false, otherTexts: [], selections: [
    { candidateId: p, role: "president" as const }, { candidateId: v, role: "vice" as const }] });

  it("فصل تام: الفائز بالرئاسة يُستبعد من ترتيب النيابة", () => {
    // a: رئاسة 3، نيابة 5. b: رئاسة 2، نيابة 2. c: نيابة 1
    const bs = [vote("a","b"), vote("a","c"), vote("a","b"), vote("b","a"), vote("b","a"), vote("c","a"), vote("c","a")]
      .map((s, i) => ballot(i, { R: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    // رئاسة: a=3, b=2, c=2 ⇒ a رئيس. النيابة بعد استبعاد a: b=2, c=1 ⇒ b نائب
    expect(r.winners).toEqual([
      { candidateId: "a", name: "A", position: "president" },
      { candidateId: "b", name: "B", position: "vice" },
    ]);
  });
  it("المرشح نفسه الأعلى في المنصبين: يأخذ الرئاسة والنائب هو الثاني في النيابة", () => {
    const bs = [vote("a","b"), vote("a","c"), vote("b","a"), vote("c","a"), vote("c","a")].map((s, i) => ballot(i, { R: s }));
    // رئاسة: a=2, b=1, c=2 ⇒ تعادل a/c على الرئاسة
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.tie?.candidateIds).toEqual(["a", "c"]);
    expect(r.winners).toEqual([]);   // لا نائب قبل حسم الرئيس
    expect(r.notes.join()).toContain("تعادل في الرئاسة");
  });
  it("الجمع التراكمي يغيّر النائب عند تفعيله", () => {
    // رئاسة: a=3, b=2. نيابة: b=1, c=2 ⇒ منفصل: c نائب. تراكمي: b=1+2=3 > c=2 ⇒ b نائب
    const bs = [vote("a","c"), vote("a","c"), vote("a","b"), vote("b","c"), vote("b","a")]
      .map((s, i) => ballot(i, { R: s }));
    // نيابة: c=3, b=1, a=1. رئاسة: a=3, b=2
    expect(tally(cfg([sec]), bs).sections[0].winners[1].candidateId).toBe("c");
    const bs2 = [vote("a","c"), vote("a","c"), vote("a","b"), vote("b","c"), vote("b","a")].map((s, i) => ballot(i, { R: s }));
    const cum = tally(cfg([sec], { conflictPolicy: "cumulative" }), bs2).sections[0];
    // c: 3 نيابة + 0 رئاسة = 3 ؛ b: 1 + 2 = 3 ⇒ تعادل في النيابة
    expect(cum.tie?.candidateIds).toEqual(["b", "c"]);
  });
  it("تعادل النيابة وحدها", () => {
    const bs = [vote("a","b"), vote("a","c")].map((s, i) => ballot(i, { R: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.winners).toEqual([{ candidateId: "a", name: "A", position: "president" }]);
    expect(r.tie?.candidateIds).toEqual(["b", "c"]);
  });
  it("مرشحان فقط ومرشح فائز في المنصبين: لا يصبح نائباً لنفسه", () => {
    const two: TallySection = { ...sec, candidates: cands("a", "b") };
    const bs = [vote("a","b"), vote("a","b"), vote("b","a")].map((s, i) => ballot(i, { R: s }));
    const r = tally(cfg([two]), bs).sections[0];
    expect(r.winners.map((w) => w.candidateId)).toEqual(["a", "b"]);
  });
});

describe("single / yes_no / multi", () => {
  it("استفتاء نعم/لا مع امتناع", () => {
    const sec: TallySection = { id: "Q", title: "هل توافق؟", kind: "yes_no", seats: 1, candidates: cands("yes", "no") };
    const bs = [sel("yes"), sel("yes"), sel("no"), abstain].map((s, i) => ballot(i, { Q: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.winners[0].candidateId).toBe("yes");
    expect(r.abstentions).toBe(1);
  });
  it("متعدد مع نص أخرى", () => {
    const sec: TallySection = { id: "M", title: "م", kind: "multi", seats: 1, candidates: cands("x", "y") };
    const bs = [
      ballot(0, { M: { abstain: false, selections: [{ candidateId: "x" }, { candidateId: "y" }], otherTexts: ["اقتراح"] } }),
      ballot(1, { M: { abstain: false, selections: [{ candidateId: "x" }], otherTexts: [" اقتراح "] } }),
    ];
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.standings.map((s) => [s.candidateId, s.score])).toEqual([["x", 2], ["y", 1]]);
    expect(r.otherTexts).toEqual([{ text: "اقتراح", count: 2 }]);
  });
});

describe("ranked (بوردا) و stars", () => {
  it("بوردا", () => {
    const sec: TallySection = { id: "N", title: "اسم", kind: "ranked", seats: 1, candidates: cands("a", "b", "c") };
    const r1 = (...ids: string[]) => ({ abstain: false, otherTexts: [], selections: ids.map((candidateId, i) => ({ candidateId, rank: i + 1 })) });
    const bs = [r1("a", "b", "c"), r1("b", "a", "c"), r1("b", "c", "a")].map((s, i) => ballot(i, { N: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    // a: 3+2+1=6 ؛ b: 2+3+3=8 ؛ c: 1+1+2=4
    expect(r.standings.map((s) => [s.candidateId, s.score])).toEqual([["b", 8], ["a", 6], ["c", 4]]);
    expect(r.winners[0].candidateId).toBe("b");
  });
  it("النجوم: متوسط التقييم، ومرشح بلا تقييمات لا يفوز", () => {
    const sec: TallySection = { id: "S", title: "تقييم", kind: "stars", seats: 1, candidates: cands("a", "b", "c") };
    const rt = (a: number, b?: number) => ({ abstain: false, otherTexts: [], selections: [
      { candidateId: "a", rating: a }, ...(b ? [{ candidateId: "b", rating: b }] : [])] });
    const bs = [rt(5, 3), rt(3, 3), rt(4)].map((s, i) => ballot(i, { S: s }));
    const r = tally(cfg([sec]), bs).sections[0];
    expect(r.standings[0]).toMatchObject({ candidateId: "a", score: 4 });
    expect(r.winners[0].candidateId).toBe("a");
    const c = r.standings.find((s) => s.candidateId === "c");
    expect(c?.score).toBe(0);
  });
  it("تعادل النجوم", () => {
    const sec: TallySection = { id: "S", title: "تقييم", kind: "stars", seats: 1, candidates: cands("a", "b") };
    const bs = [{ abstain: false, otherTexts: [], selections: [{ candidateId: "a", rating: 4 }, { candidateId: "b", rating: 4 }] }].map((s, i) => ballot(i, { S: s }));
    expect(tally(cfg([sec]), bs).sections[0].tie?.candidateIds).toEqual(["a", "b"]);
  });
});

describe("عام", () => {
  it("حد أدنى للمشاركة", () => {
    const sec: TallySection = { id: "Q", title: "q", kind: "single", seats: 1, candidates: cands("a") };
    expect(tally(cfg([sec], { minTurnout: 3 }), [ballot(0, { Q: sel("a") })]).turnoutValid).toBe(false);
    expect(tally(cfg([sec], { minTurnout: 1 }), [ballot(0, { Q: sel("a") })]).turnoutValid).toBe(true);
  });
  it("إعادة الاحتساب حتمية: نفس المدخلات بترتيب مختلف ⇒ نفس المخرجات", () => {
    const sec: TallySection = { id: "L", title: "L", kind: "top_n", seats: 2, candidates: cands("a", "b", "c") };
    const bs = ["a", "b", "a", "c", "b", "a"].map((c, i) => ballot(i, { L: sel(c) }));
    expect(tally(cfg([sec]), bs)).toEqual(tally(cfg([sec]), [...bs].reverse()));
  });
  it("rowsToBallots يجمّع الصفوف بحسب الورقة", () => {
    const rows = [
      { sheet_id: "s1", section_id: "R", candidate_id: "a", role: "president", rating: null, rank: null, other_text: null, abstain: false },
      { sheet_id: "s1", section_id: "R", candidate_id: "b", role: "vice", rating: null, rank: null, other_text: null, abstain: false },
      { sheet_id: "s1", section_id: "Q", candidate_id: null, role: null, rating: null, rank: null, other_text: null, abstain: true },
    ];
    const [b] = rowsToBallots(rows);
    expect(b.sections.R.selections).toHaveLength(2);
    expect(b.sections.Q.abstain).toBe(true);
  });
});
