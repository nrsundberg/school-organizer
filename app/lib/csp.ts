export const CSP_NONCE_HEADER = "x-csp-nonce";

export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

export function getCspNonceFromRequest(request: Request): string | null {
  return request.headers.get(CSP_NONCE_HEADER);
}
