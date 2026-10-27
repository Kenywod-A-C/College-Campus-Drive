import type { Conversation } from '@/types';
import type { AssistantService, AssistantStatus, ConversationSummary } from '../contracts/assistant';
import { http, request } from '../http';

const CHAT_TIMEOUT_MS = 120_000; // a reply can take several model rounds with tool calls

const conv = (id: string) => `/assistant/conversations/${encodeURIComponent(id)}`;

export const assistantService: AssistantService = {
  status: () => http.get<AssistantStatus>('/assistant/status'),
  suggestions: () => http.get<string[]>('/assistant/suggestions'),
  list: () => http.get<ConversationSummary[]>('/assistant/conversations'),
  get: (id) => http.get<Conversation>(conv(id)),
  create: () => http.post<Conversation>('/assistant/conversations'),
  async remove(id) { await http.delete(conv(id)); },
  send: (conversationId, text) => request<Conversation>('POST', '/assistant/chat', { body: { conversationId: conversationId ? Number(conversationId) : undefined, message: text }, timeoutMs: CHAT_TIMEOUT_MS }).then((e) => e.data),
  async resolveAction(conversationId, actionId, accept) {
    await http.post(`/assistant/actions/${encodeURIComponent(actionId)}/${accept ? 'confirm' : 'reject'}`);
    return http.get<Conversation>(conv(conversationId));
  },
};
