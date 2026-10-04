/**
 * Which overlay is asking: its version and platform, as it says them in the
 * `x-tesserafy-overlay` header ("0.1.15 win32"). Anything else is not an
 * overlay we built, and is ignored rather than recorded.
 */
export function overlayClient(header: string | null): { version: string; platform: 'win32' | 'darwin' | 'linux' } | null {
  const match = /^(\d{1,4}\.\d{1,4}\.\d{1,4}) (win32|darwin|linux)$/.exec((header ?? '').trim());
  return match ? { version: match[1]!, platform: match[2] as 'win32' | 'darwin' | 'linux' } : null;
}
