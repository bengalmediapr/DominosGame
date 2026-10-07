import { SEAT_LOOKS } from '../three/characters';

export type Look = (typeof SEAT_LOOKS)[number];

export const isLook = (x: unknown): x is Look => typeof x === 'string' && (SEAT_LOOKS as readonly string[]).includes(x);

/**
 * Who appears in each chair (by engine seat). Players keep the character they chose unless someone
 * at an earlier seat already has it; the other chairs get the remaining characters, each seat's usual
 * one first. No character appears twice.
 */
export function assignLooks(wanted: readonly (string | null | undefined)[]): Look[] {
  const looks: (Look | null)[] = wanted.map(() => null);
  const taken = new Set<Look>();
  wanted.forEach((w, p) => {
    if (isLook(w) && !taken.has(w)) {
      looks[p] = w;
      taken.add(w);
    }
  });
  looks.forEach((l, p) => {
    if (l) return;
    const pick = [SEAT_LOOKS[p], ...SEAT_LOOKS].find((x) => !taken.has(x))!;
    looks[p] = pick;
    taken.add(pick);
  });
  return looks as Look[];
}
