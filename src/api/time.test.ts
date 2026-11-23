import { describe, expect, it } from 'vitest'
import { berlinDate, berlinDateTime } from './time'

describe('Berlin time', () => {
  it('uses the current Berlin calendar date across UTC midnight', () => {
    expect(berlinDate(new Date('2026-11-22T23:30:00Z'))).toBe('2026-11-23')
  })
  it('handles summer and winter time and the DST transition', () => {
    expect(berlinDateTime('2026-09-15T08:00:00')).toBe('2026-09-15T08:00:00+02:00')
    expect(berlinDateTime('2026-11-23T08:00:00')).toBe('2026-11-23T08:00:00+01:00')
    expect(berlinDateTime('2026-03-29T01:30:00')).toBe('2026-03-29T01:30:00+01:00')
    expect(berlinDateTime('2026-03-29T03:30:00')).toBe('2026-03-29T03:30:00+02:00')
  })
  it('preserves explicit offsets', () => {
    expect(berlinDateTime('2026-11-23T08:00:00Z')).toBe('2026-11-23T08:00:00Z')
    expect(berlinDateTime('2026-11-23T08:00:00+01:00')).toBe('2026-11-23T08:00:00+01:00')
  })
})
