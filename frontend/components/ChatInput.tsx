"use client";

import { useRef, useEffect, useState, useCallback, KeyboardEvent, DragEvent } from "react";

type Props = {
  onSubmit: (content: string, images: File[]) => void;
  disabled: boolean;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export default function ChatInput({ onSubmit, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
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
    onSubmit(value || "", [...attachedImages]);
    if (ref.current) ref.current.value = "";
    previews.forEach((url) => URL.revokeObjectURL(url));
    setAttachedImages([]);
    setPreviews([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
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
      className={`p-4 border-t transition-colors ${
        dragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-slate-800"
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
                  alt={`添付 ${i + 1}`}
                  className="w-16 h-16 object-cover rounded-lg border border-slate-700"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-slate-600 hover:bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
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
            className="p-2 text-slate-500 hover:text-slate-300 disabled:opacity-50 transition-colors flex-shrink-0 mb-1"
            title="画像を添付"
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
            placeholder="質問を入力... (Enter で送信 / Shift+Enter で改行)"
            rows={3}
            className="flex-1 bg-slate-800 text-slate-200 placeholder-slate-500 text-sm px-4 py-3 rounded-xl resize-none outline-none focus:ring-1 focus:ring-slate-600 disabled:opacity-50 font-sans"
          />
        </div>
        {dragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-xl pointer-events-none z-10">
            <p className="text-blue-400 text-sm font-medium">画像をドロップして添付</p>
          </div>
        )}
        <p className="text-xs text-slate-600 mt-1 text-right">
          Enter で送信 · Shift+Enter で改行 · 画像はドラッグ&ドロップ / ペースト / クリップで添付
        </p>
      </div>
    </div>
  );
}
