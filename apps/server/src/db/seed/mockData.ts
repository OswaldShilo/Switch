import { addMonths, getDaysInMonth, startOfMonth } from 'date-fns';

export interface MockAccount {
  key: 'acc1' | 'acc2';
  bank: string;
  type: string;
  maskedNumber: string;
  balance: string;
  currency: string;
}

export interface MockTransaction {
  accountKey: 'acc1' | 'acc2';
  txnDate: string;
  amount: string;
  direction: 'credit' | 'debit';
  narration: string;
  merchant: string | null;
}

export interface MockDataset {
  userEmail: string;
  accounts: MockAccount[];
  transactions: MockTransaction[];
}

const MONTHS = 6;
const SPIKE_MONTH_INDEX = 3;
const SPIKE_EXTRA_COUNT = 28;
const REGULAR_EVERYDAY_COUNT = 54;

interface EverydayTemplate {
  merchant: string;
  narration: string;
  baseAmount: number;
  step: number;
  accountKey: 'acc1' | 'acc2';
}

const EVERYDAY_TEMPLATES: EverydayTemplate[] = [
  { merchant: 'swiggy', narration: 'SWIGGY ORDER', baseAmount: 320, step: 15, accountKey: 'acc1' },
  { merchant: 'zomato', narration: 'ZOMATO ORDER', baseAmount: 280, step: 12, accountKey: 'acc1' },
  { merchant: 'uber', narration: 'UBER TRIP', baseAmount: 180, step: 20, accountKey: 'acc1' },
  { merchant: 'ola', narration: 'OLA CAB', baseAmount: 150, step: 18, accountKey: 'acc2' },
  { merchant: 'bigbasket', narration: 'BIGBASKET GROCERIES', baseAmount: 900, step: 40, accountKey: 'acc1' },
  { merchant: 'dmart', narration: 'DMART RETAIL', baseAmount: 650, step: 30, accountKey: 'acc2' },
  { merchant: 'bses', narration: 'BSES ELECTRICITY BILL', baseAmount: 1400, step: 60, accountKey: 'acc1' },
  { merchant: 'airtel', narration: 'AIRTEL MOBILE RECHARGE', baseAmount: 399, step: 0, accountKey: 'acc2' },
  { merchant: 'amazon', narration: 'AMAZON.IN PURCHASE', baseAmount: 799, step: 100, accountKey: 'acc1' },
  { merchant: 'myntra', narration: 'MYNTRA PURCHASE', baseAmount: 1200, step: 150, accountKey: 'acc2' },
  { merchant: 'atm', narration: 'ATM CASH WITHDRAWAL', baseAmount: 2000, step: 500, accountKey: 'acc1' },
  { merchant: 'upi-transfer', narration: 'UPI/P2P TRANSFER', baseAmount: 500, step: 50, accountKey: 'acc2' },
];

interface SubscriptionTemplate {
  merchant: string;
  narration: string;
  amount: number;
  day: number;
  accountKey: 'acc1' | 'acc2';
}

const SUBSCRIPTION_TEMPLATES: SubscriptionTemplate[] = [
  { merchant: 'netflix', narration: 'NETFLIX.COM SUBSCRIPTION', amount: 649, day: 5, accountKey: 'acc1' },
  { merchant: 'spotify', narration: 'SPOTIFY INDIA', amount: 119, day: 7, accountKey: 'acc1' },
  { merchant: 'hotstar', narration: 'DISNEY HOTSTAR SUBSCRIPTION', amount: 299, day: 9, accountKey: 'acc2' },
  { merchant: 'amazonprime', narration: 'AMAZON PRIME MEMBERSHIP', amount: 299, day: 11, accountKey: 'acc1' },
  { merchant: 'icloud', narration: 'APPLE ICLOUD STORAGE', amount: 75, day: 13, accountKey: 'acc2' },
  { merchant: 'gym', narration: 'CULTFIT MEMBERSHIP', amount: 1499, day: 15, accountKey: 'acc1' },
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function clampDay(day: number, daysInMonth: number): number {
  return Math.min(day, daysInMonth);
}

export function generateMockDataset(now: Date): MockDataset {
  const accounts: MockAccount[] = [
    { key: 'acc1', bank: 'HDFC Bank', type: 'SAVINGS', maskedNumber: 'XXXX1234', balance: '84250.00', currency: 'INR' },
    { key: 'acc2', bank: 'ICICI Bank', type: 'SAVINGS', maskedNumber: 'XXXX5678', balance: '21430.00', currency: 'INR' },
  ];

  const transactions: MockTransaction[] = [];
  const anchor = startOfMonth(now);

  for (let m = 0; m < MONTHS; m++) {
    const monthDate = addMonths(anchor, -(MONTHS - 1 - m));
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = getDaysInMonth(monthDate);

    transactions.push({
      accountKey: 'acc1',
      txnDate: dateStr(year, month, clampDay(1, daysInMonth)),
      amount: '70000.00',
      direction: 'credit',
      narration: 'SALARY CREDIT NEXTLEAP TECHNOLOGIES',
      merchant: null,
    });

    transactions.push({
      accountKey: 'acc1',
      txnDate: dateStr(year, month, clampDay(3, daysInMonth)),
      amount: '15000.00',
      direction: 'debit',
      narration: 'NEFT RENT PAYMENT MAYUR CO-OP HSG SOCIETY',
      merchant: null,
    });

    for (const sub of SUBSCRIPTION_TEMPLATES) {
      transactions.push({
        accountKey: sub.accountKey,
        txnDate: dateStr(year, month, clampDay(sub.day, daysInMonth)),
        amount: sub.amount.toFixed(2),
        direction: 'debit',
        narration: sub.narration,
        merchant: sub.merchant,
      });
    }

    for (let i = 0; i < REGULAR_EVERYDAY_COUNT; i++) {
      const template = EVERYDAY_TEMPLATES[i % EVERYDAY_TEMPLATES.length];
      const amount = template.baseAmount + (i % 4) * template.step;
      const day = clampDay(1 + ((i * 2 + 3) % daysInMonth), daysInMonth);
      transactions.push({
        accountKey: template.accountKey,
        txnDate: dateStr(year, month, day),
        amount: amount.toFixed(2),
        direction: 'debit',
        narration: template.narration,
        merchant: template.merchant,
      });
    }

    if (m === SPIKE_MONTH_INDEX) {
      const spikeTemplates = EVERYDAY_TEMPLATES.filter(
        (t) => t.merchant === 'amazon' || t.merchant === 'myntra'
      );
      for (let i = 0; i < SPIKE_EXTRA_COUNT; i++) {
        const template = spikeTemplates[i % spikeTemplates.length];
        const amount = template.baseAmount + (i % 5) * template.step;
        const day = clampDay(1 + ((i * 3 + 7) % daysInMonth), daysInMonth);
        transactions.push({
          accountKey: template.accountKey,
          txnDate: dateStr(year, month, day),
          amount: amount.toFixed(2),
          direction: 'debit',
          narration: template.narration,
          merchant: template.merchant,
        });
      }
    }
  }

  return {
    userEmail: 'demo@switch.app',
    accounts,
    transactions,
  };
}

export function generateMockAccountData(
  fipId: string,
  now: Date
): { account: MockAccount; transactions: MockTransaction[] } | null {
  const dataset = generateMockDataset(now);
  const account = dataset.accounts.find((a) => a.bank.toLowerCase().replace(/\s+/g, '-') === fipId);
  if (!account) {
    return null;
  }
  const transactions = dataset.transactions.filter((t) => t.accountKey === account.key);
  return { account, transactions };
}
