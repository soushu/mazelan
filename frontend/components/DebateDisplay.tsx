"use client";

import { useState } from "react";
import type { DebateStep, DebateStepId } from "@/lib/types";
import { getModelLabel } from "@/lib/types";
import MessageContent from "@/components/MessageContent";

type Props = {
  modelA: string;
  modelB: string;
  steps: DebateStep[];
  /** Currently streaming step ID and its partial content */
  streamingStepId?: DebateStepId;
  streamingContent?: string;
};

const ALL_STEP_IDS: DebateStepId[] = [
  "model_a_answer",
  "model_b_answer",
  "model_a_critique",
  "model_b_critique",
  "final",
];

const STEP_CONFIG: Record<DebateStepId, { icon: string; labelFn: (a: string, b: string) => string }> = {
  model_a_answer: { icon: "🤖", labelFn: (a) => `${a} の回答` },
  model_b_answer: { icon: "🤖", labelFn: (_, b) => `${b} の回答` },
  model_a_critique: { icon: "💬", labelFn: (a) => `${a} の批評` },
  model_b_critique: { icon: "💬", labelFn: (_, b) => `${b} の批評` },
  final: { icon: "📝", labelFn: () => "統合回答" },
};

export default function DebateDisplay({
  modelA,
  modelB,
  steps,
  streamingStepId,
  streamingContent,
}: Props) {
  const [processExpanded, setProcessExpanded] = useState(false);

  const modelALabel = getModelLabel(modelA);
  const modelBLabel = getModelLabel(modelB);

  const processSteps = steps.filter((s) => s.id !== "final");
  const finalStep = steps.find((s) => s.id === "final");

  const isStreamingProcess = streamingStepId && streamingStepId !== "final";
  const isStreamingFinal = streamingStepId === "final";
  const isComplete = finalStep && !streamingStepId;

  // Calculate progress for the progress bar
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
          {/* Progress bar */}
          {(isStreamingProcess || isStreamingFinal || processSteps.length > 0) && (
            <ProgressBar
              currentIndex={currentStepIndex}
              completedIds={completedStepIds}
              modelALabel={modelALabel}
              modelBLabel={modelBLabel}
              streamingStepId={streamingStepId}
            />
          )}

          {/* Currently streaming process step (not final) */}
          {isStreamingProcess && (
            <div className="border border-border-secondary rounded-lg p-3">
              <StepBlock
                icon={STEP_CONFIG[streamingStepId!].icon}
                label={STEP_CONFIG[streamingStepId!].labelFn(modelALabel, modelBLabel)}
                content={streamingContent || ""}
                streaming
              />
            </div>
          )}

          {/* Streaming final answer */}
          {isStreamingFinal && (
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-t-secondary">
                <span>📝</span>
                <span>統合回答</span>
              </div>
              <div className="border-t-2 border-border-secondary pt-3">
                <MessageContent content={streamingContent || ""} />
              </div>
            </div>
          )}

          {/* Completed steps — collapsible */}
          {processSteps.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              <button
                onClick={() => setProcessExpanded(!processExpanded)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-theme-hover/40 transition-colors text-sm"
              >
                <svg
                  className={`w-3.5 h-3.5 text-t-muted flex-shrink-0 transition-transform duration-200 ${
                    processExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-t-tertiary font-medium">
                  完了したステップ（{processSteps.length}件）
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  processExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-3">
                    {processSteps.map((step) => {
                      const config = STEP_CONFIG[step.id];
                      return (
                        <StepBlock
                          key={step.id}
                          icon={config.icon}
                          label={config.labelFn(modelALabel, modelBLabel)}
                          content={step.content}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Initial loading state */}
          {!streamingStepId && processSteps.length === 0 && (
            <span className="animate-pulse text-t-muted">考え中...</span>
          )}
        </>
      )}

      {/* === COMPLETED VIEW === */}
      {isComplete && (
        <>
          {/* Final answer — prominent */}
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-t-secondary">
              <span>📝</span>
              <span>統合回答</span>
            </div>
            <div className="border-t-2 border-border-secondary pt-3">
              <MessageContent content={finalStep.content} />
            </div>
          </div>

          {/* Debate process — collapsible below */}
          {processSteps.length > 0 && (
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              <button
                onClick={() => setProcessExpanded(!processExpanded)}
                className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-theme-hover/40 transition-colors text-sm"
              >
                <svg
                  className={`w-3.5 h-3.5 text-t-muted flex-shrink-0 transition-transform duration-200 ${
                    processExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-t-tertiary font-medium">
                  議論の過程を見る（{processSteps.length}件）
                </span>
              </button>

              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  processExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-3 pb-3 space-y-3">
                    {processSteps.map((step) => {
                      const config = STEP_CONFIG[step.id];
                      return (
                        <StepBlock
                          key={step.id}
                          icon={config.icon}
                          label={config.labelFn(modelALabel, modelBLabel)}
                          content={step.content}
                        />
                      );
                    })}
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
  modelALabel,
  modelBLabel,
  streamingStepId,
}: {
  currentIndex: number;
  completedIds: Set<DebateStepId>;
  modelALabel: string;
  modelBLabel: string;
  streamingStepId?: DebateStepId;
}) {
  const stepCount = ALL_STEP_IDS.length;
  const currentLabel = streamingStepId
    ? STEP_CONFIG[streamingStepId].labelFn(modelALabel, modelBLabel)
    : null;

  return (
    <div className="space-y-2">
      {/* Progress dots */}
      <div className="flex items-center">
        {ALL_STEP_IDS.map((id, i) => {
          const isCompleted = completedIds.has(id);
          const isCurrent = i === currentIndex;
          return (
            <div key={id} className="flex items-center">
              <div
                className={`w-3 h-3 rounded-full transition-colors ${
                  isCompleted
                    ? "bg-blue-500"
                    : isCurrent
                    ? "bg-blue-400 animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.6)]"
                    : "bg-neutral-600"
                }`}
              />
              {i < stepCount - 1 && (
                <div
                  className={`w-6 h-[3px] rounded-full ${
                    isCompleted ? "bg-blue-500" : "bg-neutral-600"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Step label */}
      {streamingStepId && (
        <div className="text-xs text-t-secondary">
          ステップ {currentIndex + 1}/{stepCount}: {currentLabel}
        </div>
      )}
    </div>
  );
}

/* ---- Step Block ---- */

function StepBlock({
  icon,
  label,
  content,
  streaming,
}: {
  icon: string;
  label: string;
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="border-l-2 border-border-secondary pl-3">
      <div className="text-xs font-medium text-t-muted mb-1">
        {icon} {label}
        {streaming && <span className="ml-1 text-t-muted">（生成中）</span>}
      </div>
      <div className="text-sm">
        {content ? (
          <MessageContent content={content} />
        ) : streaming ? (
          <span className="animate-pulse text-t-muted">生成中...</span>
        ) : null}
      </div>
    </div>
  );
}
