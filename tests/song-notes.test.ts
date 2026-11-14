import { describe, expect, it } from 'vitest'
import { fileNotesText, isSongNotesRow, withFileNotes } from '../src/song-tags'
import { buildFrontmatter } from '../src/properties'
import { flacBlock, isFlac, readVorbisComments } from '../src/flac'

describe('song notes from music files', () => {
  it('knows a Notes row reading Obsidian Notes', () => {
    expect(isSongNotesRow({ name: 'Notes', source: 'fileTag', text: 'TXXX/Obsidian Notes' })).toBe(true)
    expect(isSongNotesRow({ name: 'Notes', source: 'fileTag', text: 'Obsidian Tags' })).toBe(false)
    expect(isSongNotesRow({ name: 'Notes', source: 'text', text: 'Obsidian Notes' })).toBe(false)
  })

  it('reads the file\'s text with its line breaks', () => {
    expect(fileNotesText(['First line\r\nSecond line  \r\n'])).toBe('First line\nSecond line')
    expect(fileNotesText(undefined)).toBe('')
    expect(fileNotesText(['  '])).toBe('')
  })

  it('adds the text at the end, on a new line, only when Notes lacks it', () => {
    expect(withFileNotes(undefined, 'From the file')).toBe('From the file')
    expect(withFileNotes('', 'From the file')).toBe('From the file')
    expect(withFileNotes('Mine.\n', 'From the file\nTwo')).toBe('Mine.\nFrom the file\nTwo')
    expect(withFileNotes('Mine.\r\nFrom the file  \r\nTwo\nMore of mine.', 'From the file\nTwo')).toBeNull()
    expect(withFileNotes('Mine.', '')).toBeNull()
    expect(withFileNotes(['Mine.'], 'From the file')).toEqual(['Mine.', 'From the file'])
  })

  it('gives a new song note the file\'s notes', () => {
    const item = { ratingKey: '1', title: 'Song', type: 'track', fileTags: { 'TXXX:obsidian notes': ['One\nTwo'] } }
    const ctx = { kind: 'music' as const, link: '', image: null, values: { tag: 'song' } }
    expect(buildFrontmatter(item as never, [{ name: 'Notes', source: 'fileTag', text: 'Obsidian Notes' }], ctx as never)).toEqual({ Notes: 'One\nTwo' })
    expect(buildFrontmatter({ ...item, fileTags: {} } as never, [{ name: 'Notes', source: 'fileTag', text: 'Obsidian Notes' }], ctx as never)).toEqual({ Notes: null })
  })
})

describe('FLAC tags', () => {
  const comments = (entries: string[]): Uint8Array => {
    const enc = new TextEncoder()
    const parts: number[] = []
    const u32 = (n: number) => parts.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff)
    const vendor = enc.encode('reference libFLAC')
    u32(vendor.length); parts.push(...vendor)
    u32(entries.length)
    for (const e of entries) { const b = enc.encode(e); u32(b.length); parts.push(...b) }
    return Uint8Array.from(parts)
  }

  it('reads Vorbis comments like ID3 tags', () => {
    const tags = readVorbisComments(comments(['OBSIDIAN NOTES=Line one\r\nLine two', 'OBSIDIAN TAGS=comfort', 'OBSIDIAN TAGS=holiday', 'GENRE=Rock', 'LYRICS=La la']))
    expect(tags['TXXX:obsidian notes']).toEqual(['Line one\nLine two'])
    expect(tags['TXXX:obsidian tags']).toEqual(['comfort', 'holiday'])
    expect(tags.TCON).toEqual(['Rock'])
    expect(tags.USLT).toEqual(['La la'])
  })

  it('reads a FLAC file\'s start and block headers', () => {
    expect(isFlac(Uint8Array.from([0x66, 0x4c, 0x61, 0x43]))).toBe(true)
    expect(isFlac(Uint8Array.from([0x49, 0x44, 0x33, 3]))).toBe(false)
    expect(flacBlock(Uint8Array.from([0x84, 0, 1, 2]))).toEqual({ last: true, type: 4, size: 258 })
  })
})
