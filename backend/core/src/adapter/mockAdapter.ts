// Wraps the existing mock-mode functions (banks.ts / consent.ts / dataFetch.ts) behind the
// formal AaAdapter interface. Non-behavioral refactor: no logic changes, just assembly.
import { listSupportedBanks as mockListSupportedBanks } from './banks.js';
import {
  checkConsentStatus as mockCheckConsentStatus,
  getConsentDetails as mockGetConsentDetails,
  initiateConsent as mockInitiateConsent,
} from './consent.js';
import { getDataStatus as mockGetDataStatus, requestFinancialData as mockRequestFinancialData } from './dataFetch.js';
import type { AaAdapter } from './AaAdapter.js';

export const mockAdapter: AaAdapter = {
  listSupportedBanks: mockListSupportedBanks,
  initiateConsent: mockInitiateConsent,
  checkConsentStatus: mockCheckConsentStatus,
  getConsentDetails: mockGetConsentDetails,
  requestFinancialData: mockRequestFinancialData,
  getDataStatus: mockGetDataStatus,
};
