import { Router } from 'express';
import { getAdapter } from '../adapter/index.js';
import { listConsentsForUser, revokeConsent } from '../adapter/consent.js';
import { requireUser } from '../auth/requireUser.js';

export const consentsRouter = Router();

// Sensible fixed defaults for a UI-driven "Connect a bank" flow — the chat
// tool loop lets the LLM pick these per-request, but a form only needs the
// bank and mobile number; the rest is the same for every connection this
// demo makes.
const CONSENT_PURPOSE = 'Personal finance management via Switch';
const CONSENT_FI_TYPES = ['DEPOSIT'];
const CONSENT_EXPIRY_DAYS = 365;
const CONSENT_DATA_LOOKBACK_DAYS = 365;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

consentsRouter.post('/consents', requireUser, async (req, res) => {
  const { fipId, mobile } = req.body as { fipId?: unknown; mobile?: unknown };
  if (typeof fipId !== 'string' || fipId.trim().length === 0) {
    res.status(400).json({ error: 'fipId is required' });
    return;
  }
  if (typeof mobile !== 'string' || mobile.trim().length === 0) {
    res.status(400).json({ error: 'mobile is required' });
    return;
  }

  const now = new Date();
  const from = new Date(now.getTime() - CONSENT_DATA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const result = await getAdapter().initiateConsent({
    userId: req.userId!,
    mobile,
    fipId,
    purpose: CONSENT_PURPOSE,
    fromDate: isoDate(from),
    toDate: isoDate(now),
    expiryDays: CONSENT_EXPIRY_DAYS,
    fiTypes: CONSENT_FI_TYPES,
  });
  if (!result.ok) {
    res.status(400).json(result.error);
    return;
  }
  res.json(result.data);
});

consentsRouter.post('/consents/:id/activate', requireUser, async (req, res) => {
  const result = await getAdapter().checkConsentStatus(req.params.id, req.userId!);
  if (!result.ok) {
    res.status(404).json(result.error);
    return;
  }
  res.json(result.data);
});

consentsRouter.post('/consents/:id/fetch-data', requireUser, async (req, res) => {
  const fetchResult = await getAdapter().requestFinancialData(req.params.id, req.userId!);
  if (!fetchResult.ok) {
    res.status(400).json(fetchResult.error);
    return;
  }
  const statusResult = await getAdapter().getDataStatus(fetchResult.data.sessionId, req.userId!);
  if (!statusResult.ok) {
    res.status(400).json(statusResult.error);
    return;
  }
  res.json(statusResult.data);
});

consentsRouter.get('/consents', requireUser, async (req, res) => {
  const rows = await listConsentsForUser(req.userId!);
  // Shape raw db rows into @switch/shared's ConsentDto (id -> consentId, Date -> ISO string)
  // so the web dashboard (Task 9) can consume this with the same contract packages/shared defines.
  res.json(
    rows.map((r) => ({
      consentId: r.id,
      fipId: r.fipId,
      status: r.status,
      purpose: r.purpose,
      expiryAt: r.expiryAt.toISOString(),
    }))
  );
});

consentsRouter.post('/consents/:id/revoke', requireUser, async (req, res) => {
  const result = await revokeConsent(req.params.id, req.userId!);
  if (!result.ok) {
    res.status(404).json(result.error);
    return;
  }
  res.json(result.data);
});
