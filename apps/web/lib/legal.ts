/**
 * Where Tesserafy's Terms of Service and Privacy Policy live.
 *
 * The owner is having both written by a lawyer; they are not ours to draft.
 * Until an address is set (TERMS_URL, PRIVACY_URL), /terms and /privacy say
 * they are being finalised — and /terms says the one thing the product
 * already relies on: Tesserafy never announces itself on a call, so telling
 * everyone and getting their agreement falls to whoever uses it. The
 * overlay and the live microphone link here from the consent confirmation.
 */
export function legalUrl(which: 'terms' | 'privacy'): string | null {
  const value = process.env[which === 'terms' ? 'TERMS_URL' : 'PRIVACY_URL']?.trim();
  return value && /^https:\/\//i.test(value) ? value : null;
}
