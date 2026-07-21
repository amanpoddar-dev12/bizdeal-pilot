// KYC verification abstraction — swap providers without schema changes.
// Default provider is "manual": admin toggles kyc_verified in the admin UI.
export type KycResult = { verified: boolean | null; provider: string; details?: Record<string, unknown> };

const PROVIDER = (import.meta.env.VITE_KYC_PROVIDER ?? "manual") as string;

export async function verifyGST(gstNumber: string): Promise<KycResult> {
  if (PROVIDER === "manual") return { verified: null, provider: "manual" };
  // TODO: plug in Cashfree / Signzy / Karza call here.
  return { verified: null, provider: PROVIDER, details: { gstNumber } };
}

export async function verifyPAN(pan: string): Promise<KycResult> {
  if (PROVIDER === "manual") return { verified: null, provider: "manual" };
  return { verified: null, provider: PROVIDER, details: { pan } };
}
