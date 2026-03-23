"use client";

import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import ChatInput from "@/components/ChatInput";
import QAPairBlock from "@/components/QAPairBlock";
import ApiKeyModal from "@/components/ApiKeyModal";
import SystemPromptModal from "@/components/SystemPromptModal";
import ContextModal from "@/components/ContextModal";
import { createSession, listSessions, getMessages, deleteSession, updateSession, toggleSessionStar, streamChat, streamDebate, forkSession } from "@/lib/api";
import { enqueue, processQueue } from "@/lib/offlineQueue";
import { getApiKeyForProvider, getGoogleFallbackKey } from "@/lib/apiKeyStore";
import type { Session, Message, QAPair, ImageAttachment, ModelId, DebateStepId } from "@/lib/types";
import { getProviderForModel, parseDebateContent, parseUsageMarker } from "@/lib/types";
import { useTranslations } from "next-intl";

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
  const t = useTranslations();
  const { data: authSession, status } = useSession();

  const [sessions, setSessionsRaw] = useState<Session[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = localStorage.getItem("mazelan_sessions");
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const setSessions = useCallback((update: Session[] | ((prev: Session[]) => Session[])) => {
    setSessionsRaw((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      try { localStorage.setItem("mazelan_sessions", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const [activeId, setActiveIdRaw] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem("mazelan_active_session") || null; } catch { return null; }
  });
  const setActiveId = useCallback((id: string | null) => {
    setActiveIdRaw(id);
    try {
      if (id) localStorage.setItem("mazelan_active_session", id);
      else localStorage.removeItem("mazelan_active_session");
    } catch {}
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingModel, setStreamingModel] = useState<string | undefined>(undefined);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [manualToggles, setManualToggles] = useState<Set<number>>(new Set());
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyModalTab, setApiKeyModalTab] = useState<string | undefined>(undefined);
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
    // Clear cache if user changed (e.g. logged in as different account)
    const userId = (authSession?.user as { id?: string })?.id || "";
    const cachedUserId = localStorage.getItem("mazelan_user_id") || "";
    if (userId && cachedUserId && userId !== cachedUserId) {
      const keys = Object.keys(localStorage).filter(k => k.startsWith("mazelan_sessions") || k.startsWith("mazelan_msgs_") || k.startsWith("mazelan_active_session"));
      keys.forEach(k => localStorage.removeItem(k));
      setSessions([]);
      setActiveId(null);
      setMessages([]);
    }
    if (userId) localStorage.setItem("mazelan_user_id", userId);
    // If we have cached sessions, show them immediately and skip loading state
    const hasCached = sessions.length > 0;
    if (!hasCached) setLoadingSessions(true);
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoadingSessions(false));

    // Restore active session on reload
    if (activeId) {
      const cacheKey = `mazelan_msgs_${activeId}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) setMessages(JSON.parse(cached));
      } catch {}
      setLoadingMessages(true);
      getMessages(activeId)
        .then((msgs) => {
          setMessages(msgs);
          shouldScrollToQuestion.current = true;
          try {
            const light = msgs.map((m: Message) => ({ ...m, images: undefined }));
            localStorage.setItem(cacheKey, JSON.stringify(light));
          } catch {}
        })
        .catch(console.error)
        .finally(() => setLoadingMessages(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Ref to the last QAPairBlock element — used to scroll the user's question to the top
  const lastPairRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // Flag: scroll the latest question into view on next render
  const shouldScrollToQuestion = useRef(false);
  // Track if we need to re-scroll when first streaming chunk arrives (mobile keyboard dismiss fix)
  const needsStreamingScroll = useRef(false);
  // Ref to track streaming state for visibility change handler
  const streamingRef = useRef(false);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // When user sends a message, scroll so the question appears at the top of the viewport
  useLayoutEffect(() => {
    if (shouldScrollToQuestion.current && lastPairRef.current) {
      lastPairRef.current.scrollIntoView({ behavior: "instant", block: "start" });
      shouldScrollToQuestion.current = false;
    }
  });

  // Re-scroll when first streaming chunk arrives (keyboard may have closed, changing viewport)
  useLayoutEffect(() => {
    if (needsStreamingScroll.current && streamingText && lastPairRef.current) {
      lastPairRef.current.scrollIntoView({ behavior: "instant", block: "start" });
      needsStreamingScroll.current = false;
    }
  }, [streamingText]);

  // Re-scroll on viewport resize (mobile keyboard dismiss changes viewport height)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function handleResize() {
      if (needsStreamingScroll.current && lastPairRef.current) {
        lastPairRef.current.scrollIntoView({ behavior: "instant", block: "start" });
      }
    }
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  // Foreground resume: reload messages from DB if streaming was interrupted by background
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && streamingRef.current && activeIdRef.current) {
        // App came back to foreground while streaming — reload from DB
        const sid = activeIdRef.current;
        getMessages(sid).then((msgs) => {
          if (msgs.length > 0) {
            setMessages(msgs);
            try {
              const light = msgs.map((m: Message) => ({ ...m, images: undefined }));
              localStorage.setItem(`mazelan_msgs_${sid}`, JSON.stringify(light));
            } catch {}
          }
          setStreaming(false);
          setStreamingText("");
          setStreamingModel(undefined);
          setStreamingDebate(null);
          setToolStatus(null);
        }).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Process offline queue on mount and when connectivity is restored
  useEffect(() => {
    if (navigator.onLine) processQueue();
    const handleOnline = () => processQueue();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // Dynamic spacer: use layoutEffect to set height before paint, avoiding flicker
  useLayoutEffect(() => {
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
    const cacheKey = `mazelan_msgs_${id}`;
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
      shouldScrollToQuestion.current = true;
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
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) handleNew();
    try {
      if (!navigator.onLine) throw new Error("offline");
      await deleteSession(id);
    } catch {
      enqueue({ type: "delete", sessionId: id });
    }
  }

  async function handleRename(id: string, newTitle: string) {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s))
    );
    try {
      if (!navigator.onLine) throw new Error("offline");
      const updated = await updateSession(id, newTitle);
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: updated.title } : s))
      );
    } catch {
      enqueue({ type: "rename", sessionId: id, title: newTitle });
    }
  }

  const handleExport = useCallback(async (sessionId: string, format: "text" | "pdf") => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    let msgs: Message[];
    if (sessionId === activeId) {
      msgs = messages;
    } else {
      msgs = await getMessages(sessionId);
    }
    if (msgs.length === 0) return;
    const { exportAsText, exportAsPdf } = await import("@/lib/exportChat");
    if (format === "text") {
      exportAsText(session.title, msgs);
    } else {
      await exportAsPdf(session.title, msgs);
    }
  }, [sessions, activeId, messages]);

  async function handleToggleStar(id: string) {
    setSessions((prev) => {
      const toggled = prev.map((s) => (s.id === id ? { ...s, is_starred: !s.is_starred } : s));
      const target = toggled.find((s) => s.id === id)!;
      const rest = toggled.filter((s) => s.id !== id);
      const starred = rest.filter((s) => s.is_starred);
      const unstarred = rest.filter((s) => !s.is_starred);
      if (target.is_starred) {
        return [target, ...starred, ...unstarred];
      } else {
        return [...starred, target, ...unstarred];
      }
    });
    try {
      if (!navigator.onLine) throw new Error("offline");
      await toggleSessionStar(id);
    } catch {
      enqueue({ type: "star", sessionId: id });
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
    // Pre-flight: check if API key is needed
    const provider = getProviderForModel(model);
    const GEMINI_FREE_MODELS = new Set(["gemini-2.5-flash-lite"]);
    const needsKey = (provider === "anthropic" && !getApiKeyForProvider("anthropic"))
      || (provider === "openai" && !getApiKeyForProvider("openai"))
      || (provider === "google" && !GEMINI_FREE_MODELS.has(model) && !getApiKeyForProvider("google"));
    const secondProvider = secondModel ? getProviderForModel(secondModel) : null;
    const secondNeedsKey = debateMode && secondProvider && secondModel && (
      (secondProvider === "anthropic" && !getApiKeyForProvider("anthropic"))
      || (secondProvider === "openai" && !getApiKeyForProvider("openai"))
      || (secondProvider === "google" && !GEMINI_FREE_MODELS.has(secondModel) && !getApiKeyForProvider("google"))
    );
    if (needsKey) {
      setApiKeyModalTab(provider);
      setApiKeyModalOpen(true);
      return;
    }
    if (secondNeedsKey && secondProvider) {
      setApiKeyModalTab(secondProvider);
      setApiKeyModalOpen(true);
      return;
    }

    setStreaming(true);
    setStreamingText("");
    setStreamingModel(model);
    setStreamingDebate(debateMode ? { modelA: model, modelB: secondModel!, currentStep: null, rawText: "" } : null);

    let full = "";
    try {
    let sessionId = activeId;
    if (!sessionId) {
      const session = await createSession(content.slice(0, 60) || t("chat.imageQuestion"));
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
    needsStreamingScroll.current = true;
      if (debateMode && secondModel) {
        // ── Debate mode ──
        const providerA = getProviderForModel(model);
        const providerB = getProviderForModel(secondModel);
        const apiKeyA = getApiKeyForProvider(providerA);
        const apiKeyB = getApiKeyForProvider(providerB);
        const anthropicKey = providerA !== "anthropic" && providerB !== "anthropic"
          ? getApiKeyForProvider("anthropic") : null;

        if (!apiKeyA && providerA !== "google") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: t("chat.errorApiKeyMissing", { provider: providerA.charAt(0).toUpperCase() + providerA.slice(1) }), created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setStreamingDebate(null);
          setApiKeyModalOpen(true);
          return;
        }
        if (!apiKeyB && providerB !== "google") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: t("chat.errorApiKeyMissing", { provider: providerB.charAt(0).toUpperCase() + providerB.slice(1) }), created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setStreamingDebate(null);
          setApiKeyModalOpen(true);
          return;
        }

        for await (const chunk of streamDebate(sessionId, content, model, secondModel, apiKeyA, apiKeyB, images.length > 0 ? images : undefined, anthropicKey, thinking, getGoogleFallbackKey())) {
          full += chunk;
          setStreamingText(full);
        }

        // If the stream ended with an error marker, extract just the error message
        // (errors cause db.rollback() so the message won't be in DB)
        if (full.includes("⚠️")) {
          const errorMatch = full.match(/⚠️[^\n]*/);
          const errorMsg = errorMatch ? errorMatch[0] : `⚠️ ${t("chat.errorGeneric")}`;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: errorMsg, created_at: new Date().toISOString(), model },
          ]);
        } else {
          // Reload messages from DB to get the <!--DEBATE:--> format saved by backend
          const msgs = await getMessages(sessionId);
          setMessages(msgs);
          try {
            const light = msgs.map((m: Message) => ({ ...m, images: undefined }));
            localStorage.setItem(`mazelan_msgs_${sessionId}`, JSON.stringify(light));
          } catch {}
        }
      } else {
        // ── Normal mode ──
        const provider = getProviderForModel(model);
        const apiKey = getApiKeyForProvider(provider);
        const anthropicKey = provider !== "anthropic" ? getApiKeyForProvider("anthropic") : null;
        if (!apiKey && provider !== "google") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: t("chat.errorApiKeyMissing", { provider: provider.charAt(0).toUpperCase() + provider.slice(1) }), created_at: new Date().toISOString() },
          ]);
          setStreaming(false);
          setStreamingText("");
          setApiKeyModalOpen(true);
          return;
        }
        let thinkingCleared = false;
        if (thinking) setToolStatus(t("chat.thinkingStatus"));
        for await (const chunk of streamChat(sessionId, content, images.length > 0 ? images : undefined, apiKey, model, anthropicKey, thinking, getGoogleFallbackKey())) {
          full += chunk;
          // Clear thinking status once first real text arrives
          const displayCheck = full.replace(/<!--STATUS:.*?-->/g, "").replace(/\n<!--USAGE:\{.*?\}-->$/, "");
          if (thinking && !thinkingCleared && displayCheck.length > 0) {
            setToolStatus(null);
            thinkingCleared = true;
          }
          // Parse tool status markers
          const statusMatch = full.match(/<!--STATUS:(.*?)-->/g);
          if (statusMatch) {
            const lastStatus = statusMatch[statusMatch.length - 1].match(/<!--STATUS:(.*?)-->/)![1];
            setToolStatus(lastStatus || null);
          }
          // Strip status markers and usage marker from display
          const display = full.replace(/<!--STATUS:.*?-->/g, "").replace(/\n<!--USAGE:\{.*?\}-->$/, "");
          setStreamingText(display);
        }
        setToolStatus(null);
        const stripped = full.replace(/<!--STATUS:.*?-->/g, "");
        const { text: cleanText, usage } = parseUsageMarker(stripped);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant", content: cleanText, created_at: new Date().toISOString(), model,
            ...(usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost: usage.cost } : {}),
          },
        ]);
      }
    } catch (err) {
      console.error("handleSubmit error:", err);
      if (err instanceof Error && err.message === "API_KEY_INVALID") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: t("chat.errorApiKeyInvalid"), created_at: new Date().toISOString() },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${t("chat.errorSending")}`, created_at: new Date().toISOString() },
        ]);
      }
    } finally {
      setStreaming(false);
      setStreamingText("");
      setStreamingModel(undefined);
      setStreamingDebate(null);
      setToolStatus(null);
    }
  }

  async function handleFork(pairIndex: number) {
    if (!activeId) return;
    try {
      const newSession = await forkSession(activeId, pairIndex);
      // Add new session to list and switch to it
      setSessions((prev) => [newSession, ...prev]);
      setActiveId(newSession.id);
      const msgs = await getMessages(newSession.id);
      setMessages(msgs);
      setManualToggles(new Set());
    } catch (err) {
      console.error("Fork failed:", err);
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
        onToggleStar={handleToggleStar}
        onExport={handleExport}
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
      <ApiKeyModal open={apiKeyModalOpen} onClose={() => { setApiKeyModalOpen(false); setApiKeyModalTab(undefined); }} initialTab={apiKeyModalTab} />
      <SystemPromptModal open={systemPromptModalOpen} onClose={() => setSystemPromptModalOpen(false)} activeSessionId={activeId} />
      <ContextModal open={contextModalOpen} onClose={() => setContextModalOpen(false)} />

      {/* DEV badge for staging environment */}
      {process.env.NEXT_PUBLIC_ENV === "staging" && (
        <div className="fixed top-2 right-2 z-50 bg-yellow-500 text-black text-xs font-bold px-2 py-0.5 rounded shadow">
          DEV v55.2
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
          <h1 className="text-base font-semibold text-t-primary truncate">
            {activeId ? (sessions.find(s => s.id === activeId)?.title ?? t("app.name")) : t("app.name")}
          </h1>
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
              <div className="flex flex-col items-center justify-center mt-16 md:mt-24 px-4">
                <div className="mb-4">
                  <svg width="64" height="64" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="welcome-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style={{stopColor:'#67E8F9'}}/>
                        <stop offset="100%" style={{stopColor:'#0369A1'}}/>
                      </linearGradient>
                    </defs>
                    <circle cx="256" cy="256" r="240" fill="url(#welcome-bg)"/>
                    <g transform="translate(256,256) scale(18)" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M-6,-5 Q-1,-2 0,1" opacity="0.5"/>
                      <path d="M0,1 Q2,0 6,-3" opacity="0.5"/>
                      <path d="M0,1 L1,7" opacity="0.5"/>
                      <circle cx="-6" cy="-5" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
                      <circle cx="6" cy="-3" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
                      <circle cx="0" cy="1" r="1.3" fill="white" stroke="white" strokeWidth="1" opacity="0.75"/>
                      <circle cx="1" cy="7" r="2" fill="white" stroke="white" strokeWidth="1.5"/>
                    </g>
                  </svg>
                </div>
                <h2 className="text-2xl md:text-3xl font-semibold text-t-primary mb-1">{t("app.name")}</h2>
                <p className="text-t-tertiary text-sm mb-8">{t("chat.welcome")}</p>
                <div className="grid grid-cols-2 gap-2 md:gap-3 w-full max-w-md">
                  {[
                    { icon: "✈️", text: t("chat.suggestion1") },
                    { icon: "🗺️", text: t("chat.suggestion2") },
                    { icon: "💡", text: t("chat.suggestion3") },
                    { icon: "📝", text: t("chat.suggestion4") },
                  ].map((s) => (
                    <button
                      key={s.text}
                      onClick={() => {
                        const ta = document.querySelector<HTMLTextAreaElement>("textarea");
                        if (ta) {
                          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                          nativeInputValueSetter?.call(ta, s.text);
                          ta.dispatchEvent(new Event("input", { bubbles: true }));
                          ta.focus();
                        }
                      }}
                      className="flex items-start gap-2 p-3 md:p-4 rounded-xl border border-border-primary bg-theme-surface hover:bg-theme-hover text-left transition-colors"
                    >
                      <span className="text-lg flex-shrink-0">{s.icon}</span>
                      <span className="text-sm text-t-secondary">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                    streamingModel={isLastAndStreaming ? streamingModel : undefined}
                    toolStatus={isLastAndStreaming ? toolStatus : null}
                    pairIndex={i}
                    onFork={!streaming && pair.assistant ? handleFork : undefined}
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
                <div className={`bg-theme-assistant-bubble text-t-secondary rounded-2xl rounded-bl-sm px-3 py-2.5 md:px-4 md:py-3 text-sm${streamingText ? "" : " w-fit"}`}>
                  {streamingText ? (
                    <>
                      <span>{streamingText}</span>
                      {toolStatus ? (
                        <span className="block text-xs text-t-muted mt-1 animate-pulse">{toolStatus}</span>
                      ) : (
                        <span className="inline-flex gap-1 items-center mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:300ms]" />
                        </span>
                      )}
                    </>
                  ) : toolStatus ? (
                    <span className="inline-flex items-center gap-2 text-xs text-t-muted animate-pulse py-1">
                      <span className="w-4 h-4 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
                      {toolStatus}
                    </span>
                  ) : (
                    <span className="inline-flex gap-1 items-center py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Dynamic spacer: only while streaming, removed after response completes */}
            {streaming && (
              <div ref={spacerRef} className="h-[70dvh]" />
            )}
          </div>
        </div>

        <ChatInput onSubmit={handleSubmit} disabled={streaming || status === "loading"} sessionId={activeId} onOpenApiKeyModal={(provider) => { setApiKeyModalTab(provider); setApiKeyModalOpen(true); }} />
      </div>
    </div>
  );
}
