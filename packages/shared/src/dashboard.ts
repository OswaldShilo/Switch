import { z } from 'zod';

export const accountDtoSchema = z.object({
  accountId: z.string(),
  consentId: z.string(),
  bank: z.string(),
  type: z.string(),
  maskedNumber: z.string(),
  balance: z.string(),
  currency: z.string(),
});
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const consentDtoSchema = z.object({
  consentId: z.string(),
  fipId: z.string(),
  status: z.string(),
  purpose: z.string(),
  expiryAt: z.string(),
});
export type ConsentDto = z.infer<typeof consentDtoSchema>;

export const transactionDtoSchema = z.object({
  txnId: z.string(),
  date: z.string(),
  amount: z.string(),
  direction: z.enum(['credit', 'debit']),
  narration: z.string(),
  merchant: z.string().nullable(),
  category: z.string().nullable(),
});
export type TransactionDto = z.infer<typeof transactionDtoSchema>;

export const summaryResponseSchema = z.record(z.string(), z.unknown());
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;
