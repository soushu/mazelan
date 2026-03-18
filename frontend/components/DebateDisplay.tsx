"use client";

import { useState } from "react";
import type { DebateStep, DebateStepId } from "@/lib/types";
import { getModelLabel } from "@/lib/types";
import MessageContent from "@/components/MessageContent";
import { useTranslations } from "next-intl";

type Props = {
  modelA: string;
  modelB: string;
  steps: DebateStep[];
  streamingStepId?: DebateStepId;
  streamingContent?: string;
  /** True when waiting for rate limit pacing between same-provider steps */
  isPacing?: boolean;
};

const ALL_STEP_IDS: DebateStepId[] = [
  "model_a_answer",
  "model_b_answer",
  "model_a_critique",
  "model_b_critique",
  "final",
];

function getStepIcon(id: DebateStepId): string {
  if (id === "final") return "📝";
  if (id.includes("critique")) return "💬";
  return "🤖";
}

export default function DebateDisplay({
  modelA,
  modelB,
  steps,
  streamingStepId,
  streamingContent,
  isPacing,
}: Props) {
  const t = useTranslations();
  const [processExpanded, setProcessExpanded] = useState(false);

  const modelALabel = getModelLabel(modelA);
  const modelBLabel = getModelLabel(modelB);

  function getStepLabel(id: DebateStepId): string {
    switch (id) {
      case "model_a_answer": return `${modelALabel}${t("debate.answer")}`;
      case "model_b_answer": return `${modelBLabel}${t("debate.answer")}`;
      case "model_a_critique": return `${modelALabel}${t("debate.critique")}`;
      case "model_b_critique": return `${modelBLabel}${t("debate.critique")}`;
      case "final": return t("debate.finalAnswer");
    }
  }

  const processSteps = steps.filter((s) => s.id !== "final");
  const finalStep = steps.find((s) => s.id === "final");

  const isStreamingProcess = streamingStepId && streamingStepId !== "final";
  const isStreamingFinal = streamingStepId === "final";
  const isComplete = finalStep && !streamingStepId;

  const completedStepIds = new Set(steps.map((s) => s.id));
  const currentStepIndex = streamingStepId
    ? ALL_STEP_IDS.indexOf(streamingStepId)
    : -1;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-t-muted">
        <span>🔀</span>
        <span>{modelALabel} vs {modelBLabel}</span>
      </div>

      {/* === STREAMING VIEW === */}
      {!isComplete && (
        <>
          {(isStreamingProcess || isStreamingFinal || processSteps.length > 0) && (
            <ProgressBar
              currentIndex={currentStepIndex}
              completedIds={completedStepIds}
              streamingStepId={streamingStepId}
              getStepLabel={getStepLabel}
            />
          )}

          {isStreamingProcess && (
            <div className="border border-border-secondary rounded-lg p-3">
              {isPacing ? (
                <div className="flex items-center gap-2 text-xs text-t-muted animate-pulse py-1">
                  <span className="w-4 h-4 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
                  {t("debate.preparing")}
                </div>
              ) : (
                <StepBlock
                  icon={getStepIcon(streamingStepId!)}
                  label={getStepLabel(streamingStepId!)}
                  content={streamingContent || ""}
                  streaming
                />
              )}
            </div>
          )}

          {isStreamingFinal && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-t-secondary">
                <span>📝</span>
                <span>{t("debate.finalAnswer")}</span>
              </div>
              <div className="border-t-2 border-border-secondary pt-3">
                <MessageContent content={streamingContent || ""} />
              </div>
            </div>
          )}

          {processSteps.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              <button
                onClick={() => setProcessExpanded(!processExpanded)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-theme-hover/40 transition-colors text-sm"
              >
                <svg
                  className={`w-3.5 h-3.5 text-t-muted flex-shrink-0 transition-transform duration-200 ${processExpanded ? "rotate-90" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-t-tertiary font-medium">
                  {t("debate.completedSteps", { count: processSteps.length })}
                </span>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${processExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-3">
                    {processSteps.map((step) => (
                      <StepBlock key={step.id} icon={getStepIcon(step.id)} label={getStepLabel(step.id)} content={step.content} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!streamingStepId && processSteps.length === 0 && (
            <span className="animate-pulse text-t-muted">{t("debate.thinking")}</span>
          )}
        </>
      )}

      {/* === COMPLETED VIEW === */}
      {isComplete && (
        <>
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-t-secondary">
              <span>📝</span>
              <span>{t("debate.finalAnswer")}</span>
            </div>
            <div className="border-t-2 border-border-secondary pt-3">
              <MessageContent content={finalStep.content} />
            </div>
          </div>

          {processSteps.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              <button
                onClick={() => setProcessExpanded(!processExpanded)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-theme-hover/40 transition-colors text-sm"
              >
                <svg
                  className={`w-3.5 h-3.5 text-t-muted flex-shrink-0 transition-transform duration-200 ${processExpanded ? "rotate-90" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-t-tertiary font-medium">
                  {t("debate.viewProcess", { count: processSteps.length })}
                </span>
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${processExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-3">
                    {processSteps.map((step) => (
                      <StepBlock key={step.id} icon={getStepIcon(step.id)} label={getStepLabel(step.id)} content={step.content} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---- Progress Bar ---- */

function ProgressBar({
  currentIndex,
  completedIds,
  streamingStepId,
  getStepLabel,
}: {
  currentIndex: number;
  completedIds: Set<DebateStepId>;
  streamingStepId?: DebateStepId;
  getStepLabel: (id: DebateStepId) => string;
}) {
  const t = useTranslations();
  const stepCount = ALL_STEP_IDS.length;
  const currentLabel = streamingStepId ? getStepLabel(streamingStepId) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center">
        {ALL_STEP_IDS.map((id, i) => {
          const isCompleted = completedIds.has(id);
          const isCurrent = i === currentIndex;
          return (
            <div key={id} className="flex items-center">
              <div
                className={`w-3 h-3 rounded-full transition-colors ${
                  isCompleted ? "bg-blue-500" : isCurrent ? "bg-blue-400 animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.6)]" : "bg-neutral-600"
                }`}
              />
              {i < stepCount - 1 && (
                <div className={`w-6 h-[3px] rounded-full ${isCompleted ? "bg-blue-500" : "bg-neutral-600"}`} />
              )}
            </div>
          );
        })}
      </div>
      {streamingStepId && (
        <div className="text-xs text-t-secondary">
          {t("debate.step", { current: currentIndex + 1, total: stepCount, label: currentLabel || "" })}
        </div>
      )}
    </div>
  );
}

/* ---- Step Block ---- */

function StepBlock({ icon, label, content, streaming }: { icon: string; label: string; content: string; streaming?: boolean }) {
  const t = useTranslations();
  return (
    <div className="border-l-2 border-border-secondary pl-3">
      <div className="text-xs font-medium text-t-muted mb-1">
        {icon} {label}
        {streaming && <span className="ml-1 text-t-muted">{t("debate.generating")}</span>}
      </div>
      <div className="text-sm">
        {content ? (
          <MessageContent content={content} />
        ) : streaming ? (
          <span className="animate-pulse text-t-muted">{t("debate.thinking")}</span>
        ) : null}
      </div>
    </div>
  );
}
