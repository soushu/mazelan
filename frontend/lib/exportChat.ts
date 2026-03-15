import type { Message } from "./types";
import { parseUsageMarker, parseDebateContent, getModelLabel, formatCost } from "./types";

function sanitizeFilename(title: string): string {
  return title.replace(/[^\w\u3000-\u9FFF\uF900-\uFAFF-]/g, "_").slice(0, 50);
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMessages(messages: Message[]): { lines: string[]; totalCost: number; totalInputTokens: number; totalOutputTokens: number } {
  const lines: string[] = [];
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const m of messages) {
    const roleLabel = m.role === "user" ? "You" : "Assistant";
    const timestamp = formatTimestamp(m.created_at);

    if (m.role === "assistant") {
      // Check for debate content
      const debate = parseDebateContent(m.content);
      if (debate) {
        const modelALabel = getModelLabel(debate.modelA);
        const modelBLabel = getModelLabel(debate.modelB);
        lines.push(`--- ${roleLabel} [Debate: ${modelALabel} vs ${modelBLabel}] (${timestamp}) ---`);
        for (const step of debate.steps) {
          const stepLabels: Record<string, string> = {
            model_a_answer: `${modelALabel} Answer`,
            model_b_answer: `${modelBLabel} Answer`,
            model_a_critique: `${modelALabel} Critique`,
            model_b_critique: `${modelBLabel} Critique`,
            final: "Final Answer",
          };
          lines.push(`\n[${stepLabels[step.id] || step.id}]`);
          lines.push(step.content);
        }
        // Usage info from debate message
        if (m.input_tokens || m.output_tokens || m.cost) {
          const parts: string[] = [];
          if (m.input_tokens) { parts.push(`Input: ${m.input_tokens} tokens`); totalInputTokens += m.input_tokens; }
          if (m.output_tokens) { parts.push(`Output: ${m.output_tokens} tokens`); totalOutputTokens += m.output_tokens; }
          if (m.cost) { parts.push(`Cost: ${formatCost(m.cost)}`); totalCost += m.cost; }
          lines.push(`  (${parts.join(" | ")})`);
        }
        lines.push("");
        continue;
      }

      // Normal assistant message - strip usage marker
      const { text } = parseUsageMarker(m.content);
      const modelLabel = m.model ? ` [${getModelLabel(m.model)}]` : "";
      lines.push(`--- ${roleLabel}${modelLabel} (${timestamp}) ---`);
      lines.push(text);

      if (m.input_tokens || m.output_tokens || m.cost) {
        const parts: string[] = [];
        if (m.input_tokens) { parts.push(`Input: ${m.input_tokens} tokens`); totalInputTokens += m.input_tokens; }
        if (m.output_tokens) { parts.push(`Output: ${m.output_tokens} tokens`); totalOutputTokens += m.output_tokens; }
        if (m.cost) { parts.push(`Cost: ${formatCost(m.cost)}`); totalCost += m.cost; }
        lines.push(`  (${parts.join(" | ")})`);
      }
    } else {
      // User message
      lines.push(`--- ${roleLabel} (${timestamp}) ---`);
      if (m.images && m.images.length > 0) {
        lines.push(`[画像添付: ${m.images.length}枚]`);
      }
      lines.push(m.content);
    }
    lines.push("");
  }

  return { lines, totalCost, totalInputTokens, totalOutputTokens };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportAsText(title: string, messages: Message[]) {
  if (messages.length === 0) return;

  const { lines, totalCost, totalInputTokens, totalOutputTokens } = formatMessages(messages);

  const header = `=== ${title} ===\nExported: ${new Date().toLocaleString("ja-JP")}\n`;
  let footer = "";
  if (totalInputTokens > 0 || totalOutputTokens > 0 || totalCost > 0) {
    const parts: string[] = [];
    if (totalInputTokens > 0) parts.push(`Total Input: ${totalInputTokens} tokens`);
    if (totalOutputTokens > 0) parts.push(`Total Output: ${totalOutputTokens} tokens`);
    if (totalCost > 0) parts.push(`Total Cost: ${formatCost(totalCost)}`);
    footer = `\n=== Summary ===\n${parts.join("\n")}\n`;
  }

  const content = header + "\n" + lines.join("\n") + footer;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const filename = `claudia_${sanitizeFilename(title)}_${formatDate()}.txt`;
  triggerDownload(blob, filename);
}

export async function exportAsPdf(title: string, messages: Message[]) {
  if (messages.length === 0) return;

  const { jsPDF } = await import("jspdf");

  // Load Noto Sans JP font
  let fontBase64: string | null = null;
  try {
    const res = await fetch("/fonts/NotoSansJP-Regular.ttf");
    if (res.ok) {
      const buf = await res.arrayBuffer();
      // Convert to base64
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      fontBase64 = btoa(binary);
    }
  } catch {
    // Font not available, fall back to built-in
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  if (fontBase64) {
    doc.addFileToVFS("NotoSansJP-Regular.ttf", fontBase64);
    doc.addFont("NotoSansJP-Regular.ttf", "NotoSansJP", "normal");
    doc.setFont("NotoSansJP");
  }

  function checkPage(needed: number) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function writeText(text: string, fontSize: number) {
    doc.setFontSize(fontSize);
    if (fontBase64) {
      doc.setFont("NotoSansJP", "normal");
    }
    const splitLines = doc.splitTextToSize(text, contentWidth) as string[];
    const lineHeight = fontSize * 0.45;
    for (const line of splitLines) {
      checkPage(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
  }

  // Title
  writeText(title, 16);
  y += 2;
  writeText(`Exported: ${new Date().toLocaleString("ja-JP")}`, 8);
  y += 4;

  // Draw separator
  function drawSeparator() {
    checkPage(3);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;
  }

  const { lines: formattedLines, totalCost, totalInputTokens, totalOutputTokens } = formatMessages(messages);

  for (const line of formattedLines) {
    if (line.startsWith("---") && line.endsWith("---")) {
      drawSeparator();
      writeText(line.replace(/^-+\s*/, "").replace(/\s*-+$/, ""), 9);
      y += 1;
    } else if (line.startsWith("[") && line.endsWith("]")) {
      y += 1;
      writeText(line, 9);
      y += 1;
    } else if (line.startsWith("  (") && line.endsWith(")")) {
      writeText(line, 7);
    } else if (line === "") {
      y += 2;
    } else {
      writeText(line, 9);
    }
  }

  // Footer summary
  if (totalInputTokens > 0 || totalOutputTokens > 0 || totalCost > 0) {
    drawSeparator();
    y += 2;
    writeText("Summary", 11);
    y += 1;
    if (totalInputTokens > 0) writeText(`Total Input: ${totalInputTokens} tokens`, 8);
    if (totalOutputTokens > 0) writeText(`Total Output: ${totalOutputTokens} tokens`, 8);
    if (totalCost > 0) writeText(`Total Cost: ${formatCost(totalCost)}`, 8);
  }

  const filename = `claudia_${sanitizeFilename(title)}_${formatDate()}.pdf`;
  doc.save(filename);
}
