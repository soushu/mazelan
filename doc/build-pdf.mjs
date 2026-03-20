#!/usr/bin/env node
/**
 * Markdown → スタイル付きPDF変換（Mermaid図レンダリング対応）
 * Usage: node build-pdf.mjs <input.md> [output.pdf]
 *
 * 1. Mermaid コードブロックを SVG に事前レンダリング
 * 2. カスタム CSS + ページ番号付きで PDF 生成
 */
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const input = process.argv[2];
if (!input) {
  console.log('Usage: node build-pdf.mjs <input.md> [output.pdf]');
  process.exit(1);
}

const output = process.argv[3] || input.replace(/\.md$/, '.pdf');
const cssPath = resolve(__dirname, 'pdf-style.css');
const tempDir = mkdtempSync(join(tmpdir(), 'md-pdf-'));

let md = readFileSync(resolve(input), 'utf-8');

// Step 1: Extract and render Mermaid blocks to SVG
let mermaidIndex = 0;
const mermaidBlocks = [];

md = md.replace(/```mermaid\n([\s\S]*?)```/g, (match, content) => {
  const idx = mermaidIndex++;
  const mmdFile = join(tempDir, `diagram-${idx}.mmd`);
  const svgFile = join(tempDir, `diagram-${idx}.svg`);

  writeFileSync(mmdFile, content.trim());

  try {
    execSync(
      `npx --yes @mermaid-js/mermaid-cli -i "${mmdFile}" -o "${svgFile}" -b transparent -q`,
      { timeout: 30000 }
    );
    console.log(`  Rendered diagram ${idx + 1}`);

    // Read SVG and embed inline
    let svg = readFileSync(svgFile, 'utf-8');
    // Wrap in centered div
    return `<div style="text-align:center;margin:20px 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">\n${svg}\n</div>`;
  } catch (e) {
    console.warn(`  Warning: Failed to render diagram ${idx + 1}, keeping as text`);
    return match;
  }
});

// Step 2: Add frontmatter for md-to-pdf
const frontmatter = `---
stylesheet: ${cssPath}
pdf_options:
  format: A4
  margin:
    top: 20mm
    bottom: 20mm
    left: 15mm
    right: 15mm
  printBackground: true
  displayHeaderFooter: true
  headerTemplate: '<span></span>'
  footerTemplate: '<div style="width:100%;text-align:center;font-size:9px;color:#94a3b8;padding:0 20mm;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
---

`;

const tempFile = join(tempDir, 'output.md');
writeFileSync(tempFile, frontmatter + md);

// Step 3: Convert to PDF
try {
  execSync(`npx md-to-pdf "${tempFile}"`, { stdio: 'inherit', timeout: 60000 });
  const tempPdf = tempFile.replace(/\.md$/, '.pdf');
  execSync(`mv "${tempPdf}" "${resolve(output)}"`);
  console.log(`\nGenerated: ${output}`);
} finally {
  // Cleanup
  try { execSync(`rm -rf "${tempDir}"`); } catch {}
}
