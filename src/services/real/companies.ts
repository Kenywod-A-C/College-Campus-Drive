import type { Company } from '@/types';
import type { CompanyDetailDto, CompanyRow, CompanyService } from '../contracts/companies';
import { http } from '../http';

export const companyService: CompanyService = {
  async list(q = {}) {
    const { items, total, page, pageSize, meta } = await http.page<CompanyRow>('/companies', { ...q });
    return { items, total, page, pageSize, industries: (meta.industries as string[] | undefined) ?? [] };
  },
  get: (id) => http.get<CompanyDetailDto>(`/companies/${encodeURIComponent(id)}`),
  archive: (id, archived) => http.post<Company>(`/companies/${encodeURIComponent(id)}/archive`, { archived }),
  save: ({ id, ...body }) => (id ? http.put<Company>(`/companies/${encodeURIComponent(id)}`, body) : http.post<Company>('/companies', body)),
};
