"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** تسجيل/تحقق TOTP (Supabase MFA) — مطلوب للوصول إلى لوحة التحكم */
export default function Mfa() {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) { router.replace("/admin/login"); return; }
      const { data: f } = await sb.auth.mfa.listFactors();
      const verified = f?.totp?.find((x) => x.status === "verified");
      if (verified) { setFactorId(verified.id); return; }
      for (const x of f?.totp ?? []) await sb.auth.mfa.unenroll({ factorId: x.id });   // تنظيف محاولات غير مكتملة
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp" });
      if (error) { setMsg(error.message); return; }
      setFactorId(data.id); setQr(data.totp.qr_code);
    })();
  }, [sb, router]);

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!factorId) return;
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
    if (e1) { setMsg(e1.message); return; }
    const { error: e2 } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (e2) { setMsg("الرمز غير صحيح"); return; }
    router.replace("/admin"); router.refresh();
  }

  return (
    <form onSubmit={verify} className="card mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">التحقق بخطوتين</h1>
      {qr && (<><p className="text-sm">امسح الرمز بتطبيق مصادقة (Google Authenticator/Aegis) ثم أدخل الرمز المكوّن من 6 أرقام.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR" className="mx-auto h-48 w-48" /></>)}
      <input className="input text-center tracking-widest" inputMode="numeric" maxLength={6} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} aria-label="رمز التحقق" />
      {msg && <p className="text-sm text-rose-700" role="alert">{msg}</p>}
      <button className="btn-primary w-full" disabled={code.length !== 6}>تحقق</button>
    </form>
  );
}
