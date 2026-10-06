// Builds native/mac/mic-users.swift into dist/mac/mic-users: one binary for
// Apple silicon and Intel (lipo), for the macOS installers to carry beside the
// app's own executable. Anywhere but a Mac there is nothing to build, and it
// says so rather than failing the Windows build.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'native', 'mac', 'mic-users.swift');
const out = join(root, 'dist', 'mac');

if (process.platform !== 'darwin') {
  console.info('mic-users: macOS only, skipped');
  process.exit(0);
}

mkdirSync(out, { recursive: true });
const slices = ['arm64', 'x86_64'].map((arch) => {
  const binary = join(out, `mic-users-${arch}`);
  execFileSync('swiftc', ['-O', '-target', `${arch}-apple-macos11`, source, '-o', binary], { stdio: 'inherit' });
  return binary;
});
const helper = join(out, 'mic-users');
execFileSync('lipo', ['-create', ...slices, '-output', helper], { stdio: 'inherit' });
for (const slice of slices) rmSync(slice);
// Signed ad hoc, as the app is: lipo leaves the joined binary unsigned, and
// codesign refuses to seal an app with unsigned code inside it.
execFileSync('codesign', ['--sign', '-', '--force', helper], { stdio: 'inherit' });
console.info(`mic-users: built and signed ${helper}`);
