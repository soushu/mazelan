"use client";

import { useState } from "react";
import type { UsageInfo } from "@/lib/types";
import { formatCost, getModelLabel, getProviderFromModelId } from "@/lib/types";
import { getApiKeyForProvider } from "@/lib/apiKeyStore";
import { useTranslations } from "next-intl";

type Props = {
  usage: UsageInfo;
  modelId?: string;
};

function parseDebateModelId(modelId: string): { modelA: string; modelB: string } | null {
  if (!modelId.startsWith("debate:")) return null;
  const parts = modelId.split(":");
  if (parts.length >= 3) return { modelA: parts[1], modelB: parts[2] };
  return null;
}

export default function TokenUsageTooltip({ usage, modelId }: Props) {
  const t = useTranslations();
  const [show, setShow] = useState(false);
  const total = usage.input_tokens + usage.output_tokens;

  const debateModels = modelId ? parseDebateModelId(modelId) : null;

  // Determine if this was a free request (Google model without user API key)
  const isFree = (() => {
    if (!modelId) return false;
    const hasGoogleKey = !!getApiKeyForProvider("google");
    if (hasGoogleKey) return false;
    if (debateModels) {
      // Both debate models must be Google for the whole debate to be free
      const provA = getProviderFromModelId(debateModels.modelA);
      const provB = getProviderFromModelId(debateModels.modelB);
      return provA === "google" && provB === "google";
    }
    return getProviderFromModelId(modelId) === "google";
  })();

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShow(!show)}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="p-1 rounded text-t-muted hover:text-t-secondary hover:bg-theme-hover transition-all text-xs"
        title={t("usage.title")}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      </button>
      {show && (
        <div className="absolute bottom-full right-0 mb-2 bg-theme-surface border border-border-primary rounded-lg shadow-lg p-3 text-xs z-50 min-w-[260px] max-w-[calc(100vw-2rem)]">
          <div className="text-t-secondary space-y-1">
            {debateModels ? (
              <div className="pb-1 mb-1 border-b border-border-primary space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="text-t-muted whitespace-nowrap">Model A</span>
                  <span className="font-medium whitespace-nowrap">{getModelLabel(debateModels.modelA)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-t-muted whitespace-nowrap">Model B</span>
                  <span className="font-medium whitespace-nowrap">{getModelLabel(debateModels.modelB)}</span>
                </div>
              </div>
            ) : modelId ? (
              <div className="flex justify-between gap-4 pb-1 mb-1 border-b border-border-primary">
                <span className="text-t-muted">{t("usage.model")}</span>
                <span className="font-medium">{getModelLabel(modelId)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <span className="text-t-muted whitespace-nowrap">{t("usage.input")}</span>
              <span className="whitespace-nowrap">{usage.input_tokens.toLocaleString()} tokens</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-t-muted whitespace-nowrap">{t("usage.output")}</span>
              <span className="whitespace-nowrap">{usage.output_tokens.toLocaleString()} tokens</span>
            </div>
            <div className="border-t border-border-primary pt-1 mt-1 flex justify-between gap-4">
              <span className="text-t-muted whitespace-nowrap">{t("usage.total")}</span>
              <span className="whitespace-nowrap">{total.toLocaleString()} tokens</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-t-muted">{t("usage.cost")}</span>
              <span className="font-medium">
                {isFree ? (
                  <>{t("usage.free", { cost: "$0.00" })}</>
                ) : (
                  formatCost(usage.cost)
                )}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
