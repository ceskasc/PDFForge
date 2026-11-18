import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { safeBaseName, normalizeRotation } from './ranges.js';
export { combinePages, splitPdf } from './pdf-core.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 160 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_RENDER_PAGES = 220;
export const PDF_MIME = 'application/pdf';
const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

function assertSize(file) {
  if (!file || file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error('file-size');
}
function isPdfHeader(bytes) {
  const limit = Math.min(1024, bytes.length);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, limit));
  return header.includes('%PDF-');
}
export async function importPdf(file) {
  assertSize(file);
  const data = new Uint8Array(await file.arrayBuffer());
  if (!isPdfHeader(data)) throw new Error('not-pdf');
  let task;
  try {
    task = pdfjs.getDocument({ data: data.slice(), stopAtErrors: true, isEvalSupported: false });
    const reader = await task.promise;
    if (reader.numPages < 1 || reader.numPages > MAX_RENDER_PAGES) {
      await reader.destroy();
      throw new Error('too-many-pages');
    }
    return { id: crypto.randomUUID(), file, bytes: data, pageCount: reader.numPages, reader, type: 'pdf' };
  } catch (error) {
    try { await task?.destroy(); } catch {}
    if (error.message === 'too-many-pages') throw error;
    if (/password|encrypt/i.test(String(error.name + error.message))) throw new Error('encrypted');
    throw new Error('invalid-pdf');
  }
}
export async function importImage(file) {
  assertSize(file);
  const mime = file.type.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('not-image');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('invalid-image');
  }
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 45_000_000) {
    bitmap.close();
    throw new Error('large-image');
  }
  return { id: crypto.randomUUID(), file, width: bitmap.width, height: bitmap.height, bitmap, type: 'image' };
}
export async function releaseDocuments(docs) {
  for (const doc of docs) {
    try { await doc.reader?.destroy(); } catch {}
    try { doc.bitmap?.close(); } catch {}
  }
}
export async function previewPage(doc, pageIndex, maxWidth = 190, rotation = 0) {
  const page = await doc.reader.getPage(pageIndex + 1);
  const initial = page.getViewport({ scale: 1, rotation: normalizeRotation(page.rotate + rotation) });
  const ratio = Math.min(1.6, maxWidth / Math.max(1, initial.width));
  const viewport = page.getViewport({ scale: ratio, rotation: normalizeRotation(page.rotate + rotation) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
  const dataURL = canvas.toDataURL('image/jpeg', 0.76);
  canvas.width = canvas.height = 0;
  page.cleanup();
  return dataURL;
}
export async function previewImage(doc, maxWidth = 190) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxWidth / doc.width);
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(doc.bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', .8);
  canvas.width = canvas.height = 0;
  return url;
}
function createPdfResult(bytes, filename, detail = '') {
  return { blob: new Blob([bytes], { type: PDF_MIME }), filename, detail };
}
async function embedImage(pdf, image) {
  if (image.file.type === 'image/jpeg') return pdf.embedJpg(new Uint8Array(await image.file.arrayBuffer()));
  if (image.file.type === 'image/png') return pdf.embedPng(new Uint8Array(await image.file.arrayBuffer()));
  // Browser WebP decoding is used only as an intermediate; PDF export remains standard JPEG.
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image.bitmap, 0, 0);
  const jpg = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('invalid-image')), 'image/jpeg', .92));
  canvas.width = canvas.height = 0;
  return pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
}
export async function imagesToPdf(images, paper = 'a4', margin = 18, progress = () => {}) {
  if (!images.length) throw new Error('no-files');
  const pdf = await PDFDocument.create();
  const pad = Math.max(0, Math.min(70, Number(margin) || 0));
  for (let i = 0; i < images.length; i++) {
    const source = images[i];
    const embedded = await embedImage(pdf, source);
    let width, height;
    if (paper === 'original') {
      const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
      width = source.width * scale + pad * 2; height = source.height * scale + pad * 2;
    } else {
      [width, height] = paper === 'letter' ? [612, 792] : [595.28, 841.89];
      if (source.width > source.height) [width, height] = [height, width];
    }
    const page = pdf.addPage([width, height]);
    const scale = Math.min((width - pad * 2) / source.width, (height - pad * 2) / source.height);
    const imgWidth = source.width * scale, imgHeight = source.height * scale;
    page.drawImage(embedded, { x: (width - imgWidth) / 2, y: (height - imgHeight) / 2, width: imgWidth, height: imgHeight });
    progress((i + 1) / images.length * .92);
    if (i % 3 === 0) await yieldToUI();
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  progress(1);
  return createPdfResult(bytes, 'pdfforge-images.pdf', `${images.length} pages`);
}
export async function watermarkPdf(doc, text, opacity, progress = () => {}) {
  if (!text || text.trim().length === 0 || text.length > 80) throw new Error('watermark-text');
  const pdf = await PDFDocument.load(doc.bytes);
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 230;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 114px "DM Sans", system-ui, sans-serif';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#2944cd';
  const max = canvas.width - 55;
  let fontSize = 114;
  while (ctx.measureText(text).width > max && fontSize > 26) {
    fontSize -= 3;
    ctx.font = `700 ${fontSize}px "DM Sans", system-ui, sans-serif`;
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const pngBytes = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('watermark-text')), 'image/png'));
  canvas.width = canvas.height = 0;
  const png = await pdf.embedPng(new Uint8Array(pngBytes));
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const size = width * .78;
    const imgHeight = size * 230 / 1600;
    page.drawImage(png, { x: (width - size) / 2, y: (height - imgHeight) / 2, width: size, height: imgHeight, rotate: degrees(-24), opacity: Math.max(.05, Math.min(.65, Number(opacity) / 100)) });
    progress((index + 1) / pages.length * .88);
  });
  const bytes = await pdf.save({ useObjectStreams: true });
  progress(1);
  return createPdfResult(bytes, `${safeBaseName(doc.file.name)}-watermarked.pdf`, `${pages.length} pages`);
}
export async function compressPdf(doc, quality, progress = () => {}) {
  if (doc.pageCount > 60) throw new Error('compress-limit');
  const pdf = await PDFDocument.create();
  const jpgQuality = Math.max(.4, Math.min(.9, Number(quality) / 100));
  for (let index = 0; index < doc.pageCount; index++) {
    const page = await doc.reader.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.65, 2200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('memory');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('memory')), 'image/jpeg', jpgQuality));
    canvas.width = canvas.height = 0;
    const embedded = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const out = pdf.addPage([base.width, base.height]);
    out.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height });
    page.cleanup();
    progress((index + 1) / doc.pageCount * .9);
    await yieldToUI();
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  progress(1);
  return createPdfResult(bytes, `${safeBaseName(doc.file.name)}-smaller.pdf`, `${doc.pageCount} pages`);
}
