export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtShort = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDateTime = (iso?: string) => (iso ? `${fmtShort(iso)}, ${fmtTime(iso)}` : '—');
export const fmtLpa = (v?: number) => (v == null ? '—' : `₹${v.toFixed(v % 1 ? 1 : 0)} LPA`);
export const fmtStipend = (v?: number) => (v == null ? '—' : `₹${v.toLocaleString('en-IN')}/month`);

export const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
export function deadlineText(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return 'Closed';
  if (d === 0) return 'Closes today';
  if (d === 1) return '1 day left';
  return `${d} days left`;
}
export const deadlineTone = (iso: string): 'error' | 'warning' | 'default' => {
  const d = daysUntil(iso);
  return d < 0 ? 'default' : d <= 3 ? 'error' : d <= 7 ? 'warning' : 'default';
};
export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : fmtDate(iso);
};
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const toLocalInput = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const toDateInput = (iso?: string) => toLocalInput(iso).slice(0, 10);

export function downloadText(filename: string, content: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
