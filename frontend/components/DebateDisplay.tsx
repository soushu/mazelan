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

  const isStreamingProcess =
    streamingStepId && streamingStepId !== "final";
  const isStreamingFinal = streamingStepId === "final";

  return (
    <div className="space-y-3">
      {/* Debate process — collapsible */}
      {(processSteps.length > 0 || isStreamingProcess) && (
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
              🔀 議論の過程（{modelALabel} vs {modelBLabel}）
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
                {/* Currently streaming process step */}
                {isStreamingProcess && (
                  <StepBlock
                    icon={STEP_CONFIG[streamingStepId!].icon}
                    label={STEP_CONFIG[streamingStepId!].labelFn(modelALabel, modelBLabel)}
                    content={streamingContent || ""}
                    streaming
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Final answer — always visible */}
      {(finalStep || isStreamingFinal) && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-sm font-medium text-t-secondary">
            <span>📝</span>
            <span>統合回答</span>
          </div>
          <MessageContent
            content={isStreamingFinal ? (streamingContent || "") : (finalStep?.content || "")}
          />
        </div>
      )}

      {/* Streaming cursor when no content yet */}
      {streamingStepId && !streamingContent && !finalStep && processSteps.length === 0 && (
        <span className="animate-pulse text-t-muted">考え中...</span>
      )}
    </div>
  );
}

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
