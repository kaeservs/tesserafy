/**
 * Action items keep only what they can quote: an item whose quote is not in
 * the segment it names is dropped, and empty names and dues become nothing
 * rather than empty strings.
 */
import { describe, expect, it } from 'vitest';
import { resolveActionItems } from '../src/tiers/t3-actions';

const segments = [
  { id: 's1', speaker: 'Maya', startMs: 0, text: 'I will send the security documents today.' },
  { id: 's2', speaker: 'Tom', startMs: 4000, text: 'Finance will confirm the budget by Friday.' },
];

describe('resolveActionItems', () => {
  it('keeps quoted items with whose and when, and drops the rest', () => {
    const { items, dropped } = resolveActionItems(
      [
        { action: 'Send the security documents', owner_side: 'ours', owner_name: 'Maya', due: 'today', segment_id: 's1', quote: 'send the security documents today' },
        { action: 'Confirm the budget', owner_side: 'theirs', owner_name: ' ', due: '', segment_id: 's2', quote: 'confirm the budget by Friday' },
        { action: 'Invented', owner_side: 'ours', owner_name: '', due: '', segment_id: 's2', quote: 'nobody said this' },
        { action: 'Nowhere', owner_side: 'ours', owner_name: '', due: '', segment_id: 's9', quote: 'I will' },
      ],
      segments,
    );
    expect(dropped).toBe(2);
    expect(items).toEqual([
      { action: 'Send the security documents', ownerSide: 'ours', ownerName: 'Maya', due: 'today', segmentId: 's1', quote: 'send the security documents today' },
      { action: 'Confirm the budget', ownerSide: 'theirs', ownerName: null, due: null, segmentId: 's2', quote: 'confirm the budget by Friday' },
    ]);
  });
});
