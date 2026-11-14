"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { previewStudentsCsv, type CsvPreview } from "@/lib/csv";
import { rowsToBallots, tally, type ChoiceRow, type TallyConfig } from "@/lib/tally";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (str(f, k) === "" ? null : Number(str(f, k)));
const fail = (path: string, msg: string): never => redirect(`${path}?error=${encodeURIComponent(msg)}`);

export async function signIn(formData: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: str(formData, "email"), password: str(formData, "password") });
  if (error) fail("/admin/login", "بيانات الدخول غير صحيحة");
  redirect("/admin");
}
export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/admin/login");
}

const ElectionForm = z.object({
  title: z.string().min(2).max(200),
  type: z.enum(["leadership", "name_proposals", "referendum"]),
  privacy_level: z.enum(["strong_anonymous", "restricted_administrative"]),
  tie_policy: z.enum(["runoff", "declare_tie"]),
  conflict_policy: z.enum(["separate", "cumulative"]),
  starts_at: z.string().min(1), ends_at: z.string().min(1),
});
export async function createElection(formData: FormData) {
  const { sb, user } = await requireAdmin();
  const p = ElectionForm.safeParse(Object.fromEntries(formData));
  if (!p.success) return fail("/admin", "بيانات غير صالحة");
  const d = p.data;
  const { data, error } = await sb.from("elections").insert({
    ...d, starts_at: new Date(d.starts_at).toISOString(), ends_at: new Date(d.ends_at).toISOString(), created_by: user.id,
  }).select("id").single();
  if (error) return fail("/admin", error.message);
  redirect(`/admin/elections/${data.id}`);
}

export async function addSection(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const kind = str(formData, "kind");
  const { data: s, error } = await sb.from("election_sections").insert({
    election_id: eid, title: str(formData, "title"), kind,
    display_order: num(formData, "display_order") ?? 0,
    seats: num(formData, "seats") ?? 1, min_choices: num(formData, "min_choices") ?? 1, max_choices: num(formData, "max_choices"),
    allow_abstain: formData.get("allow_abstain") === "on", allow_other: formData.get("allow_other") === "on",
  }).select("id").single();
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  if (kind === "yes_no") {     // قسم نعم/لا يُنشأ بخيارَيه الثابتين
    const { error: e2 } = await sb.from("candidates").insert([
      { election_id: eid, section_id: s.id, name: "نعم", display_order: 1 },
      { election_id: eid, section_id: s.id, name: "لا", display_order: 2 },
    ]);
    if (e2) return fail(`/admin/elections/${eid}`, e2.message);
  }
  revalidatePath(`/admin/elections/${eid}`);
  redirect(`/admin/elections/${eid}`);
}

export async function addCandidate(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const { error } = await sb.from("candidates").insert({
    election_id: eid, section_id: str(formData, "section_id"), name: str(formData, "name"),
    bio: str(formData, "bio") || null, image_url: str(formData, "image_url") || null,
    status: str(formData, "status") === "pending" ? "pending" : "approved",
  });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}

export async function changeStatus(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const { error } = await sb.rpc("set_box_status", { p_election: eid, p_new: str(formData, "to"), p_reason: str(formData, "reason") });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}

export async function reviewProposal(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const { error } = await sb.rpc("review_proposal", { p_candidate: str(formData, "candidate_id"), p_decision: str(formData, "decision"), p_reason: str(formData, "reason") });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}

/** يحتسب النتائج من الاختيارات الخام (بعد الإغلاق) ويرفعها للمراجعة */
export async function computeResults(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const [{ data: e }, { data: secs }, { data: cands }, { data: rows, error }] = await Promise.all([
    sb.from("elections").select("tie_policy,conflict_policy,min_turnout").eq("id", eid).single(),
    sb.from("election_sections").select("id,title,kind,seats,display_order").eq("election_id", eid).order("display_order"),
    sb.from("candidates").select("id,section_id,name").eq("election_id", eid),
    sb.rpc("export_choices", { p_election: eid }),
  ]);
  if (error || !e || !secs || !cands) return fail(`/admin/elections/${eid}`, error?.message ?? "تعذّر جلب البيانات");
  const cfg: TallyConfig = {
    tiePolicy: e.tie_policy, conflictPolicy: e.conflict_policy, minTurnout: e.min_turnout ?? undefined,
    sections: secs.map((s) => ({ id: s.id, title: s.title, kind: s.kind, seats: s.seats, candidates: cands.filter((c) => c.section_id === s.id).map((c) => ({ id: c.id, name: c.name })) })),
  };
  const result = tally(cfg, rowsToBallots(rows as ChoiceRow[]));
  const { error: e2 } = await sb.rpc("submit_results", { p_election: eid, p_result: result, p_rules_version: result.rulesVersion });
  if (e2) return fail(`/admin/elections/${eid}`, e2.message);
  redirect(`/admin/elections/${eid}`);
}
export async function resultsStep(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const fn = str(formData, "step") === "publish" ? "publish_results" : "approve_results";
  const { error } = await sb.rpc(fn, { p_result: str(formData, "result_id") });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}

// ───── الوصول الاستثنائي (السرية الإدارية) ─────
export async function requestAccess(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const { error } = await sb.rpc("request_identity_access", { p_election: eid, p_reason: str(formData, "reason") });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}
export async function decideAccess(formData: FormData) {
  const { sb } = await requireAdmin();
  const eid = str(formData, "election_id");
  const { error } = await sb.rpc("decide_identity_access", { p_request: str(formData, "request_id"), p_approve: str(formData, "approve") === "yes", p_note: str(formData, "note") });
  if (error) return fail(`/admin/elections/${eid}`, error.message);
  redirect(`/admin/elections/${eid}`);
}

// ───── الطلاب ─────
export async function previewStudents(_prev: unknown, formData: FormData): Promise<{ preview?: CsvPreview; error?: string }> {
  await requireAdmin();
  const f = formData.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "اختر ملف CSV" };
  try { return { preview: previewStudentsCsv(new Uint8Array(await f.arrayBuffer())) }; }
  catch (e) { return { error: e instanceof Error ? e.message : "ملف غير صالح" }; }
}
export async function importStudents(rows: { university_id: string; full_name: string | null; status: "active" | "frozen" }[]) {
  const { sb } = await requireAdmin();
  if (rows.length > 20_000) return { error: "عدد الصفوف كبير" };
  const { data, error } = await sb.rpc("import_students", { p_rows: rows });
  if (error) return { error: error.message };
  revalidatePath("/admin/students");
  return { ok: data as { new: number; updated: number } };
}
export async function freezeStudent(formData: FormData) {
  const { sb } = await requireAdmin();
  const { error } = await sb.rpc("set_student_status", { p_id: str(formData, "id"), p_status: str(formData, "status"), p_reason: str(formData, "reason") });
  if (error) return fail("/admin/students", error.message);
  redirect("/admin/students");
}
