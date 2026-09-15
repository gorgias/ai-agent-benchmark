// Print runner/eval-rubric.md to ./eval-rubric.pdf (internal judge spec).
// The public download at /rubric.pdf is the designed scoring worksheet — do not
// overwrite it from this script.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0, inCode = false, code = [], inTable = false, table = [];
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\s*\|?\s*:?-{3,}/.test(r));
    const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(rows[0] || "");
    let h = "<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
    for (const row of rows.slice(1)) {
      h += "<tr>" + cells(row).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    }
    out.push(h + "</tbody></table>");
    table = []; inTable = false;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = []; inCode = false; }
      else { flushTable(); inCode = true; }
      i++; continue;
    }
    if (inCode) { code.push(line); i++; continue; }
    if (/^\s*\|/.test(line)) { inTable = true; table.push(line); i++; continue; }
    if (inTable) flushTable();
    if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^> /.test(line)) {
      const bits = [];
      while (i < lines.length && /^> /.test(lines[i])) { bits.push(inline(lines[i].slice(2))); i++; }
      out.push(`<blockquote><p>${bits.join("<br>")}</p></blockquote>`);
      continue;
    } else if (/^[-*] /.test(line)) {
      const bits = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { bits.push(`<li>${inline(lines[i].slice(2))}</li>`); i++; }
      out.push(`<ul>${bits.join("")}</ul>`);
      continue;
    } else if (line.trim() === "") out.push("");
    else {
      const bits = [inline(line)];
      i++;
      while (i < lines.length && lines[i].trim() && !/^#{1,3} |^[-*] |^> |^\s*\|/.test(lines[i]) && !lines[i].startsWith("```")) {
        bits.push(inline(lines[i])); i++;
      }
      out.push(`<p>${bits.join(" ")}</p>`);
      continue;
    }
    i++;
  }
  if (inCode) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flushTable();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Conversation-quality rubric</title>
<style>
@page{margin:18mm 16mm}
body{font:11.5px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1b1a19;max-width:720px;margin:0 auto}
h1{font-size:22px;font-weight:600;margin:0 0 12px}
h2{font-size:16px;margin:22px 0 8px;border-bottom:1px solid #e8e2dc;padding-bottom:4px}
h3{font-size:13px;margin:16px 0 6px}
p,li,td,th,blockquote{font-size:11.5px}
table{border-collapse:collapse;width:100%;margin:8px 0 14px;font-variant-numeric:tabular-nums}
th,td{border:1px solid #d9d2cb;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f6f2ee}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;background:#f4f0eb;padding:1px 4px;border-radius:3px}
pre{background:#f4f0eb;padding:10px 12px;overflow:auto;border-radius:6px}
blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #f0603f;color:#3d3a37;background:#fff7f4}
.mark{font-size:10px;color:#5f5c59;margin-bottom:16px}
</style></head><body>
<p class="mark">Canonical judge specification · runner/eval-rubric.md · Gorgias AI Agent Benchmark</p>
${out.join("\n")}
</body></html>`;
}

export async function renderRubricPdf() {
  const mdPath = new URL("./eval-rubric.md", import.meta.url);
  const pdfPath = new URL("./eval-rubric.pdf", import.meta.url);
  const md = await readFile(mdPath, "utf8");
  const html = mdToHtml(md);
  if (!html.includes("a_direct") || !html.includes("s_answered")) {
    throw new Error("rendered rubric HTML is missing required checks — refusing to write PDF");
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath.pathname,
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
  } finally {
    await browser.close();
  }
  return pdfPath.pathname;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await renderRubricPdf();
  console.log(`Wrote ${out} from eval-rubric.md`);
}
