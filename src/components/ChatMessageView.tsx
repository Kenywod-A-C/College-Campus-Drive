import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Alert, Avatar, Box, Button, Card, Chip, Stack, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import BlockIcon from '@mui/icons-material/Block';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { ChatMessage, ChatSource } from '@/types';
import type { Base } from '@/layouts/useBase';
import { jobsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { fmtTime } from '@/utils/format';
import { JobCard } from './JobCard';
import { ChatChartCard } from './ChatChart';
import { ChatReportCard } from './ChatReport';

// Minimal safe markdown: **bold**, _italic_, "- " bullets, "> " quotes. No raw HTML is ever rendered.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((p, i) =>
    p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <i key={i}>{p.slice(1, -1)}</i> : <Fragment key={i}>{p}</Fragment>);
}
function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const out: { kind: 'p' | 'ul' | 'quote'; lines: string[] }[] = [];
    for (const raw of text.split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const kind = line.startsWith('- ') ? 'ul' : line.startsWith('> ') ? 'quote' : 'p';
      const clean = kind === 'ul' ? line.slice(2) : kind === 'quote' ? line.slice(2) : line;
      const last = out[out.length - 1];
      if (last && last.kind === kind && kind !== 'p') last.lines.push(clean); else out.push({ kind, lines: [clean] });
    }
    return out;
  }, [text]);
  return (
    <Stack spacing={1}>
      {blocks.map((b, i) => b.kind === 'ul'
        ? <Box key={i} component="ul" sx={{ m: 0, pl: 2.5, '& li': { mb: 0.5 } }}>{b.lines.map((l, j) => <li key={j}><Typography variant="body2" component="span">{inline(l)}</Typography></li>)}</Box>
        : b.kind === 'quote'
          ? <Box key={i} sx={{ borderLeft: 3, borderColor: 'secondary.main', pl: 1.5, color: 'text.secondary' }}>{b.lines.map((l, j) => <Typography key={j} variant="body2">{inline(l)}</Typography>)}</Box>
          : <Typography key={i} variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{inline(b.lines.join(' '))}</Typography>)}
    </Stack>
  );
}

function InlineJobs({ ids, base }: { ids: string[]; base: Base }) {
  const state = useAsync(() => Promise.all(ids.map((id) => jobsApi.get(id))), [ids.join(',')]);
  if (!state.data) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fit, minmax(260px, 1fr))' }, mt: 1.5 }}>
      {state.data.map((v) => <JobCard key={v.job.id} view={v} base={base} compact />)}
    </Box>
  );
}

interface Props {
  message: ChatMessage;
  base: Base;
  onResolve: (actionId: string, accept: boolean) => Promise<void>;
  onOpenSource: (source: ChatSource) => void;
}

export function ChatMessageView({ message: m, base, onResolve, onOpenSource }: Props) {
  const mine = m.role === 'user';
  const [busy, setBusy] = useState(false);
  const act = m.action;
  const resolve = async (accept: boolean) => { if (!act) return; setBusy(true); try { await onResolve(act.id, accept); } finally { setBusy(false); } };

  return (
    <Stack direction={mine ? 'row-reverse' : 'row'} spacing={1.5} alignItems="flex-start" component="li" sx={{ listStyle: 'none' }}>
      <Avatar sx={{ width: 34, height: 34, bgcolor: mine ? 'secondary.main' : 'primary.main' }} aria-hidden>{mine ? <PersonOutlineIcon fontSize="small" /> : <SmartToyOutlinedIcon fontSize="small" />}</Avatar>
      <Box sx={{ maxWidth: { xs: '88%', md: m.charts?.length || m.reports?.length ? 860 : 640 }, width: m.charts?.length || m.reports?.length ? { md: 860 } : undefined, minWidth: 0 }}>
        <Box sx={{ p: 1.75, borderRadius: 3, bgcolor: mine ? 'secondary.main' : '#fff', color: mine ? '#fff' : 'text.primary', border: mine ? 0 : 1, borderColor: 'divider', borderTopRightRadius: mine ? 4 : undefined, borderTopLeftRadius: mine ? undefined : 4 }}>
          {mine ? <Typography variant="body2">{m.text}</Typography> : <Markdown text={m.text} />}
          {m.reports?.map((r, i) => <ChatReportCard key={`r${i}`} report={r} />)}
          {m.charts?.map((c, i) => <ChatChartCard key={i} chart={c} />)}
          {m.jobIds?.length ? <InlineJobs ids={m.jobIds} base={base} /> : null}
          {act && (
            <Card sx={{ mt: 1.5, p: 1.75, bgcolor: act.destructive ? '#fef2f2' : '#f8fafc', ...(act.destructive ? { borderColor: 'error.main' } : {}) }} role="group" aria-label={`Confirm action: ${act.title}`}>
              <Typography variant="subtitle2">{act.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: act.details?.length ? 1 : 1.25 }}>{act.description}</Typography>
              {act.details?.length ? (
                <Box component="dl" sx={{ m: 0, mb: 1.25, display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) 1fr', columnGap: 1.5, rowGap: 0.5 }}>
                  {act.details.map((d, i) => (
                    <Fragment key={i}>
                      <Typography component="dt" variant="caption" color="text.secondary">{d.label}</Typography>
                      <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>{d.value}</Typography>
                    </Fragment>
                  ))}
                </Box>
              ) : null}
              {act.state === 'awaiting_confirmation' ? (
                <>
                  {act.destructive && <Alert severity="warning" icon={false} sx={{ py: 0, mb: 1 }}>This removes access or data. Read the details above before confirming.</Alert>}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Nothing happens until you confirm. The server re-checks every rule when you do.</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" color={act.destructive ? 'error' : 'secondary'} disabled={busy} onClick={() => resolve(true)}>{busy ? 'Working…' : 'Confirm'}</Button>
                    <Button size="small" color="inherit" disabled={busy} onClick={() => resolve(false)}>Cancel</Button>
                  </Stack>
                </>
              ) : (
                <Alert severity={act.state === 'confirmed' ? 'success' : act.state === 'failed' ? 'error' : act.state === 'expired' ? 'warning' : 'info'} sx={{ py: 0 }} role="status">{act.resultMessage ?? (act.state === 'expired' ? 'This proposal expired. Ask the assistant again.' : '')}</Alert>
              )}
            </Card>
          )}
        </Box>
        {(m.sources?.length || m.tools?.length) ? (
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mt: 0.75 }}>
            {m.sources?.map((s, i) => <Chip key={i} size="small" variant="outlined" icon={<DescriptionOutlinedIcon />} label={`${s.title} · p.${s.page}`} onClick={() => onOpenSource(s)} aria-label={`Open source ${s.title}, page ${s.page}`} />)}
            {m.tools?.map((t, i) => <Chip key={`t${i}`} size="small" variant="outlined" color={t.status === 'denied' ? 'error' : 'default'} icon={t.status === 'denied' ? <BlockIcon /> : <BuildOutlinedIcon />} label={`${t.tool}${t.status === 'denied' ? ' · denied' : ''}`} sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }} />)}
          </Stack>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, textAlign: mine ? 'right' : 'left' }}>{fmtTime(m.at)}</Typography>
      </Box>
    </Stack>
  );
}
