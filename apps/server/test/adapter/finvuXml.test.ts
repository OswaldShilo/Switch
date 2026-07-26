import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFinvuAccountXml } from '../../src/adapter/finvuXml.js';

// Real REBIT deposit-schema XML captured live against the Finfactor "Dhanaprayoga" Finsense
// sandbox (FIDataFetch / FIRawDataFetch response) — see docs/superpowers/plans/
// 2026-07-26-m5-finvu-adapter-connector-deploy.md's Global Constraints for the walkthrough.
// Kept as an external fixture file (rather than an inline template-literal constant) purely so
// this test file itself stays readable — the parsing behavior under test is unaffected either way.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'finvu-fi-data-sample.xml');

describe('parseFinvuAccountXml', () => {
  it('parses the real captured REBIT deposit-schema XML fixture, skipping Profile/Holders entirely', () => {
    const xml = readFileSync(FIXTURE_PATH, 'utf-8');
    const { account, transactions } = parseFinvuAccountXml(xml);

    expect(account).toEqual({
      maskedAccNumber: 'XXXXXXXXXXXXX4712',
      balance: '166.67',
      currency: 'INR',
      accountType: 'SAVINGS',
    });
    // Deliberate decision (see plan's Global Constraints): Profile/Holders PII is never
    // parsed or surfaced by this function at all.
    expect(account).not.toHaveProperty('holders');
    expect(account).not.toHaveProperty('profile');

    expect(transactions).toHaveLength(373);

    expect(transactions[0]).toEqual({
      direction: 'credit',
      amount: '60.00',
      txnDate: '2024-02-12',
      narration: 'DEP TFR   NEFT*UTIB0001506*AXNPN40445376118*PHONEPE PRI',
      sourceMetadata: {
        txnId: '3464128',
        reference: '',
        mode: 'OTHERS',
        transactionTimestamp: '2024-02-13T05:54:18+05:30',
      },
    });

    const last = transactions[transactions.length - 1];
    expect(last).toEqual({
      direction: 'credit',
      amount: '80.00',
      txnDate: '2025-01-21',
      narration: 'DEP TFR   UPI/CR/502217297574/JAKHADIY/UBIN/thakordevc/',
      sourceMetadata: {
        txnId: '100244841',
        reference: '',
        mode: 'UPI',
        transactionTimestamp: '2025-01-22T10:36:06+05:30',
      },
    });

    // The real fixture demonstrates exactly the case the plan warns not to assume away:
    // reference is a genuinely distinct (here, empty) field from txnId, not a mirror of it.
    // Both keys must still be present on every transaction, unparsed.
    for (const t of transactions) {
      expect(t.sourceMetadata).toHaveProperty('txnId');
      expect(t.sourceMetadata).toHaveProperty('reference');
      expect(t.sourceMetadata.reference).not.toBe(t.sourceMetadata.txnId);
    }

    const debitCount = transactions.filter((t) => t.direction === 'debit').length;
    const creditCount = transactions.filter((t) => t.direction === 'credit').length;
    expect(debitCount + creditCount).toBe(373);
    expect(debitCount).toBeGreaterThan(0);
    expect(creditCount).toBeGreaterThan(0);
  });

  it('wraps a single <Transaction> element (no siblings) into a one-element array', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Account xmlns="http://api.rebit.org.in/FISchema/deposit" type="deposit" version="1.1" maskedAccNumber="XXXXX0001">
    <Profile>
        <Holders type="SINGLE">
            <Holder name="TEST HOLDER"/>
        </Holders>
    </Profile>
    <Summary currentBalance="500.00" currency="INR" type="SAVINGS"></Summary>
    <Transactions startDate="2025-01-01" endDate="2025-01-31">
        <Transaction amount="100.00" mode="UPI" narration="Solo Transaction" reference="ref-1" transactionTimestamp="2025-01-05T10:00:00+05:30" txnId="txn-1" type="DEBIT" valueDate="2025-01-04"/>
    </Transactions>
</Account>`;

    const { account, transactions } = parseFinvuAccountXml(xml);
    expect(account.maskedAccNumber).toBe('XXXXX0001');
    expect(transactions).toEqual([
      {
        direction: 'debit',
        amount: '100.00',
        txnDate: '2025-01-04',
        narration: 'Solo Transaction',
        sourceMetadata: {
          txnId: 'txn-1',
          reference: 'ref-1',
          mode: 'UPI',
          transactionTimestamp: '2025-01-05T10:00:00+05:30',
        },
      },
    ]);
  });

  it('returns an empty transactions array when there are no <Transaction> elements', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Account xmlns="http://api.rebit.org.in/FISchema/deposit" type="deposit" version="1.1" maskedAccNumber="XXXXX0002">
    <Profile><Holders type="SINGLE"><Holder name="TEST"/></Holders></Profile>
    <Summary currentBalance="0.00" currency="INR" type="SAVINGS"></Summary>
    <Transactions startDate="2025-01-01" endDate="2025-01-31"></Transactions>
</Account>`;

    const { transactions } = parseFinvuAccountXml(xml);
    expect(transactions).toEqual([]);
  });
});
