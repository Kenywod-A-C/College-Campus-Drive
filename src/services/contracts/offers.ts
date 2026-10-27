import type { OfferStatus } from '@/types';
import type { ApplicationView, OfferView } from '@/types/views';

export interface PolicySummary { id: string; name: string; description: string; params: Record<string, string | number | boolean>; scope: 'college' | 'department' | 'academic_year' }

export interface OfferListQuery { q?: string; status?: OfferStatus | 'all'; dept?: string; companyId?: string; page?: number; pageSize?: number }
/** One page of offers plus college-wide summaries (counts only) and the selected applicants who have no offer yet. */
export interface OfferList {
  rows: OfferView[]; total: number; page: number; pageSize: number;
  byDept: { dept: string; offers: number; placed: number; students: number }[];
  byCompany: { company: string; offers: number; accepted: number }[];
  totals: { offers: number; accepted: number; placed: number };
  selectedWithoutOffer: ApplicationView[];
}

export interface OfferService {
  listMine(): Promise<OfferView[]>;
  policySummary(): Promise<PolicySummary[]>;
  /** Students may only respond to their own offer; no other field of the record can change. */
  respond(id: string, decision: 'accepted' | 'declined'): Promise<OfferView>;
  /** Permission: offers.manage. */
  listAll(q?: OfferListQuery): Promise<OfferList>;
  /** Permission: offers.manage. Only a SELECTED application; refused if placement policies would make the offer unacceptable. */
  create(applicationId: string, ctcLpa: number, acceptBy: string): Promise<OfferView>;
  /** Permission: offers.manage. Withdrawing needs a reason. */
  setStatus(id: string, status: OfferStatus, reason?: string): Promise<OfferView>;
}
