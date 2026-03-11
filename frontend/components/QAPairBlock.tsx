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
        className="group flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800/40 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-slate-500 flex-shrink-0 transition-transform duration-300 ${
            collapsed ? "" : "rotate-90"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm text-slate-400 truncate">
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
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-slate-700 text-slate-100 rounded-br-sm">
                <p className="whitespace-pre-wrap">{pair.user.content}</p>
              </div>
            </div>

            {/* Assistant bubble */}
            {pair.assistant && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">
                  C
                </div>
                <div className="max-w-[80%] bg-slate-800/60 text-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                  <MessageContent content={pair.assistant.content} />
                </div>
              </div>
            )}

            {/* Streaming response */}
            {isStreaming && !pair.assistant && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs flex-shrink-0 mt-1">
                  C
                </div>
                <div className="max-w-[80%] bg-slate-800/60 text-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm">
                  {streamingText ? (
                    <MessageContent content={streamingText} />
                  ) : (
                    <span className="animate-pulse text-slate-500">▋</span>
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
