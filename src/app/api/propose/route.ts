import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseService } from "@/lib/supabase/server";
import { isValidUniversityId, normalizeUniversityId } from "@/lib/student-id";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ electionId: z.string().uuid(), universityId: z.string().min(1).max(64), name: z.string().min(2).max(80) });
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (!rateLimit(`pip:${ip}`, 20, 60_000)) return reply(429, { error: "rate_limited" });
  let p; try { p = Body.safeParse(await req.json()); } catch { return reply(400, { error: "invalid" }); }
  if (!p.success) return reply(422, { error: "invalid" });
  const uid = normalizeUniversityId(p.data.universityId);
  if (!isValidUniversityId(uid)) return reply(403, { error: "not_allowed" });
  if (!rateLimit(`puid:${uid}`, 6, 60_000)) return reply(429, { error: "rate_limited" });
  try {
    const { data, error } = await supabaseService().rpc("submit_proposal", { p_election: p.data.electionId, p_university_id: uid, p_name: p.data.name });
    if (error) return reply(500, { error: "server" });
    return reply(data?.status === "ok" ? 200 : 409, { status: data?.status ?? "server" });
  } catch { return reply(500, { error: "server" }); }
}
