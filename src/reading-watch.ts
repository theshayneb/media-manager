// Books read on this device, for daily notes' Related property: the book reader (Omni Book Reader)
// saves the page being read in the book note's Progress property every few minutes. A page going up
// while that book is open in the reader here is reading (`readPage`), grouped into sittings, each
// offered for the daily note of the day it started. A change that came from another device through
// Sync isn't counted here unless the book is open here too: that device counts its own reading.

import { App, FileView, TFile, type CachedMetadata } from 'obsidian'
import { openBook, pageElsewhere, readPage, type BookReading } from './reading'
import type { PlexSync } from './sync'

/** The book reader's view type and the property it saves the page in. */
export const READER_VIEW = 'omni-book-reader-mod-view'
const PROGRESS = 'progress'
/** This device's own record (Obsidian's local storage, not synced). */
const STORE = 'pmn-book-reading'
/** How long a sitting whose daily note doesn't exist yet is tried again. */
const KEEP_WAITING = 7 * 86400

interface Stored {
  books: Record<string, BookReading>
  /** Sittings whose daily note wasn't there yet: the book note and when the sitting started. */
  waiting: { note: string, start: number }[]
}

export class BookReadingWatcher {
  private stored: Stored = { books: {}, waiting: [] }
  private open = new Set<string>()
  private retrying = false

  constructor(private readonly app: App, private readonly sync: () => PlexSync) {
    try {
      const saved = app.loadLocalStorage(STORE) as Partial<Stored> | null
      if (saved && typeof saved.books === 'object' && saved.books) this.stored.books = saved.books
      if (Array.isArray(saved?.waiting)) this.stored.waiting = saved.waiting.filter(w => typeof w?.note === 'string' && typeof w.start === 'number')
    } catch {
      // Starts afresh.
    }
  }

  /** A book was opened or closed somewhere in the workspace. */
  layoutChanged(): void {
    const now = Math.floor(Date.now() / 1000)
    const open = this.openBooks()
    for (const path of open) {
      if (this.open.has(path)) continue
      const file = this.app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) this.stored.books[path] = openBook(this.stored.books[path], this.progressOf(this.app.metadataCache.getFileCache(file)), now)
    }
    this.open = open
    this.save()
  }

  /** A note's properties changed: a book note's page going up while it's open here is reading. */
  async changed(file: TFile, cache: CachedMetadata): Promise<void> {
    const sync = this.sync()
    if (!sync.isBookNote(file)) return
    if (!this.open.has(file.path)) {
      this.layoutChanged()
      if (!this.open.has(file.path)) {
        // Read on another device (through Sync): only the page is kept, so it isn't counted here later.
        this.stored.books[file.path] = pageElsewhere(this.stored.books[file.path], this.progressOf(cache))
        this.save()
        return
      }
    }
    const { state, started } = readPage(this.stored.books[file.path], this.progressOf(cache), Math.floor(Date.now() / 1000))
    this.stored.books[file.path] = state
    this.save()
    if (started === null) return
    if (await sync.offerBookRead(file, started) === 'missing' && !this.stored.waiting.some(w => w.note === file.path && w.start === started)) {
      this.stored.waiting.push({ note: file.path, start: started })
      this.save()
    }
  }

  /** Sittings whose daily note wasn't there, tried again (when a note is made, and at start). */
  async retry(): Promise<void> {
    if (!this.stored.waiting.length || this.retrying) return
    this.retrying = true
    try {
      await this.retryWaiting()
    } finally {
      this.retrying = false
    }
  }

  private async retryWaiting(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const still: Stored['waiting'] = []
    for (const wait of this.stored.waiting) {
      const note = this.app.vault.getAbstractFileByPath(wait.note)
      if (!(note instanceof TFile) || now - wait.start > KEEP_WAITING) continue
      if (await this.sync().offerBookRead(note, wait.start) === 'missing') still.push(wait)
    }
    this.stored.waiting = still
    this.save()
  }

  /** A note moved: what's known about it moves too. */
  renamed(path: string, oldPath: string): void {
    const book = this.stored.books[oldPath]
    if (!book && !this.stored.waiting.some(w => w.note === oldPath)) return
    if (book) {
      this.stored.books[path] = book
      delete this.stored.books[oldPath]
    }
    for (const wait of this.stored.waiting) if (wait.note === oldPath) wait.note = path
    if (this.open.delete(oldPath)) this.open.add(path)
    this.save()
  }

  /** The book notes of the books open in the reader here (the note named like the book's file, as the reader finds it). */
  private openBooks(): Set<string> {
    const open = new Set<string>()
    for (const leaf of this.app.workspace.getLeavesOfType(READER_VIEW)) {
      const book = leaf.view instanceof FileView ? leaf.view.file : null
      if (!book) continue
      const linked = this.app.metadataCache.getFirstLinkpathDest(book.basename, book.path)
      const note = linked && linked.extension.toLowerCase() === 'md' && linked.basename === book.basename
        ? linked
        : this.app.vault.getMarkdownFiles().find(file => file.basename === book.basename)
      if (note) open.add(note.path)
    }
    return open
  }

  private progressOf(cache: CachedMetadata | null): unknown {
    const fm = cache?.frontmatter ?? {}
    const name = Object.keys(fm).find(key => key.toLowerCase() === PROGRESS)
    return name ? fm[name] : undefined
  }

  private save(): void {
    try {
      this.app.saveLocalStorage(STORE, this.stored)
    } catch {
      // Only this device's record.
    }
  }
}
