/** Exportar respuesta o chat a texto / HTML imprimible (PDF vía diálogo del sistema) y DOCX simple. */

import type { StoredMessage } from "@/lib/types";

export function chatToMarkdown(messages: StoredMessage[], title = "Chat Lumen"): string {
  const lines = [`# ${title}`, "", `_Exportado ${new Date().toLocaleString("es-CO")}_`, ""];
  for (const message of messages) {
    const who = message.role === "user" ? "Tú" : "Lumen";
    lines.push(`## ${who}`, "", message.content.trim(), "");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** DOCX mínimo (Office Open XML) sin dependencias. */
export function downloadDocx(filename: string, title: string, bodyMarkdown: string): void {
  const paragraphs = bodyMarkdown
    .split(/\n/)
    .map((line) => {
      const safe = escapeXml(line || " ");
      return `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
    })
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>
    ${paragraphs}
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  void zipAndDownload(filename, {
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rels,
    "word/document.xml": documentXml,
  });
}

export function openPrintablePdf(title: string, bodyHtml: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=800,height=900");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;line-height:1.5;color:#111}
h1{font-size:1.4rem} pre,code{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:.9rem}
.meta{color:#555;font-size:.85rem}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Lumen · exportado ${new Date().toLocaleString("es-CO")} · solo local</p>
${bodyHtml}
<script>window.onload=()=>window.print()</script>
</body></html>`);
  win.document.close();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

async function zipAndDownload(filename: string, files: Record<string, string>): Promise<void> {
  // ZIP store (sin compresión) mínimo para DOCX.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 0, true); // store
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const crc = crc32(data);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    parts.push(local, data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const blob = new Blob([...parts, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88330 : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}
