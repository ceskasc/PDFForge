/** Parse semicolon-separated output documents, with commas and ranges inside each. */
export function parsePageGroups(input, totalPages) {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) throw new Error('invalid-pages');
  const expression = String(input ?? '').trim();
  if (!expression) throw new Error('empty-range');
  const groups = expression.split(';').map(chunk => chunk.trim());
  if (groups.some(group => !group)) throw new Error('invalid-range');
  return groups.map(group => {
    const pages = [];
    for (const token of group.split(',').map(part => part.trim())) {
      const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(token);
      if (!match) throw new Error('invalid-range');
      const first = Number(match[1]);
      const last = match[2] ? Number(match[2]) : first;
      if (first < 1 || last < first || last > totalPages) throw new Error('out-of-range');
      for (let p = first; p <= last; p++) {
        if (!pages.includes(p - 1)) pages.push(p - 1);
      }
    }
    if (!pages.length) throw new Error('empty-range');
    return pages;
  });
}
export function safeBaseName(filename) {
  return String(filename || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\-_\u00c0-\u024f]+/g, '-').replace(/^-+|-+$/g, '').slice(0,65) || 'document';
}
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return Math.round(bytes) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
export function normalizeRotation(value) {
  return ((Number(value) % 360) + 360) % 360;
}
