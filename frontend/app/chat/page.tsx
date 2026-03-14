"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import QAPairBlock from "@/components/QAPairBlock";
import ApiKeyModal from "@/components/ApiKeyModal";
import SystemPromptModal from "@/components/SystemPromptModal";
import ContextModal from "@/components/ContextModal";
import { createSession, listSessions, getMessages, deleteSession, updateSession, streamChat, streamDebate } from "@/lib/api";
import { getApiKeyForProvider } from "@/lib/apiKeyStore";
import type { Session, Message, QAPair, ImageAttachment, ModelId, DebateStepId } from "@/lib/types";
import { getProviderForModel, parseDebateContent } from "@/lib/types";

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

  const [sessions, setSessionsRaw] = useState<Session[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = localStorage.getItem("claudia_sessions");
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const setSessions = useCallback((update: Session[] | ((prev: Session[]) => Session[])) => {
    setSessionsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      try { localStorage.setItem("claudia_sessions", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [manualToggles, setManualToggles] = useState<Set<number>>(new Set());
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [systemPromptModalOpen, setSystemPromptModalOpen] = useState(false);
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [streamingDebate, setStreamingDebate] = useState<{
    modelA: string;
    modelB: string;
    currentStep: DebateStepId | null;
    rawText: string;
  } | null>(null);

  const pairs = useMemo(() => groupIntoPairs(messages), [messages]);

  useEffect(() => {
    if (status !== "authenticated") return;
    // If we have cached sessions, show them immediately and skip loading state
    const hasCached = sessions.length > 0;
    if (!hasCached) setLoadingSessions(true);
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoadingSessions(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Ref to the last QAPairBlock element — used to scroll the user's question to the top
  const lastPairRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // Flag: scroll the latest question into view on next render
  const shouldScrollToQuestion = useRef(false);

  // When user sends a message, scroll so the question appears at the top of the viewport
  useEffect(() => {
    if (shouldScrollToQuestion.current && lastPairRef.current) {
      lastPairRef.current.scrollIntoView({ behavior: "instant", block: "start" });
      shouldScrollToQuestion.current = false;
    }
  });

  // Dynamic spacer: shrinks as the last pair (question + response) grows
  useEffect(() => {
    if (!scrollContainerRef.current || !lastPairRef.current || !spacerRef.current) return;
    const viewportH = scrollContainerRef.current.clientHeight;
    const pairH = lastPairRef.current.clientHeight;
    spacerRef.current.style.height = `${Math.max(0, viewportH - pairH)}px`;
  });

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
    setStreamingText("");
    setManualToggles(new Set());
    setSidebarOpen(false);

    // Show cached messages immediately if available
    const cacheKey = `claudia_msgs_${id}`;
    let hasCached = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setMessages(JSON.parse(cached));
        hasCached = true;
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }

    if (!hasCached) setLoadingMessages(true);
    try {
      const msgs = await getMessages(id);
      setMessages(msgs);
      // Cache without image data to save localStorage space
      try {
        const light = msgs.map((m: Message) => ({ ...m, images: undefined }));
        localStorage.setItem(cacheKey, JSON.stringify(light));
      } catch {}
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

  async function handleRename(id: string, newTitle: string) {
    try {
      const updated = await updateSession(id, newTitle);
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: updated.title } : s))
      );
    } catch (err) {
      console.error(err);
    }
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

  async function handleSubmit(content: string, imageFiles: File[], model: ModelId, debateMode?: boolean, secondModel?: ModelId, thinking?: boolean) {
    setStreaming(true);
    setStreamingText("");
    setStreamingDebate(debateMode ? { modelA: model, modelB: secondModel!, currentStep: null, rawText: "" } : null);

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
    shouldScrollToQuestion.current = true;

    let full = "";
    try {
      if (debateMode && secondModel) {
        // ── Debate mode ──
        const providerA = getProviderForModel(model);
        const providerB = getProviderForModel(secondModel);
        const apiKeyA = getApiKeyForProvider(providerA);
        const apiKeyB = getApiKeyForProvider(providerB);
        const anthropicKey = providerA !== "anthropic" && providerB !== "anthropic"
          ? getApiKeyForProvider("anthropic") : null;

        const providerNames: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
        if (!apiKeyA) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${providerNames[providerA]} APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。`, created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setStreamingDebate(null);
          setApiKeyModalOpen(true);
          return;
        }
        if (!apiKeyB) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${providerNames[providerB]} APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。`, created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setStreamingDebate(null);
          setApiKeyModalOpen(true);
          return;
        }

        for await (const chunk of streamDebate(sessionId, content, model, secondModel, apiKeyA, apiKeyB, images.length > 0 ? images : undefined, anthropicKey, thinking)) {
          full += chunk;
          setStreamingText(full);
        }

        // Reload messages from DB to get the <!--DEBATE:--> format saved by backend
        const msgs = await getMessages(sessionId);
        setMessages(msgs);
        try {
          const light = msgs.map((m: Message) => ({ ...m, images: undefined }));
          localStorage.setItem(`claudia_msgs_${sessionId}`, JSON.stringify(light));
        } catch {}
      } else {
        // ── Normal mode ──
        const provider = getProviderForModel(model);
        const apiKey = getApiKeyForProvider(provider);
        const anthropicKey = provider !== "anthropic" ? getApiKeyForProvider("anthropic") : null;
        if (!apiKey) {
          const providerNames: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `${providerNames[provider]} APIキーが設定されていません。サイドバーの「API Key 設定」からキーを設定してください。`, created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setApiKeyModalOpen(true);
          return;
        }
        for await (const chunk of streamChat(sessionId, content, images.length > 0 ? images : undefined, apiKey, model, anthropicKey, thinking)) {
          full += chunk;
          setStreamingText(full);
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: full, created_at: new Date().toISOString() },
        ]);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "API_KEY_INVALID") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "APIキーが無効です。サイドバーの「API Key 設定」から正しいキーを設定してください。", created_at: new Date().toISOString() },
        ]);
      } else {
        throw err;
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      setStreamingDebate(null);
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
    <div className="flex h-dvh overflow-hidden bg-theme-base">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onRename={handleRename}
        onNew={handleNew}
        userEmail={authSession?.user?.email}
        onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
        onOpenSystemPromptModal={() => setSystemPromptModalOpen(true)}
        onOpenContextModal={() => setContextModalOpen(true)}
        apiKeyModalOpen={apiKeyModalOpen}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        loading={loadingSessions}
      />
      <ApiKeyModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />
      <SystemPromptModal open={systemPromptModalOpen} onClose={() => setSystemPromptModalOpen(false)} activeSessionId={activeId} />
      <ContextModal open={contextModalOpen} onClose={() => setContextModalOpen(false)} />

      {/* DEV badge for staging environment */}
      {process.env.NEXT_PUBLIC_ENV === "staging" && (
        <div className="fixed top-2 right-2 z-50 bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded shadow">
          DEV v30.4
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-t-tertiary hover:text-t-secondary transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-t-primary">claudia</h1>
        </div>

        {/* Message list */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {status === "loading" && (
              <div className="flex justify-center mt-20">
                <div className="w-6 h-6 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
              </div>
            )}

            {loadingMessages && (
              <div className="flex justify-center mt-20">
                <div className="w-6 h-6 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
              </div>
            )}

            {messages.length === 0 && !streaming && !loadingMessages && status !== "loading" && (
              <p className="text-t-faint text-center mt-20 text-sm">
                Start a conversation
              </p>
            )}

            {pairs.map((pair, i) => {
              const isLastAndStreaming = i === pairs.length - 1 && streaming && !pair.assistant;
              const isLast = i === pairs.length - 1;
              return (
                <div key={i} ref={isLast ? lastPairRef : undefined}>
                  <QAPairBlock
                    pair={pair}
                    collapsed={isCollapsed(i)}
                    onToggle={() => handleToggle(i)}
                    streamingText={isLastAndStreaming ? streamingText : undefined}
                    streamingDebate={isLastAndStreaming ? streamingDebate : null}
                  />
                </div>
              );
            })}

            {/* Spinner while preparing (session creation, image conversion) */}
            {streaming && !streamingText && (messages.length === 0 || messages[messages.length - 1].role !== "user") && !pairs.some(p => !p.assistant) && (
              <div className="flex justify-center py-4">
                <div className="w-6 h-6 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
              </div>
            )}

            {/* Streaming for brand new pair (user message just sent, not yet in pairs) */}
            {streaming && pairs.length > 0 && pairs[pairs.length - 1].assistant !== null && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 mt-1 text-t-primary">
                  C
                </div>
                <div className="max-w-[95%] md:max-w-[80%] bg-theme-assistant-bubble text-t-secondary rounded-2xl rounded-bl-sm px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  {streamingText ? (
                    <span>{streamingText}</span>
                  ) : (
                    <span className="animate-pulse text-t-muted">cursor</span>
                  )}
                </div>
              </div>
            )}

            {/* Dynamic spacer: shrinks as the response grows */}
            <div ref={spacerRef} />
          </div>
        </div>

        <ChatInput onSubmit={handleSubmit} disabled={streaming || status === "loading"} sessionId={activeId} />
      </div>
    </div>
  );
}
