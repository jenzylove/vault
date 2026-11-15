/** Daily vault: everyone gets the same seeded layout on the same calendar day. */
export function dailySeed(dateISO: string): number {
  const day = dateISO.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`dailySeed expects an ISO date, got "${dateISO}"`);
  // FNV-1a 32 bit
  let h = 0x811c9dc5;
  for (const ch of `the-vault:${day}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Share card line: "He read me 2 of 10. Can he read you?" */
export function shareLine(bankerCorrect: number, bankerCalls: number): string {
  return `He read me ${bankerCorrect} of ${bankerCalls}. Can he read you?`;
}
