"use client";

import type { QAPair } from "@/lib/types";
import MessageContent from "@/components/MessageContent";

type Props = {
  pair: QAPair;
  collapsed: boolean;
  onToggle: () => void;
  streamingText?: string;
};

export default function QAPairBlock({ pair, collapsed, onToggle, streamingText }: Props) {
  const isStreaming = streamingText !== undefined;

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

            {/* Assistant bubble */}
            {pair.assistant && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 mt-1 text-t-primary">
                  C
                </div>
                <div className="max-w-[95%] md:max-w-[80%] bg-theme-assistant-bubble text-t-secondary rounded-2xl rounded-bl-sm px-3 py-2.5 md:px-4 md:py-3 text-sm">
                  <MessageContent content={pair.assistant.content} />
                </div>
              </div>
            )}

            {/* Streaming response */}
            {isStreaming && !pair.assistant && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-theme-avatar flex items-center justify-center text-xs flex-shrink-0 mt-1 text-t-primary">
                  C
                </div>
                <div className="max-w-[95%] md:max-w-[80%] bg-theme-assistant-bubble text-t-secondary rounded-2xl rounded-bl-sm px-3 py-2.5 md:px-4 md:py-3 text-sm">
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
