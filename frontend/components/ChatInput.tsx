"use client";

import { useRef, useEffect, useState, useCallback, useMemo, KeyboardEvent, DragEvent } from "react";
import { MODEL_GROUPS, type ModelId } from "@/lib/types";
import { getApiKeyForProvider } from "@/lib/apiKeyStore";
import { useTranslations } from "next-intl";

const COST_LABELS: Record<string, string> = {
  "gemini-2.5-flash-lite": "x1",
  "gemini-2.5-flash": "x2",
  "gemini-2.5-pro": "x30",
  "gemini-3.5-flash": "x28",
  "gemini-3.1-pro-preview": "x37",
  "gpt-4o-mini": "x1",
  "o3-mini": "x7",
  "gpt-4o": "x17",
  "claude-haiku-4-5-20251001": "x1",
  "claude-sonnet-4-6": "x4",
  "claude-opus-4-6": "x19",
};

// Flash Lite + Flash are free on Google's free tier
const GEMINI_FREE_MODELS = new Set(["gemini-2.5-flash-lite", "gemini-2.5-flash"]);

function getCostLabel(modelId: string, isGoogleFree: boolean): string {
  const cost = COST_LABELS[modelId] || "";
  if (!cost) return "";
  const isFree = isGoogleFree && GEMINI_FREE_MODELS.has(modelId);
  return isFree ? ` (Free) ${cost}` : ` ${cost}`;
}

type Props = {
  onSubmit: (content: string, images: File[], model: ModelId, debateMode?: boolean, secondModel?: ModelId, thinking?: boolean, translationMode?: boolean, audioBlob?: Blob | null, translationFastMode?: boolean) => void;
  disabled: boolean;
  sessionId: string | null;
  onOpenApiKeyModal?: (provider?: string) => void;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const DEFAULT_MODEL: ModelId = "gemini-2.5-flash-lite";
const DEFAULT_MODEL2: ModelId = "gpt-4o";

function getSessionModel(sessionId: string | null): { model: ModelId; model2: ModelId } {
  if (typeof window === "undefined") return { model: DEFAULT_MODEL, model2: DEFAULT_MODEL2 };
  if (sessionId) {
    try {
      const data = JSON.parse(localStorage.getItem("mazelan_session_models") || "{}");
      if (data[sessionId]) return { model: data[sessionId].model || DEFAULT_MODEL, model2: data[sessionId].model2 || DEFAULT_MODEL2 };
    } catch {}
  }
  return {
    model: (localStorage.getItem("mazelan_model") as ModelId) || DEFAULT_MODEL,
    model2: (localStorage.getItem("mazelan_model2") as ModelId) || DEFAULT_MODEL2,
  };
}

function saveSessionModel(sessionId: string | null, model: ModelId, model2: ModelId) {
  try {
    localStorage.setItem("mazelan_model", model);
    localStorage.setItem("mazelan_model2", model2);
    if (sessionId) {
      const data = JSON.parse(localStorage.getItem("mazelan_session_models") || "{}");
      data[sessionId] = { model, model2 };
      localStorage.setItem("mazelan_session_models", JSON.stringify(data));
    }
  } catch {}
}

// Translation mode is persisted per session. For new chats (sessionId=null), we save
// to a "__pending__" key so the state survives the ChatInput remount that happens when
// activeId changes (the parent's key prop includes activeId, forcing a fresh mount).
function getSessionTranslationMode(sessionId: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const data = JSON.parse(localStorage.getItem("mazelan_translation_modes") || "{}");
    if (sessionId && data[sessionId] !== undefined) return !!data[sessionId];
    // New session just created (sessionId set, no entry yet) → adopt pending state
    if (sessionId && data["__pending__"]) {
      data[sessionId] = true;
      delete data["__pending__"];
      localStorage.setItem("mazelan_translation_modes", JSON.stringify(data));
      return true;
    }
    if (!sessionId && data["__pending__"]) return true;
    return false;
  } catch { return false; }
}

function saveSessionTranslationMode(sessionId: string | null, enabled: boolean) {
  try {
    const key = sessionId || "__pending__";
    const data = JSON.parse(localStorage.getItem("mazelan_translation_modes") || "{}");
    if (enabled) data[key] = true;
    else delete data[key];
    localStorage.setItem("mazelan_translation_modes", JSON.stringify(data));
  } catch {}
}

// Translation fast mode (per-session, mirrors the translation mode pattern so the toggle
// state survives the ChatInput remount that happens when a new session is created).
function getSessionTranslationFastMode(sessionId: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const data = JSON.parse(localStorage.getItem("mazelan_translation_fast_modes") || "{}");
    if (sessionId && data[sessionId] !== undefined) return !!data[sessionId];
    if (sessionId && data["__pending__"]) {
      data[sessionId] = true;
      delete data["__pending__"];
      localStorage.setItem("mazelan_translation_fast_modes", JSON.stringify(data));
      return true;
    }
    if (!sessionId && data["__pending__"]) return true;
    return false;
  } catch { return false; }
}

function saveSessionTranslationFastMode(sessionId: string | null, enabled: boolean) {
  try {
    const key = sessionId || "__pending__";
    const data = JSON.parse(localStorage.getItem("mazelan_translation_fast_modes") || "{}");
    if (enabled) data[key] = true;
    else delete data[key];
    localStorage.setItem("mazelan_translation_fast_modes", JSON.stringify(data));
  } catch {}
}

export default function ChatInput({ onSubmit, disabled, sessionId, onOpenApiKeyModal }: Props) {
  const t = useTranslations();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => getSessionModel(null).model);
  const [debateMode, setDebateMode] = useState(false);
  const [secondModel, setSecondModel] = useState<ModelId>(() => getSessionModel(null).model2);
  const [thinking, setThinking] = useState(false);
  const [translationMode, setTranslationMode] = useState(() => getSessionTranslationMode(sessionId));
  const [translationFastMode, setTranslationFastMode] = useState(() => getSessionTranslationFastMode(sessionId));
  const [isRecording, setIsRecording] = useState(false);
  const [micErrorModal, setMicErrorModal] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const hasGoogleKey = !!getApiKeyForProvider("google");

  function isModelLocked(modelId: string, provider: string): boolean {
    if (provider === "anthropic" && !getApiKeyForProvider("anthropic")) return true;
    if (provider === "openai" && !getApiKeyForProvider("openai")) return true;
    // Google: only Flash Lite is free without key; Flash and Pro require key
    if (provider === "google" && !hasGoogleKey && !GEMINI_FREE_MODELS.has(modelId)) return true;
    return false;
  }
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  const supportsThinking = useMemo(() => {
    for (const g of MODEL_GROUPS) {
      const m = g.models.find((m) => m.id === selectedModel);
      if (m) return !!m.supports_thinking;
    }
    return false;
  }, [selectedModel]);

  useEffect(() => {
    const { model, model2 } = getSessionModel(sessionId);
    setSelectedModel(model);
    setSecondModel(model2);
    setDebateMode(false);
    // getSessionTranslationMode adopts __pending__ when sessionId is newly set,
    // preserving the toggle state through the remount that happens after handleSubmit
    // creates a session (parent's key prop changes from "new-X" to "<id>-X").
    setTranslationMode(getSessionTranslationMode(sessionId));
    setTranslationFastMode(getSessionTranslationFastMode(sessionId));
    // Auto-focus input when opening a new/different session
    ref.current?.focus();
  }, [sessionId]);

  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  useEffect(() => {
    if (!modeMenuOpen && !attachMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (modeMenuOpen && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
      if (attachMenuOpen && attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modeMenuOpen, attachMenuOpen]);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const validFiles = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type));
    if (validFiles.length === 0) return;
    setAttachedImages((prev) => [...prev, ...validFiles]);
    setPreviews((prev) => [...prev, ...validFiles.map((f) => URL.createObjectURL(f))]);
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(previews[index]);
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  function submit(audioBlob?: Blob | null) {
    const value = ref.current?.value.trim();
    if (!value && attachedImages.length === 0 && !audioBlob) return;
    onSubmit(value || "", [...attachedImages], selectedModel, debateMode, debateMode ? secondModel : undefined, thinking && supportsThinking, translationMode, audioBlob, translationFastMode);
    if (ref.current) ref.current.value = "";
    previews.forEach((url) => URL.revokeObjectURL(url));
    setAttachedImages([]);
    if (debateMode) setDebateMode(false);
    setPreviews([]);
  }

  async function startRecording() {
    setMicErrorModal(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicErrorModal("このブラウザはマイク入力に対応していません");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Stop the underlying tracks so the mic indicator goes away
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        // Auto-submit the audio (translation mode handles the rest)
        if (blob.size > 0) submit(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setMicErrorModal(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "マイクのアクセスが拒否されています。ブラウザのサイト設定からマイクを許可してください。"
          : "マイクを起動できませんでした。"
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }

  // Stop recording cleanly if the component unmounts mid-recording
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter") return;
    // IME変換中（日本語入力等）はEnterで送信しない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Mobile: Enter = newline (send via button only)
    if (isMobile) return;
    // PC: Ctrl/Cmd/Shift+Enter = insert newline
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.substring(0, start) + "\n" + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    // PC: Enter = send
    e.preventDefault();
    submit();
  }

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types.includes("Files")) setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer?.files || null);
  }, []);

  const modeLabel = thinking && supportsThinking ? t("input.thinkingMode") : t("input.fastMode");
  const containerRef = useRef<HTMLDivElement>(null);

  // Push input area above mobile keyboard/predictive bar using visualViewport
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function handleResize() {
      const el = containerRef.current;
      if (!el || !vv) return;
      const offsetBottom = window.innerHeight - vv.height - vv.offsetTop;
      el.style.paddingBottom = offsetBottom > 0 ? `${offsetBottom}px` : "0px";
    }
    vv.addEventListener("resize", handleResize);
    vv.addEventListener("scroll", handleResize);
    return () => {
      vv.removeEventListener("resize", handleResize);
      vv.removeEventListener("scroll", handleResize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`p-2 md:p-4 border-t transition-colors ${
        dragging ? "border-blue-500 bg-blue-500/10" : "border-border-primary"
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="relative max-w-3xl mx-auto">
        {/* Image previews */}
        {previews.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {previews.map((url, i) => (
              <div key={i} className="relative group">
                <img
                  src={url}
                  alt={t("chat.imageAlt", { number: i + 1 })}
                  className="w-16 h-16 object-cover rounded-lg border border-border-secondary"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 md:w-5 md:h-5 bg-theme-hover hover:bg-red-500 text-white rounded-full text-xs flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  title={t("chat.removeImage")}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input box — textarea + toolbar inside one rounded container */}
        <div className="bg-theme-input rounded-xl focus-within:ring-1 focus-within:ring-border-secondary">
          <textarea
            ref={ref}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) handleFiles(files);
            }}
            placeholder={t("chat.typeMessage")}
            rows={2}
            className="w-full bg-transparent text-t-secondary placeholder-t-placeholder text-sm px-4 py-3 resize-none outline-none disabled:opacity-50 font-sans"
          />
          {/* Toolbar row inside the box: paperclip, mode selector + send */}
          <div className="flex items-center px-2 pb-2">
            {/* Left: paperclip with optional camera menu on mobile */}
            <div className="relative" ref={attachMenuRef}>
              <button
                onClick={() => {
                  if (isMobile) {
                    setAttachMenuOpen(!attachMenuOpen);
                  } else {
                    fileRef.current?.click();
                  }
                }}
                disabled={disabled}
                className="p-1.5 text-t-muted hover:text-t-secondary disabled:opacity-50 transition-colors"
                title={t("chat.attachImage")}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
              </button>

              {attachMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 bg-theme-elevated border border-border-primary rounded-lg shadow-lg overflow-hidden min-w-[160px] z-50">
                  <button
                    onClick={() => { setAttachMenuOpen(false); fileRef.current?.click(); }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-t-secondary hover:bg-theme-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    {t("chat.choosePhoto")}
                  </button>
                  <button
                    onClick={() => { setAttachMenuOpen(false); cameraRef.current?.click(); }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-t-secondary hover:bg-theme-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                    {t("chat.takePhoto")}
                  </button>
                </div>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Right group: mode selector + send */}
            {supportsThinking && (
              <div className="relative" ref={modeMenuRef}>
                <button
                  onClick={() => setModeMenuOpen(!modeMenuOpen)}
                  disabled={disabled}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
                    thinking
                      ? "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                      : "text-t-muted hover:text-t-secondary bg-theme-hover/50"
                  }`}
                >
                  {modeLabel}
                  <svg className={`w-3 h-3 transition-transform ${modeMenuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {modeMenuOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-56 bg-theme-input border border-border-secondary rounded-xl shadow-lg overflow-hidden z-20">
                    <button
                      onClick={() => { setThinking(false); setModeMenuOpen(false); }}
                      className={`w-full text-left px-4 py-3 transition-colors ${!thinking ? "bg-theme-hover" : "hover:bg-theme-hover"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-t-secondary">{t("input.fastMode")}</span>
                        {!thinking && (
                          <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-t-muted mt-0.5">{t("input.fastDescription")}</p>
                    </button>
                    <button
                      onClick={() => { setThinking(true); setModeMenuOpen(false); }}
                      className={`w-full text-left px-4 py-3 transition-colors ${thinking ? "bg-theme-hover" : "hover:bg-theme-hover"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-t-secondary">{t("input.thinkingMode")}</span>
                        {thinking && (
                          <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-t-muted mt-0.5">{t("input.thinkingDescription")}</p>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Mic button: voice input for translation mode (audio sent to Gemini multimodal) */}
            {translationMode && (
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={disabled}
                className={`p-1.5 rounded-full disabled:opacity-50 transition-colors ${
                  isRecording
                    ? "bg-red-500/20 text-red-500 animate-pulse"
                    : "text-t-muted hover:text-t-secondary"
                }`}
                title={isRecording ? "録音停止" : "音声入力（押すと録音開始、もう一度押すと送信）"}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </button>
            )}

            {/* Right: send */}
            <button
              onClick={() => submit()}
              disabled={disabled}
              className="p-1.5 text-t-muted hover:text-t-secondary disabled:opacity-50 transition-colors"
              title={t("chat.send")}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>

        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-xl pointer-events-none z-10">
            <p className="text-blue-400 text-sm font-medium">{t("chat.dropImages")}</p>
          </div>
        )}

        {/* Model selector + debate — below the input box */}
        <div className="flex items-center gap-2 mt-2 mb-2 md:mt-1.5 md:mb-0 ml-1 flex-wrap">
          <select
            value={selectedModel}
            onChange={(e) => {
              const v = e.target.value as ModelId;
              const group = MODEL_GROUPS.find((g) => g.models.some((m) => m.id === v));
              if (group && isModelLocked(v, group.provider)) {
                onOpenApiKeyModal?.(group.provider);
                setSelectedModel(v);
                saveSessionModel(sessionId, v, secondModel);
                return;
              }
              setSelectedModel(v);
              saveSessionModel(sessionId, v, secondModel);
            }}
            disabled={disabled}
            className="bg-transparent text-t-muted text-xs py-1 md:py-0 outline-none disabled:opacity-50 cursor-pointer"
          >
            {MODEL_GROUPS.map((g) => (
              <optgroup key={g.provider} label={g.label}>
                {g.models.map((m) => (
                  <option key={m.id} value={m.id} className={isModelLocked(m.id, g.provider) ? "opacity-50" : ""}>
                    {m.label}{getCostLabel(m.id, !hasGoogleKey)}{isModelLocked(m.id, g.provider) ? " 🔒" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            onClick={() => setDebateMode(!debateMode)}
            disabled={disabled}
            className={`flex items-center gap-1 px-2 py-1.5 md:py-0.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
              debateMode
                ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/40"
                : "text-t-muted hover:text-t-secondary hover:bg-theme-hover border border-transparent"
            }`}
            title={t("input.debateMode")}
          >
            🔀 {t("input.debate")}
          </button>

          {debateMode && (
            <>
              <span className="text-t-muted text-xs select-none">{t("input.vs")}</span>
              <select
                value={secondModel}
                onChange={(e) => {
                  const v = e.target.value as ModelId;
                  const group = MODEL_GROUPS.find((g) => g.models.some((m) => m.id === v));
                  if (group && isModelLocked(v, group.provider)) {
                    onOpenApiKeyModal?.(group.provider);
                    setSecondModel(v);
                    saveSessionModel(sessionId, selectedModel, v);
                    return;
                  }
                  setSecondModel(v);
                  saveSessionModel(sessionId, selectedModel, v);
                }}
                disabled={disabled}
                className="bg-transparent text-t-muted text-xs py-1 md:py-0 outline-none disabled:opacity-50 cursor-pointer"
              >
                {MODEL_GROUPS.map((g) => (
                  <optgroup key={g.provider} label={g.label}>
                    {g.models.map((m) => (
                      <option key={m.id} value={m.id} className={isModelLocked(m.id, g.provider) ? "opacity-50" : ""}>
                        {m.label}{getCostLabel(m.id, !hasGoogleKey)}{isModelLocked(m.id, g.provider) ? " 🔒" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </>
          )}

          <button
            onClick={() => {
              const next = !translationMode;
              setTranslationMode(next);
              saveSessionTranslationMode(sessionId, next);
            }}
            disabled={disabled}
            className={`flex items-center gap-1 px-2 py-1.5 md:py-0.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
              translationMode
                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40"
                : "text-t-muted hover:text-t-secondary hover:bg-theme-hover border border-transparent"
            }`}
            title="日本語 ⇄ ベトナム語 翻訳モード（ホーチミン / em-anh / カジュアル）"
          >
            🌐 翻訳 {translationMode ? "(JP⇄VI)" : ""}
          </button>

          {translationMode && (
            <button
              onClick={() => {
                const next = !translationFastMode;
                setTranslationFastMode(next);
                saveSessionTranslationFastMode(sessionId, next);
              }}
              disabled={disabled}
              className={`flex items-center gap-1 px-2 py-1.5 md:py-0.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
                translationFastMode
                  ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40"
                  : "text-t-muted hover:text-t-secondary hover:bg-theme-hover border border-transparent"
              }`}
              title="高速モード: 翻訳結果1行のみ、解説なし（応答が速い）"
            >
              ⚡ 高速
            </button>
          )}
        </div>

        {/* Translation mode quality nudge: Flash Lite handles JP→VI OK but is unreliable for VI→JP */}
        {translationMode && selectedModel === "gemini-2.5-flash-lite" && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 ml-1">
            ⚠️ 翻訳精度を重視するなら <strong>Gemini 2.5 Pro</strong> 推奨（Flash Lite はベトナム語→日本語の方向判定が弱いことがあります）
          </p>
        )}
      </div>

      {/* Mic permission / device error modal */}
      {micErrorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-theme-overlay"
          onClick={() => setMicErrorModal(null)}
        >
          <div
            className="bg-theme-elevated rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-t-primary mb-4">⚠️ {micErrorModal}</p>
            <button
              onClick={() => setMicErrorModal(null)}
              className="w-full py-2 bg-theme-active text-t-primary rounded-lg text-sm hover:opacity-80 transition-opacity"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
