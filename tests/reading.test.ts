import { describe, expect, it } from 'vitest'
import { openBook, pageElsewhere, pageOf, readPage, SITTING_GAP } from '../src/reading'

const at = (h: number, m: number, day = 1) => Date.UTC(2026, 10, day, h, m) / 1000

describe('pageOf', () => {
  it('reads page numbers only', () => {
    expect(pageOf(14)).toBe(14)
    expect(pageOf(' 14 ')).toBe(14)
    expect(pageOf('xii')).toBeNull()
    expect(pageOf(undefined)).toBeNull()
  })
})

describe('readPage', () => {
  it('counts nothing for the first page seen, paging back or a label', () => {
    let r = readPage(undefined, 10, at(20, 0))
    expect(r.started).toBeNull()
    expect(r.state.page).toBe(10)
    r = readPage(r.state, 8, at(20, 5))
    expect(r.started).toBeNull()
    expect(r.state.page).toBe(8)
    r = readPage(r.state, 'xii', at(20, 6))
    expect(r.started).toBeNull()
    expect(r.state.page).toBe(8)
  })

  it('keeps a sitting going past midnight on the day it started', () => {
    let r = readPage(openBook(undefined, 50, at(23, 0)), 52, at(23, 3))
    for (const [page, time] of [[55, at(23, 30)], [58, at(23, 57)], [60, at(0, 3, 2)]] as const) {
      r = readPage(r.state, page, time)
      expect(r.started).toBe(at(23, 0))
    }
  })

  it('starts a new sitting after a break', () => {
    let r = readPage(openBook(undefined, 50, at(23, 0)), 52, at(23, 3))
    r = readPage(r.state, 53, at(23, 3) + SITTING_GAP + 60)
    expect(r.started).toBe(at(23, 3) + SITTING_GAP + 60)
  })

  it('starts at the opening only when it was recent', () => {
    expect(readPage(openBook(undefined, 1, at(9, 0)), 2, at(9, 3)).started).toBe(at(9, 0))
    expect(readPage(openBook(undefined, 1, at(9, 0)), 2, at(11, 0)).started).toBe(at(11, 0))
  })

  it('takes in pages read on another device without counting them', () => {
    let state = pageElsewhere(undefined, 40)
    state = pageElsewhere(state, 'xii')
    expect(state.page).toBe(40)
    state = openBook(pageElsewhere(state, 90), 90, at(8, 0))
    expect(readPage(state, 90, at(8, 3)).started).toBeNull()
    expect(readPage(state, 91, at(8, 3)).started).toBe(at(8, 0))
  })
})
