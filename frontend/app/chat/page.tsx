"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import QAPairBlock from "@/components/QAPairBlock";
import ApiKeyModal from "@/components/ApiKeyModal";
import { createSession, listSessions, getMessages, deleteSession, streamChat } from "@/lib/api";
import { getApiKey } from "@/lib/apiKeyStore";
import type { Session, Message, QAPair, ImageAttachment, ModelId } from "@/lib/types";

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
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const pairs = useMemo(() => groupIntoPairs(messages), [messages]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoadingSessions(true);
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoadingSessions(false));
  }, [status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Prevent body scroll when sidebar is open on mobile (iOS Safari fix)
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  async function handleSelect(id: string) {
    setActiveId(id);
    setMessages([]);
    setStreamingText("");
    setManualToggles(new Set());
    setSidebarOpen(false);
    setLoadingMessages(true);
    try {
      const msgs = await getMessages(id);
      setMessages(msgs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleNew() {
    setActiveId(null);
    setMessages([]);
    setStreamingText("");
    setManualToggles(new Set());
    setSidebarOpen(false);
  }

  async function handleDelete(id: string) {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) handleNew();
  }

  async function fileToBase64(file: File): Promise<ImageAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // data:image/png;base64,xxxx -> extract base64 part
        const data = result.split(",")[1];
        resolve({
          media_type: file.type,
          data,
          preview_url: URL.createObjectURL(file),
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit(content: string, imageFiles: File[], model: ModelId) {
    let sessionId = activeId;
    if (!sessionId) {
      const session = await createSession(content.slice(0, 60) || "Image question");
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
      sessionId = session.id;
    }

    const images: ImageAttachment[] = await Promise.all(
      imageFiles.map(fileToBase64)
    );

    setMessages((prev) => [
      ...prev,
      { role: "user", content, created_at: new Date().toISOString(), images: images.length > 0 ? images : undefined },
    ]);
    setStreaming(true);
    setStreamingText("");

    let full = "";
    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "API key is not set. Please set your Anthropic API key from 'API Key' in the sidebar.", created_at: new Date().toISOString() },
        ]);
        setStreaming(false);
        setStreamingText("");
        setApiKeyModalOpen(true);
        return;
      }
      for await (const chunk of streamChat(sessionId, content, images.length > 0 ? images : undefined, apiKey, model)) {
        full += chunk;
        setStreamingText(full);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: full, created_at: new Date().toISOString() },
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === "API_KEY_INVALID") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "API key is invalid. Please set a valid key from 'API Key' in the sidebar.", created_at: new Date().toISOString() },
        ]);
      } else {
        throw err;
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
    }
  }

  function isCollapsed(pairIndex: number): boolean {
    const isLastPair = pairIndex === pairs.length - 1 && !streaming;
    const isStreamingPair = pairIndex === pairs.length - 1 && streaming;
    if (isLastPair || isStreamingPair) {
      return manualToggles.has(pairIndex);
    }
    return !manualToggles.has(pairIndex);
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
        onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
        apiKeyModalOpen={apiKeyModalOpen}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        loading={loadingSessions}
      />
      <ApiKeyModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-slate-100">claudia</h1>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {status === "loading" && (
              <div className="flex justify-center mt-20">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
              </div>
            )}

            {loadingMessages && (
              <div className="flex justify-center mt-20">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
              </div>
            )}

            {messages.length === 0 && !streaming && !loadingMessages && status !== "loading" && (
              <p className="text-slate-600 text-center mt-20 text-sm">
                Start a conversation
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
                <div className="max-w-[95%] md:max-w-[80%] bg-slate-800/60 text-slate-200 rounded-2xl rounded-bl-sm px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  {streamingText ? (
                    <span>{streamingText}</span>
                  ) : (
                    <span className="animate-pulse text-slate-500">cursor</span>
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
