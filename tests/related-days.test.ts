import { describe, expect, it, vi } from 'vitest'

const { TFile } = vi.hoisted(() => {
  class TFile {
    constructor(public path: string) {}
    get basename(): string { return this.path.split('/').pop()!.replace(/\.[^.]+$/, '') }
  }
  return { TFile }
})

vi.mock('obsidian', async () => {
  const moment = (await import('moment')).default
  class Unused {}
  return {
    TFile, TFolder: Unused, Notice: Unused, Modal: Unused, FuzzySuggestModal: Unused, AbstractInputSuggest: Unused,
    PluginSettingTab: Unused, Setting: Unused, Platform: { isDesktopApp: false }, moment, requestUrl: vi.fn(),
    normalizePath: (p: string) => p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
  }
})
vi.mock('../src/music-files', () => ({ readFileTags: vi.fn(() => null), lyricsOf: () => null, writeOwnTag: vi.fn(() => null) }))
vi.mock('../src/steam-local', () => ({ readSteamCollections: vi.fn(() => null) }))

import { PlexSync } from '../src/sync'
import { defaultSettings } from '../src/config'

function appWith(notes: Record<string, { key: string, link: string }[]>) {
  const files = Object.keys(notes).map(p => new TFile(p))
  return {
    vault: { getMarkdownFiles: () => files, getAbstractFileByPath: (p: string) => files.find(f => f.path === p) ?? null },
    metadataCache: {
      getFileCache: (f: { path: string }) => ({ frontmatterLinks: notes[f.path] }),
      getFirstLinkpathDest: (link: string) => ({ path: `Media/${link}.md` }),
    },
  }
}

describe('relatedDays', () => {
  const settings = (extra: object) => ({ ...defaultSettings(), ...extra })

  it('reads daily notes whose format has folders in it', () => {
    const app = appWith({
      'Journal/2026/11/2026-11-03.md': [{ key: 'Related.0', link: 'Wand & Order' }],
      'Journal/2026/11/2026-11-05.md': [{ key: 'related.1', link: 'The Book of Elsewhere|Elsewhere' }],
      'Media/Wand & Order.md': [],
    })
    const sync = new PlexSync(app as never, settings({ dailyFolder: 'Journal', dailyFormat: 'YYYY/MM/YYYY-MM-DD' }), async () => {})
    expect(sync.relatedDays()).toEqual([
      { day: '2026-11-03', path: 'Media/Wand & Order.md' },
      { day: '2026-11-05', path: 'Media/The Book of Elsewhere.md' },
    ])
  })

  it('still reads plain dated names in the folder', () => {
    const app = appWith({ 'Daily/2026-11-03.md': [{ key: 'Related', link: 'Wand & Order' }] })
    const sync = new PlexSync(app as never, settings({ dailyFolder: 'Daily', dailyFormat: 'YYYY-MM-DD' }), async () => {})
    expect(sync.relatedDays()).toEqual([{ day: '2026-11-03', path: 'Media/Wand & Order.md' }])
    expect(sync.dailyNoteFiles()).toHaveLength(1)
  })
})
