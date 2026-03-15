"use client";

import { useState } from "react";
import type { UsageInfo } from "@/lib/types";
import { formatCost } from "@/lib/types";

export default function TokenUsageTooltip({ usage }: { usage: UsageInfo }) {
  const [show, setShow] = useState(false);
  const total = usage.input_tokens + usage.output_tokens;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShow(!show)}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="p-1 rounded text-t-muted hover:text-t-secondary hover:bg-theme-hover transition-all text-xs"
        title="Token usage"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
      </button>
      {show && (
        <div className="absolute bottom-full right-0 mb-2 bg-theme-surface border border-border-primary rounded-lg shadow-lg p-3 text-xs whitespace-nowrap z-50">
          <div className="text-t-secondary space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-t-muted">Input</span>
              <span>{usage.input_tokens.toLocaleString()} tokens</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-t-muted">Output</span>
              <span>{usage.output_tokens.toLocaleString()} tokens</span>
            </div>
            <div className="border-t border-border-primary pt-1 mt-1 flex justify-between gap-4">
              <span className="text-t-muted">Total</span>
              <span>{total.toLocaleString()} tokens</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-t-muted">Cost</span>
              <span className="font-medium">{formatCost(usage.cost)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
