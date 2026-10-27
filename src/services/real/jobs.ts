import type { Job } from '@/types';
import type { JobView } from '@/types/views';
import type { JobDriveDetail, JobService } from '../contracts/jobs';
import { http } from '../http';

const enc = encodeURIComponent;

export const jobService: JobService = {
  // 'all' is a UI sentinel meaning "no filter"; the API simply omits the parameter.
  list: (q = {}) => http.page<JobView>('/jobs', { ...q, status: q.status === 'all' ? undefined : q.status }),
  get: (id) => http.get<JobView>(`/jobs/${enc(id)}`),
  toggleSave: (id) => http.post<{ saved: boolean }>(`/jobs/${enc(id)}/save`),
  // The URL is authoritative for the id: it is not repeated in the body.
  save: ({ id, ...body }) => (id ? http.put<Job>(`/jobs/${enc(id)}`, body) : http.post<Job>('/jobs', body)),
  setStatus: (id, status, reason) => http.post<Job>(`/jobs/${enc(id)}/status`, { status, reason: reason || undefined }),
  archive: (id, archived) => http.post<Job>(`/jobs/${enc(id)}/archive`, { archived }),
  drive: (id) => http.get<JobDriveDetail>(`/jobs/${enc(id)}/drive`),
};
