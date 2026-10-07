import { describe, expect, it } from 'vitest';
import { assignLooks } from './cast';

describe('who sits in each chair', () => {
  it('fills chairs with the usual characters when nobody chose', () => {
    expect(assignLooks([null, null, null, null])).toEqual(['nico', 'tito', 'don_rafa', 'yadiel']);
  });

  it('gives players their character and moves the others around it', () => {
    expect(assignLooks(['don_rafa', null, null, null])).toEqual(['don_rafa', 'tito', 'nico', 'yadiel']);
  });

  it('never shows the same character twice', () => {
    const looks = assignLooks(['tito', null, 'tito', 'bogus']);
    expect(looks[0]).toBe('tito');
    expect(new Set(looks).size).toBe(4);
  });
});
