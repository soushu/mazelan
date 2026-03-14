"use client";

import { useState } from "react";
import type { QAPair, DebateStepId } from "@/lib/types";
import { parseDebateContent } from "@/lib/types";
import MessageContent from "@/components/MessageContent";
import DebateDisplay from "@/components/DebateDisplay";

function MessageCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy message"
      className="opacity-0 group-hover/msg:opacity-100 p-1 rounded text-t-muted hover:text-t-secondary hover:bg-theme-hover transition-all text-xs"
    >
      {copied ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
        </svg>
      )}
    </button>
  );
}

type Props = {
  pair: QAPair;
  collapsed: boolean;
  onToggle: () => void;
  streamingText?: string;
  /** If set, this pair is streaming a debate response */
  streamingDebate?: {
    modelA: string;
    modelB: string;
    currentStep: DebateStepId | null;
    rawText: string;
  } | null;
};

export default function QAPairBlock({ pair, collapsed, onToggle, streamingText, streamingDebate }: Props) {
  const isStreaming = streamingText !== undefined;

  // Check if assistant content is a debate
  const debateData = pair.assistant ? parseDebateContent(pair.assistant.content) : null;

  return (
    <div>
      {/* Toggle header — always visible */}
      <button
        onClick={onToggle}
        className="group flex items-center gap-2 w-full text-left px-3 py-3 md:py-2 rounded-lg hover:bg-theme-hover/40 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-t-muted flex-shrink-0 transition-transform duration-300 ${
            collapsed ? "" : "rotate-90"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm text-t-tertiary truncate">
          {pair.user.content}
        </span>
      </button>

      {/* Collapsible body — grid-rows trick for smooth animation */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-6 pt-4">
            {/* User bubble */}
            <div className="flex gap-3 justify-end">
              <div className="max-w-[95%] md:max-w-[80%] rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm bg-theme-user-bubble text-t-user-bubble rounded-br-sm">
                {pair.user.images && pair.user.images.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-2">
                    {pair.user.images.map((img, i) => (
                      <img
                        key={i}
                        src={img.preview_url || `data:${img.media_type};base64,${img.data}`}
                        alt={`attach ${i + 1}`}
                        className="max-w-[150px] max-h-[150px] md:max-w-[200px] md:max-h-[200px] object-contain rounded-lg"
                      />
                    ))}
                  </div>
                )}
                {pair.user.content && (
                  <p className="whitespace-pre-wrap">{pair.user.content}</p>
                )}
              </div>
            </div>

            {/* Assistant bubble — debate or normal */}
            {pair.assistant && debateData && (
              <div className="group/msg">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 text-t-primary">
                    🔀
                  </div>
                  <span className="text-xs font-medium text-t-muted">議論モード</span>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <DebateDisplay
                    modelA={debateData.modelA}
                    modelB={debateData.modelB}
                    steps={debateData.steps}
                  />
                </div>
                <div className="flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <MessageCopyButton text={debateData.steps.find(s => s.id === "final")?.content || pair.assistant.content} />
                </div>
              </div>
            )}

            {pair.assistant && !debateData && (
              <div className="group/msg">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 text-t-primary">
                    C
                  </div>
                  <span className="text-xs font-medium text-t-muted">claudia</span>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <MessageContent content={pair.assistant.content} />
                </div>
                <div className="flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  <MessageCopyButton text={pair.assistant.content} />
                </div>
              </div>
            )}

            {/* Streaming response — debate mode */}
            {isStreaming && !pair.assistant && streamingDebate && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 text-t-primary">
                    🔀
                  </div>
                  <span className="text-xs font-medium text-t-muted">議論モード</span>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <StreamingDebateView rawText={streamingText || ""} modelA={streamingDebate.modelA} modelB={streamingDebate.modelB} />
                </div>
              </div>
            )}

            {/* Streaming response — normal mode */}
            {isStreaming && !pair.assistant && !streamingDebate && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 text-t-primary">
                    C
                  </div>
                  <span className="text-xs font-medium text-t-muted">claudia</span>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  {streamingText ? (
                    <MessageContent content={streamingText} />
                  ) : (
                    <span className="animate-pulse text-t-muted">cursor</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Parse streaming debate text into steps for real-time display */
function StreamingDebateView({ rawText, modelA, modelB }: { rawText: string; modelA: string; modelB: string }) {
  const completedSteps: { id: DebateStepId; content: string }[] = [];
  let currentStepId: DebateStepId | null = null;
  let currentContent = "";

  // Split by step markers: \n[STEP:xxx]\n
  const parts = rawText.split(/\n\[STEP:(\w+)\]\n/);
  // parts[0] = text before first marker (usually empty)
  // parts[1] = step id, parts[2] = content, ...

  for (let i = 1; i < parts.length; i += 2) {
    const stepId = parts[i] as DebateStepId;
    const content = (parts[i + 1] || "").trim();
    if (i + 2 < parts.length) {
      completedSteps.push({ id: stepId, content });
    } else {
      currentStepId = stepId;
      currentContent = content;
    }
  }

  if (!currentStepId && completedSteps.length === 0) {
    return <span className="animate-pulse text-t-muted">議論を開始中...</span>;
  }

  return (
    <DebateDisplay
      modelA={modelA}
      modelB={modelB}
      steps={completedSteps}
      streamingStepId={currentStepId || undefined}
      streamingContent={currentContent}
    />
  );
}
