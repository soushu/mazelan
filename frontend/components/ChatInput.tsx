"use client";

import { useRef, useEffect, KeyboardEvent } from "react";

type Props = {
  onSubmit: (content: string) => void;
  disabled: boolean;
};

export default function ChatInput({ onSubmit, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const value = ref.current?.value.trim();
      if (value) {
        onSubmit(value);
        if (ref.current) ref.current.value = "";
      }
    }
  }

  return (
    <div className="p-4 border-t border-slate-800">
      <div className="relative max-w-3xl mx-auto">
        <textarea
          ref={ref}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          placeholder="質問を入力... (Enter で送信 / Shift+Enter で改行)"
          rows={3}
          className="w-full bg-slate-800 text-slate-200 placeholder-slate-500 text-sm px-4 py-3 pr-12 rounded-xl resize-none outline-none focus:ring-1 focus:ring-slate-600 disabled:opacity-50 font-sans"
        />
        <p className="text-xs text-slate-600 mt-1 text-right">
          Enter で送信 · Shift+Enter で改行
        </p>
      </div>
    </div>
  );
}
