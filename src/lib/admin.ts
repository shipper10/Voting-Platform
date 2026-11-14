import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

/** حارس الإدارة: جلسة صالحة + حساب مشرف نشط + MFA (AAL2) ما لم يُعطَّل صراحة. كل المشرفين بصلاحيات متساوية؛ المالك فقط يدير المشرفين. */
export async function requireAdmin() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/admin/login");
  const { data: me } = await sb.from("admin_users").select("user_id,display_name,active,is_owner").eq("user_id", user.id).maybeSingle();
  if (!me?.active) redirect("/admin/login?error=forbidden");
  if (process.env.ADMIN_REQUIRE_MFA !== "false") {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") redirect("/admin/mfa");
  }
  return { sb, user, me, isOwner: !!me.is_owner };
}
