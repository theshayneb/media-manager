/**
 * Reading sittings, from the page numbers a book reader saves in a book note's Progress property.
 * Pure: the plugin feeds it what it sees on this device and offers each sitting's book for the
 * Related property of the daily note of the day the sitting started.
 */

/** Page saves less than this far apart (seconds) are one sitting. */
export const SITTING_GAP = 30 * 60

/** What's known about one book on this device. */
export interface BookReading {
  /** The last page number seen in its Progress (null when it isn't a number). */
  page: number | null
  /** When the book was last opened in the reader here (seconds), if known. */
  openedAt?: number
  /** The sitting going on: when it started and when a page last went up (seconds). */
  start?: number
  last?: number
}

/** A Progress value as a page number: 14 or "14"; null for anything else ("xii", empty). */
export function pageOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return Number(value)
  return null
}

/**
 * A newly saved Progress `value` at `at` (seconds). Only a page number higher than the last one
 * seen counts as reading (paging back, a page label or the first look at a book don't). A page
 * that goes up within `SITTING_GAP` of the last one carries on the sitting; otherwise a new one
 * starts, at when the book was opened in the reader when that's within the gap (the reader saves
 * the page only every few minutes), else now. `started` is the sitting's start when this counted
 * as reading, so its day's daily note can be offered the book.
 */
export function readPage(state: BookReading | undefined, value: unknown, at: number): { state: BookReading, started: number | null } {
  const page = pageOf(value)
  const before = state?.page ?? null
  if (page === null || before === null || page <= before) {
    return { state: { ...state, page: page ?? before }, started: null }
  }
  const going = state?.start !== undefined && state.last !== undefined && at - state.last <= SITTING_GAP ? state.start : undefined
  const opened = state?.openedAt
  const start = going !== undefined ? going : opened !== undefined && opened <= at && at - opened <= SITTING_GAP ? opened : at
  return { state: { ...state, page, start, last: at }, started: start }
}

/** Opening a book in the reader at `at`: notes when, and the page it's on now. */
export function openBook(state: BookReading | undefined, value: unknown, at: number): BookReading {
  return { ...state, page: pageOf(value) ?? state?.page ?? null, openedAt: at }
}

/** A page saved while the book isn't open here (read on another device): remembered, not counted. */
export function pageElsewhere(state: BookReading | undefined, value: unknown): BookReading {
  return { ...state, page: pageOf(value) ?? state?.page ?? null }
}
