"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import MessageContent from "@/components/MessageContent";
import { createSession, listSessions, getMessages, deleteSession, streamChat } from "@/lib/api";
import type { Session, Message } from "@/lib/types";

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(console.error);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  async function handleSelect(id: string) {
    setActiveId(id);
    setStreamingText("");
    const msgs = await getMessages(id);
    setMessages(msgs);
  }

  async function handleNew() {
    setActiveId(null);
    setMessages([]);
    setStreamingText("");
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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#020509" }}>
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onNew={handleNew}
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

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">
                    C
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    m.role === "user"
                      ? "bg-slate-700 text-slate-100 rounded-br-sm"
                      : "bg-slate-800/60 text-slate-200 rounded-bl-sm"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <MessageContent content={m.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* ストリーミング中 */}
            {streaming && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">
                  C
                </div>
                <div className="max-w-[80%] bg-slate-800/60 text-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                  {streamingText ? (
                    <MessageContent content={streamingText} />
                  ) : (
                    <span className="animate-pulse text-slate-500">▋</span>
                  )}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <ChatInput onSubmit={handleSubmit} disabled={streaming} />
      </div>
    </div>
  );
}
