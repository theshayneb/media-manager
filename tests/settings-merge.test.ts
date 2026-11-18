import { describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, mergeAnswers, type PlexNotesSettings } from '../src/config'
import { isSettingsData, mergeSettings, snapshot, stampChanges, STAMPS_KEPT } from '../src/settings-merge'

const DAY = 86400 * 1000
const T0 = Date.UTC(2026, 10, 1)

/** A device: its settings and what they were at its last save, saving stamps its changes. */
function device(from: PlexNotesSettings = loadSettings({})) {
  const settings = snapshot(from)
  let before = snapshot(settings)
  return {
    settings,
    save(at: number) {
      stampChanges(before, settings, settings.syncStamps, at)
      before = snapshot(settings)
      return snapshot(settings)
    },
  }
}

const merge = (local: PlexNotesSettings, remote: PlexNotesSettings, at = T0 + 10 * DAY) => loadSettings(mergeSettings(local, remote, at))

describe('mergeSettings', () => {
  it('keeps entries a stale copy lacks (a tablet back after days offline)', () => {
    const desktop = device()
    const tablet = device()
    desktop.settings.ratingsSeen['1'] = 5
    desktop.settings.ratingsReviewed['1'] = true
    desktop.settings.keptValues['1|Genre'] = 'x'
    const fromDesktop = desktop.save(T0 + DAY)
    tablet.settings.ratingsSeen['2'] = 3
    const fromTablet = tablet.save(T0 + 2 * DAY)
    for (const merged of [merge(fromDesktop, fromTablet), merge(fromTablet, fromDesktop)]) {
      expect(merged.ratingsSeen).toEqual({ 1: 5, 2: 3 })
      expect(merged.ratingsReviewed).toEqual({ 1: true })
      expect(merged.keptValues).toEqual({ '1|Genre': 'x' })
    }
  })

  it('takes the newest value of an entry both copies have', () => {
    const desktop = device()
    desktop.settings.ratingsSeen['1'] = 4
    const old = desktop.save(T0)
    const phone = device(old)
    phone.save(T0)
    desktop.settings.ratingsSeen['1'] = 5
    const newer = desktop.save(T0 + DAY)
    expect(merge(old, newer).ratingsSeen['1']).toBe(5)
    expect(merge(newer, old).ratingsSeen['1']).toBe(5)
    // The phone changes it later still: its change wins.
    phone.settings.ratingsSeen['1'] = 2
    expect(merge(newer, phone.save(T0 + 2 * DAY)).ratingsSeen['1']).toBe(2)
  })

  it('keeps an entry removed on one device removed, unless set again since', () => {
    const desktop = device()
    desktop.settings.ignored['9'] = { title: 'Skipped', library: 'Movies' } as never
    desktop.settings.notInterested.push('note:a.md')
    const shared = desktop.save(T0)
    const tablet = device(shared)
    tablet.save(T0)
    // Undone in Remembered choices on the desktop; the tablet still has its old copy.
    delete desktop.settings.ignored['9']
    desktop.settings.notInterested = []
    const undone = desktop.save(T0 + DAY)
    for (const merged of [merge(undone, tablet.settings), merge(tablet.settings, undone)]) {
      expect(merged.ignored).toEqual({})
      expect(merged.notInterested).toEqual([])
    }
    // The tablet catches up, then skips it again later: it's back everywhere.
    const caughtUp = device(merge(tablet.settings, undone))
    caughtUp.settings.ignored['9'] = { title: 'Skipped', library: 'Movies' } as never
    expect(Object.keys(merge(undone, caughtUp.save(T0 + 2 * DAY)).ignored)).toEqual(['9'])
  })

  it('takes the most recently changed ordinary setting, else keeps its own', () => {
    const desktop = device()
    const phone = device()
    phone.settings.checkInAt = '21:00'
    const fromPhone = phone.save(T0 + DAY)
    desktop.settings.dailyRelated = 'Linked'
    const fromDesktop = desktop.save(T0 + 2 * DAY)
    for (const merged of [merge(fromPhone, fromDesktop), merge(fromDesktop, fromPhone)]) {
      expect(merged.checkInAt).toBe('21:00')
      expect(merged.dailyRelated).toBe('Linked')
    }
    // Never changed since stamps began, and different: each copy keeps its own (nothing is lost).
    const a = loadSettings({})
    const b = loadSettings({})
    b.bedtimeFrom = '23:00'
    expect(merge(a, b).bedtimeFrom).toBe(a.bedtimeFrom)
    expect(merge(b, a).bedtimeFrom).toBe('23:00')
  })

  it('never brings back a Related offer answered on another device', () => {
    const phone = device()
    const offer = { path: 'Daily/2026-11-01.md', link: '[[Heat]]', title: 'Heat', kind: 'movie' as const, viewedAt: 1 }
    phone.settings.relatedPending = [offer]
    const shared = phone.save(T0)
    const desktop = device(shared)
    desktop.save(T0)
    // Accepted on the desktop: no longer waiting, and remembered as answered.
    desktop.settings.relatedPending = []
    desktop.settings.relatedAnswered['daily/2026-11-01.md|heat'.replace('daily', 'Daily')] = T0 + DAY
    const answered = desktop.save(T0 + DAY)
    for (const merged of [merge(phone.settings, answered), merge(answered, phone.settings)]) {
      expect(merged.relatedPending).toEqual([])
      expect(Object.keys(merged.relatedAnswered)).toHaveLength(1)
    }
    // Nor does the phone's old answers backup (before 0.0.207's format).
    const settings = merge(answered, phone.settings)
    mergeAnswers(settings, { relatedPending: [offer] })
    expect(settings.relatedPending).toEqual([])
  })

  it('forgets stamps after a while', () => {
    const desktop = device()
    desktop.settings.notRewatches = ['movie:1@2026-01-01']
    const saved = desktop.save(T0)
    expect(Object.keys(mergeSettings(saved, saved, T0 + STAMPS_KEPT + DAY).syncStamps!.set)).toEqual([])
  })

  it('stamps nothing when nothing changed', () => {
    const settings = defaultSettings()
    const stamps = { set: {}, removed: {} }
    expect(stampChanges(snapshot(settings), settings, stamps, T0)).toBe(false)
    expect(stamps).toEqual({ set: {}, removed: {} })
  })

  it('never lets an empty value or an empty file replace filled settings (0.0.207 lost the server and libraries)', () => {
    const mine = loadSettings({})
    mine.serverUrl = 'http://plex'
    mine.token = 'tok'
    mine.omdbKey = 'key'
    const blank = loadSettings({})
    for (const merged of [merge(mine, blank), merge(blank, mine)]) {
      expect(merged.serverUrl).toBe('http://plex')
      expect(merged.token).toBe('tok')
      expect(merged.omdbKey).toBe('key')
    }
    expect(isSettingsData(null)).toBe(false)
    expect(isSettingsData({})).toBe(false)
    expect(isSettingsData({ serverUrl: '' })).toBe(false)
    expect(isSettingsData(mine)).toBe(true)
    // Cleared on purpose (stamped): that stays.
    const cleared = device(mine)
    cleared.settings.omdbKey = ''
    expect(merge(mine, cleared.save(T0 + DAY)).omdbKey).toBe('')
  })
})
