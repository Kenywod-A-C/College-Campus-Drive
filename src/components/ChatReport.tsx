import { useRef } from 'react';
import { Box, Button, Card, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import type { ChatReport } from '@/types';
import { ChatChartCard, csvCell, downloadCsv } from './ChatChart';

type Cell = string | number | null;
export const tableCsv = (columns: string[], rows: Cell[][]) => [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

/** Prints just this report: a hidden iframe gets the page's styles and a copy of the card (without its buttons, tables un-scrolled). */
export function printNode(node: HTMLElement, title: string) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) { iframe.remove(); return; }
  doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:16px;font-family:Inter,system-ui,sans-serif"></body></html>'); doc.close();
  doc.title = title;
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => doc.head.appendChild(n.cloneNode(true)));
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-noprint]').forEach((e) => e.remove());
  clone.querySelectorAll<HTMLElement>('[data-scroll]').forEach((e) => { e.style.maxHeight = 'none'; e.style.overflow = 'visible'; });
  doc.body.appendChild(clone);
  setTimeout(() => {
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } finally { setTimeout(() => iframe.remove(), 1500); }
  }, 300);
}

const fmtWhen = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

/** A server-built report inside the chat: KPI tiles, tables (CSV per table), charts (with their own style switcher) and print / save-as-PDF. */
export function ChatReportCard({ report }: { report: ChatReport }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Card ref={ref} variant="outlined" component="section" aria-label={`Report: ${report.title}`} sx={{ mt: 1.5, p: { xs: 1.5, sm: 2.5 }, bgcolor: '#fff' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h3">{report.title}</Typography>
          <Typography variant="caption" color="text.secondary">{[report.subtitle, report.generatedAt && `Generated ${fmtWhen(report.generatedAt)}`].filter(Boolean).join(' · ')}</Typography>
        </Box>
        <Button data-noprint size="small" variant="outlined" color="inherit" startIcon={<PrintOutlinedIcon />} onClick={() => ref.current && printNode(ref.current, report.title)} aria-label={`Print or save ${report.title} as PDF`}>Print / PDF</Button>
      </Stack>

      {report.kpis.length > 0 && (
        <Box component="dl" sx={{ m: 0, mb: 2, display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          {report.kpis.map((k) => (
            <Box key={k.label} sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: '#f8fafc' }}>
              <Typography component="dt" variant="caption" color="text.secondary">{k.label}</Typography>
              <Typography component="dd" variant="h4" sx={{ m: 0 }}>{k.value}</Typography>
            </Box>
          ))}
        </Box>
      )}

      <Stack spacing={2.5}>
        {report.sections.map((s) => (
          <Box key={s.heading}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
              <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }}>{s.heading}</Typography>
              {s.table && s.table.rows.length > 0 && (
                <Button data-noprint size="small" color="inherit" startIcon={<FileDownloadOutlinedIcon />} sx={{ fontSize: 12 }} aria-label={`Download ${s.heading} as CSV`}
                  onClick={() => downloadCsv(`${report.title} ${s.heading}`, tableCsv(s.table!.columns, s.table!.rows))}>CSV</Button>
              )}
            </Stack>
            {s.table && (s.table.rows.length ? (
              <TableContainer data-scroll sx={{ maxHeight: 360, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Table size="small" stickyHeader aria-label={`${report.title}: ${s.heading}`}>
                  <TableHead><TableRow>{s.table.columns.map((c, i) => <TableCell key={c} align={typeof s.table!.rows[0]?.[i] === 'number' ? 'right' : 'left'} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c}</TableCell>)}</TableRow></TableHead>
                  <TableBody>
                    {s.table.rows.map((r, ri) => (
                      <TableRow key={ri} hover>{r.map((v, ci) => <TableCell key={ci} align={typeof v === 'number' ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>{v ?? ''}</TableCell>)}</TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : <Typography variant="body2" color="text.secondary">No rows for these filters.</Typography>)}
            {s.note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{s.note}</Typography>}
            {s.chart && <ChatChartCard chart={s.chart} />}
          </Box>
        ))}
      </Stack>
      {report.truncated && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Large tables are cut to the first rows. Use the Reports page for the full export.</Typography>}
    </Card>
  );
}
