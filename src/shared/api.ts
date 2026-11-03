/** Tipos dos contratos HTTP compartilhados entre interface e funções. */
import type { ExpiryOptionId, ReportReasonId } from './constants.ts';

export interface ApiError {
  error: { code: string; message: string; retryAfterSeconds?: number };
}

export interface CreateLinkRequest {
  url: string;
  expiresIn?: ExpiryOptionId;
  turnstileToken: string;
}

export interface CreateLinkResponse {
  slug: string;
  shortUrl: string;
  destinationHost: string;
  expiresAt: string | null;
}

export interface CreateReportRequest {
  link: string;
  reason: ReportReasonId;
  details?: string;
  contactEmail?: string;
  turnstileToken: string;
}

export interface CreateReportResponse {
  received: true;
}

export interface LegalDocumentResponse {
  kind: 'terms' | 'privacy';
  title: string;
  body: string;
  responsibleName: string | null;
  responsibleContact: string | null;
  responsibleDocument: string | null;
  updatedAt: string;
}

export type LinkStatus = 'active' | 'blocked' | 'deleted';

export interface AdminSessionResponse {
  admin: { githubId: number; login: string };
  csrfToken: string;
  expiresAt: string;
}

export interface AdminLinkSummary {
  slug: string;
  destinationUrl: string | null;
  destinationHost: string | null;
  status: LinkStatus;
  statusReason: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  interstitialViews: number;
  continuations: number;
  openReports: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AdminReport {
  id: number;
  slug: string;
  linkStatus: LinkStatus | null;
  destinationHost: string | null;
  reason: ReportReasonId;
  details: string | null;
  contactEmail: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface AdminBlockedDomain {
  domain: string;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface AdminSettings {
  linkCreationEnabled: boolean;
  adsEnabled: boolean;
  reportsEnabled: boolean;
}

export interface AdminMetricsDay {
  day: string;
  linkCreated: number;
  linkRejected: number;
  interstitialView: number;
  continuation: number;
  reportCreated: number;
}

export interface AdminMetrics {
  days: AdminMetricsDay[];
  totals: { activeLinks: number; blockedLinks: number; deletedLinks: number; openReports: number; blockedDomains: number };
}

export interface AdminAuditEntry {
  id: number;
  createdAt: string;
  adminLogin: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
}
