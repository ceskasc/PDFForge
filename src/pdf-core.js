import { PDFDocument, degrees } from 'pdf-lib';
import JSZip from 'jszip';
import { parsePageGroups, safeBaseName, normalizeRotation } from './ranges.js';

// Document editing in a browser-independent module for real PDF integration tests.
const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
const PDF_MIME = 'application/pdf';
function createPdfResult(bytes, filename, detail = '') {
  return { blob: new Blob([bytes], { type: PDF_MIME }), filename, detail };
}
export async function combinePages(docs, pages, progress = () => {}) {
  if (!pages.length) throw new Error('no-pages');
  const dest = await PDFDocument.create();
  const cached = new Map();
  for (let i = 0; i < pages.length; i++) {
    const entry = pages[i];
    const doc = docs.find(item => item.id === entry.docId);
    if (!doc) throw new Error('missing-document');
    if (!cached.has(doc.id)) cached.set(doc.id, await PDFDocument.load(doc.bytes));
    const [copied] = await dest.copyPages(cached.get(doc.id), [entry.pageIndex]);
    if (entry.rotation) copied.setRotation(degrees(normalizeRotation(copied.getRotation().angle + entry.rotation)));
    dest.addPage(copied);
    progress((i + 1) / pages.length * .9);
    if (i % 4 === 0) await yieldToUI();
  }
  const output = await dest.save({ useObjectStreams: true });
  progress(1);
  return createPdfResult(output, `pdfforge-${docs.length > 1 ? 'merged' : 'organized'}.pdf`, `${pages.length} pages`);
}
export async function splitPdf(doc, input, progress = () => {}) {
  const groups = parsePageGroups(input, doc.pageCount);
  const src = await PDFDocument.load(doc.bytes);
  const zip = groups.length > 1 ? new JSZip() : null;
  let single = null;
  for (let i = 0; i < groups.length; i++) {
    const output = await PDFDocument.create();
    const copies = await output.copyPages(src, groups[i]);
    copies.forEach(page => output.addPage(page));
    const bytes = await output.save({ useObjectStreams: true });
    const name = `${safeBaseName(doc.file.name)}-part-${String(i + 1).padStart(2, '0')}.pdf`;
    if (zip) zip.file(name, bytes);
    else single = createPdfResult(bytes, name, `${groups[i].length} pages`);
    progress((i + 1) / groups.length * (zip ? .72 : 1));
    await yieldToUI();
  }
  if (!zip) return single;
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => progress(.72 + metadata.percent / 100 * .28));
  return { blob, filename: `${safeBaseName(doc.file.name)}-parts.zip`, detail: `${groups.length} PDF files` };
}
