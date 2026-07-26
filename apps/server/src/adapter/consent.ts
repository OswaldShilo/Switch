import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consents } from '../db/schema.js';
import { SUPPORTED_BANKS } from './banks.js';
import type { ToolResult } from './types.js';

const DATA_LIFE = '1 year';

export interface InitiateConsentInput {
  userId: string;
  mobile: string;
  fipId: string;
  purpose: string;
  fromDate: string;
  toDate: string;
  expiryDays: number;
  fiTypes: string[];
}

export interface ConsentSummary {
  consentId: string;
  approvalUrl: string;
  status: string;
}

export interface ConsentDetails {
  purpose: string;
  fiTypes: string[];
  dateRange: { from: string; to: string };
  expiry: string;
  dataLife: string | null;
}

export async function initiateConsent(input: InitiateConsentInput): Promise<ToolResult<ConsentSummary>> {
  const bank = SUPPORTED_BANKS.find((b) => b.fipId === input.fipId);
  if (!bank) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_BANK', message: `No supported bank with fip_id "${input.fipId}"` },
    };
  }

  const expiryAt = new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000);

  const [consent] = await db
    .insert(consents)
    .values({
      userId: input.userId,
      fipId: input.fipId,
      status: 'PENDING',
      purpose: input.purpose,
      fiTypes: input.fiTypes,
      fromDate: input.fromDate,
      toDate: input.toDate,
      expiryAt,
      dataLife: DATA_LIFE,
      rawJson: { mobile: input.mobile },
    })
    .returning();

  return {
    ok: true,
    data: {
      consentId: consent.id,
      approvalUrl: `https://mock-finvu.sandbox/approve/${consent.id}`,
      status: consent.status,
    },
  };
}

export async function checkConsentStatus(consentId: string): Promise<ToolResult<{ status: string }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }

  if (consent.status === 'PENDING') {
    const [updated] = await db
      .update(consents)
      .set({ status: 'ACTIVE', aaConsentId: `mock-consent-${consent.id}` })
      .where(eq(consents.id, consentId))
      .returning();
    return { ok: true, data: { status: updated.status } };
  }

  return { ok: true, data: { status: consent.status } };
}

export async function listConsentsForUser(userId: string) {
  return db.select().from(consents).where(eq(consents.userId, userId));
}

export async function revokeConsent(consentId: string, userId: string): Promise<ToolResult<{ status: string }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent || consent.userId !== userId) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  const [updated] = await db
    .update(consents)
    .set({ status: 'REVOKED' })
    .where(eq(consents.id, consentId))
    .returning();
  return { ok: true, data: { status: updated.status } };
}

export async function getConsentDetails(consentId: string): Promise<ToolResult<ConsentDetails>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  return {
    ok: true,
    data: {
      purpose: consent.purpose,
      fiTypes: consent.fiTypes,
      dateRange: { from: consent.fromDate, to: consent.toDate },
      expiry: consent.expiryAt.toISOString(),
      dataLife: consent.dataLife,
    },
  };
}
