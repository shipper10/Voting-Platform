import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PRIVACY_LABEL, PRIVACY_NOTICE } from "@/lib/labels";
import VoteFlow, { type VoteElection } from "./VoteFlow";

export const dynamic = "force-dynamic";

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: e } = await sb.from("elections").select("id,title,description,privacy_level,box_status,starts_at,ends_at").eq("id", id).maybeSingle();
  if (!e) notFound();
  if (e.box_status !== "open") {
    return (
      <div className="card space-y-3">
        <h1 className="text-xl font-bold">{e.title}</h1>
        <p>الصندوق غير مفتوح حالياً.</p>
        <Link className="btn-ghost" href="/">رجوع</Link>
      </div>
    );
  }
  const [{ data: sections }, { data: candidates }] = await Promise.all([
    sb.from("election_sections").select("id,title,kind,display_order,allow_abstain,allow_other,min_choices,max_choices,seats").eq("election_id", id).order("display_order"),
    sb.from("candidates").select("id,section_id,name,bio,image_url,display_order").eq("election_id", id).eq("status", "approved").order("display_order"),
  ]);
  const election: VoteElection = {
    id: e.id, title: e.title, description: e.description, privacy: e.privacy_level,
    privacyLabel: PRIVACY_LABEL[e.privacy_level], privacyNotice: PRIVACY_NOTICE[e.privacy_level],
    sections: (sections ?? []).map((s) => ({
      ...s, candidates: (candidates ?? []).filter((c) => c.section_id === s.id),
    })),
  };
  return <VoteFlow election={election} />;
}
