"use client";
import ChatPanel from "@/components/ChatPanel";
import { PageHeader, Spinner } from "@/components/ui";
import { useQueryParam } from "@/lib/useQuery";

export default function Coach() {
  const q = useQueryParam("q");
  return (
    <>
      <PageHeader title="AI Exam Coach" subtitle="The Master Orchestrator routes your request to the right specialist agent and shows what it is doing." />
      {q === undefined ? <Spinner /> : <ChatPanel kind="coach" initial={q ?? undefined} />}
    </>
  );
}
