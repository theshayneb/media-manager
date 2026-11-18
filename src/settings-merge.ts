// Merging two copies of the settings (this device's and another device's, brought in by Obsidian
// Sync), so neither overwrites the other. Pure.
//
// Each save notes what this device changed since the last save or merge (`stampChanges`): every
// ordinary setting and every entry of the remembered maps and lists that was set or changed gets
// the time in `syncStamps.set`, every entry removed on purpose the time in `syncStamps.removed`.
// `mergeSettings` then takes, per setting and per entry, the newest: a removal newer than the
// entry's last change stays removed; an entry only one copy has is kept (a stale copy lacking it
// can't drop it). With no stamps on either side (not changed since 0.0.207), the other copy's
// value is taken for an ordinary setting, and both are kept for map entries.

import type { PlexNotesSettings, RelatedOffer } from './config'
import { relatedKey } from './daily-episodes'

/** When things were last set and removed (ms), by `key` or `key` + SEP + entry. Synced with the settings. */
export interface SyncStamps {
  set: Record<string, number>
  removed: Record<string, number>
}

const SEP = '\u0001'
/** Stamps older than this are forgotten (a device offline longer may bring back what was removed). */
export const STAMPS_KEPT = 180 * 86400 * 1000

/** Maps merged entry by entry. */
const MAPS = ['reactionsDone', 'gamePlaytimes', 'gameFinishSeen', 'lastfmGaps', 'fileNameReplacements', 'ignored', 'merged',
  'checkByLibrary', 'syncCompare', 'keptLinks', 'lockedProperties', 'keptValues', 'ratingsSeen', 'ratingsReviewed', 'libraries',
  'relatedAnswered'] as const
/** Lists of distinct strings merged entry by entry (order: this copy's, then the other's additions). */
const SETS = ['relatedDeclined', 'reviewSkipped', 'notRewatches', 'listenedTo', 'collectionsDeclined', 'unmatchedIgnored',
  'notInterested', 'migrations'] as const
/** Lists of records merged by a key of their own. */
const KEYED = { relatedPending: (o: RelatedOffer) => relatedKey(o.path, o.link) } as const
/** Not merged at all: the bookkeeping itself. */
const SKIP = new Set(['syncStamps'])

type Entries = Record<string, unknown>
type Settings = PlexNotesSettings & { syncStamps?: SyncStamps }

function kindOf(key: string): 'map' | 'set' | 'keyed' | 'plain' {
  if ((MAPS as readonly string[]).includes(key)) return 'map'
  if ((SETS as readonly string[]).includes(key)) return 'set'
  if (key in KEYED) return 'keyed'
  return 'plain'
}

/** A field's entries, by entry key. */
function entriesOf(key: string, value: unknown): Entries {
  const kind = kindOf(key)
  if (kind === 'map') return value && typeof value === 'object' ? value as Entries : {}
  if (kind === 'set') return Object.fromEntries((Array.isArray(value) ? value : []).filter(v => typeof v === 'string').map(v => [v, true]))
  if (kind === 'keyed') {
    const keyOf = KEYED[key as keyof typeof KEYED]
    return Object.fromEntries((Array.isArray(value) ? value as RelatedOffer[] : []).map(o => [keyOf(o), o]))
  }
  return {}
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/** A deep copy, as the starting point for the next `stampChanges`. */
export function snapshot<T>(settings: T): T {
  return JSON.parse(JSON.stringify(settings)) as T
}

/**
 * Notes in `stamps` (changed in place) what `now` differs from `before` (the last save or merge),
 * stamped `at`. Whether anything was stamped.
 */
export function stampChanges(before: Settings, now: Settings, stamps: SyncStamps, at: number): boolean {
  let changed = false
  const mark = (id: string, removed: boolean) => {
    if (removed) {
      stamps.removed[id] = at
      delete stamps.set[id]
    } else {
      stamps.set[id] = at
      delete stamps.removed[id]
    }
    changed = true
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (SKIP.has(key)) continue
    const a = (before as unknown as Entries)[key]
    const b = (now as unknown as Entries)[key]
    if (kindOf(key) === 'plain') {
      if (!same(a, b)) mark(key, false)
      continue
    }
    const was = entriesOf(key, a)
    const is = entriesOf(key, b)
    for (const entry of Object.keys(is)) if (!(entry in was) || !same(was[entry], is[entry])) mark(`${key}${SEP}${entry}`, false)
    for (const entry of Object.keys(was)) if (!(entry in is)) mark(`${key}${SEP}${entry}`, true)
    // A map going from "never looked" (null) to looked at, or back, counts as a change of its own.
    if ((a === null) !== (b === null) && kindOf(key) === 'map') mark(key, false)
  }
  return changed
}

/** Both copies' stamps together (the later of each), leaving out those older than `STAMPS_KEPT`. */
export function joinStamps(a: SyncStamps | undefined, b: SyncStamps | undefined, now: number): SyncStamps {
  const out: SyncStamps = { set: {}, removed: {} }
  for (const part of ['set', 'removed'] as const) {
    for (const from of [a?.[part] ?? {}, b?.[part] ?? {}]) {
      for (const [id, at] of Object.entries(from)) {
        if (typeof at !== 'number' || now - at > STAMPS_KEPT) continue
        if (!(id in out[part]) || at > out[part][id]) out[part][id] = at
      }
    }
  }
  return out
}

/**
 * `local` (this device's) and `remote` (another copy, say the one Sync just wrote) as one: per
 * ordinary setting the more recently changed value (unstamped on both: `remote`'s); per map or list
 * entry the more recently set one, dropped when a removal is newer than it; an entry only one copy
 * has is kept. Each copy's own `syncStamps` decide; the result carries both together.
 */
export function mergeSettings(local: Settings, remote: Settings, now: number): Settings {
  const ls = local.syncStamps
  const rs = remote.syncStamps
  const stamps = joinStamps(ls, rs, now)
  const out = { ...remote } as unknown as Entries
  const l = local as unknown as Entries
  const r = remote as unknown as Entries
  for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (SKIP.has(key)) continue
    const kind = kindOf(key)
    if (kind === 'plain') {
      const lt = ls?.set[key] ?? 0
      const rt = rs?.set[key] ?? 0
      out[key] = !(key in r) || (key in l && lt > rt) ? l[key] : r[key]
      continue
    }
    const le = entriesOf(key, l[key])
    const re = entriesOf(key, r[key])
    const merged: Entries = {}
    const order = [...Object.keys(le), ...Object.keys(re).filter(k => !(k in le))]
    for (const entry of order) {
      const id = `${key}${SEP}${entry}`
      const setAt = stamps.set[id] ?? 0
      const removedAt = stamps.removed[id] ?? 0
      if (removedAt > setAt) continue
      if (!(entry in le)) merged[entry] = re[entry]
      else if (!(entry in re)) merged[entry] = le[entry]
      else merged[entry] = (ls?.set[id] ?? 0) > (rs?.set[id] ?? 0) ? le[entry] : re[entry]
    }
    // Entries removed here and stamped so are gone, even when the other copy still has them.
    if (kind === 'map') {
      const nulls = l[key] === null && r[key] === null
      out[key] = nulls && !Object.keys(merged).length ? null : merged
    } else if (kind === 'set') out[key] = Object.keys(merged)
    else out[key] = Object.values(merged)
  }
  out.syncStamps = stamps
  return out as unknown as Settings
}
