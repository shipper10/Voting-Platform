import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import ProposeForm from "./ProposeForm";

export const dynamic = "force-dynamic";

export default async function Propose({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: e } = await sb.from("elections").select("id,title,type,box_status").eq("id", id).maybeSingle();
  if (!e) notFound();
  const open = e.type === "name_proposals" && e.box_status === "scheduled";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{e.title}</h1>
      {open ? <ProposeForm electionId={e.id} /> : <p className="card">باب تقديم المقترحات مغلق.</p>}
      <Link href="/" className="btn-ghost w-full">رجوع</Link>
    </div>
  );
}
