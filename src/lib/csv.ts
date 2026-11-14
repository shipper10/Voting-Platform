import { isValidUniversityId, normalizeUniversityId } from "./student-id";

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 20_000;

export interface ParsedStudent { university_id: string; full_name: string | null; status: "active" | "frozen" }
export interface RowIssue { line: number; reason: string; raw?: string }
export interface CsvPreview { valid: ParsedStudent[]; issues: RowIssue[]; duplicates: RowIssue[]; totalLines: number }

/** محلل CSV بسيط يدعم علامات الاقتباس والفواصل العربية (،) والفاصلة المنقوطة */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const delim = (() => {
    const first = text.split(/\r?\n/, 1)[0] ?? "";
    const counts: [string, number][] = [[",", 0], [";", 0], ["\t", 0], ["،", 0]];
    for (const c of counts) c[1] = first.split(c[0]).length - 1;
    return counts.sort((a, b) => b[1] - a[1])[0][0];
  })();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADERS: Record<string, "university_id" | "full_name" | "status"> = {
  university_id: "university_id", id: "university_id", "الرقم الجامعي": "university_id", "رقم جامعي": "university_id",
  full_name: "full_name", name: "full_name", "الاسم": "full_name",
  status: "status", "الحالة": "status",
};

/** معاينة قبل الاستيراد: لا يُكتب شيء. يكشف الأرقام غير الصالحة والتكرار داخل الملف. */
export function previewStudentsCsv(input: string | Uint8Array): CsvPreview {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input).length : input.length;
  if (bytes > MAX_CSV_BYTES) throw new Error("الملف أكبر من الحد المسموح (1MB)");
  let text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  text = text.replace(/^﻿/, "");
  const rows = parseCsv(text);
  if (rows.length - 1 > MAX_CSV_ROWS) throw new Error("عدد الصفوف أكبر من الحد المسموح");
  if (rows.length === 0) throw new Error("الملف فارغ");
  const header = rows[0].map((h) => HEADERS[h.trim().toLowerCase()] ?? null);
  if (!header.includes("university_id")) throw new Error("لم يُعثر على عمود الرقم الجامعي (university_id)");

  const seen = new Map<string, number>();
  const valid: ParsedStudent[] = [], issues: RowIssue[] = [], duplicates: RowIssue[] = [];
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const get = (k: string) => { const i = header.indexOf(k as never); return i >= 0 ? (r[i] ?? "").trim() : ""; };
    const id = normalizeUniversityId(get("university_id"));
    if (!isValidUniversityId(id)) { issues.push({ line, reason: "رقم جامعي غير صالح", raw: get("university_id") }); return; }
    if (seen.has(id)) { duplicates.push({ line, reason: `مكرر (أول ظهور في السطر ${seen.get(id)})`, raw: id }); return; }
    const st = get("status").toLowerCase();
    const status = st === "" || ["active", "نشط", "فعال"].includes(st) ? "active" : ["frozen", "مجمد", "مجمّد"].includes(st) ? "frozen" : null;
    if (!status) { issues.push({ line, reason: "حالة غير معروفة", raw: st }); return; }
    seen.set(id, line);
    valid.push({ university_id: id, full_name: get("full_name") || null, status });
  });
  return { valid, issues, duplicates, totalLines: rows.length - 1 };
}
