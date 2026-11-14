// FLAC files' tags (Vorbis comments), read into the same shape as an MP3's ID3 tags, so a sync
// treats both alike. Only read, never written. No Obsidian imports, so it can be unit tested.
import type { FileTags } from './id3'

/** Vorbis comment names that stand for a standard ID3 frame. */
const STANDARD: Record<string, string> = {
  title: 'TIT2', artist: 'TPE1', albumartist: 'TPE2', album: 'TALB', genre: 'TCON', date: 'TDRC',
  tracknumber: 'TRCK', bpm: 'TBPM', composer: 'TCOM', lyrics: 'USLT', unsyncedlyrics: 'USLT', comment: 'COMM',
}

/** Whether a file's first bytes are a FLAC file's. */
export function isFlac(start: Uint8Array): boolean {
  return start.length >= 4 && String.fromCharCode(...start.subarray(0, 4)) === 'fLaC'
}

/**
 * A FLAC metadata block's header (4 bytes): whether it's the last block, its type (4 is the Vorbis
 * comments) and how many bytes follow.
 */
export function flacBlock(header: Uint8Array): { last: boolean, type: number, size: number } {
  return { last: (header[0] & 0x80) !== 0, type: header[0] & 0x7f, size: (header[1] << 16) | (header[2] << 8) | header[3] }
}

/**
 * The Vorbis comments block's tags: each "NAME=value" as your own tag `TXXX:<name>` (any case, as
 * ID3's are kept), and the usual ones (GENRE, LYRICS…) as their ID3 frame too. A name given more than
 * once has several values. Line endings are made plain.
 */
export function readVorbisComments(data: Uint8Array): FileTags {
  const tags: FileTags = {}
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const utf8 = new TextDecoder('utf-8')
  let at = 0
  const u32 = (): number | null => {
    if (at + 4 > data.length) return null
    const n = view.getUint32(at, true)
    at += 4
    return n
  }
  const vendor = u32()
  if (vendor === null) return tags
  at += vendor
  const count = u32() ?? 0
  for (let i = 0; i < count; i++) {
    const length = u32()
    if (length === null || at + length > data.length) break
    const text = utf8.decode(data.subarray(at, at + length))
    at += length
    const eq = text.indexOf('=')
    if (eq <= 0) continue
    const name = text.slice(0, eq).trim().toLowerCase()
    const value = text.slice(eq + 1).replace(/\r\n?/g, '\n')
    if (!value) continue
    for (const key of [`TXXX:${name}`, STANDARD[name.replace(/[\s_]/g, '')]].filter(Boolean)) tags[key] = [...tags[key] ?? [], value]
  }
  return tags
}
