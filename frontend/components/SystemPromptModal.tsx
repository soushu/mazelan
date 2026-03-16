"use client";

import { useState, useEffect } from "react";
import { getUserSystemPrompt, updateUserSystemPrompt, getSessionSystemPrompt, updateSessionSystemPrompt } from "@/lib/api";
import { useTranslations } from "next-intl";

type Props = {
  open: boolean;
  onClose: () => void;
  activeSessionId: string | null;
};

export default function SystemPromptModal({ open, onClose, activeSessionId }: Props) {
  const t = useTranslations();
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
        <h2 className="text-lg font-semibold text-t-primary mb-1">{t("systemPrompt.title")}</h2>
        <p className="text-xs text-t-tertiary mb-4">
          {t("systemPrompt.description")}
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
            {t("systemPrompt.global")}
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
            {t("systemPrompt.session")}
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
              placeholder={tab === "global" ? t("systemPrompt.globalPlaceholder") : t("systemPrompt.sessionPlaceholder")}
              rows={6}
              className="w-full bg-theme-surface text-t-secondary placeholder-t-placeholder text-sm px-3 py-2.5 rounded-lg outline-none focus:ring-1 focus:ring-border-secondary resize-none"
            />
            <div className="flex items-center justify-between mt-2 mb-4">
              <span className="text-xs text-t-muted">{currentPrompt.length} {t("systemPrompt.chars")}</span>
              {tab === "session" && !activeSessionId && (
                <span className="text-xs text-t-muted">{t("systemPrompt.selectSession")}</span>
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
            {saved ? t("systemPrompt.saved") : t("systemPrompt.save")}
          </button>
          {currentPrompt && (
            <button
              onClick={handleClear}
              disabled={saving || loading}
              className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
            >
              {t("systemPrompt.clear")}
            </button>
          )}
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
          >
            {t("systemPrompt.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
