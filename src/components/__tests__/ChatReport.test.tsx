// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import type { ChatReport } from '@/types';
import { theme } from '@/theme/theme';
import { ChatReportCard, tableCsv } from '../ChatReport';

const report: ChatReport = {
  title: 'Placement summary report', subtitle: 'Filtered to department CSE', generatedAt: '2030-01-05T10:30:00Z',
  kpis: [{ label: 'Students', value: '120' }, { label: 'Placed', value: '45' }, { label: 'Placement %', value: '37.5%' }],
  sections: [
    { heading: 'Placement by department', table: { columns: ['Department', 'Students', 'Placed'], rows: [['CSE', 60, 30], ['IT', 40, 15]] }, chart: { title: 'Placed vs not placed by department', type: 'stacked', types: ['bar', 'stacked', 'hbar'], labels: ['CSE', 'IT'], series: [{ name: 'Placed', values: [30, 15] }, { name: 'Not placed', values: [30, 25] }] } },
    { heading: 'Applicants', note: 'Showing the first 100 of 240.', table: { columns: ['Name', 'Email'], rows: [['=cmd|"/c calc"!A1', 'a@b.c']] } },
    { heading: 'Empty section', table: { columns: ['A'], rows: [] } },
  ],
  truncated: true,
};
const show = (r = report) => render(<ThemeProvider theme={theme}><ChatReportCard report={r} /></ThemeProvider>);

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: ResizeObserverCallback) {} observe(el: Element) { this.cb([{ target: el, contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as never); } unobserve() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll('iframe').forEach((f) => f.remove()); });

describe('ChatReportCard', () => {
  it('shows the title, subtitle, KPI tiles, tables with right-aligned numbers, notes and the truncation hint', () => {
    show();
    const card = screen.getByRole('region', { name: 'Report: Placement summary report' });
    expect(within(card).getByRole('heading', { name: 'Placement summary report' })).toBeInTheDocument();
    expect(within(card).getByText(/Filtered to department CSE · Generated/)).toBeInTheDocument();
    expect(within(card).getByText('Placement %').nextElementSibling).toHaveTextContent('37.5%');
    const table = within(card).getByRole('table', { name: 'Placement summary report: Placement by department' });
    expect(within(table).getByRole('columnheader', { name: 'Students' })).toHaveStyle({ textAlign: 'right' });
    expect(within(table).getByRole('row', { name: /CSE 60 30/ })).toBeInTheDocument();
    expect(within(card).getByText('Showing the first 100 of 240.')).toBeInTheDocument();
    expect(within(card).getByText('No rows for these filters.')).toBeInTheDocument();
    expect(within(card).getByText(/Use the Reports page for the full export/)).toBeInTheDocument();
  });

  it('embeds each section chart with its own style switcher', async () => {
    show();
    expect(screen.getByRole('heading', { name: 'Placed vs not placed by department' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Horizontal chart' }));
    expect(screen.getByRole('button', { name: 'Horizontal chart' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('builds CSV per table and neutralises spreadsheet formulas', () => {
    expect(tableCsv(['Department', 'Students'], [['CSE', 60], ['IT', null]])).toBe('"Department","Students"\r\n"CSE","60"\r\n"IT",""');
    expect(tableCsv(['Name'], [['=cmd|"/c calc"!A1']])).toBe(`"Name"\r\n"'=cmd|""/c calc""!A1"`);
  });

  it('downloads a table as CSV (only tables that have rows get a button)', async () => {
    let blob: Blob | undefined;
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blob = b; return 'blob:x'; }, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    show();
    expect(screen.queryByRole('button', { name: 'Download Empty section as CSV' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download Placement by department as CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(await blob!.text()).toBe('"Department","Students","Placed"\r\n"CSE","60","30"\r\n"IT","40","15"');
  });

  it('Print / PDF prints a copy of the report in a hidden frame, without the buttons, then cleans up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show();
    await act(async () => { screen.getByRole('button', { name: 'Print or save Placement summary report as PDF' }).click(); });
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toBeInTheDocument();
    const printed = frame.contentDocument!;
    expect(printed.title).toBe('Placement summary report');
    expect(printed.body.textContent).toContain('Placement by department');
    expect(printed.querySelector('[data-noprint]')).toBeNull();
    expect(printed.querySelector('button')).toBeNull();
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow!, 'print', { value: print, configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(print).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(document.querySelector('iframe')).toBeNull();
  });
});
