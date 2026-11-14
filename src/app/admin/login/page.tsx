import { signIn } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signIn} className="card mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">دخول اللجنة</h1>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error === "forbidden" ? "هذا الحساب ليس مشرفاً نشطاً" : error}</p>}
      <div><label className="label" htmlFor="email">البريد</label><input id="email" name="email" type="email" required className="input" dir="ltr" autoComplete="username" /></div>
      <div><label className="label" htmlFor="password">كلمة المرور</label><input id="password" name="password" type="password" required className="input" dir="ltr" autoComplete="current-password" /></div>
      <button className="btn-primary w-full">دخول</button>
    </form>
  );
}
