import { describe, expect, it } from "vitest";
import { normalizeUniversityId, isValidUniversityId } from "./student-id";
import { previewStudentsCsv } from "./csv";
import { seededShuffle } from "./shuffle";
import { rateLimit } from "./rate-limit";

describe("الرقم الجامعي", () => {
  it("يوحّد الأرقام العربية والمسافات", () => {
    expect(normalizeUniversityId(" ٢٣٠١٢٣ ")).toBe("230123");
    expect(normalizeUniversityId("ab-۱۲")).toBe("AB-12");
  });
  it("يرفض الرموز", () => {
    expect(isValidUniversityId("23;DROP")).toBe(false);
    expect(isValidUniversityId("1")).toBe(false);
    expect(isValidUniversityId("230123")).toBe(true);
  });
});

describe("استيراد CSV", () => {
  it("يعاين ويكشف الأخطاء والتكرار", () => {
    const p = previewStudentsCsv("﻿university_id,full_name,status\n230001,أحمد,\n٢٣٠٠٠٢,سارة,frozen\n230001,مكرر,\nxx yy;,خطأ,\n230003,علي,غريب\n");
    expect(p.valid.map((v) => v.university_id)).toEqual(["230001", "230002"]);
    expect(p.valid[1].status).toBe("frozen");
    expect(p.duplicates).toHaveLength(1);
    expect(p.issues.map((i) => i.reason)).toEqual(["رقم جامعي غير صالح", "حالة غير معروفة"]);
  });
  it("يدعم رؤوساً عربية وفاصلة منقوطة واقتباساً", () => {
    const p = previewStudentsCsv('الرقم الجامعي;الاسم\n100;"علي; محمد"\n');
    expect(p.valid).toEqual([{ university_id: "100", full_name: "علي; محمد", status: "active" }]);
  });
  it("يرفض ملفاً بلا عمود الرقم أو كبيراً", () => {
    expect(() => previewStudentsCsv("a,b\n1,2")).toThrow();
    expect(() => previewStudentsCsv("x".repeat(1_000_001))).toThrow("1MB");
  });
});

describe("الخلط", () => {
  const xs = ["a", "b", "c", "d", "e", "f"];
  it("حتمي لنفس البذرة، وتبديل كامل، ومختلف بين بذرات", () => {
    expect(seededShuffle(xs, "s1")).toEqual(seededShuffle(xs, "s1"));
    expect([...seededShuffle(xs, "s1")].sort()).toEqual(xs);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => seededShuffle(xs, `seed${i}`).join("")));
    expect(orders.size).toBeGreaterThan(10);
  });
});

describe("محدد المعدل", () => {
  it("يسمح حتى الحد ثم يمنع ثم يتعافى", () => {
    expect(rateLimit("k", 2, 1000, 0)).toBe(true);
    expect(rateLimit("k", 2, 1000, 1)).toBe(true);
    expect(rateLimit("k", 2, 1000, 2)).toBe(false);
    expect(rateLimit("k", 2, 1000, 1500)).toBe(true);
  });
});
