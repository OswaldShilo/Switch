import type { Bank } from './banks.js';
import type { ConsentDetails, ConsentSummary } from './consent.js';
import type { ToolResult } from './types.js';

export interface AaAdapter {
  listSupportedBanks(): Bank[] | Promise<Bank[]>;
  initiateConsent(input: {
    userId: string;
    mobile: string;
    fipId: string;
    purpose: string;
    fromDate: string;
    toDate: string;
    expiryDays: number;
    fiTypes: string[];
  }): Promise<ToolResult<ConsentSummary>>;
  checkConsentStatus(consentId: string): Promise<ToolResult<{ status: string }>>;
  getConsentDetails(consentId: string): Promise<ToolResult<ConsentDetails>>;
  requestFinancialData(consentId: string): Promise<ToolResult<{ sessionId: string; status: string }>>;
  getDataStatus(sessionId: string): Promise<ToolResult<{ status: string; fetchedAt: string | null }>>;
}
