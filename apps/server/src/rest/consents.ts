import { Router } from 'express';
import { listConsentsForUser, revokeConsent } from '../adapter/consent.js';
import { requireUser } from '../auth/requireUser.js';

export const consentsRouter = Router();

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
