import { useMemo } from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { InterviewView } from '@/api';
import { fmtTime } from '@/utils/format';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Accessible month grid: every day is a labelled cell, every interview a focusable button. */
export function InterviewCalendar({ month, onMonth, items, onOpen }: { month: Date; onMonth: (d: Date) => void; items: InterviewView[]; onOpen: (i: InterviewView) => void }) {
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const today = new Date();
  const shift = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const label = month.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const rows = cells.slice(35).every((d) => d.getMonth() !== month.getMonth()) ? 35 : 42;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h4" component="h2" aria-live="polite">{label}</Typography>
        <Stack direction="row" spacing={0.5}>
          <IconButton onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeftIcon /></IconButton>
          <Button size="small" onClick={() => onMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
          <IconButton onClick={() => shift(1)} aria-label="Next month"><ChevronRightIcon /></IconButton>
        </Stack>
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Box role="grid" aria-label={`Interview calendar, ${label}`} sx={{ minWidth: 720, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: '#fff' }}>
          <Box role="row" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', bgcolor: '#f8fafc' }}>
            {DOW.map((d) => <Typography key={d} role="columnheader" variant="caption" fontWeight={600} color="text.secondary" sx={{ p: 1, textAlign: 'center' }}>{d}</Typography>)}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {cells.slice(0, rows).map((d) => {
              const evs = items.filter((i) => sameDay(new Date(i.interview.at), d));
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = sameDay(d, today);
              return (
                <Box key={d.toISOString()} role="gridcell" aria-label={`${d.toDateString()}, ${evs.length} interview(s)`} sx={{ minHeight: 98, p: 0.75, borderTop: 1, borderLeft: 1, borderColor: 'divider', '&:nth-of-type(7n+1)': { borderLeft: 0 }, bgcolor: inMonth ? '#fff' : '#f8fafc' }}>
                  <Typography variant="caption" sx={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', fontWeight: isToday ? 700 : 500, bgcolor: isToday ? 'secondary.main' : undefined, color: isToday ? '#fff' : inMonth ? 'text.primary' : 'text.disabled' }}>{d.getDate()}</Typography>
                  <Stack spacing={0.4} sx={{ mt: 0.25 }}>
                    {evs.slice(0, 3).map((i) => (
                      <Box key={i.interview.id} component="button" type="button" onClick={() => onOpen(i)} aria-label={`${i.interview.round}, ${i.company.name}, ${fmtTime(i.interview.at)}`}
                        sx={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', px: 0.75, py: 0.25, borderRadius: 1, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          bgcolor: i.interview.status === 'cancelled' ? '#fee2e2' : i.interview.status === 'completed' ? '#dcfce7' : '#dbeafe', color: i.interview.status === 'cancelled' ? '#991b1b' : i.interview.status === 'completed' ? '#166534' : '#1e40af', '&:focus-visible': { outline: '2px solid #2563eb' } }}>
                        {fmtTime(i.interview.at)} {i.company.name}
                      </Box>
                    ))}
                    {evs.length > 3 && <Typography variant="caption" color="text.secondary">+{evs.length - 3} more</Typography>}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
