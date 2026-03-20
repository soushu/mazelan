"use client";

import { useState, useRef, useEffect } from "react";
import type { QAPair, DebateStepId } from "@/lib/types";
import { parseDebateContent, getProviderFromModelId } from "@/lib/types";
import MessageContent from "@/components/MessageContent";
import DebateDisplay from "@/components/DebateDisplay";
import ProviderIcon from "@/components/ProviderIcon";
import TokenUsageTooltip from "@/components/TokenUsageTooltip";
import { useTranslations } from "next-intl";

function MessageCopyButton({ text }: { text: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      title={t("copy.copy")}
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

function UserBubble({ user }: { user: QAPair["user"] }) {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // Check if content exceeds 5 lines (compare scrollHeight vs clamped height)
    setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [user.content]);

  return (
    <div className="flex gap-3 justify-end">
      <div className="max-w-[95%] md:max-w-[80%] rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm bg-theme-user-bubble text-t-user-bubble rounded-br-sm">
        {user.images && user.images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-2">
            {user.images.map((img, i) => (
              <img
                key={i}
                src={img.preview_url || `data:${img.media_type};base64,${img.data}`}
                alt={`attach ${i + 1}`}
                className="max-w-[150px] max-h-[150px] md:max-w-[200px] md:max-h-[200px] object-contain rounded-lg"
              />
            ))}
          </div>
        )}
        {user.content && (
          <div className="relative">
            <p
              ref={textRef}
              className={`whitespace-pre-wrap ${!expanded ? "line-clamp-5" : ""}`}
            >
              {user.content}
            </p>
            {clamped && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                className="absolute bottom-0 right-0 pl-8 bg-gradient-to-l from-[var(--color-bg-user-bubble)] from-60% text-t-user-bubble/70 hover:text-t-user-bubble text-xs"
              >
                {t("debate.more")}
              </button>
            )}
            {expanded && clamped && (
              <button
                onClick={() => setExpanded(false)}
                className="text-t-user-bubble/70 hover:text-t-user-bubble text-xs mt-1"
              >
                {t("debate.showLess")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
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
  /** Model ID for the streaming response (used to show correct provider icon) */
  streamingModel?: string;
  /** Tool execution status message (e.g. "フライトを検索中...") */
  toolStatus?: string | null;
  /** Pair index for fork functionality */
  pairIndex?: number;
  /** Called when user clicks fork button */
  onFork?: (pairIndex: number) => void;
};

export default function QAPairBlock({ pair, collapsed, onToggle, streamingText, streamingDebate, streamingModel, toolStatus, pairIndex, onFork }: Props) {
  const t = useTranslations();
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
            <UserBubble user={pair.user} />

            {/* Assistant bubble — debate or normal */}
            {pair.assistant && debateData && (
              <div className="group/msg">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 flex items-center justify-center text-xs flex-shrink-0 text-t-secondary">
                    🔀
                  </div>
                  <span className="text-xs font-medium text-t-muted">{t("debate.debateMode")}</span>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <DebateDisplay
                    modelA={debateData.modelA}
                    modelB={debateData.modelB}
                    steps={debateData.steps}
                  />
                </div>
                <div className="flex justify-end mt-1 gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  {pair.assistant.input_tokens != null && pair.assistant.cost != null && (
                    <TokenUsageTooltip usage={{ input_tokens: pair.assistant.input_tokens, output_tokens: pair.assistant.output_tokens!, cost: pair.assistant.cost }} modelId={pair.assistant.model} />
                  )}
                  <MessageCopyButton text={debateData.steps.find(s => s.id === "final")?.content || pair.assistant.content} />
                  {onFork && pairIndex !== undefined && (
                    <ForkButton onClick={() => onFork(pairIndex)} label={t("chat.fork")} />
                  )}
                </div>
              </div>
            )}

            {pair.assistant && !debateData && (
              <div className="group/msg">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-t-secondary">
                    <ProviderIcon provider={getProviderFromModelId(pair.assistant.model)} />
                  </div>
                </div>
                <div className="bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <MessageContent content={pair.assistant.content} />
                </div>
                <div className="flex justify-end mt-1 gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  {pair.assistant.input_tokens != null && pair.assistant.cost != null && (
                    <TokenUsageTooltip usage={{ input_tokens: pair.assistant.input_tokens, output_tokens: pair.assistant.output_tokens!, cost: pair.assistant.cost }} modelId={pair.assistant.model} />
                  )}
                  <MessageCopyButton text={pair.assistant.content} />
                  {onFork && pairIndex !== undefined && (
                    <ForkButton onClick={() => onFork(pairIndex)} label={t("chat.fork")} />
                  )}
                </div>
              </div>
            )}

            {/* Streaming response — debate mode */}
            {isStreaming && !pair.assistant && streamingDebate && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-6 h-6 flex items-center justify-center text-xs flex-shrink-0 text-t-secondary">
                    🔀
                  </div>
                  <span className="text-xs font-medium text-t-muted">{t("debate.debateMode")}</span>
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
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-t-secondary">
                    <ProviderIcon provider={getProviderFromModelId(streamingModel)} />
                  </div>
                </div>
                <div className={`bg-theme-assistant-bubble text-t-secondary rounded-2xl px-3 py-2.5 md:px-4 md:py-3 text-sm${streamingText ? "" : " w-fit"}`}>
                  {streamingText ? (
                    <>
                      <MessageContent content={streamingText} />
                      {toolStatus ? (
                        <span className="block text-xs text-t-muted mt-1 animate-pulse">{toolStatus}</span>
                      ) : (
                        <span className="inline-flex gap-1 items-center mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:300ms]" />
                        </span>
                      )}
                    </>
                  ) : toolStatus ? (
                    <span className="inline-flex items-center gap-2 text-xs text-t-muted animate-pulse py-1">
                      <span className="w-4 h-4 border-2 border-spinner-track border-t-spinner-fill rounded-full animate-spin" />
                      {toolStatus}
                    </span>
                  ) : (
                    <span className="inline-flex gap-1 items-center py-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-t-muted animate-bounce [animation-delay:300ms]" />
                    </span>
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
  const t = useTranslations();
  const completedSteps: { id: DebateStepId; content: string }[] = [];
  let currentStepId: DebateStepId | null = null;
  let currentContent = "";

  // Split by step markers: \n[STEP:xxx]\n
  const parts = rawText.split(/\n\[STEP:(\w+)\]\n/);
  // parts[0] = text before first marker (usually empty)
  // parts[1] = step id, parts[2] = content, ...

  for (let i = 1; i < parts.length; i += 2) {
    const stepId = parts[i] as DebateStepId;
    const content = (parts[i + 1] || "").replace(/<!--PACING-->/g, "").trim();
    if (i + 2 < parts.length) {
      completedSteps.push({ id: stepId, content });
    } else {
      currentStepId = stepId;
      currentContent = content;
    }
  }

  // Detect pacing state: step marker received but no content yet (waiting for rate limit delay)
  const isPacing = currentStepId !== null && currentContent === "" && rawText.includes("<!--PACING-->");

  if (!currentStepId && completedSteps.length === 0) {
    return <span className="animate-pulse text-t-muted">{t("debate.starting")}</span>;
  }

  return (
    <DebateDisplay
      modelA={modelA}
      modelB={modelB}
      steps={completedSteps}
      streamingStepId={currentStepId || undefined}
      streamingContent={isPacing ? undefined : currentContent}
      isPacing={isPacing}
    />
  );
}

function ForkButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="p-1 text-t-faint hover:text-t-secondary transition-colors"
      title={label}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
    </button>
  );
}
