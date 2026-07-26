import {
  checkConsentStatus,
  getConsentDetails,
  initiateConsent,
  type ConsentDetails,
  type ConsentSummary,
  type InitiateConsentInput,
} from '../../adapter/consent.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function initiateConsentTool(
  userId: string,
  input: Omit<InitiateConsentInput, 'userId'>
): Promise<ToolResult<ConsentSummary>> {
  return withAudit('initiate_consent', userId, input, () => initiateConsent({ ...input, userId }));
}

export async function checkConsentStatusTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<{ status: string }>> {
  return withAudit('check_consent_status', userId, input, () => checkConsentStatus(input.consentId));
}

export async function getConsentDetailsTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<ConsentDetails>> {
  return withAudit('get_consent_details', userId, input, () => getConsentDetails(input.consentId));
}
