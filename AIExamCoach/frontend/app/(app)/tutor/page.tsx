"use client";
import ChatPanel from "@/components/ChatPanel";
import { PageHeader, Spinner } from "@/components/ui";
import { useQueryParam } from "@/lib/useQuery";

export default function Tutor() {
  const topic = useQueryParam("topic");
  return (
    <>
      <PageHeader title="AI Tutor" subtitle="Structured 10-part lessons grounded on your own study material, with follow-up questions in context." />
      {topic === undefined ? <Spinner /> : <ChatPanel kind="tutor" levelSelector initial={topic ? `Teach me ${topic}` : undefined} />}
    </>
  );
}
