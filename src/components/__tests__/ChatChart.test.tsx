// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import type { ChatChart } from '@/types';
import { theme } from '@/theme/theme';

// jsdom has no layout, so the real ResponsiveContainer would measure 0x0 and draw nothing: report a fixed size instead.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: ResizeObserverCallback) {} observe(el: Element) { this.cb([{ target: el, contentRect: { width: 600, height: 300 } } as ResizeObserverEntry], this as never); } unobserve() {} disconnect() {} });
  // the chart container is 600x300; small things (the legend) must not also claim 300px or no plot area is left
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const small = this.className?.toString().includes('recharts-legend');
    const [w, h] = small ? [600, 24] : [600, 300];
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) };
  });
});

import { ChatChartCard, chartCsv } from '../ChatChart';

const single: ChatChart = { title: 'Students by placement status', subtitle: 'Filtered to department IT', type: 'pie', types: ['pie', 'donut', 'bar', 'hbar'], labels: ['Placed', 'In process', 'Unplaced'], series: [{ name: 'Students', values: [6, 3, 8] }] };
const multi: ChatChart = { title: 'Placed vs not placed by department', type: 'stacked', types: ['bar', 'stacked', 'hbar'], labels: ['CSE', 'IT'], series: [{ name: 'Placed', values: [5, 2] }, { name: 'Not placed', values: [7, 6] }] };
const trend: ChatChart = { title: 'Applications and offers by month', type: 'line', types: ['line', 'area', 'bar'], labels: ['Aug 26', 'Sep 26', 'Oct 26'], series: [{ name: 'Applications', values: [4, 9, 12] }, { name: 'Offers', values: [0, 2, 5] }] };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const show = (c: ChatChart) => render(<ThemeProvider theme={theme}><ChatChartCard chart={c} /></ThemeProvider>);
const style = (name: string) => screen.getByRole('button', { name: `${name} chart` });

describe('ChatChartCard', () => {
  it('draws the requested style with one mark per data point, plus an accessible summary of the numbers', () => {
    const { container } = show(single);
    expect(screen.getByRole('heading', { name: 'Students by placement status' })).toBeInTheDocument();
    expect(screen.getByText('Filtered to department IT')).toBeInTheDocument();
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3);
    expect(screen.getByRole('img', { name: /Placed 6, In process 3, Unplaced 8/ })).toBeInTheDocument();
    expect(style('Pie')).toHaveAttribute('aria-pressed', 'true');
  });

  it('the same data can be viewed several ways: donut, bar and horizontal bar', async () => {
    const { container } = show(single);
    await userEvent.click(style('Donut'));
    expect(style('Donut')).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.recharts-pie-sector')).toHaveLength(3);
    await userEvent.click(style('Bar'));
    expect(container.querySelectorAll('.recharts-pie')).toHaveLength(0);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    await userEvent.click(style('Horizontal'));
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    expect(container.querySelector('.recharts-yAxis')).toBeInTheDocument();
  });

  it('only offers styles that suit the data: no pie for several series, line/area for trends', async () => {
    const { unmount } = show(multi);
    expect(screen.queryByRole('button', { name: 'Pie chart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stacked chart' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    const { container } = show(trend);
    expect(container.querySelectorAll('.recharts-line-curve')).toHaveLength(2);
    await userEvent.click(style('Area'));
    expect(container.querySelectorAll('.recharts-area-area')).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Aug 26 4 \/ 0/ })).toBeInTheDocument();
  });

  it('stacked series draw one bar per series and label', () => {
    const { container } = show(multi);
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4);
  });

  it('has a table view with the exact numbers as an alternative to the graphic', async () => {
    show(single);
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    const table = screen.getByRole('table', { name: 'Students by placement status: data' });
    expect(within(table).getByRole('row', { name: /Unplaced 8/ })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await userEvent.click(style('Bar'));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('percent units appear in the table and the summary', async () => {
    show({ title: 'Placement rate by department', type: 'bar', types: ['bar', 'hbar', 'line'], labels: ['CSE'], series: [{ name: 'Placed %', values: [33.3] }], unit: '%' });
    expect(screen.getByRole('img', { name: /CSE 33.3%/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('33.3%')).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  it('builds a CSV with a header row and one row per label', () => {
    expect(chartCsv(multi)).toBe('"","Placed","Not placed"\r\n"CSE","5","7"\r\n"IT","2","6"');
  });

  it('neutralises spreadsheet formulas and quotes', () => {
    const c = chartCsv({ ...single, labels: ['=HYPERLINK("http://evil")', 'A "quoted" name', '-5'], series: [{ name: 'Students', values: [1, 2, 3] }] });
    expect(c).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(c).toContain('"A ""quoted"" name"');
    expect(c).toContain('"-5"'); // plain numbers are left alone
  });

  describe('download button', () => {
    let created: Blob | undefined;
    beforeEach(() => {
      created = undefined;
      vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { created = b; return 'blob:x'; }, revokeObjectURL: vi.fn() });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('downloads the dataset as a CSV file named after the chart', async () => {
      const clicks = vi.mocked(HTMLAnchorElement.prototype.click);
      show(single);
      await userEvent.click(screen.getByRole('button', { name: 'Download Students by placement status as CSV' }));
      expect(clicks).toHaveBeenCalledTimes(1);
      expect(created?.type).toContain('text/csv');
      expect(await created!.text()).toContain('"Placed","6"');
    });
  });
});
