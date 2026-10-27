import type { ReportData, ReportFilters } from '@/types/views';
import type { AdminDashboard, AdminDashboardService, FacultyDashboard, FacultyDashboardService, PlacementReportService, ReferenceFilters, ReferenceService } from '../contracts/reference';
import { http } from '../http';

export const referenceService: ReferenceService = {
  filterOptions: () => http.get<ReferenceFilters>('/reference/filters'),
};
export const facultyDashboardService: FacultyDashboardService = {
  facultyDashboard: (f = {}) => http.get<FacultyDashboard>('/faculty/dashboard', { ...f }),
};
export const adminDashboardService: AdminDashboardService = {
  dashboard: () => http.get<AdminDashboard>('/admin/dashboard'),
};
const reportQuery = (f: ReportFilters) => ({ ...f, appStatus: f.appStatus === 'all' ? undefined : f.appStatus, offerStatus: f.offerStatus === 'all' ? undefined : f.offerStatus });
export const placementReportService: PlacementReportService = {
  placement: (f = {}) => http.get<ReportData>('/reports/placement', reportQuery(f)),
  exportPlacementCsv: (f = {}) => http.get<string>('/reports/placement/export.csv', reportQuery(f)),
};
