// Song tags: a song note's tags against its music file's own tag of tags (Music Manager's
// "Obsidian Tags", one value per tag). No Obsidian imports, so it can be unit tested.

/** "#Feminism " → "Feminism"; spaces inside become hyphens (Obsidian tags have none), as Music Manager does. */
export function cleanTag(value: string): string {
  return value.trim().replace(/^#+/, '').trim().split(/\s+/).filter(Boolean).join('-')
}

/** A tag's values from a music file as tags: each value, also split at ";" or ",", cleaned, each once. */
export function fileTagList(values: unknown): string[] {
  const raw = Array.isArray(values) ? values.map(String) : typeof values === 'string' ? [values] : []
  const out: string[] = []
  for (const tag of raw.flatMap(v => v.split(/[;,]/)).map(cleanTag).filter(Boolean)) {
    if (!out.some(t => t.toLowerCase() === tag.toLowerCase())) out.push(tag)
  }
  return out
}

/** A note's tags property as a list of tags ("#" and spaces as Obsidian keeps them). */
export function noteTagList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,\s]+/) : []
  return raw.map(cleanTag).filter(Boolean)
}

/**
 * How a song note's tags and its music file's differ, any case: `toNote` are in the file but not the
 * note, `toFile` in the note but not the file. Type tags (music, song…) are never compared.
 */
export function songTagDiff(noteTags: unknown, fileTags: string[], typeTags: Set<string>): { toNote: string[], toFile: string[] } {
  const note = noteTagList(noteTags)
  const has = (list: string[], tag: string) => list.some(t => t.toLowerCase() === tag.toLowerCase())
  return {
    toNote: fileTags.filter(tag => !typeTags.has(tag.toLowerCase()) && !has(note, tag)),
    toFile: note.filter(tag => !typeTags.has(tag.toLowerCase()) && !has(fileTags, tag)),
  }
}

/** Two lists together, each value once (any case), the first's order kept. */
export function unionTags(a: unknown, b: unknown): string[] {
  const out: string[] = []
  const items = (v: unknown): unknown[] => Array.isArray(v) ? (v as unknown[]) : v ? [v] : []
  for (const v of [...items(a), ...items(b)].map(x => typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '')) {
    if (v.trim() && !out.some(t => t.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return out
}

/** Whether a property row is a song's tags from its music file (a "tags" property whose source is a tag in the file). */
export function isSongTagsRow(m: { name: string, source: string, text?: string }): boolean {
  return m.source === 'fileTag' && m.name.trim().toLowerCase() === 'tags' && Boolean(m.text?.trim())
}

/** Whether a property row is a song's notes from its music file (Music Manager's "Obsidian Notes" tag). */
export function isSongNotesRow(m: { name: string, source: string, text?: string }): boolean {
  return m.source === 'fileTag' && Boolean(m.name.trim()) && (m.text ?? '').trim().replace(/^TXXX[/:]/i, '').toLowerCase() === 'obsidian notes'
}

const plainLines = (text: string): string => text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim()

/** A music file's notes as one text: its values on lines of their own, line endings made plain; '' for none. */
export function fileNotesText(values: unknown): string {
  const raw = Array.isArray(values) ? values.map(String) : typeof values === 'string' || typeof values === 'number' ? [String(values)] : []
  return plainLines(raw.map(plainLines).filter(Boolean).join('\n'))
}

/**
 * A note's Notes with the music file's text added at the end, on a new line, or null when there's
 * nothing to add: the file has no text, or Notes already holds it (line endings and spaces at line
 * ends aside). Nothing in Notes is ever taken away or changed. A list keeps being a list.
 */
export function withFileNotes(current: unknown, fileText: string): string | string[] | null {
  const text = plainLines(fileText)
  if (!text) return null
  const asText = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''
  const items = Array.isArray(current) ? current.map(asText) : [asText(current)].filter(Boolean)
  const now = plainLines(items.join('\n'))
  if (now.includes(text)) return null
  if (Array.isArray(current)) return [...items, text]
  const before = items.join('\n').replace(/\s+$/, '')
  return before ? `${before}\n${text}` : text
}
