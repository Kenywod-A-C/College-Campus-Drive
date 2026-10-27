import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Button, Card, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import type { ChartType, ChatChart } from '@/types';
import { chartColors } from '@/theme/theme';

const STYLE_LABEL: Record<ChartType, string> = { pie: 'Pie', donut: 'Donut', bar: 'Bar', hbar: 'Horizontal', stacked: 'Stacked', line: 'Line', area: 'Area' };
const axis = { tick: { fontSize: 12, fill: '#5b6b86' }, axisLine: { stroke: '#e3e8f0' }, tickLine: false } as const;
const tooltipStyle = { borderRadius: 10, border: '1px solid #e3e8f0', boxShadow: '0 4px 12px rgba(15,23,42,.08)', fontSize: 13 };
const HEIGHT = 300;

type View = ChartType | 'table';

/** CSV cells that start with = + - @ would be run as formulas by spreadsheets; neutralise them. */
export const csvCell = (v: string | number | null) => {
  const t = String(v ?? '');
  const safe = /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
  return `"${safe.replace(/"/g, '""')}"`;
};
export const chartCsv = (c: ChatChart) => [['', ...c.series.map((s) => s.name)], ...c.labels.map((l, i) => [l, ...c.series.map((s) => s.values[i] ?? '')])].map((r) => r.map(csvCell).join(',')).join('\r\n');

export const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'download';

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${slug(name)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const download = (c: ChatChart) => downloadCsv(c.title, chartCsv(c));

function Plot({ chart, type }: { chart: ChatChart; type: ChartType }) {
  const { labels, series, unit = '' } = chart;
  const rows = useMemo(() => labels.map((name, i) => ({ name, ...Object.fromEntries(series.map((s, j) => [`s${j}`, s.values[i] ?? 0])) })), [labels, series]);
  const fmt = (v: unknown) => `${v}${unit}`;
  const tip = <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} cursor={{ fill: 'rgba(37,99,235,.06)' }} />;
  const legend = series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null;
  const margin = { top: 16, right: 16, left: -8, bottom: 0 };

  if (type === 'pie' || type === 'donut') {
    return (
      <PieChart>
        <Pie data={rows} dataKey="s0" nameKey="name" innerRadius={type === 'donut' ? '52%' : 0} outerRadius="78%" paddingAngle={type === 'donut' ? 2 : 0} stroke="#fff" label={(e: { value?: number }) => fmt(e.value ?? '')} isAnimationActive={false}>
          {rows.map((_, i) => <Cell key={i} fill={chartColors[i % chartColors.length]} />)}
        </Pie>
        {tip}
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  }
  if (type === 'line') {
    return (
      <LineChart data={rows} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={false} />
        <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} unit={unit} {...axis} />
        {tip}{legend}
        {series.map((s, j) => <Line key={j} type="monotone" dataKey={`s${j}`} name={s.name} stroke={chartColors[j % chartColors.length]} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />)}
      </LineChart>
    );
  }
  if (type === 'area') {
    return (
      <AreaChart data={rows} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={false} />
        <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} unit={unit} {...axis} />
        {tip}{legend}
        {series.map((s, j) => <Area key={j} type="monotone" dataKey={`s${j}`} name={s.name} stroke={chartColors[j % chartColors.length]} fill={chartColors[j % chartColors.length]} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />)}
      </AreaChart>
    );
  }
  const horizontal = type === 'hbar';
  const stacked = type === 'stacked';
  const labelW = Math.min(150, Math.max(...labels.map((l) => l.length), 4) * 6.5 + 16);
  return (
    <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={horizontal ? { top: 8, right: 24, left: 4, bottom: 0 } : margin}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={horizontal} horizontal={!horizontal} />
      {horizontal ? <><XAxis type="number" allowDecimals={false} unit={unit} {...axis} /><YAxis type="category" dataKey="name" width={labelW} {...axis} /></> : <><XAxis dataKey="name" interval={0} {...axis} /><YAxis allowDecimals={false} unit={unit} {...axis} /></>}
      {tip}{legend}
      {series.map((s, j) => (
        <Bar key={j} dataKey={`s${j}`} name={s.name} fill={chartColors[j % chartColors.length]} stackId={stacked ? 'a' : undefined} maxBarSize={40} isAnimationActive={false}
          radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} label={!stacked && series.length === 1 ? { position: horizontal ? 'right' : 'top', fontSize: 11, fill: '#5b6b86' } : undefined} />
      ))}
    </BarChart>
  );
}

function DataTable({ chart }: { chart: ChatChart }) {
  const { labels, series, unit = '' } = chart;
  return (
    <Box sx={{ maxHeight: HEIGHT, overflow: 'auto' }}>
      <Table size="small" aria-label={`${chart.title}: data`}>
        <TableHead><TableRow><TableCell /> {series.map((s) => <TableCell key={s.name} align="right">{s.name}</TableCell>)}</TableRow></TableHead>
        <TableBody>{labels.map((l, i) => <TableRow key={l}><TableCell component="th" scope="row">{l}</TableCell>{series.map((s) => <TableCell key={s.name} align="right">{s.values[i]}{unit}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </Box>
  );
}

/** One server-computed chart with a style switcher, an accessible table view and CSV export. */
export function ChatChartCard({ chart }: { chart: ChatChart }) {
  const [view, setView] = useState<View>(chart.type);
  const summary = `${chart.title}. ${chart.labels.map((l, i) => `${l} ${chart.series.map((s) => `${s.values[i]}${chart.unit ?? ''}`).join(' / ')}`).join(', ')}.`;
  return (
    <Card variant="outlined" sx={{ mt: 1.5, p: { xs: 1.25, sm: 2 }, bgcolor: '#fff' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3">{chart.title}</Typography>
          {chart.subtitle && <Typography variant="caption" color="text.secondary">{chart.subtitle}</Typography>}
        </Box>
        <Stack data-noprint direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)} aria-label={`Chart style for ${chart.title}`}>
            {chart.types.map((t) => <ToggleButton key={t} value={t} sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: 12 }} aria-label={`${STYLE_LABEL[t]} chart`}>{STYLE_LABEL[t]}</ToggleButton>)}
            <ToggleButton value="table" sx={{ px: 1, py: 0.25, textTransform: 'none', fontSize: 12 }} aria-label="Table view">Table</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" color="inherit" startIcon={<FileDownloadOutlinedIcon />} onClick={() => download(chart)} sx={{ fontSize: 12 }} aria-label={`Download ${chart.title} as CSV`}>CSV</Button>
        </Stack>
      </Stack>
      {view === 'table' ? <DataTable chart={chart} /> : (
        <Box role="img" aria-label={summary} sx={{ width: '100%', height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%"><Plot chart={chart} type={view} /></ResponsiveContainer>
        </Box>
      )}
    </Card>
  );
}
