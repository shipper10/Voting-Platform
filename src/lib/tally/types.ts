export type SectionKind = "top_n" | "explicit_roles" | "single" | "multi" | "ranked" | "stars" | "yes_no";
export type TiePolicy = "runoff" | "declare_tie";
export type ConflictPolicy = "separate" | "cumulative";

export interface TallySection {
  id: string;
  title: string;
  kind: SectionKind;
  seats: number;
  candidates: { id: string; name: string }[];
}

export interface BallotSelection {
  candidateId: string;
  role?: "president" | "vice";
  rating?: number;
  rank?: number;
}
export interface BallotSection {
  abstain: boolean;
  selections: BallotSelection[];
  otherTexts: string[];
}
/** ورقة واحدة: sectionId → إجابتها. لا هوية ولا توقيت. */
export interface Ballot {
  sheetId: string;
  sections: Record<string, BallotSection>;
}

export interface TallyConfig {
  sections: TallySection[];
  tiePolicy: TiePolicy;
  conflictPolicy: ConflictPolicy;
  /** حد أدنى للمشاركة لصحة الاستحقاق (اختياري) */
  minTurnout?: number;
}

export interface Standing {
  candidateId: string;
  name: string;
  score: number;
  /** للنجوم: متوسط التقييم؛ للترتيب: مجموع نقاط بوردا */
  detail?: Record<string, number>;
}

export interface Tie {
  /** المرشحون المتعادلون على المقعد/المقاعد الأخيرة */
  candidateIds: string[];
  seatsAtStake: number;
  resolution: TiePolicy;
}

export interface SectionResult {
  sectionId: string;
  title: string;
  kind: SectionKind;
  ballots: number;       // الأوراق الصالحة التي ضمّت هذا القسم
  abstentions: number;
  standings: Standing[]; // مرتبة تنازلياً
  winners: { candidateId: string; name: string; position?: "president" | "vice" | "seat" }[];
  tie?: Tie;
  /** رئيس/نائب: كل منصب يُسجَّل منفصلاً */
  roleStandings?: { president: Standing[]; vice: Standing[] };
  otherTexts?: { text: string; count: number }[];
  notes: string[];
}

export interface TallyResult {
  rulesVersion: string;
  totalBallots: number;
  turnoutValid: boolean;
  sections: SectionResult[];
}
