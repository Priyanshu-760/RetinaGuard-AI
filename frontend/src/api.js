export const CLASS_ORDER = ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];

export async function getHealth() {
  const res = await fetch('/health', { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok) throw new Error('Health check failed');
  return body;
}

export async function postAnalyze(file) {
  const fd = new FormData();
  fd.append('image', file, file.name);
  const res = await fetch('/analyze', { method: 'POST', body: fd });
  const body = await res.json();
  if (!res.ok || body.success !== true) {
    throw new Error(body.error || 'Analysis failed.');
  }
  return body;
}

export function gradeKey(grade) {
  return String(grade || '').toLowerCase().replace(/[^a-z]/g, '');
}

export function formatBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}
