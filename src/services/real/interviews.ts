import type { InterviewService, InterviewView } from '../contracts/interviews';
import { http } from '../http';

const PAGE = 100;
const MAX_PAGES = 20; // 2000 interviews: far beyond one placement season; stops a runaway loop

export const interviewService: InterviewService = {
  /** The calendar needs every round, so the pages are walked (the server caps a page at 100). */
  async list() {
    const out: InterviewView[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await http.page<InterviewView>('/interviews', { page, pageSize: PAGE });
      out.push(...r.items);
      if (out.length >= r.total || r.items.length === 0) break;
    }
    return out;
  },
  save: ({ id, jobId, applicationIds, ...rest }) => {
    const body = { jobId: Number(jobId), applicationIds: applicationIds.map(Number), ...rest };
    return id ? http.put<InterviewView>(`/interviews/${encodeURIComponent(id)}`, body) : http.post<InterviewView>('/interviews', body);
  },
  setStatus: (id, status) => http.post<InterviewView>(`/interviews/${encodeURIComponent(id)}/status`, { status }),
  notify: (id) => http.post<{ notified: number }>(`/interviews/${encodeURIComponent(id)}/notify`),
};
