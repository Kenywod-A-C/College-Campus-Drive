import type { ApplicationDetail, ApplicationQuery, ApplicationView } from '@/types/views';
import type { ApplicationService, StageResult } from '../contracts/applications';
import { http } from '../http';

const clean = (q: ApplicationQuery) => ({ ...q, status: q.status === 'all' ? undefined : q.status });

export const applicationService: ApplicationService = {
  apply: (jobId) => http.post<ApplicationView>('/applications', { jobId }),
  listMine: (q = {}) => http.page<ApplicationView>('/applications/me', clean(q)),
  get: (id) => http.get<ApplicationDetail>(`/applications/${encodeURIComponent(id)}`),
  withdraw: (id) => http.post<ApplicationView>(`/applications/${encodeURIComponent(id)}/withdraw`),
  async listAll(q = {}) {
    const { items, total, page, pageSize } = await http.page<ApplicationView>('/applications', clean(q));
    return { items, total, page, pageSize };
  },
  updateStage: (ids, status, note, exception) => http.post<StageResult>('/applications/stage', { ids: ids.map(Number), status, note: note || undefined, exception }),
  exportCsv: (q = {}) => http.get<string>('/applications/export', clean(q)),
};
