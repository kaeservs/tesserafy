import { describe, expect, it } from 'vitest';
import { groupSignature } from '../src/insights/declines';

describe('groupSignature', () => {
  it('is the same group whatever order the signals come in', () => {
    const a = groupSignature(['b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001']);
    const b = groupSignature(['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002']);

    expect(a).toBe(b);
  });

  it('ignores a signal listed twice', () => {
    expect(groupSignature(['x', 'y', 'x'])).toBe('x,y');
  });

  it('sorts byte by byte, as the database does with collate "C"', () => {
    // A hyphen sorts before a digit here. A language collation that ignored
    // hyphens could order these the other way, and the two sides would then
    // never agree on what "the same group" is.
    expect(groupSignature(['aaaaaaaa-1', 'aaaaaaaa-0000'])).toBe('aaaaaaaa-0000,aaaaaaaa-1');
  });

  it('is a different group once a signal is added', () => {
    // New evidence deserves a new look.
    expect(groupSignature(['x', 'y'])).not.toBe(groupSignature(['x', 'y', 'z']));
  });
});
