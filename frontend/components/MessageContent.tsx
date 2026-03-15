"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, coldarkCold } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/lib/themeContext";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 rounded text-xs bg-theme-hover/80 hover:bg-theme-active text-t-tertiary hover:text-t-secondary transition-colors opacity-0 group-hover:opacity-100"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function MessageContent({ content }: { content: string }) {
  const { theme } = useTheme();
  const codeStyle = theme === "dark" ? oneDark : coldarkCold;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match;
          const codeString = String(children).replace(/\n$/, "");
          return isInline ? (
            <code
              className="bg-code-bg text-code-text px-1 py-0.5 rounded text-sm font-mono"
              {...props}
            >
              {children}
            </code>
          ) : (
            <div className="relative group my-2">
              <CopyButton text={codeString} />
              <SyntaxHighlighter
                style={codeStyle}
                language={match[1]}
                PreTag="div"
                className="rounded-lg text-sm"
                customStyle={{ overflowX: "auto", maxWidth: "100%" }}
              >
                {codeString}
              </SyntaxHighlighter>
            </div>
          );
        },
        p({ children }) {
          return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
        },
        ul({ children }) {
          return <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>;
        },
        h1({ children }) {
          return <h1 className="text-xl font-semibold mb-2 mt-4">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-lg font-semibold mb-2 mt-4">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-base font-semibold mb-1 mt-3">{children}</h3>;
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full border-collapse text-sm">{children}</table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="border-b-2 border-border-primary">{children}</thead>;
        },
        th({ children }) {
          return <th className="px-3 py-2 text-left font-semibold text-t-primary">{children}</th>;
        },
        td({ children }) {
          return <td className="px-3 py-2 border-t border-border-primary text-t-secondary">{children}</td>;
        },
      }}
    >
      {content.replace(/<\/?cite[^>]*>/g, "")}
    </ReactMarkdown>
  );
}
