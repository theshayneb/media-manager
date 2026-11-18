import { it, expect } from 'vitest'
import { loadSettings, type PlexNotesSettings } from '../src/config'
import { isSettingsData, mergeSettings, sameSettings, snapshot, stampChanges } from '../src/settings-merge'

// A model of main.ts's load/reload/save, per device, with a shared "Sync" that copies files around.
type Disk = { data: unknown }
class Device {
  settings!: PlexNotesSettings
  before: PlexNotesSettings | null = null
  backup: unknown = null
  constructor(public disk: Disk, public name: string) {}
  load(now: number) {
    const data = this.disk.data
    const b = this.backup as Record<string, unknown> | null
    const disk = loadSettings(isSettingsData(data) ? data : isSettingsData(b) ? b : data)
    this.settings = b && 'syncStamps' in b ? loadSettings(mergeSettings(loadSettings(b), disk, now)) : disk
    this.before = snapshot(this.settings)
    if (isSettingsData(this.settings)) this.backup = snapshot(this.settings)
    if (isSettingsData(data) && !sameSettings(this.settings, disk)) this.write()
  }
  stamp(now: number) { if (this.before) { stampChanges(this.before, this.settings, this.settings.syncStamps, now); this.before = snapshot(this.settings) } }
  mergeDisk(now: number) {
    this.stamp(now)
    if (!isSettingsData(this.disk.data)) return isSettingsData(this.settings)
    const disk = loadSettings(this.disk.data)
    const merged = loadSettings(mergeSettings(this.settings, disk, now))
    Object.assign(this.settings, merged)
    this.before = snapshot(this.settings)
    return !sameSettings(merged, disk)
  }
  reload(now: number) { if (this.mergeDisk(now)) this.write() }
  save(now: number) { this.stamp(now); this.mergeDisk(now); this.write() }
  writes = 0
  write() { this.writes++; this.disk.data = snapshot(this.settings); this.backup = snapshot(this.settings) }
}

it('never loses the server, libraries or remembered choices, whatever Sync does (empty files, overlays, restarts)', () => {
  const full = loadSettings({})
  full.serverUrl = 'http://plex'; full.token = 'tok'
  full.libraries = { 1: { title: 'Movies', type: 'movie', target: 'movie', folder: 'M', fileNameFormat: '', matchBy: 'both', properties: [], values: {} } as never }
  full.keptValues = { a: 'x' }
  let bad = ''
  for (let seed = 1; seed < 300 && !bad; seed++) {
    let r = seed
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648 }
    const disks = [0, 1, 2].map(() => ({ data: snapshot(full) as unknown }))
    const devs = disks.map((d, i) => new Device(d, 'd' + i))
    let now = 1e12
    devs.forEach(d => d.load(now))
    const log: string[] = []
    const check = () => {
      // Sync catches up: every device gets every other's file a few times over.
      for (let round = 0; round < 3; round++) for (const x of devs) for (const y of devs) { now += 1000; x.disk.data = snapshot(y.disk.data); x.reload(now) }
      // Caught up: one more round changes nothing, so nobody writes (0.0.208 kept writing back and forth).
      const before = devs.map(x => x.writes)
      for (const x of devs) for (const y of devs) { now += 1000; x.disk.data = snapshot(y.disk.data); x.reload(now) }
      const busy = devs.filter((x, i) => x.writes !== before[i]).map(x => x.name)
      if (busy.length) bad = `seed ${seed}: still writing after catching up: ${busy.join(', ')}\n` + log.join('\n')
      for (const x of devs) if (!x.settings.serverUrl || !x.settings.libraries['1'] || !x.settings.keptValues.a) {
        bad = `seed ${seed}: ${x.name} lost ${!x.settings.serverUrl ? 'server ' : ''}${!x.settings.libraries['1'] ? 'libraries ' : ''}${!x.settings.keptValues.a ? 'kept' : ''}\n` + log.join('\n')
      }
    }
    for (let step = 0; step < 40; step++) {
      now += 60000
      const d = devs[Math.floor(rnd() * 3)]
      const op = Math.floor(rnd() * 8)
      if (op === 0) { d.settings.ratingsSeen[String(step)] = step; d.save(now); log.push(d.name + ' save') }
      else if (op === 1) { const from = devs[Math.floor(rnd() * 3)]; d.disk.data = snapshot(from.disk.data); d.reload(now); log.push(d.name + ' gets ' + from.name) }
      else if (op === 2) { d.disk.data = null; d.reload(now); log.push(d.name + ' empty file reload') }
      else if (op === 3) { d.disk.data = null; d.load(now); log.push(d.name + ' restart, empty file') }
      else if (op === 4) { d.load(now); log.push(d.name + ' restart') }
      else if (op === 7) { const from = devs[Math.floor(rnd() * 3)]; d.disk.data = { ...(from.disk.data as object), ...(d.disk.data as object) }; d.reload(now); log.push(d.name + ' overlays ' + from.name) }
      else if (op === 5) { d.disk.data = {}; d.reload(now); log.push(d.name + ' {} reload') }
      else if (op === 6) { d.settings.checkInAt = '20:0' + step % 10; d.save(now); log.push(d.name + ' change setting') }
    }
    check()
  }
  expect(bad).toBe('')
}, 120000)
