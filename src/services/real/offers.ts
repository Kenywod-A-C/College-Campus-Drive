import type { OfferView } from '@/types/views';
import type { OfferList, OfferService, PolicySummary } from '../contracts/offers';
import { http } from '../http';

export const offerService: OfferService = {
  listMine: () => http.get<OfferView[]>('/offers/me'),
  policySummary: () => http.get<PolicySummary[]>('/offers/policies'),
  respond: (id, decision) => http.post<OfferView>(`/offers/${encodeURIComponent(id)}/respond`, { decision }),
  async listAll(q = {}) {
    const { items, total, page, pageSize, meta } = await http.page<OfferView>('/offers', { ...q, status: q.status === 'all' ? undefined : q.status });
    const m = meta as Pick<OfferList, 'byDept' | 'byCompany' | 'totals' | 'selectedWithoutOffer'>;
    return { rows: items, total, page, pageSize, byDept: m.byDept ?? [], byCompany: m.byCompany ?? [], totals: m.totals ?? { offers: 0, accepted: 0, placed: 0 }, selectedWithoutOffer: m.selectedWithoutOffer ?? [] };
  },
  create: (applicationId, ctcLpa, acceptBy) => http.post<OfferView>('/offers', { applicationId: Number(applicationId), ctcLpa, acceptBy }),
  setStatus: (id, status, reason) => http.post<OfferView>(`/offers/${encodeURIComponent(id)}/status`, { status, reason: reason || undefined }),
};
