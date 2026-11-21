/** How long each read lasts, in signal time. One place so the baseline windows match the peek. */

/** Learn your calm: 10 s is two or three breaths, enough for a band, a pause length and a blink rate. */
export const BASELINE_MS = 10000;
/** A peek: 5 s still holds at least one full breath for anyone breathing 12 or more times a minute. */
export const PEEK_MS = 5000;
/** Lead in before the contents show (the box lifts and opens). */
export const PEEK_LEAD_MS = 1500;
