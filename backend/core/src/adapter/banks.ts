export interface Bank {
  fipId: string;
  name: string;
  logo: string;
}

export const SUPPORTED_BANKS: Bank[] = [
  { fipId: 'hdfc-bank', name: 'HDFC Bank', logo: 'https://mock-aa.switch.app/logos/hdfc-bank.png' },
  { fipId: 'icici-bank', name: 'ICICI Bank', logo: 'https://mock-aa.switch.app/logos/icici-bank.png' },
];

export function listSupportedBanks(): Bank[] {
  return SUPPORTED_BANKS;
}
