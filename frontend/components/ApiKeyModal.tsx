"use client";

import { useState, useEffect } from "react";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/apiKeyStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ApiKeyModal({ open, onClose }: Props) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const stored = getApiKey();
      setKey(stored ?? "");
      setSaved(!!stored);
      setShowKey(false);
      setError("");
    }
  }, [open]);

  function handleSave() {
    const trimmed = key.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      setError("APIキーは sk-ant- で始まる必要があります");
      return;
    }
    setApiKey(trimmed);
    setSaved(true);
    setError("");
    onClose();
  }

  function handleClear() {
    clearApiKey();
    setKey("");
    setSaved(false);
    setError("");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100 mb-1">API Key 設定</h2>
        <p className="text-xs text-slate-400 mb-4">
          Anthropic APIキーを設定すると、自分のキーでClaudeを利用できます。キーはブラウザのlocalStorageにのみ保存されます。
        </p>

        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(""); }}
            placeholder="sk-ant-api03-..."
            className="w-full bg-slate-900 text-slate-200 placeholder-slate-600 text-sm px-3 py-2.5 rounded-lg outline-none focus:ring-1 focus:ring-slate-600 pr-16"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300 px-2 py-1"
          >
            {showKey ? "隠す" : "表示"}
          </button>
        </div>

        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={!key.trim()}
            className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition-colors"
          >
            保存
          </button>
          {saved && (
            <button
              onClick={handleClear}
              className="py-2 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
            >
              削除
            </button>
          )}
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
