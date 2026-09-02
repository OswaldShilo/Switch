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
  checkConsentStatus(consentId: string, userId: string): Promise<ToolResult<{ status: string }>>;
  getConsentDetails(consentId: string, userId: string): Promise<ToolResult<ConsentDetails>>;
  requestFinancialData(
    consentId: string,
    userId: string
  ): Promise<ToolResult<{ sessionId: string; status: string }>>;
  getDataStatus(
    sessionId: string,
    userId: string
  ): Promise<ToolResult<{ status: string; fetchedAt: string | null }>>;
}
