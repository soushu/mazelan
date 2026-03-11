"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import QAPairBlock from "@/components/QAPairBlock";
import { createSession, listSessions, getMessages, deleteSession, streamChat } from "@/lib/api";
import type { Session, Message, QAPair } from "@/lib/types";

function groupIntoPairs(messages: Message[]): QAPair[] {
  const pairs: QAPair[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      const next = messages[i + 1];
      if (next?.role === "assistant") {
        pairs.push({ user: m, assistant: next });
        i++; // skip the assistant message
      } else {
        pairs.push({ user: m, assistant: null });
      }
    }
    // skip orphan assistant messages (shouldn't happen normally)
  }
  return pairs;
}

export default function ChatPage() {
  const { data: authSession, status } = useSession();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [manualToggles, setManualToggles] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const pairs = useMemo(() => groupIntoPairs(messages), [messages]);

  useEffect(() => {
    if (status !== "authenticated") return;
    listSessions().then(setSessions).catch(console.error);
  }, [status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  async function handleSelect(id: string) {
    setActiveId(id);
    setStreamingText("");
    setManualToggles(new Set());
    const msgs = await getMessages(id);
    setMessages(msgs);
  }

  async function handleNew() {
    setActiveId(null);
    setMessages([]);
    setStreamingText("");
    setManualToggles(new Set());
  }

  async function handleDelete(id: string) {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) handleNew();
  }

  async function handleSubmit(content: string) {
    // セッションがなければ新規作成
    let sessionId = activeId;
    if (!sessionId) {
      const session = await createSession(content.slice(0, 60));
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
      sessionId = session.id;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content, created_at: new Date().toISOString() },
    ]);
    setStreaming(true);
    setStreamingText("");

    let full = "";
    try {
      for await (const chunk of streamChat(sessionId, content)) {
        full += chunk;
        setStreamingText(full);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: full, created_at: new Date().toISOString() },
      ]);
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  function isCollapsed(pairIndex: number): boolean {
    const isLastPair = pairIndex === pairs.length - 1 && !streaming;
    const isStreamingPair = pairIndex === pairs.length - 1 && streaming;
    // Last pair and streaming pair are always expanded by default
    if (isLastPair || isStreamingPair) {
      return manualToggles.has(pairIndex); // toggled = collapsed
    }
    // Other pairs are collapsed by default
    return !manualToggles.has(pairIndex); // toggled = expanded
  }

  function handleToggle(pairIndex: number) {
    setManualToggles((prev) => {
      const next = new Set(prev);
      if (next.has(pairIndex)) {
        next.delete(pairIndex);
      } else {
        next.add(pairIndex);
      }
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#020509" }}>
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onNew={handleNew}
        userEmail={authSession?.user?.email}
      />

      {/* メインエリア */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* メッセージ一覧 */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && !streaming && (
              <p className="text-slate-600 text-center mt-20 text-sm">
                質問を入力して会話を始めましょう
              </p>
            )}

            {pairs.map((pair, i) => {
              const isLastAndStreaming = i === pairs.length - 1 && streaming && !pair.assistant;
              return (
                <QAPairBlock
                  key={i}
                  pair={pair}
                  collapsed={isCollapsed(i)}
                  onToggle={() => handleToggle(i)}
                  streamingText={isLastAndStreaming ? streamingText : undefined}
                />
              );
            })}

            {/* Streaming for brand new pair (user message just sent, not yet in pairs) */}
            {streaming && pairs.length > 0 && pairs[pairs.length - 1].assistant !== null && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">
                  C
                </div>
                <div className="max-w-[80%] bg-slate-800/60 text-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                  {streamingText ? (
                    <span>{streamingText}</span>
                  ) : (
                    <span className="animate-pulse text-slate-500">▋</span>
                  )}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <ChatInput onSubmit={handleSubmit} disabled={streaming || status === "loading"} />
      </div>
    </div>
  );
}
