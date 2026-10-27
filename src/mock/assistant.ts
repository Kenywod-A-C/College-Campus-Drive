// Mock "LLM + tool calling" orchestrator. A real deployment sends the user message to an LLM with these tools
// registered; the LLM chooses tools, the Flask backend executes them with the caller's permissions, and the
// LLM only phrases the tool results. Here an intent router plays the LLM so the UI flow is fully demonstrable.
// Eligibility is ALWAYS computed by evaluateEligibility() — never by the "model".
import type { ChatMessage, Job, PendingAction, ToolCallTrace } from '@/types';
import type { Session } from '@/services/mock/client';
import { applications, audit, companies, day, deptName, departments, documents, evalFor, interviews, jobs, offers, students, uid } from './db';

type Draft = Omit<ChatMessage, 'id' | 'role' | 'at'>;
const coName = (j: Job) => companies.find((c) => c.id === j.companyId)!.name;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDT = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const jobLabel = (j: Job) => `${coName(j)} — ${j.title}`;

export const STUDENT_SUGGESTIONS = [
  'Show a chart of my applications by status',
  'What is my CGPA?', 'Which jobs am I eligible for?', 'What placement drives are coming up?', 'Why am I not eligible for TCS Prime?',
  'How many applications are currently active?', 'What is the status of my applications?', 'What are the eligibility rules for TCS?',
  'Remind me two days before my next drive to update my resume',
];
export const FACULTY_SUGGESTIONS = [
  'Show a pie chart of placed vs unplaced students',
  'Which companies are hiring this month?', 'How many students are eligible for Zoho Software Developer?', 'Which students meet the TCS Digital criteria?',
  'How many offers have been distributed by department?', 'What does the latest company circular say?', 'Which hiring drives need attention?',
];

function findJobs(text: string, pool: Job[]): Job[] {
  const t = text.toLowerCase();
  const byCompany = pool.filter((j) => t.includes(coName(j).toLowerCase()));
  const pickFrom = byCompany.length ? byCompany : pool;
  const titled = pickFrom.filter((j) => {
    const words = j.title.toLowerCase().split(/[^a-z0-9+]+/).filter((w) => w.length > 2 && !['tcs', 'the', 'and', 'engineer'].includes(w));
    return words.some((w) => t.includes(w));
  });
  if (titled.length) return titled;
  return byCompany;
}

function search(query: string, limit = 3) {
  const q = query.toLowerCase();
  const terms = q.split(/\W+/).filter((w) => w.length > 2);
  return documents
    .filter((d) => d.processing === 'indexed' && d.extractedExcerpts?.length && d.access.includes('student'))
    .flatMap((d) => d.extractedExcerpts!.map((e) => ({ d, e, score: terms.filter((w) => e.text.toLowerCase().includes(w) || d.title.toLowerCase().includes(w)).length })))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function respond(s: Session, text: string): Draft {
  const t = text.toLowerCase();
  const tools: ToolCallTrace[] = [];
  const done = (d: Omit<Draft, 'tools'>): Draft => ({ ...d, tools });
  const isStudent = s.role === 'student';

  // ----- Guardrail: students may only query their own data
  if (isStudent && /(all|other|every|another|any)\s+(the\s+)?students?|classmate|someone else|\bfriend'?s?\b|everyone'?s/.test(t)) {
    tools.push({ tool: 'query_student_records', args: { scope: 'others' }, status: 'denied' });
    audit(s.user.name, s.role, 'assistant.tool_denied', 'query_student_records (others)', 'denied', 'Student scope');
    return done({ text: "I can only access **your own** records, so I can't share information about other students. I'm happy to help with your profile, eligibility, applications, offers or reminders." });
  }

  // ----- Charts (the mock computes the data from its own records, like the server does)
  if (/\b(chart|graph|plot|visuali[sz]e)\b/.test(t)) {
    const style = /donut/.test(t) ? 'donut' : /horizontal/.test(t) ? 'hbar' : /\bbar\b/.test(t) ? 'bar' : /\bline\b/.test(t) ? 'line' : 'pie';
    if (isStudent) {
      tools.push({ tool: 'show_my_chart', args: { metric: 'my_applications_by_status' }, status: 'ok' });
      const mine = applications.filter((a) => a.studentId === s.studentId);
      const counts = new Map<string, number>();
      mine.forEach((a) => counts.set(a.status.replace('_', ' '), (counts.get(a.status.replace('_', ' ')) ?? 0) + 1));
      if (!counts.size) return done({ text: "You haven't applied to anything yet, so there is nothing to chart." });
      return done({ text: 'Here are your applications by status. Use the buttons on the chart to switch style.', charts: [{ title: 'My applications by status', type: style === 'line' ? 'donut' : style, types: ['pie', 'donut', 'bar', 'hbar'], labels: [...counts.keys()], series: [{ name: 'Applications', values: [...counts.values()] }] }] });
    }
    tools.push({ tool: 'show_chart', args: { metric: 'placement_status' }, status: 'ok' });
    const order: [string, string][] = [['placed', 'Placed'], ['in_process', 'In process'], ['unplaced', 'Unplaced'], ['opted_out', 'Opted out']];
    const rows = order.map(([k, l]) => [l, students.filter((x) => x.placementStatus === k).length] as const).filter(([, n]) => n > 0);
    return done({ text: `**${rows[0]?.[0] === 'Placed' ? rows[0][1] : 0}** of ${students.length} students are placed. Switch the chart style with the buttons above it.`, charts: [{ title: 'Students by placement status', type: style === 'line' ? 'bar' : style, types: ['pie', 'donut', 'bar', 'hbar'], labels: rows.map((r) => r[0]), series: [{ name: 'Students', values: rows.map((r) => r[1]) }] }] });
  }

  // ----- Reminder creation (consequential → needs confirmation)
  if (isStudent && /remind me|set a reminder|create a reminder/.test(t)) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1 };
    const m = t.match(/(\d+|one|two|three|four|five)\s+days?\s+before/);
    const n = m ? (words[m[1]] ?? Number(m[1])) : 0;
    const task = (text.match(/\bto\s+(.+)$/i)?.[1] ?? 'Prepare for the drive').replace(/[.?!]$/, '');
    tools.push({ tool: 'list_upcoming_drives', args: { mine: true }, status: 'ok' });
    const mine = new Set(applications.filter((a) => a.studentId === s.studentId && !['rejected', 'withdrawn'].includes(a.status)).map((a) => a.jobId));
    const drive = jobs.filter((j) => mine.has(j.id) && j.driveDate && new Date(j.driveDate) > new Date()).sort((a, b) => +new Date(a.driveDate!) - +new Date(b.driveDate!))[0];
    if (/before my next (drive|interview)/.test(t) && !drive) return done({ text: "I couldn't find an upcoming drive from your active applications, so I haven't created anything. Tell me a specific date and I can set the reminder." });
    if (!drive && !/\d{1,2}[/-]\d{1,2}|tomorrow|today|next week/.test(t)) return done({ text: 'When should I remind you? For example: **"Remind me two days before my next drive to update my resume"**.' });
    const at = drive ? new Date(new Date(drive.driveDate!).getTime() - n * 86400000) : new Date(day(1, 9));
    at.setHours(9, 0, 0, 0);
    const action: PendingAction = {
      id: uid('act'), kind: 'create_reminder', state: 'awaiting_confirmation', title: 'Create reminder',
      description: `"${task.charAt(0).toUpperCase() + task.slice(1)}" on ${fmtDT(at.toISOString())}${drive ? `, ${n} day(s) before the ${jobLabel(drive)} drive (${fmtDate(drive.driveDate!)})` : ''}.`,
      payload: { title: task.charAt(0).toUpperCase() + task.slice(1), at: at.toISOString(), jobId: drive?.id },
    };
    return done({ text: 'I can set that up. Please confirm the details below. Nothing is created until you confirm.', action });
  }

  // ----- Apply (consequential → needs confirmation; eligibility from deterministic service)
  if (isStudent && /\bapply\b/.test(t)) {
    const st = students.find((x) => x.id === s.studentId)!;
    const found = findJobs(text, jobs.filter((j) => j.status === 'published'));
    if (found.length !== 1) return done({ text: found.length ? `Which job did you mean?\n${found.map((j) => `- ${jobLabel(j)}`).join('\n')}` : "Tell me which company and role you'd like to apply to, e.g. **\"Apply to Zoho Software Developer\"**." });
    const j = found[0];
    tools.push({ tool: 'check_eligibility', args: { jobId: j.id }, status: 'ok' });
    const r = evalFor(st, j);
    if (r.state !== 'eligible') return done({ text: `I can't submit this: **${r.summary}**\n${r.checks.filter((c) => c.passed !== true).map((c) => `- ${c.detail}`).join('\n')}`, jobIds: [j.id] });
    const action: PendingAction = { id: uid('act'), kind: 'apply', state: 'awaiting_confirmation', title: `Apply to ${jobLabel(j)}`, description: `You are eligible. Deadline ${fmtDate(j.deadline)}. Submitting records an application on your behalf.`, payload: { jobId: j.id } };
    return done({ text: `You're eligible for **${jobLabel(j)}**. Confirm to submit your application.`, jobIds: [j.id], action });
  }

  if (isStudent) return studentIntents(s, text, t, tools);
  return facultyIntents(s, text, t, tools);
}

function studentIntents(s: Session, text: string, t: string, tools: ToolCallTrace[]): Draft {
  const st = students.find((x) => x.id === s.studentId)!;
  const done = (d: Omit<Draft, 'tools'>): Draft => ({ ...d, tools });
  const published = jobs.filter((j) => j.status === 'published');

  if (/\bcgpa\b|\bgpa\b|arrear/.test(t) && !/rule|criteria|eligib/.test(t)) {
    tools.push({ tool: 'get_my_profile', args: {}, status: 'ok' });
    const a = st.academic;
    if (a.cgpa == null) return done({ text: 'Your CGPA is **not on your profile yet**. Add it under My Profile → Academic information so I can evaluate your eligibility.' });
    return done({ text: `Your CGPA is **${a.cgpa.toFixed(2)}** (${a.cgpaVerified ? 'verified by the placement cell' : 'self-reported, awaiting verification'}).\nActive arrears: **${a.activeArrears}** · Arrear history: **${a.arrearHistory}**.` });
  }

  if (/why.*(not|isn'?t|aren'?t).*eligible|not eligible for|can'?t apply|why can'?t i/.test(t)) {
    const found = findJobs(text, jobs.filter((j) => j.status !== 'draft'));
    if (found.length === 1) {
      const j = found[0];
      tools.push({ tool: 'explain_eligibility', args: { jobId: j.id }, status: 'ok' });
      const r = evalFor(st, j);
      const lines = r.checks.map((c) => `- ${c.passed === true ? '✅' : c.passed === false ? '❌' : '❔'} **${c.label}:** ${c.detail}`).join('\n');
      return done({ text: `For **${jobLabel(j)}**: ${r.state === 'eligible' ? 'you ARE eligible.' : r.summary}\n${lines}\n\n_This result comes from the placement eligibility service, not from my own judgement._`, jobIds: [j.id] });
    }
    tools.push({ tool: 'list_eligible_jobs', args: { state: 'not_eligible' }, status: 'ok' });
    const ne = published.filter((j) => evalFor(st, j).state === 'not_eligible');
    return done({ text: ne.length ? `Which job do you mean? You're currently not eligible for ${ne.length} open job(s). Name one and I'll explain exactly why:` : "You're eligible for every open job right now.", jobIds: ne.slice(0, 3).map((j) => j.id) });
  }

  if (/eligible for|which jobs|jobs (can|should) i|am i eligible|recommend/.test(t)) {
    tools.push({ tool: 'list_eligible_jobs', args: { state: 'eligible' }, status: 'ok' });
    const el = published.filter((j) => evalFor(st, j).state === 'eligible').sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline));
    if (!el.length) {
      const r = published.length ? evalFor(st, published[0]) : null;
      return done({ text: r?.state === 'profile_incomplete' || r?.state === 'needs_verification' ? `I can't confirm eligibility yet: **${r.summary}**` : "You aren't eligible for any open jobs right now. Ask me about a specific job to see why." });
    }
    return done({ text: `You're eligible for **${el.length}** open job(s). Here are the ones closing soonest:`, jobIds: el.slice(0, 3).map((j) => j.id) });
  }

  if (/status.*application|my applications|applications.*status|where do i stand/.test(t)) {
    tools.push({ tool: 'list_my_applications', args: {}, status: 'ok' });
    const mine = applications.filter((a) => a.studentId === st.id).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
    if (!mine.length) return done({ text: "You haven't applied to anything yet." });
    return done({ text: `You have **${mine.length}** application(s):\n${mine.map((a) => { const j = jobs.find((x) => x.id === a.jobId)!; return `- **${jobLabel(j)}** — ${a.status.replace('_', ' ')}${a.currentRound ? ` (${a.currentRound})` : ''}`; }).join('\n')}` });
  }

  if (/how many.*application|active application|applications.*active/.test(t)) {
    tools.push({ tool: 'count_my_applications', args: {}, status: 'ok' });
    const mine = applications.filter((a) => a.studentId === st.id);
    const active = mine.filter((a) => ['applied', 'shortlisted', 'interview', 'selected'].includes(a.status));
    return done({ text: `You have **${active.length}** active application(s) out of ${mine.length} total (active = applied, shortlisted, interview or selected).` });
  }

  if (/drive|upcoming|interview|schedule/.test(t) && !/rule|criteria/.test(t)) {
    tools.push({ tool: 'list_upcoming_drives', args: {}, status: 'ok' });
    const drives = published.filter((j) => j.driveDate && new Date(j.driveDate) > new Date()).sort((a, b) => +new Date(a.driveDate!) - +new Date(b.driveDate!)).slice(0, 4);
    const myIds = new Set(applications.filter((a) => a.studentId === st.id).map((a) => a.id));
    const ints = interviews.filter((i) => i.status === 'scheduled' && new Date(i.at) > new Date() && i.applicationIds.some((id) => myIds.has(id)));
    const lines = [
      ...ints.map((i) => `- 🎤 **${i.round}** — ${jobLabel(jobs.find((j) => j.id === i.jobId)!)} · ${fmtDT(i.at)} · ${i.location}`),
      ...drives.map((j) => `- 🏢 **${jobLabel(j)}** drive on ${fmtDate(j.driveDate!)}`),
    ];
    return done({ text: lines.length ? `Here is what's coming up:\n${lines.join('\n')}` : 'There are no upcoming drives or interviews scheduled.', jobIds: drives.slice(0, 2).map((j) => j.id) });
  }

  if (/rule|criteria|requirement|eligibility/.test(t)) {
    const found = findJobs(text, jobs.filter((j) => j.status !== 'draft'));
    tools.push({ tool: 'get_job_rules', args: { query: text }, status: 'ok' });
    tools.push({ tool: 'search_documents', args: { query: text }, status: 'ok' });
    if (found.length) {
      const hits = search(text).filter((h) => !h.d.companyId || found.some((j) => j.companyId === h.d.companyId));
      const lines = found.map((j) => `- **${j.title}**: min CGPA ${j.eligibility.minCgpa.toFixed(1)}, max active arrears ${j.eligibility.maxActiveArrears}${j.eligibility.maxArrearHistory != null ? `, arrear history ≤ ${j.eligibility.maxArrearHistory}` : ''}; departments: ${j.eligibility.departmentIds.map(deptName).join(', ')}; batch ${j.eligibility.graduationYears.join(', ')}`);
      return done({ text: `Eligibility rules for **${coName(found[0])}** (from the job records):\n${lines.join('\n')}`, jobIds: found.slice(0, 3).map((j) => j.id), sources: hits.map((h) => ({ documentId: h.d.id, title: h.d.title, page: h.e.page })) });
    }
    const hits = search(text);
    if (hits.length) return done({ text: `I found this in the uploaded documents:\n${hits.map((h) => `> ${h.e.text}`).join('\n')}`, sources: hits.map((h) => ({ documentId: h.d.id, title: h.d.title, page: h.e.page })) });
    return done({ text: "I couldn't find rules for that. Tell me the company name (e.g. **TCS** or **Zoho**) and I'll look it up." });
  }

  if (/offer/.test(t)) {
    tools.push({ tool: 'list_my_offers', args: {}, status: 'ok' });
    const mine = offers.filter((o) => o.studentId === st.id);
    return done({ text: mine.length ? `You have **${mine.length}** offer(s):\n${mine.map((o) => `- **${coName(jobs.find((j) => j.id === o.jobId)!)}** — ${o.status}${o.status === 'received' ? ` (respond by ${fmtDate(o.acceptBy)})` : ''}`).join('\n')}` : "You don't have any offers yet." });
  }

  const hits = search(text, 2);
  if (hits.length) {
    tools.push({ tool: 'search_documents', args: { query: text }, status: 'ok' });
    return done({ text: `Here's what the uploaded documents say:\n${hits.map((h) => `> ${h.e.text}`).join('\n')}`, sources: hits.map((h) => ({ documentId: h.d.id, title: h.d.title, page: h.e.page })) });
  }
  return done({ text: "I'm not sure how to answer that from your data. I can help with your **profile and CGPA**, **eligible jobs**, **why you're not eligible** for a job, **application status**, **upcoming drives**, **offers**, **company eligibility rules**, and **reminders**." });
}

function facultyIntents(s: Session, text: string, t: string, tools: ToolCallTrace[]): Draft {
  const done = (d: Omit<Draft, 'tools'>): Draft => ({ ...d, tools });
  const can = (p: Parameters<Session['permissions']['includes']>[0]) => s.permissions.includes(p);
  const deny = (tool: string, perm: string): Draft => {
    tools.push({ tool, args: {}, status: 'denied' });
    audit(s.user.name, s.role, 'assistant.tool_denied', tool, 'denied', `Missing ${perm}`);
    return done({ text: `You don't have the **${perm}** permission, so I can't retrieve that. An administrator can grant it under Roles & Permissions.` });
  };
  const now = new Date();

  if (/hiring this month|companies.*(hiring|visiting)|this month/.test(t)) {
    tools.push({ tool: 'list_hiring_drives', args: { month: now.getMonth() + 1 }, status: 'ok' });
    const rows = jobs.filter((j) => j.status === 'published' && j.driveDate && new Date(j.driveDate).getMonth() === now.getMonth() && new Date(j.driveDate).getFullYear() === now.getFullYear());
    const list = rows.length ? rows : jobs.filter((j) => j.status === 'published' && j.driveDate && +new Date(j.driveDate) - +now < 30 * 86400000 && new Date(j.driveDate) > now);
    return done({ text: list.length ? `**${new Set(list.map((j) => j.companyId)).size}** compan(ies) have drives ${rows.length ? 'this month' : 'in the next 30 days'}:\n${list.map((j) => `- **${jobLabel(j)}** — drive ${fmtDate(j.driveDate!)}, deadline ${fmtDate(j.deadline)}`).join('\n')}` : 'No drives are scheduled this month.', jobIds: list.slice(0, 3).map((j) => j.id) });
  }

  if (/eligible for|meet.*criteria|meets?.*criteria|which students|criteria/.test(t) && !/circular|offers/.test(t)) {
    const found = findJobs(text, jobs.filter((j) => j.status !== 'cancelled'));
    if (found.length !== 1) return done({ text: found.length ? `Which job did you mean?\n${found.map((j) => `- ${jobLabel(j)}`).join('\n')}` : 'Which company and job? For example: **"How many students are eligible for Zoho Software Developer?"**' });
    if (!can('students.view')) return deny('count_eligible_students', 'students.view');
    const j = found[0];
    tools.push({ tool: 'count_eligible_students', args: { jobId: j.id }, status: 'ok' });
    const sub = { ...j, status: 'published' as const, deadline: day(1) };
    const results = students.map((st) => ({ st, r: evalFor(st, sub) }));
    const el = results.filter((x) => x.r.state === 'eligible');
    const pend = results.filter((x) => x.r.state === 'profile_incomplete' || x.r.state === 'needs_verification');
    const asksList = /which students|who|list/.test(t);
    return done({ text: `**${jobLabel(j)}** — ${el.length} eligible, ${pend.length} pending verification/profile completion, ${results.length - el.length - pend.length} not eligible (of ${results.length} students).${asksList ? `\n\nEligible students (ID · department · CGPA):\n${el.slice(0, 12).map((x) => `- ${x.st.studentCode} · ${deptName(x.st.departmentId)} · ${x.st.academic.cgpa?.toFixed(2)}`).join('\n')}${el.length > 12 ? `\n…and ${el.length - 12} more. Open the Students directory for the full list.` : ''}` : ''}`, jobIds: [j.id] });
  }

  if (/offer/.test(t)) {
    if (!can('offers.manage') && !can('reports.view')) return deny('offers_by_department', 'reports.view');
    tools.push({ tool: 'offers_by_department', args: {}, status: 'ok' });
    const rows = departments.map((d) => ({ d, total: offers.filter((o) => students.find((x) => x.id === o.studentId)!.departmentId === d.id) })).map((r) => `- **${r.d.code}**: ${r.total.length} offer(s), ${r.total.filter((o) => o.status === 'accepted').length} accepted`);
    const unique = new Set(offers.filter((o) => o.status === 'accepted').map((o) => o.studentId)).size;
    return done({ text: `**${offers.length}** offers in total, **${offers.filter((o) => o.status === 'accepted').length}** accepted, covering **${unique}** unique placed students:\n${rows.join('\n')}` });
  }

  if (/circular|brochure|document/.test(t)) {
    tools.push({ tool: 'search_documents', args: { type: 'circular' }, status: 'ok' });
    const d = documents.filter((x) => x.type === 'circular' && x.processing === 'indexed' && x.companyId && x.extractedExcerpts?.length).sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
    if (!d) return done({ text: 'No processed circulars are available yet.' });
    return done({ text: `The latest processed circular is **${d.title}** (uploaded ${fmtDate(d.uploadedAt)}):\n> ${d.extractedExcerpts![0].text}`, sources: [{ documentId: d.id, title: d.title, page: d.extractedExcerpts![0].page }] });
  }

  if (/attention|at risk|problem|issues?|need/.test(t)) {
    tools.push({ tool: 'list_drives_needing_attention', args: {}, status: 'ok' });
    const soon = jobs.filter((j) => j.status === 'published' && +new Date(j.deadline) - +now < 5 * 86400000 && new Date(j.deadline) > now);
    const low = soon.filter((j) => applications.filter((a) => a.jobId === j.id).length < 3);
    const unprocessed = documents.filter((d) => d.processing === 'failed');
    const lines = [
      ...soon.map((j) => `- ⏰ **${jobLabel(j)}** closes ${fmtDate(j.deadline)} with ${applications.filter((a) => a.jobId === j.id).length} application(s)${low.includes(j) ? ' — low response' : ''}`),
      ...unprocessed.map((d) => `- 📄 **${d.title}** failed document processing`),
      ...jobs.filter((j) => j.status === 'draft').map((j) => `- 📝 **${jobLabel(j)}** is still a draft`),
    ];
    return done({ text: lines.length ? `These need attention:\n${lines.join('\n')}` : 'Nothing needs attention right now.', jobIds: soon.slice(0, 3).map((j) => j.id) });
  }

  const hits = search(text, 2);
  if (hits.length) {
    tools.push({ tool: 'search_documents', args: { query: text }, status: 'ok' });
    return done({ text: `From the uploaded documents:\n${hits.map((h) => `> ${h.e.text}`).join('\n')}`, sources: hits.map((h) => ({ documentId: h.d.id, title: h.d.title, page: h.e.page })) });
  }
  return done({ text: "I can answer placement questions from authorised records and indexed documents: **companies hiring this month**, **eligible student counts for a job**, **offers by department**, **latest circulars** and **drives needing attention**. Student-level details require the students.view permission." });
}
