"use client";

import { useState, useEffect } from "react";
import { getUserSystemPrompt, updateUserSystemPrompt, getSessionSystemPrompt, updateSessionSystemPrompt } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  activeSessionId: string | null;
};

export default function SystemPromptModal({ open, onClose, activeSessionId }: Props) {
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [sessionPrompt, setSessionPrompt] = useState("");
  const [tab, setTab] = useState<"global" | "session">("global");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setLoading(true);

    const promises: Promise<void>[] = [
      getUserSystemPrompt().then((r) => setGlobalPrompt(r.system_prompt ?? "")).catch(() => {}),
    ];
    if (activeSessionId) {
      promises.push(
        getSessionSystemPrompt(activeSessionId).then((r) => setSessionPrompt(r.system_prompt ?? "")).catch(() => {})
      );
    } else {
      setSessionPrompt("");
    }

    Promise.all(promises).finally(() => setLoading(false));
  }, [open, activeSessionId]);

  async function handleSave() {
    setSaving(true);
    try {
      if (tab === "global") {
        await updateUserSystemPrompt(globalPrompt.trim() || null);
      } else if (activeSessionId) {
        await updateSessionSystemPrompt(activeSessionId, sessionPrompt.trim() || null);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      if (tab === "global") {
        await updateUserSystemPrompt(null);
        setGlobalPrompt("");
      } else if (activeSessionId) {
        await updateSessionSystemPrompt(activeSessionId, null);
        setSessionPrompt("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const currentPrompt = tab === "global" ? globalPrompt : sessionPrompt;
  const setCurrentPrompt = tab === "global" ? setGlobalPrompt : setSessionPrompt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-overlay" onClick={onClose}>
      <div
        className="bg-theme-elevated rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-t-primary mb-1">System Prompt</h2>
        <p className="text-xs text-t-tertiary mb-4">
          すべての会話に共通の指示をここに書いておくと、毎回同じことを伝える必要がなくなります。複数の指示を登録したい場合は、改行や「・」で区切って自由に書けます。セッション設定はその会話だけに適用され、グローバルより優先されます。
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab("global")}
            className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
              tab === "global"
                ? "bg-theme-active text-t-primary"
                : "text-t-tertiary hover:bg-theme-hover hover:text-t-secondary"
            }`}
          >
            Global
          </button>
          <button
            onClick={() => setTab("session")}
            disabled={!activeSessionId}
            className={`flex-1 py-1.5 text-sm rounded-lg transition-colors ${
              tab === "session"
                ? "bg-theme-active text-t-primary"
                : "text-t-tertiary hover:bg-theme-hover hover:text-t-secondary"
            } ${!activeSessionId ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            Session
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <textarea
              value={currentPrompt}
              onChange={(e) => setCurrentPrompt(e.target.value)}
              placeholder={tab === "global"
                ? "例:\n・日本語で回答して\n・簡潔に答えて\n・コードにはコメントをつけて\n・敬語は不要"
                : "この会話だけに適用する指示\n例:\n・この会話では英語で回答して\n・専門用語を避けて説明して"
              }
              rows={6}
              className="w-full bg-theme-surface text-t-secondary placeholder-t-placeholder text-sm px-3 py-2.5 rounded-lg outline-none focus:ring-1 focus:ring-border-secondary resize-none"
            />
            <div className="flex items-center justify-between mt-2 mb-4">
              <span className="text-xs text-t-muted">{currentPrompt.length} chars</span>
              {tab === "session" && !activeSessionId && (
                <span className="text-xs text-t-muted">会話を選択してください</span>
              )}
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition-colors"
          >
            {saved ? "Saved!" : "保存"}
          </button>
          {currentPrompt && (
            <button
              onClick={handleClear}
              disabled={saving || loading}
              className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
            >
              クリア
            </button>
          )}
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
