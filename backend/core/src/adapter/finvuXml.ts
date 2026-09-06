import { XMLParser } from 'fast-xml-parser';

export interface ParsedFinvuAccount {
  maskedAccNumber: string;
  balance: string;
  currency: string;
  accountType: string;
}

export interface ParsedFinvuTransaction {
  direction: 'credit' | 'debit';
  amount: string;
  txnDate: string;
  narration: string;
  sourceMetadata: { txnId: string; reference: string; mode: string; transactionTimestamp: string };
}

// Parses the REBIT deposit-schema FI data XML (xmlns="http://api.rebit.org.in/FISchema/deposit").
// Deliberately never reads <Profile>/<Holders> — that's real PII (name, DOB, mobile, address,
// email, PAN) that nothing in this project needs; see the M5 plan's Global Constraints.
export function parseFinvuAccountXml(xml: string): {
  account: ParsedFinvuAccount;
  transactions: ParsedFinvuTransaction[];
} {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const doc = parser.parse(xml);
  const account = doc.Account;
  const summary = account.Summary;

  const rawTxns = Array.isArray(account.Transactions?.Transaction)
    ? account.Transactions.Transaction
    : account.Transactions?.Transaction
      ? [account.Transactions.Transaction]
      : [];

  return {
    account: {
      maskedAccNumber: account.maskedAccNumber,
      balance: Number(summary.currentBalance).toFixed(2),
      currency: summary.currency,
      accountType: summary.type,
    },
    transactions: rawTxns.map((t: Record<string, string>) => ({
      direction: t.type === 'CREDIT' ? 'credit' : 'debit',
      amount: Number(t.amount).toFixed(2),
      txnDate: t.valueDate,
      narration: t.narration,
      sourceMetadata: {
        txnId: t.txnId,
        reference: t.reference,
        mode: t.mode,
        transactionTimestamp: t.transactionTimestamp,
      },
    })),
  };
}
