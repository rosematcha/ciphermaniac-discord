/** Combining marks, written as escapes: the literal characters are invisible in source. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Lower-cased and stripped of diacritics. Must fold exactly as ciphermaniac's
 * `shared/live/fold.ts` does, or seat keys stop matching its deck reports.
 */
export function foldName(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(COMBINING_MARKS, '').replace(/\s+/g, ' ').trim();
}

/** The key ciphermaniac files a seat's deck reports under. */
export function seatKey(seat: { name: string; country: string }): string {
  return `${foldName(seat.name)}|${seat.country}`;
}
