import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseService } from "@/lib/supabase/server";
import { isValidUniversityId, normalizeUniversityId } from "@/lib/student-id";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Selection = z.object({
  candidate_id: z.string().uuid(),
  role: z.enum(["president", "vice"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  rank: z.number().int().min(1).max(200).optional(),
});
const Section = z.object({
  section_id: z.string().uuid(),
  abstain: z.boolean().optional(),
  other_text: z.string().max(200).optional(),
  selections: z.array(Selection).max(200).default([]),
});
const Body = z.object({
  electionId: z.string().uuid(),
  universityId: z.string().min(1).max(64),
  idempotencyKey: z.string().min(16).max(100),
  choices: z.array(Section).min(1).max(50),
});

const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * مبدأ السرية: لا نسجّل جسم الطلب ولا الرقم الجامعي ولا الاختيارات في أي سجل.
 * الاستجابات عن الرقم "غير مسموح/صوّت سابقاً/مجمّد/غير موجود" متطابقة عمداً.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!rateLimit(`ip:${ip}`, 30, 60_000)) return reply(429, { error: "rate_limited" });

  let parsed;
  try { parsed = Body.safeParse(await req.json()); } catch { return reply(400, { error: "invalid_ballot" }); }
  if (!parsed.success) return reply(422, { error: "invalid_ballot" });
  const { electionId, idempotencyKey, choices } = parsed.data;

  const uid = normalizeUniversityId(parsed.data.universityId);
  if (!isValidUniversityId(uid)) return reply(403, { error: "not_allowed" });
  // حد أشد لكل رقم جامعي لإبطاء محاولات التخمين/الإغراق
  if (!rateLimit(`uid:${electionId}:${uid}`, 6, 60_000)) return reply(429, { error: "rate_limited" });

  try {
    const { data, error } = await supabaseService().rpc("cast_ballot", {
      p_election: electionId,
      p_university_id: uid,
      p_idempotency_key: idempotencyKey,
      p_choices: choices,
    });
    if (error) return reply(500, { error: "server" });
    switch (data?.status) {
      case "ok": return reply(200, { status: "ok", receipt: data.receipt });
      case "already_recorded": return reply(200, { status: "already_recorded" });
      case "closed": return reply(409, { error: "closed" });
      case "invalid_ballot": return reply(422, { error: "invalid_ballot", detail: data.detail });
      default: return reply(403, { error: "not_allowed" });
    }
  } catch {
    return reply(500, { error: "server" });
  }
}
