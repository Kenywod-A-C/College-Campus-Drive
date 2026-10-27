import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, AlertTitle, Avatar, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, IconButton, List, ListItem, ListItemButton, ListItemText, Stack, TextField,
  Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import HistoryIcon from '@mui/icons-material/History';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import { ApiError, type ChatMessage, type ChatSource, type Conversation } from '@/types';
import { assistantApi, USE_MOCK } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useBase } from '@/layouts/useBase';
import { ChatMessageView } from '@/components/ChatMessageView';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DocumentPreviewDialog } from '@/components/DocumentUpload';
import { PageHeader } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { timeAgo } from '@/utils/format';

const MAX_CHARS = 2000; // matches the server's ASSISTANT_MAX_INPUT_CHARS default; the server is the authority

const WELCOME = {
  '/student': 'Ask about jobs you are eligible for, your applications, interviews and offers, or placement documents. I can also prepare an application or a reminder for you to confirm.',
  '/faculty': 'Ask me to summarise applicants, interviews, offers and placement data within your permissions, find eligible students for a job, or search placement documents.',
  '/admin': 'Ask about placement statistics, recruitment activity, configured policies, administrative alerts and (if you may view it) audit activity.',
} as const;

const TypingIndicator = () => (
  <Stack direction="row" spacing={1.5} alignItems="center" role="status" aria-live="polite" aria-label="Assistant is typing">
    <Box sx={{ width: 34 }} />
    <Box sx={{ px: 2, py: 1.5, borderRadius: 3, bgcolor: '#fff', border: 1, borderColor: 'divider', display: 'flex', gap: 0.6 }}>
      {[0, 1, 2].map((i) => <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary', animation: 'blink 1.2s infinite', animationDelay: `${i * 0.2}s`, '@keyframes blink': { '0%,80%,100%': { opacity: 0.25 }, '40%': { opacity: 1 } }, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} />)}
    </Box>
  </Stack>
);

/** Failed send: explains what happened and offers Retry for the very same message (nothing was saved server-side). */
function SendError({ error, text, onRetry }: { error: Error; text: string; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  const title = status === 503 ? 'The assistant is unavailable' : status === 429 ? 'Slow down a little' : status === 504 ? 'The assistant took too long' : 'The message was not sent';
  return (
    <Alert severity={status === 503 ? 'warning' : 'error'} action={<Button color="inherit" size="small" onClick={onRetry}>Retry</Button>}>
      <AlertTitle>{title}</AlertTitle>
      {error.message}
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }} noWrap>Your message: “{text}”</Typography>
    </Alert>
  );
}

function SourceDialog({ source, onClose }: { source?: ChatSource; onClose: () => void }) {
  return (
    <Dialog open={!!source} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="source-title">
      <DialogTitle id="source-title">{source?.title}</DialogTitle>
      <DialogContent>
        <Chip size="small" label={`Page ${source?.page}`} sx={{ mb: 1.5 }} />
        <Typography variant="body2" sx={{ p: 1.5, bgcolor: '#f8fafc', border: 1, borderColor: 'divider', borderRadius: 2, whiteSpace: 'pre-wrap' }}>{source?.snippet}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Excerpt retrieved from the indexed document. Document text is third-party content: the assistant quotes it but never follows instructions inside it.</Typography>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

export function AssistantPage() {
  const base = useBase();
  const toast = useToast();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const list = useAsync(() => assistantApi.list(), []);
  const suggestions = useAsync(() => assistantApi.suggestions(), []);
  const status = useAsync(() => assistantApi.status(), []);
  const [conv, setConv] = useState<Conversation>(); // undefined = a new conversation that is created by the first message
  const [pending, setPending] = useState<ChatMessage>();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState<{ error: Error; text: string }>();
  const [loadError, setLoadError] = useState<Error>();
  const [source, setSource] = useState<ChatSource>();
  const [drawer, setDrawer] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; title: string }>();
  const endRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  const unavailable = status.data?.available === false;

  const open = useCallback(async (id: string) => {
    setDrawer(false); setFailed(undefined); setLoadError(undefined);
    try { setConv(await assistantApi.get(id)); } catch (e) { setLoadError(e as Error); }
  }, []);
  const startNew = useCallback(() => { setDrawer(false); setConv(undefined); setFailed(undefined); setLoadError(undefined); setText(''); }, []);

  // Open the latest conversation once; "New conversation" afterwards is a blank slate that is saved by its first message.
  useEffect(() => {
    if (!list.data || initialised.current) return;
    initialised.current = true;
    if (list.data[0]) void open(list.data[0].id);
  }, [list.data, open]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [conv?.messages.length, typing, pending, failed]);

  const send = async (msg: string) => {
    const t = msg.trim();
    if (!t || typing || unavailable) return;
    setText(''); setFailed(undefined);
    setPending({ id: 'pending', role: 'user', text: t, at: new Date().toISOString() });
    setTyping(true);
    try {
      setConv(await assistantApi.send(conv?.id, t));
      list.reload();
    } catch (e) {
      setFailed({ error: e as Error, text: t });
    } finally { setTyping(false); setPending(undefined); }
  };

  const resolve = async (actionId: string, accept: boolean) => {
    if (!conv) return;
    try { setConv(await assistantApi.resolveAction(conv.id, actionId, accept)); }
    catch (e) { toast.error((e as Error).message); }
  };

  const remove = async () => {
    if (!toDelete) return;
    await assistantApi.remove(toDelete.id);
    if (conv?.id === toDelete.id) startNew();
    list.reload();
    toast.success('Conversation deleted.');
  };

  const openSource = (s: ChatSource) => setSource(s);

  const history = (
    <Box sx={{ width: { xs: 300, md: '100%' }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 1.5 }}><Button fullWidth variant="outlined" startIcon={<AddCommentOutlinedIcon />} onClick={startNew}>New conversation</Button></Box>
      <Divider />
      <List dense sx={{ flex: 1, overflowY: 'auto', p: 1 }} aria-label="Conversation history">
        {list.loading && !list.data && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }} role="status">Loading conversations…</Typography>}
        {list.error && <Alert severity="error" sx={{ m: 1 }} action={<Button color="inherit" size="small" onClick={list.reload}>Retry</Button>}>Could not load your conversations.</Alert>}
        {list.data?.map((c) => (
          <ListItem key={c.id} disablePadding secondaryAction={
            <Tooltip title="Delete"><IconButton edge="end" size="small" aria-label={`Delete conversation: ${c.title}`} onClick={() => setToDelete({ id: c.id, title: c.title })}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
          }>
            <ListItemButton selected={c.id === conv?.id} onClick={() => open(c.id)} sx={{ pr: 6 }}>
              <ListItemText primary={c.title} secondary={timeAgo(c.updatedAt)} slotProps={{ primary: { noWrap: true, fontSize: 14, fontWeight: 500 }, secondary: { fontSize: 12 } }} />
            </ListItemButton>
          </ListItem>
        ))}
        {list.data?.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No conversations yet. Ask your first question to start one.</Typography>}
      </List>
    </Box>
  );

  const empty = !conv || conv.messages.length === 0;
  return (
    <>
      <PageHeader title="AI Assistant" subtitle="Answers are grounded in your authorised records and indexed documents. Eligibility comes from the college rules engine, not from the model."
        actions={!wide ? <Button startIcon={<HistoryIcon />} onClick={() => setDrawer(true)}>History</Button> : undefined} />
      {unavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>AI assistant not configured</AlertTitle>
          {status.data?.reason ?? 'The language-model service has not been set up on the server yet.'} You can still browse your earlier conversations.
        </Alert>
      )}
      <Card sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, height: { xs: 'calc(100vh - 250px)', md: 'calc(100vh - 270px)' }, minHeight: 460, overflow: 'hidden' }}>
        {wide && <Box sx={{ borderRight: 1, borderColor: 'divider', minHeight: 0 }}>{history}</Box>}
        <Drawer open={drawer && !wide} onClose={() => setDrawer(false)}>{history}</Drawer>

        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: '#f8fafc' }}>
          <Box role="log" aria-live="polite" aria-busy={typing} aria-label="Conversation" sx={{ flex: 1, overflowY: 'auto', p: { xs: 1.5, sm: 2.5 } }}>
            {empty && !pending && !loadError && (
              <Stack alignItems="center" textAlign="center" spacing={1.5} sx={{ py: { xs: 3, sm: 6 }, px: 2, maxWidth: 520, mx: 'auto' }}>
                <Avatar sx={{ width: 52, height: 52, bgcolor: 'primary.main' }} aria-hidden><SmartToyOutlinedIcon /></Avatar>
                <Typography variant="h4" component="h2">How can I help?</Typography>
                <Typography variant="body2" color="text.secondary">{WELCOME[base]}</Typography>
              </Stack>
            )}
            <Stack component="ul" spacing={2.5} sx={{ m: 0, p: 0 }}>
              {conv?.messages.map((m) => <ChatMessageView key={m.id} message={m} base={base} onResolve={resolve} onOpenSource={openSource} />)}
              {pending && <ChatMessageView message={pending} base={base} onResolve={resolve} onOpenSource={openSource} />}
            </Stack>
            {typing && <Box sx={{ mt: 2.5 }}><TypingIndicator /></Box>}
            {loadError && <Alert severity="error" sx={{ mt: 2 }}>{loadError.message}</Alert>}
            {failed && !typing && <Box sx={{ mt: 2 }}><SendError error={failed.error} text={failed.text} onRetry={() => send(failed.text)} /></Box>}
            <div ref={endRef} />
          </Box>

          <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: '#fff', p: 1.5 }}>
            {(empty || !wide) && !unavailable && suggestions.data && suggestions.data.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ pb: 1.25, overflowX: 'auto', flexWrap: empty ? 'wrap' : 'nowrap', rowGap: 1 }} role="group" aria-label="Suggested questions">
                {suggestions.data.slice(0, empty ? undefined : 4).map((s) => <Chip key={s} label={s} variant="outlined" onClick={() => send(s)} disabled={typing} sx={{ flexShrink: 0 }} />)}
              </Stack>
            )}
            <Box component="form" onSubmit={(e) => { e.preventDefault(); send(text); }} sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField value={text} onChange={(e) => setText(e.target.value)} fullWidth multiline maxRows={4} disabled={unavailable}
                placeholder={unavailable ? 'The assistant is not available right now' : 'Ask about jobs, eligibility, applications…'}
                helperText={text.length > MAX_CHARS * 0.8 ? `${text.length}/${MAX_CHARS}` : 'Enter to send, Shift+Enter for a new line'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }}
                slotProps={{ htmlInput: { 'aria-label': 'Message the assistant', maxLength: MAX_CHARS } }} />
              <Tooltip title="Send"><span><IconButton type="submit" color="secondary" disabled={!text.trim() || typing || unavailable} aria-label="Send message" sx={{ bgcolor: 'secondary.main', color: '#fff', mb: 2.5, '&:hover': { bgcolor: '#1d4ed8' }, '&.Mui-disabled': { bgcolor: '#e2e8f0' } }}><SendIcon /></IconButton></span></Tooltip>
            </Box>
            {USE_MOCK && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>Demo: the assistant is simulated by a rules-based mock; tool calls shown under each reply are the backend calls a real LLM would make.</Typography>}
          </Box>
        </Box>
      </Card>
      <SourceDialog source={source?.snippet ? source : undefined} onClose={() => setSource(undefined)} />
      <DocumentPreviewDialog id={source && !source.snippet ? source.documentId : undefined} onClose={() => setSource(undefined)} />
      <ConfirmDialog open={!!toDelete} title="Delete this conversation?" confirmLabel="Delete" tone="error" onConfirm={remove} onClose={() => setToDelete(undefined)}>
        “{toDelete?.title}” will be removed from your history. Anything the assistant prepared but you have not confirmed will be cancelled.
      </ConfirmDialog>
    </>
  );
}
