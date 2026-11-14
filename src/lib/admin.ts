import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "super_admin" | "election_manager" | "auditor" | "results_officer" | "privacy_approver";

/** حارس الإدارة: جلسة صالحة + حساب مشرف نشط + MFA (AAL2) ما لم يُعطَّل صراحة */
export async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: me } = await sb.from("admin_users").select("user_id,display_name,active").eq("user_id", user.id).maybeSingle();
  if (!me?.active) redirect("/admin/login?error=forbidden");
  if (process.env.ADMIN_REQUIRE_MFA !== "false") {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") redirect("/admin/mfa");
  }
  const { data: roleRows } = await sb.from("admin_roles").select("role").eq("user_id", user.id);
  const roles = (roleRows ?? []).map((r) => r.role as Role);
  return { sb, user, me, roles, has: (...r: Role[]) => r.some((x) => roles.includes(x)) };
}
