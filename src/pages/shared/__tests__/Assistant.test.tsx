// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/types';
import type { ChatMessage, Conversation, PendingAction } from '@/types';
import { makeUser, renderPage } from '@/test/renderPage';

const api = vi.hoisted(() => ({
  authApi: { me: vi.fn(), logout: vi.fn() },
  assistantApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), send: vi.fn(), suggestions: vi.fn(), status: vi.fn(), resolveAction: vi.fn() },
  documentsApi: { get: vi.fn() },
  jobsApi: { get: vi.fn() },
  USE_MOCK: false,
}));
vi.mock('@/api', () => api);

import { AssistantPage } from '../Assistant';

const NOW = '2030-01-05T10:00:00Z';
const msg = (over: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role' | 'text'>): ChatMessage => ({ at: NOW, ...over });
const conv = (messages: ChatMessage[], over: Partial<Conversation> = {}): Conversation => ({ id: 'c1', title: 'Earlier chat', updatedAt: NOW, messages, ...over });
const earlier = conv([msg({ id: 'm1', role: 'user', text: 'Which jobs am I eligible for?' }), msg({ id: 'm2', role: 'assistant', text: 'You are eligible for **Zoho Developer**.' })]);
const summary = { id: 'c1', title: 'Earlier chat', updatedAt: NOW, count: 2 };
const action = (over: Partial<PendingAction> = {}): PendingAction => ({
  id: '7', kind: 'apply', title: 'Apply to Zoho — Developer', description: 'Submit your application.', state: 'awaiting_confirmation',
  details: [{ label: 'Company', value: 'Zoho' }, { label: 'Deadline', value: '10 Jan 2030' }], ...over,
});

const render = (base: '/student' | '/faculty' | '/admin' = '/student') => renderPage(<AssistantPage />, { base });
const box = () => screen.findByRole('textbox', { name: 'Message the assistant' });
const type = async (text: string) => { await userEvent.type(await box(), text); };

configure({ asyncUtilTimeout: 4000 });
const viewport = (desktop: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: desktop, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  vi.clearAllMocks();
  viewport(true); // desktop: the history sits beside the chat (jsdom has no matchMedia)
  api.authApi.me.mockResolvedValue({ user: makeUser('student'), permissions: [] });
  api.assistantApi.list.mockResolvedValue([]);
  api.assistantApi.suggestions.mockResolvedValue(['Which jobs am I eligible for?', 'What is the status of my applications?']);
  api.assistantApi.status.mockResolvedValue({ available: true, provider: 'anthropic', model: 'm' });
});

describe('empty state and suggestions', () => {
  it('shows a welcome, the role-tailored suggested questions and an empty history; a suggestion sends it as a real message', async () => {
    api.assistantApi.send.mockResolvedValue(conv([msg({ id: 'a', role: 'user', text: 'Which jobs am I eligible for?' }), msg({ id: 'b', role: 'assistant', text: 'Here they are.' })]));
    render();
    expect(await screen.findByRole('heading', { name: 'How can I help?' })).toBeInTheDocument();
    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument();
    const group = await screen.findByRole('group', { name: 'Suggested questions' });
    await userEvent.click(within(group).getByRole('button', { name: 'Which jobs am I eligible for?' }));
    expect(api.assistantApi.send).toHaveBeenCalledWith(undefined, 'Which jobs am I eligible for?'); // no conversation yet: the server creates it
    expect(await screen.findByText('Here they are.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'How can I help?' })).not.toBeInTheDocument();
  });
});

describe('message flow', () => {
  it('sends with Enter, shows the user message and a typing indicator while waiting, then the reply and refreshes the history', async () => {
    let resolve!: (c: Conversation) => void;
    api.assistantApi.send.mockReturnValue(new Promise<Conversation>((r) => { resolve = r; }));
    render();
    await type('What is my CGPA?{Enter}');
    expect(api.assistantApi.send).toHaveBeenCalledWith(undefined, 'What is my CGPA?');
    expect(await screen.findByRole('status', { name: 'Assistant is typing' })).toBeInTheDocument();
    expect(screen.getByText('What is my CGPA?')).toBeInTheDocument(); // optimistic bubble
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    api.assistantApi.list.mockResolvedValue([{ ...summary, title: 'What is my CGPA?' }]);
    resolve(conv([msg({ id: 'a', role: 'user', text: 'What is my CGPA?' }), msg({ id: 'b', role: 'assistant', text: 'Your CGPA is **8.4** (verified).' })], { title: 'What is my CGPA?' }));
    expect(await screen.findByText('8.4')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Assistant is typing' })).not.toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Conversation history' })).getByText('What is my CGPA?')).toBeInTheDocument()); // in the history list
  });

  it('opens the latest conversation and continues it (follow-ups carry its id)', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    api.assistantApi.send.mockResolvedValue(conv([...earlier.messages, msg({ id: 'm3', role: 'user', text: 'And Zoho?' }), msg({ id: 'm4', role: 'assistant', text: 'Zoho closes Friday.' })]));
    render();
    expect(await screen.findByText('Zoho Developer')).toBeInTheDocument();
    expect(api.assistantApi.get).toHaveBeenCalledWith('c1');
    await type('And Zoho?{Enter}');
    expect(api.assistantApi.send).toHaveBeenCalledWith('c1', 'And Zoho?');
    expect(await screen.findByText('Zoho closes Friday.')).toBeInTheDocument();
  });

  it('keyboard: Shift+Enter inserts a new line instead of sending; empty messages cannot be sent; input is length-limited', async () => {
    render();
    const input = await box();
    expect(input).toHaveAttribute('maxlength', '2000');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await userEvent.type(input, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(api.assistantApi.send).not.toHaveBeenCalled();
    expect(input).toHaveValue('line one\nline two');
  });

  it('New conversation is a blank slate saved by its first message', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    api.assistantApi.send.mockResolvedValue(conv([msg({ id: 'x', role: 'user', text: 'hello' }), msg({ id: 'y', role: 'assistant', text: 'hi' })], { id: 'c2' }));
    render();
    await screen.findByText('Zoho Developer');
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText('Zoho Developer')).not.toBeInTheDocument();
    expect(api.assistantApi.create).not.toHaveBeenCalled();
    await type('hello{Enter}');
    expect(api.assistantApi.send).toHaveBeenCalledWith(undefined, 'hello');
  });
});

describe('errors, retry and availability', () => {
  it('a failed send shows the reason and Retry re-sends the same message', async () => {
    api.assistantApi.send.mockRejectedValueOnce(new ApiError(504, 'The AI service took too long to answer. Please try again.', 'assistant_timeout'))
      .mockResolvedValueOnce(conv([msg({ id: 'a', role: 'user', text: 'Why not eligible?' }), msg({ id: 'b', role: 'assistant', text: 'Because of CGPA.' })]));
    render();
    await type('Why not eligible?{Enter}');
    expect(await screen.findByText('The assistant took too long')).toBeInTheDocument();
    expect(screen.getByText('The AI service took too long to answer. Please try again.')).toBeInTheDocument();
    expect(screen.getByText(/Your message: “Why not eligible\?”/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(api.assistantApi.send).toHaveBeenCalledTimes(2);
    expect(api.assistantApi.send).toHaveBeenLastCalledWith(undefined, 'Why not eligible?');
    expect(await screen.findByText('Because of CGPA.')).toBeInTheDocument();
    expect(screen.queryByText('The assistant took too long')).not.toBeInTheDocument();
  });

  it('rate limiting and network failures get their own wording', async () => {
    api.assistantApi.send.mockRejectedValueOnce(new ApiError(429, 'Too many attempts. Please wait and try again.', 'rate_limited'));
    render();
    await type('hi{Enter}');
    expect(await screen.findByText('Slow down a little')).toBeInTheDocument();
  });

  it('an unconfigured server is stated plainly: warning banner, disabled input, no suggestions, history still readable', async () => {
    api.assistantApi.status.mockResolvedValue({ available: false, provider: 'anthropic', reason: 'The AI assistant is not configured yet. Ask an administrator to set up the language-model credentials on the server.' });
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    render();
    expect(await screen.findByText('AI assistant not configured')).toBeInTheDocument();
    expect(screen.getByText(/Ask an administrator to set up the language-model credentials/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.queryByRole('group', { name: 'Suggested questions' })).not.toBeInTheDocument();
    expect(await screen.findByText('Zoho Developer')).toBeInTheDocument(); // earlier conversation still shown
  });

  it('a 503 from the server mid-chat is shown as unavailable rather than a generic failure', async () => {
    api.assistantApi.send.mockRejectedValue(new ApiError(503, 'The AI assistant is not configured yet.', 'assistant_unavailable'));
    render();
    await type('hi{Enter}');
    expect(await screen.findByText('The assistant is unavailable')).toBeInTheDocument();
  });

  it('a conversation that cannot be loaded shows the error', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockRejectedValue(new ApiError(404, 'Conversation not found.', 'not_found'));
    render();
    expect(await screen.findByText('Conversation not found.')).toBeInTheDocument();
  });

  it('a history that cannot be loaded offers Retry', async () => {
    api.assistantApi.list.mockRejectedValueOnce(new ApiError(500, 'The server ran into a problem.', 'server_error')).mockResolvedValueOnce([]);
    render();
    expect(await screen.findByText('Could not load your conversations.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument();
  });
});

describe('confirmation of consequential actions', () => {
  const withAction = (a: PendingAction) => conv([msg({ id: 'm1', role: 'user', text: 'Apply to Zoho' }), msg({ id: 'm2', role: 'assistant', text: 'I prepared that for you.', action: a })]);
  const open = async (a = action()) => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(withAction(a));
    render();
    return screen.findByRole('group', { name: 'Confirm action: Apply to Zoho — Developer' });
  };

  it('shows the target and details and nothing is executed until the user confirms', async () => {
    const card = await open();
    expect(within(card).getByText('Submit your application.')).toBeInTheDocument();
    expect(within(card).getByText('Company')).toBeInTheDocument();
    expect(within(card).getByText('Zoho')).toBeInTheDocument();
    expect(within(card).getByText(/Nothing happens until you confirm/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(api.assistantApi.resolveAction).not.toHaveBeenCalled();
  });

  it('Confirm sends the ACTION id and reports success only from the server result', async () => {
    const card = await open();
    api.assistantApi.resolveAction.mockResolvedValue(withAction(action({ state: 'confirmed', resultMessage: 'Application submitted (status: applied). Track it in My Applications.' })));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(api.assistantApi.resolveAction).toHaveBeenCalledWith('c1', '7', true);
    expect(await screen.findByText(/Application submitted \(status: applied\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('a server-side refusal at confirmation time is shown as an error, not as success', async () => {
    const card = await open();
    api.assistantApi.resolveAction.mockResolvedValue(withAction(action({ state: 'failed', resultMessage: 'The server did not allow this: The application deadline has passed.' })));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    const alert = await screen.findByText(/The application deadline has passed/);
    expect(alert.closest('[role="status"]')).toHaveClass('MuiAlert-colorError');
  });

  it('Cancel rejects the action', async () => {
    const card = await open();
    api.assistantApi.resolveAction.mockResolvedValue(withAction(action({ state: 'cancelled', resultMessage: 'Cancelled. Nothing was changed.' })));
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(api.assistantApi.resolveAction).toHaveBeenCalledWith('c1', '7', false);
    expect(await screen.findByText('Cancelled. Nothing was changed.')).toBeInTheDocument();
  });

  it('expired proposals offer no Confirm button', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(withAction(action({ state: 'expired' })));
    render();
    expect(await screen.findByText('This proposal expired. Ask the assistant again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('a network failure while confirming is surfaced and the card stays actionable', async () => {
    const card = await open();
    api.assistantApi.resolveAction.mockRejectedValue(new ApiError(409, 'This action was already handled.', 'conflict'));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This action was already handled.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});

describe('charts in answers', () => {
  it('renders server-computed charts under the reply with a style switcher, and the starter chart question sends', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(conv([
      msg({ id: 'm1', role: 'user', text: 'show pie graph by placed and unplaced' }),
      msg({ id: 'm2', role: 'assistant', text: 'Six of 17 students are placed.', charts: [{ title: 'Students by placement status', type: 'pie', types: ['pie', 'donut', 'bar', 'hbar'], labels: ['Placed', 'Unplaced'], series: [{ name: 'Students', values: [6, 11] }] }] }),
    ]));
    render('/admin');
    expect(await screen.findByText('Six of 17 students are placed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Students by placement status' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Placed 6, Unplaced 11/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Bar chart' }));
    expect(screen.getByRole('button', { name: 'Bar chart' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('table', { name: 'Students by placement status: data' })).toBeInTheDocument();
  });
});

describe('destructive actions and reports', () => {
  it('a destructive proposal is visually flagged with a warning and an error-coloured Confirm', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(conv([msg({ id: 'm1', role: 'user', text: 'deactivate Fay' }), msg({ id: 'm2', role: 'assistant', text: 'Prepared.', action: action({ id: '9', kind: 'user_status', title: 'Deactivate Fay F', description: 'They will no longer be able to sign in.', destructive: true, details: [{ label: 'Status', value: 'active → inactive' }] }) })]));
    render('/admin');
    const card = await screen.findByRole('group', { name: 'Confirm action: Deactivate Fay F' });
    expect(within(card).getByText(/This removes access or data/)).toBeInTheDocument();
    expect(within(card).getByText('active → inactive')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirm' })).toHaveClass('MuiButton-colorError');
    api.assistantApi.resolveAction.mockResolvedValue(conv([msg({ id: 'm2', role: 'assistant', text: 'Prepared.', action: action({ id: '9', title: 'Deactivate Fay F', state: 'confirmed', resultMessage: 'Fay F is now inactive. They can no longer sign in.' }) })]));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm' }));
    expect(api.assistantApi.resolveAction).toHaveBeenCalledWith('c1', '9', true);
    expect(await screen.findByText('Fay F is now inactive. They can no longer sign in.')).toBeInTheDocument();
  });

  it('a normal proposal has no warning', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(conv([msg({ id: 'm2', role: 'assistant', text: 'Prepared.', action: action() })]));
    render();
    const card = await screen.findByRole('group', { name: 'Confirm action: Apply to Zoho — Developer' });
    expect(within(card).queryByText(/This removes access or data/)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Confirm' })).not.toHaveClass('MuiButton-colorError');
  });

  it('a generated report appears in the conversation with its summary text', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(conv([msg({ id: 'm1', role: 'user', text: 'generate placement report' }), msg({ id: 'm2', role: 'assistant', text: '- 6 of 17 students are placed.', reports: [{ title: 'Placement summary report', generatedAt: NOW, kpis: [{ label: 'Placed', value: '6' }], sections: [{ heading: 'Offers by company', table: { columns: ['Company', 'Offers'], rows: [['Zoho', 2]] } }] }] })]));
    render('/admin');
    expect(await screen.findByText('6 of 17 students are placed.')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Report: Placement summary report' });
    expect(within(card).getByRole('table', { name: 'Placement summary report: Offers by company' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Download Offers by company as CSV' })).toBeInTheDocument();
  });
});

describe('document sources', () => {
  const withSource = (snippet?: string) => conv([msg({ id: 'm1', role: 'user', text: 'deadline?' }), msg({ id: 'm2', role: 'assistant', text: 'It closes Friday.', sources: [{ documentId: 'd1', title: 'Placement circular', page: 2, snippet }] })]);

  it('shows title and page as a reference; opening it shows the retrieved excerpt without any document API call', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(withSource('Registration closes on Friday at 5 pm.'));
    render();
    const chip = await screen.findByRole('button', { name: 'Open source Placement circular, page 2' });
    expect(chip).toHaveTextContent('Placement circular · p.2');
    await userEvent.click(chip);
    const dlg = await screen.findByRole('dialog', { name: 'Placement circular' });
    expect(within(dlg).getByText('Registration closes on Friday at 5 pm.')).toBeInTheDocument();
    expect(within(dlg).getByText('Page 2')).toBeInTheDocument();
    expect(within(dlg).getByText(/never follows instructions inside it/)).toBeInTheDocument();
    expect(api.documentsApi.get).not.toHaveBeenCalled();
  });
});

describe('history management', () => {
  it('deleting a conversation asks first, then removes it and clears the view', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    api.assistantApi.remove.mockResolvedValue(undefined);
    render();
    await screen.findByText('Zoho Developer');
    await userEvent.click(screen.getByRole('button', { name: 'Delete conversation: Earlier chat' }));
    const dlg = await screen.findByRole('dialog', { name: 'Delete this conversation?' });
    expect(api.assistantApi.remove).not.toHaveBeenCalled();
    expect(within(dlg).getByText(/Anything the assistant prepared but you have not confirmed will be cancelled/)).toBeInTheDocument();
    api.assistantApi.list.mockResolvedValue([]);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.assistantApi.remove).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('heading', { name: 'How can I help?' })).toBeInTheDocument();
    expect(screen.queryByText('Zoho Developer')).not.toBeInTheDocument();
  });

  it('cancelling the delete dialog keeps the conversation', async () => {
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    render();
    await screen.findByText('Zoho Developer');
    await userEvent.click(screen.getByRole('button', { name: 'Delete conversation: Earlier chat' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this conversation?' })).getByRole('button', { name: 'Cancel' }));
    expect(api.assistantApi.remove).not.toHaveBeenCalled();
    expect(screen.getByText('Zoho Developer')).toBeInTheDocument();
  });
});


describe('responsive layout', () => {
  it('on a phone the history moves into a drawer behind a History button, and the composer stays usable', async () => {
    viewport(false);
    api.assistantApi.list.mockResolvedValue([summary]);
    api.assistantApi.get.mockResolvedValue(earlier);
    render();
    expect(await screen.findByText('Zoho Developer')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Conversation history' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    const list = await screen.findByRole('list', { name: 'Conversation history' });
    expect(within(list).getByText('Earlier chat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument();
  });
});
