"use client";

import { useState, useEffect } from "react";
import type { Provider } from "@/lib/types";
import {
  getApiKeyForProvider,
  setApiKeyForProvider,
  clearApiKeyForProvider,
  validateApiKey,
} from "@/lib/apiKeyStore";
import { useTranslations } from "next-intl";

type Props = {
  open: boolean;
  onClose: () => void;
};

const TABS: { provider: Provider; label: string; placeholder: string }[] = [
  { provider: "anthropic", label: "Anthropic", placeholder: "sk-ant-api03-..." },
  { provider: "openai", label: "OpenAI", placeholder: "sk-proj-..." },
  { provider: "google", label: "Google", placeholder: "AIza..." },
];

export default function ApiKeyModal({ open, onClose }: Props) {
  const t = useTranslations();
  const [activeTab, setActiveTab] = useState<Provider>("anthropic");
  const [keys, setKeys] = useState<Record<Provider, string>>({ anthropic: "", openai: "", google: "" });
  const [saved, setSaved] = useState<Record<Provider, boolean>>({ anthropic: false, openai: false, google: false });
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const newKeys: Record<Provider, string> = { anthropic: "", openai: "", google: "" };
      const newSaved: Record<Provider, boolean> = { anthropic: false, openai: false, google: false };
      for (const tab of TABS) {
        const stored = getApiKeyForProvider(tab.provider);
        newKeys[tab.provider] = stored ?? "";
        newSaved[tab.provider] = !!stored;
      }
      setKeys(newKeys);
      setSaved(newSaved);
      setShowKey(false);
      setError("");
    }
  }, [open]);

  function handleSave() {
    const trimmed = keys[activeTab].trim();
    const validationError = validateApiKey(activeTab, trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setApiKeyForProvider(activeTab, trimmed);
    setSaved((prev) => ({ ...prev, [activeTab]: true }));
    setError("");
  }

  function handleClear() {
    clearApiKeyForProvider(activeTab);
    setKeys((prev) => ({ ...prev, [activeTab]: "" }));
    setSaved((prev) => ({ ...prev, [activeTab]: false }));
    setError("");
  }

  if (!open) return null;

  const currentTab = TABS.find((t) => t.provider === activeTab)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-theme-overlay" onClick={onClose}>
      <div
        className="bg-theme-elevated rounded-xl shadow-2xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-t-primary mb-1">{t("apiKey.title")}</h2>
        <p className="text-xs text-t-tertiary mb-4">
          {t("apiKey.description")}
        </p>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-theme-surface rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.provider}
              onClick={() => { setActiveTab(tab.provider); setError(""); setShowKey(false); }}
              className={`flex-1 py-1.5 px-2 rounded-md text-sm transition-colors flex items-center justify-center gap-1.5 ${
                activeTab === tab.provider
                  ? "bg-theme-elevated text-t-primary shadow-sm"
                  : "text-t-tertiary hover:text-t-secondary"
              }`}
            >
              {tab.label}
              {saved[tab.provider] && (
                <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
              )}
            </button>
          ))}
        </div>

        {/* Google free tier note */}
        {activeTab === "google" && (
          <p className="text-xs text-t-muted mb-3">
            {t("apiKey.googleFreeNote")}
          </p>
        )}

        {/* Key input */}
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={keys[activeTab]}
            onChange={(e) => { setKeys((prev) => ({ ...prev, [activeTab]: e.target.value })); setError(""); }}
            placeholder={currentTab.placeholder}
            className="w-full bg-theme-surface text-t-secondary placeholder-t-placeholder text-sm px-3 py-2.5 rounded-lg outline-none focus:ring-1 focus:ring-border-secondary pr-16"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-t-muted hover:text-t-secondary px-2 py-1"
          >
            {showKey ? t("apiKey.hide") : t("apiKey.show")}
          </button>
        </div>

        {error && <p className="text-danger text-xs mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={!keys[activeTab].trim()}
            className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm transition-colors"
          >
            {t("apiKey.save")}
          </button>
          {saved[activeTab] && (
            <button
              onClick={handleClear}
              className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
            >
              {t("apiKey.clear")}
            </button>
          )}
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-theme-hover hover:bg-theme-active text-t-secondary text-sm transition-colors"
          >
            {t("apiKey.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
