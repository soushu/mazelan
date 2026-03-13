"use client";

import { useRef, useEffect, useState, useCallback, KeyboardEvent, DragEvent } from "react";
import { MODEL_GROUPS, type ModelId } from "@/lib/types";

type Props = {
  onSubmit: (content: string, images: File[], model: ModelId, debateMode?: boolean, secondModel?: ModelId) => void;
  disabled: boolean;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export default function ChatInput({ onSubmit, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => {
    if (typeof window === "undefined") return "claude-sonnet-4-6";
    return (localStorage.getItem("claudia_model") as ModelId) || "claude-sonnet-4-6";
  });
  const [debateMode, setDebateMode] = useState(false);
  const [secondModel, setSecondModel] = useState<ModelId>(() => {
    if (typeof window === "undefined") return "gpt-4o";
    return (localStorage.getItem("claudia_model2") as ModelId) || "gpt-4o";
  });
  const dragCounter = useRef(0);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  // Clean up object URLs on unmount or change
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

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

  function submit() {
    const value = ref.current?.value.trim();
    if (!value && attachedImages.length === 0) return;
    onSubmit(value || "", [...attachedImages], selectedModel, debateMode, debateMode ? secondModel : undefined);
    if (ref.current) ref.current.value = "";
    previews.forEach((url) => URL.revokeObjectURL(url));
    setAttachedImages([]);
    setPreviews([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter (Mac) or Ctrl+Enter (Win) to send
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragging(false);
    }
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

  return (
    <div
      className={`p-2 md:p-4 border-t transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-border-primary"
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
                  alt={`attach ${i + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-border-secondary"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-6 h-6 md:w-5 md:h-5 bg-theme-hover hover:bg-red-500 text-white rounded-full text-xs flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Paperclip button */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            className="p-2 text-t-muted hover:text-t-secondary disabled:opacity-50 transition-colors flex-shrink-0 mb-1"
            title="Attach image"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>

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

          <textarea
            ref={ref}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) {
                handleFiles(files);
              }
            }}
            placeholder="Type a message..."
            rows={2}
            className="flex-1 bg-theme-input text-t-secondary placeholder-t-placeholder text-sm px-4 py-3 rounded-xl resize-none outline-none focus:ring-1 focus:ring-border-secondary disabled:opacity-50 font-sans"
          />

          {/* Send button */}
          <button
            onClick={submit}
            disabled={disabled}
            className="p-2 text-t-muted hover:text-t-secondary disabled:opacity-50 transition-colors flex-shrink-0 mb-1"
            title="Send"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-xl pointer-events-none z-10">
            <p className="text-blue-400 text-sm font-medium">Drop images to attach</p>
          </div>
        )}
        <div className="flex items-center justify-between mt-1 ml-11 gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Model selector */}
            <select
              value={selectedModel}
              onChange={(e) => { const v = e.target.value as ModelId; setSelectedModel(v); localStorage.setItem("claudia_model", v); }}
              disabled={disabled}
              className="bg-transparent text-t-muted text-xs outline-none disabled:opacity-50 cursor-pointer"
            >
              {MODEL_GROUPS.map((g) => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Debate mode toggle */}
            <button
              onClick={() => setDebateMode(!debateMode)}
              disabled={disabled}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors disabled:opacity-50 ${
                debateMode
                  ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/40"
                  : "text-t-muted hover:text-t-secondary hover:bg-theme-hover border border-transparent"
              }`}
              title="議論モード"
            >
              🔀 議論
            </button>

            {/* Second model selector (debate mode) */}
            {debateMode && (
              <>
                <span className="text-t-muted text-xs">vs</span>
                <select
                  value={secondModel}
                  onChange={(e) => { const v = e.target.value as ModelId; setSecondModel(v); localStorage.setItem("claudia_model2", v); }}
                  disabled={disabled}
                  className="bg-transparent text-t-muted text-xs outline-none disabled:opacity-50 cursor-pointer"
                >
                  {MODEL_GROUPS.map((g) => (
                    <optgroup key={g.provider} label={g.label}>
                      {g.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </>
            )}
          </div>
          <p className="text-xs text-t-faint text-right hidden md:block flex-shrink-0">
            Cmd+Enter で送信 / 画像はドラッグ&ドロップ、ペースト、クリップで添付
          </p>
        </div>
      </div>
    </div>
  );
}
