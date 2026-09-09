import type { EvalQuestion } from './types.js';

// Grounding period matches the fixed seed reference date used by setupEvalUsers.ts
// (2026-07-20), whose most recent full seeded month is July 2026 — see
// tests/rest/summary.test.ts for the same anchor-month convention.
const JULY: { from: string; to: string } = { from: '2026-07-01', to: '2026-07-31' };

export const EVAL_QUESTIONS: EvalQuestion[] = [
  // --- A. Numerical grounding (10) ---
  {
    id: 'grounding-income',
    category: 'grounding',
    setup: [],
    question: 'How much income did I receive in July 2026?',
    groundTruth: { metrics: ['income'], period: JULY, path: ['income'] },
  },
  {
    id: 'grounding-savings-rate',
    category: 'grounding',
    setup: [],
    question: "What was my savings rate in July 2026?",
    groundTruth: { metrics: ['savings_rate'], period: JULY, path: ['savingsRate'] },
  },
  {
    id: 'grounding-food-delivery',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Food Delivery in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Food Delivery'] },
  },
  {
    id: 'grounding-groceries',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Groceries in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Groceries'] },
  },
  {
    id: 'grounding-transport',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Transport in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Transport'] },
  },
  {
    id: 'grounding-shopping',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Shopping in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Shopping'] },
  },
  {
    id: 'grounding-subscriptions',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Subscriptions in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Subscriptions'] },
  },
  {
    id: 'grounding-utilities',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Utilities in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Utilities'] },
  },
  {
    id: 'grounding-rent',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Rent in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Rent'] },
  },
  {
    id: 'grounding-cash-withdrawal',
    category: 'grounding',
    setup: [],
    question: 'How much did I withdraw as cash in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Cash Withdrawal'] },
  },

  // --- B. Preference adherence, same-session (6) ---
  {
    id: 'preference-crypto',
    category: 'preference',
    setup: ['Just so you know, never suggest crypto to me as an investment.'],
    question: 'Where should I put my surplus savings this month?',
    rubric: 'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.',
  },
  {
    id: 'preference-rent-exclude',
    category: 'preference',
    setup: ["I send ₹10,000 home to my parents every month via UPI transfer — please don't count that as discretionary spending when you analyze my budget."],
    question: 'Based on my spending, where could I realistically cut back?',
    rubric: 'PASS if the reply does not list the monthly transfer to parents / UPI transfer as an area to cut back or as discretionary/wasteful spending. FAIL if it suggests cutting the transfer to parents.',
  },
  {
    id: 'preference-conservative',
    category: 'preference',
    setup: ["I'm very risk-averse — please keep any suggestions conservative, not aggressive."],
    question: 'What should I do with money left over at the end of the month?',
    rubric: 'PASS if the tone/suggestions are conservative (e.g. savings, emergency fund, safe options) and do not push aggressive or high-risk framing. FAIL if it recommends aggressive/high-risk approaches.',
  },
  {
    id: 'preference-no-subscriptions-advice',
    category: 'preference',
    setup: ["I already know my subscriptions are expensive, please don't lecture me about cancelling them — I've decided to keep them."],
    question: 'What patterns do you notice in my monthly spending?',
    rubric: 'PASS if the reply does not push the user to cancel subscriptions or lecture about subscription costs, even if it may mention them factually. FAIL if it recommends cancelling subscriptions.',
  },
  {
    id: 'preference-goal-house',
    category: 'preference',
    setup: ["My goal is saving for a house down payment — that's my top priority right now."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    rubric: "PASS if the reply frames the answer with reference to the house-down-payment goal (e.g. weighing the trip against that priority). FAIL if it ignores the stated goal entirely.",
  },
  {
    id: 'preference-currency-inr',
    category: 'preference',
    setup: ['Please always show amounts in INR with the ₹ symbol, never USD.'],
    question: 'What was my total spending last month?',
    rubric: 'PASS if all money figures in the reply use ₹/INR. FAIL if any figure is shown in USD or another currency.',
  },

  // --- B. Preference adherence, cross-session (4) ---
  {
    id: 'preference-crypto-cross',
    category: 'preference',
    setup: ['Never suggest crypto to me as an investment — please remember that for future conversations.'],
    question: 'Where should my surplus go?',
    rubric: 'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin. FAIL if it does.',
  },
  {
    id: 'preference-rent-exclude-cross',
    category: 'preference',
    setup: ["Please remember: I send ₹10,000 home to my parents monthly, don't treat it as discretionary spending."],
    question: 'Where could I cut back on spending?',
    rubric: 'PASS if the reply does not list the transfer to parents as something to cut. FAIL if it does.',
  },
  {
    id: 'preference-conservative-cross',
    category: 'preference',
    setup: ["Please remember I'm risk-averse and want conservative suggestions only."],
    question: 'What should I do with leftover money each month?',
    rubric: 'PASS if suggestions stay conservative. FAIL if aggressive/high-risk options are pushed.',
  },
  {
    id: 'preference-goal-house-cross',
    category: 'preference',
    setup: ["Please remember my top financial goal is saving for a house down payment."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    rubric: 'PASS if the reply references the house-down-payment goal when answering. FAIL if it ignores it.',
  },

  // --- C. Multi-turn recall, same session, no "remember" framing (8) ---
  {
    id: 'recall-pet-name',
    category: 'recall',
    setup: [
      'By the way, my dog Bruno just had surgery, it was expensive.',
      'How much did I spend on Groceries last month?',
      'And Transport?',
      'What about Shopping?',
    ],
    question: 'What did I mention about my dog earlier?',
    expectedFact: 'bruno',
  },
  {
    id: 'recall-job-change',
    category: 'recall',
    setup: [
      "I just switched jobs, my new salary is different from what you'll see historically.",
      'How much did I spend on Utilities last month?',
      'And on Subscriptions?',
      'What was my savings rate?',
    ],
    question: 'Did I mention anything about a job change earlier in this conversation?',
    expectedFact: 'job',
  },
  {
    id: 'recall-goa-trip',
    category: 'recall',
    setup: [
      "I'm planning a trip to Goa in December, budget around ₹40,000.",
      'How much did I spend on Food Delivery last month?',
      'How much cash did I withdraw last month?',
    ],
    question: 'What trip did I mention planning earlier?',
    expectedFact: 'goa',
  },
  {
    id: 'recall-emergency-fund',
    category: 'recall',
    setup: [
      "I'm trying to build a 6-month emergency fund as my main goal.",
      'What was my income last month?',
      'What was my savings rate?',
    ],
    question: 'What financial goal did I state earlier?',
    expectedFact: 'emergency fund',
  },
  {
    id: 'recall-freelance-income',
    category: 'recall',
    setup: [
      'I also do freelance work on the side, though it is not reflected in this account.',
      'How much did I spend on Rent last month?',
      'How much on Transport?',
    ],
    question: 'Did I mention any other source of income earlier?',
    expectedFact: 'freelance',
  },
  {
    id: 'recall-wedding',
    category: 'recall',
    setup: [
      "I'm saving up for a friend's wedding gift, planning to spend around ₹15,000.",
      'What was my total spending last month?',
      'How much did I spend on Shopping?',
    ],
    question: 'What was I saving up for, that I mentioned earlier?',
    expectedFact: 'wedding',
  },
  {
    id: 'recall-medical',
    category: 'recall',
    setup: [
      'I had an unexpected medical expense this month that threw off my budget.',
      'What was my savings rate last month?',
      'How much did I spend on Utilities?',
    ],
    question: 'What unexpected expense did I mention earlier?',
    expectedFact: 'medical',
  },
  {
    id: 'recall-side-project',
    category: 'recall',
    setup: [
      "I'm building a side project and might need to invest in a laptop soon.",
      'How much did I spend on Subscriptions last month?',
      'What was my income last month?',
    ],
    question: 'What was I considering buying, that I mentioned earlier?',
    expectedFact: 'laptop',
  },

  // --- D. Memory hygiene (6) ---
  {
    id: 'hygiene-delete-crypto',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ['Never suggest crypto to me — please remember that.'],
    question: 'Where should my surplus savings go?',
    deletedFactSubstring: 'crypto',
  },
  {
    id: 'hygiene-delete-goal',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ["Please remember my top goal is saving for a house down payment."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    deletedFactSubstring: 'house',
  },
  {
    id: 'hygiene-delete-rent',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ["Please remember: I send ₹10,000 home monthly, don't count it as discretionary."],
    question: 'Where could I cut back on spending?',
    deletedFactSubstring: 'parents',
  },
  {
    id: 'hygiene-stale-netflix',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: "For your records: I don't have a Netflix subscription anymore, I cancelled it last year.",
    question: 'How much did I spend on Subscriptions in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Subscriptions'] },
  },
  {
    id: 'hygiene-stale-income',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: 'For your records: my monthly salary is ₹50,000, not whatever the data might show.',
    question: 'How much income did I receive in July 2026?',
    groundTruth: { metrics: ['income'], period: JULY, path: ['income'] },
  },
  {
    id: 'hygiene-stale-savings',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: 'For your records: my savings rate is roughly 5%, that has been true for a while.',
    question: 'What was my savings rate in July 2026?',
    groundTruth: { metrics: ['savings_rate'], period: JULY, path: ['savingsRate'] },
  },
];
