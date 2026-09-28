/**
 * Finding a meeting: what the URL may ask for, and what comes back.
 *
 * The cases pinned are the ones a list gets quietly wrong: an unscored call
 * sorting as a zero, a date filter ignoring calls with no date, a page past
 * the end, and a search for "50%" matching everything.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  bandOf,
  hrefWith,
  isFiltered,
  likePattern,
  PAGE_SIZE,
  parseFilters,
  type FilterableMeeting,
} from '@/lib/meeting-filters';

function meeting(title: string, day: string | null, score: number | null, imported = '2026-09-01'): FilterableMeeting {
  return { title, occurred_at: day ? `${day}T10:00:00Z` : null, created_at: `${imported}T09:00:00Z`, score };
}

const none = parseFilters({});

describe('parseFilters', () => {
  it('defaults to every meeting, newest first, page one', () => {
    expect(none).toEqual({
      q: '',
      seller: null,
      type: null,
      from: null,
      to: null,
      band: null,
      outcome: null,
      sort: 'newest',
      page: 1,
    });
    expect(isFiltered(none)).toBe(false);
  });

  it('drops anything malformed rather than guessing', () => {
    const parsed = parseFilters({
      seller: 'robert; drop table',
      type: 'Demo!',
      from: 'last week',
      score: 'great',
      outcome: 'maybe',
      sort: 'random',
      page: '-3',
    });
    expect(parsed).toEqual(none);
  });

  it('keeps what is well formed', () => {
    const parsed = parseFilters({
      q: ' Acme ',
      seller: 'mine',
      type: 'product-demo',
      from: '2026-09-01',
      to: '2026-09-30',
      score: 'low',
      outcome: 'won',
      sort: 'lowest',
      page: '2',
    });
    expect(parsed).toMatchObject({
      q: 'Acme',
      seller: 'mine',
      type: 'product-demo',
      band: 'low',
      outcome: 'won',
      sort: 'lowest',
      page: 2,
    });
    expect(isFiltered(parsed)).toBe(true);
  });
});

describe('likePattern', () => {
  it('searches for the characters typed, not a pattern', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });
});

describe('bandOf', () => {
  it('keeps "not scored" apart from a zero', () => {
    expect(bandOf(null)).toBe('unscored');
    expect(bandOf(0)).toBe('low');
    expect(bandOf(49.9)).toBe('low');
    expect(bandOf(50)).toBe('mid');
    expect(bandOf(80)).toBe('high');
  });
});

describe('applyFilters', () => {
  const meetings = [
    meeting('Acme', '2026-09-20', 90),
    meeting('Brightloom', '2026-09-10', 40),
    meeting('Northwind', null, null, '2026-09-15'),
    meeting('Pinegrove', '2026-08-30', 60),
  ];

  it('filters on the meeting date, or the import date when there is none', () => {
    const shown = applyFilters(meetings, { ...none, from: '2026-09-12', to: '2026-09-30' });
    expect(shown.items.map((m) => m.title)).toEqual(['Acme', 'Northwind']);
  });

  it('filters by score band', () => {
    expect(applyFilters(meetings, { ...none, band: 'unscored' }).items.map((m) => m.title)).toEqual(['Northwind']);
    expect(applyFilters(meetings, { ...none, band: 'mid' }).items.map((m) => m.title)).toEqual(['Pinegrove']);
  });

  it('sorts unscored calls last whichever way scores are sorted', () => {
    expect(applyFilters(meetings, { ...none, sort: 'highest' }).items.map((m) => m.title)).toEqual([
      'Acme',
      'Pinegrove',
      'Brightloom',
      'Northwind',
    ]);
    expect(applyFilters(meetings, { ...none, sort: 'lowest' }).items.map((m) => m.title)).toEqual([
      'Brightloom',
      'Pinegrove',
      'Acme',
      'Northwind',
    ]);
  });

  it('sorts by date both ways and by title', () => {
    expect(applyFilters(meetings, none).items.map((m) => m.title)).toEqual([
      'Acme',
      'Northwind',
      'Brightloom',
      'Pinegrove',
    ]);
    expect(applyFilters(meetings, { ...none, sort: 'oldest' }).items[0]!.title).toBe('Pinegrove');
    expect(applyFilters(meetings, { ...none, sort: 'title' }).items.map((m) => m.title)).toEqual([
      'Acme',
      'Brightloom',
      'Northwind',
      'Pinegrove',
    ]);
  });

  it('pages, and a page past the end shows the last one', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      meeting(`Call ${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, i),
    );
    const second = applyFilters(many, { ...none, page: 2 });
    expect(second).toMatchObject({ total: 60, page: 2, pages: 3 });
    expect(second.items).toHaveLength(PAGE_SIZE);
    const past = applyFilters(many, { ...none, page: 9 });
    expect(past.page).toBe(3);
    expect(past.items).toHaveLength(10);
  });
});

describe('hrefWith', () => {
  it('keeps every filter and changes only what is asked', () => {
    const filters = parseFilters({ q: 'Acme & co', score: 'high', sort: 'title' });
    expect(hrefWith(filters, { page: 2 })).toBe('/conversations?q=Acme+%26+co&score=high&sort=title&page=2');
    expect(hrefWith(none, { page: 1 })).toBe('/conversations');
  });
});
