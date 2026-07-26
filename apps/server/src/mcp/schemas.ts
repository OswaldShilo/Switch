import { z } from 'zod';

export const initiateConsentInputSchema = z.object({
  mobile: z.string(),
  fip_id: z.string(),
  purpose: z.string(),
  from_date: z.string(),
  to_date: z.string(),
  expiry_days: z.number().int().positive(),
  fi_types: z.array(z.string()),
});

export const checkConsentStatusInputSchema = z.object({
  consent_id: z.string(),
});

export const getConsentDetailsInputSchema = z.object({
  consent_id: z.string(),
});

export const requestFinancialDataInputSchema = z.object({
  consent_id: z.string(),
});

export const getDataStatusInputSchema = z.object({
  session_id: z.string(),
});

export const fetchAccountsInputSchema = z.object({
  consent_id: z.string(),
});

export const fetchTransactionsInputSchema = z.object({
  account_id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
});
