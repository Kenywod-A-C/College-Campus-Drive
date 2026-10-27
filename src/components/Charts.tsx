import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Box, Typography } from '@mui/material';
import { chartColors } from '@/theme/theme';
import { SectionCard } from './ui';
import { EmptyState } from './feedback';

export function ChartCard({ title, subtitle, children, height = 280, empty, ariaLabel }: { title: string; subtitle?: string; children: ReactNode; height?: number; empty?: boolean; ariaLabel?: string }) {
  return (
    <SectionCard title={title} subtitle={subtitle}>
      {empty ? <EmptyState title="No data for these filters" /> : (
        <Box role="img" aria-label={ariaLabel ?? title} sx={{ width: '100%', height }}>
          <ResponsiveContainer width="100%" height="100%">{children as never}</ResponsiveContainer>
        </Box>
      )}
    </SectionCard>
  );
}

const axis = { tick: { fontSize: 12, fill: '#5b6b86' }, axisLine: { stroke: '#e3e8f0' }, tickLine: false } as const;
const tooltipStyle = { borderRadius: 10, border: '1px solid #e3e8f0', boxShadow: '0 4px 12px rgba(15,23,42,.08)', fontSize: 13 };

export interface Series { key: string; label: string }

export function BarChartCard({ title, subtitle, data, xKey, series, stacked, height, layout = 'horizontal' }: { title: string; subtitle?: string; data: object[]; xKey: string; series: Series[]; stacked?: boolean; height?: number; layout?: 'horizontal' | 'vertical' }) {
  const vertical = layout === 'vertical';
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!data.length} ariaLabel={`${title}. ${series.map((s) => s.label).join(', ')} by ${xKey}.`}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={vertical} horizontal={!vertical} />
        {vertical ? <><XAxis type="number" allowDecimals={false} {...axis} /><YAxis type="category" dataKey={xKey} width={90} {...axis} /></> : <><XAxis dataKey={xKey} {...axis} /><YAxis allowDecimals={false} {...axis} /></>}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(37,99,235,.06)' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={chartColors[i % chartColors.length]} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ChartCard>
  );
}

export function DonutCard({ title, subtitle, data, nameKey, valueKey, height }: { title: string; subtitle?: string; data: object[]; nameKey: string; valueKey: string; height?: number }) {
  const rows = data.filter((d) => Number((d as Record<string, unknown>)[valueKey]) > 0);
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!rows.length} ariaLabel={`${title}: ${rows.map((d) => `${(d as Record<string, unknown>)[nameKey]} ${(d as Record<string, unknown>)[valueKey]}`).join(', ')}`}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="#fff">
          {rows.map((_, i) => <Cell key={i} fill={chartColors[i % chartColors.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ChartCard>
  );
}

export function LineChartCard({ title, subtitle, data, xKey, series, height }: { title: string; subtitle?: string; data: object[]; xKey: string; series: Series[]; height?: number }) {
  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={!data.length}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f0" vertical={false} />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis allowDecimals={false} {...axis} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={chartColors[i % chartColors.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}
      </LineChart>
    </ChartCard>
  );
}

/** Horizontal funnel built from plain markup so every stage has a visible label and value (and is screen-reader friendly). */
export function FunnelCard({ title, subtitle, stages }: { title: string; subtitle?: string; stages: { stage: string; count: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <SectionCard title={title} subtitle={subtitle}>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
        {stages.map((s, i) => (
          <Box component="li" key={s.stage} sx={{ display: 'grid', gridTemplateColumns: { xs: '104px 1fr 40px', sm: '140px 1fr 48px' }, gap: 1.5, alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">{s.stage}</Typography>
            <Box sx={{ bgcolor: '#eef2f7', borderRadius: 1, height: 22 }} aria-hidden>
              <Box sx={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 6 : 0, height: '100%', borderRadius: 1, bgcolor: chartColors[0], opacity: 1 - i * 0.12 }} />
            </Box>
            <Typography variant="body2" fontWeight={600} textAlign="right">{s.count}</Typography>
          </Box>
        ))}
      </Box>
    </SectionCard>
  );
}
