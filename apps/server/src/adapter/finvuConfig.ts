function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set (required when MOCK_MODE=false)`);
  return value;
}

export interface FinvuConfig {
  baseUrl: string;
  channelUserId: string;
  channelPassword: string;
  aaId: string;
  templateName: string;
  redirectUrl: string;
}

export function getFinvuConfig(): FinvuConfig {
  return {
    baseUrl: required('FINVU_BASE_URL', 'https://dhanaprayoga.fiu.finfactor.in/finsense/API/V2'),
    channelUserId: required('FINVU_CHANNEL_USER_ID', 'channel@dhanaprayoga'),
    // No fallback for the password — the shared demo credential has to come from the real
    // onboarding kit's env, never hardcoded, even though it's meant to be a shared sandbox login.
    channelPassword: required('FINVU_CHANNEL_PASSWORD'),
    aaId: required('FINVU_AA_ID', 'cookiejar-aa@finvu.in'),
    templateName: required('FINVU_TEMPLATE_NAME', 'FINVUDEMO_TESTING'),
    redirectUrl: required('FINVU_REDIRECT_URL', 'https://google.co.in'),
  };
}
