import { ApiError, type Conversation } from '@/types';
import { audit, conversations, uid } from '@/mock/db';
import { FACULTY_SUGGESTIONS, respond, STUDENT_SUGGESTIONS } from '@/mock/assistant';

const ADMIN_SUGGESTIONS = ['How many offers have been distributed by department?', 'Which companies are hiring this month?', 'What does the latest company circular say?'];
import { call, notFound } from './client';
import { applicationsApi } from './jobs';
import { remindersApi } from './content';

export const assistantApi = {
  /** GET /assistant/status: the demo assistant is always "available" and says what it really is. */
  status: () => call('GET', '/assistant/status', () => ({ available: true, provider: 'demo rules engine (no language model)' }), { delay: 20 }),
  suggestions: () => call('GET', '/assistant/suggestions', (s) => (s.role === 'student' ? STUDENT_SUGGESTIONS : s.role === 'admin' ? ADMIN_SUGGESTIONS : FACULTY_SUGGESTIONS), { delay: 20 }),
  /** GET /assistant/conversations */
  list: () => call('GET', '/assistant/conversations', (s) => (conversations[s.user.id] ??= []).map(({ messages, ...c }) => ({ ...c, count: messages.length })).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)), { delay: 60 }),
  /** GET /assistant/conversations/:id */
  get: (id: string) => call('GET', `/assistant/conversations/${id}`, (s) => (conversations[s.user.id] ?? []).find((c) => c.id === id) ?? notFound('Conversation'), { delay: 60 }),
  /** POST /assistant/conversations */
  create: () => call('POST', '/assistant/conversations', (s) => {
    const c: Conversation = { id: uid('conv'), title: 'New conversation', updatedAt: new Date().toISOString(), messages: [] };
    (conversations[s.user.id] ??= []).unshift(c);
    return c;
  }, { delay: 60 }),
  /** DELETE /assistant/conversations/:id */
  remove: (id: string) => call('DELETE', `/assistant/conversations/${id}`, (s) => {
    const list = conversations[s.user.id] ?? [];
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) notFound('Conversation');
    list.splice(i, 1);
  }, { delay: 60 }),
  /** POST /assistant/chat — LLM tool-calling happens server-side with the caller's permissions. */
  send: (id: string | undefined, text: string) => call('POST', '/assistant/chat', (s) => {
    let c = id ? (conversations[s.user.id] ?? []).find((x) => x.id === id) : undefined;
    if (id && !c) notFound('Conversation');
    if (!c) { c = { id: uid('conv'), title: 'New conversation', updatedAt: new Date().toISOString(), messages: [] }; (conversations[s.user.id] ??= []).unshift(c); }
    if (!text.trim()) throw new ApiError(422, 'Message is empty.');
    const now = new Date().toISOString();
    c.messages.push({ id: uid('m'), role: 'user', text: text.trim(), at: now });
    const draft = respond(s, text);
    c.messages.push({ id: uid('m'), role: 'assistant', at: new Date().toISOString(), ...draft });
    if (c.title === 'New conversation') c.title = text.trim().slice(0, 48);
    c.updatedAt = new Date().toISOString();
    return c;
  }, { delay: 900 + Math.random() * 600 }),
  /**
   * POST /assistant/actions/:id/confirm — executes the pending action through the SAME authorised REST endpoint
   * a button would use. The outcome shown to the user is the backend's real result, never an assumption.
   */
  async resolveAction(conversationId: string, actionId: string, accept: boolean): Promise<Conversation> {
    const pending = await call('POST', accept ? `/assistant/actions/${actionId}/confirm` : `/assistant/actions/${actionId}/reject`, (s) => {
      const c = (conversations[s.user.id] ?? []).find((x) => x.id === conversationId) ?? notFound('Conversation');
      const m = c.messages.find((x) => x.action?.id === actionId);
      if (!m?.action) notFound('Action');
      if (m!.action!.state !== 'awaiting_confirmation') throw new ApiError(409, 'This action was already handled.');
      return m!.action!;
    }, { delay: 40 });
    let state: 'confirmed' | 'cancelled' | 'failed' = 'cancelled';
    let resultMessage = 'Cancelled. Nothing was changed.';
    if (accept) {
      try {
        if (pending.kind === 'apply') {
          const r = await applicationsApi.apply(String(pending.payload?.jobId));
          resultMessage = `Application submitted (status: ${r.application.status}). Track it in My Applications.`;
        } else {
          await remindersApi.save({ title: String(pending.payload?.title), at: String(pending.payload?.at), jobId: pending.payload?.jobId ? String(pending.payload.jobId) : undefined });
          resultMessage = 'Reminder created. You can edit it under Reminders & Notifications.';
        }
        state = 'confirmed';
      } catch (e) {
        state = 'failed';
        resultMessage = `The backend rejected this: ${e instanceof Error ? e.message : 'unknown error'}`;
      }
    }
    return call('POST', accept ? `/assistant/actions/${actionId}/confirm` : `/assistant/actions/${actionId}/reject`, (s) => {
      const c = (conversations[s.user.id] ?? []).find((x) => x.id === conversationId) ?? notFound('Conversation');
      const m = c.messages.find((x) => x.action?.id === actionId)!;
      m.action!.state = state; m.action!.resultMessage = resultMessage;
      audit(s.user.name, s.role, `assistant.action.${state}`, m.action!.title);
      return c;
    }, { delay: 40 });
  },
};
