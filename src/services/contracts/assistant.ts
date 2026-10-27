import type { Conversation } from '@/types';

/** What the UI may know about the model provider. Never contains keys. */
export interface AssistantStatus { available: boolean; provider: string; model?: string; reason?: string }
export type ConversationSummary = Pick<Conversation, 'id' | 'title' | 'updatedAt'> & { count: number };

/**
 * AI assistant. Authorisation is server-side for every call: conversations and actions belong to the signed-in user,
 * tools run with that user's permissions, and the assistant can only PROPOSE changes (see resolveAction).
 */
export interface AssistantService {
  /** GET /assistant/status: `available: false` means no language-model credentials are configured on the server. */
  status(): Promise<AssistantStatus>;
  /** GET /assistant/suggestions: starter questions for the signed-in user's role. */
  suggestions(): Promise<string[]>;
  /** GET /assistant/conversations: the caller's own, newest first. */
  list(): Promise<ConversationSummary[]>;
  /** GET /assistant/conversations/{id}: 404 for anyone but the owner. */
  get(id: string): Promise<Conversation>;
  /** POST /assistant/conversations */
  create(): Promise<Conversation>;
  /** DELETE /assistant/conversations/{id}: archives it (purged after the retention period). */
  remove(id: string): Promise<void>;
  /** POST /assistant/chat. Without a conversation id a new conversation is started. Returns the whole updated conversation. */
  send(conversationId: string | undefined, text: string): Promise<Conversation>;
  /** POST /assistant/actions/{id}/confirm | reject, then the refreshed conversation. A rejected-by-rules confirmation comes back with `state: 'failed'`. */
  resolveAction(conversationId: string, actionId: string, accept: boolean): Promise<Conversation>;
}
