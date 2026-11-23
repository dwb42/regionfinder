const timeZone = 'Europe/Berlin'

export function berlinDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Convert a Berlin wall-clock timestamp, preserving timestamps with an explicit offset. */
export function berlinDateTime(value: string): string {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value
  const wallClockMs = Date.parse(`${value}Z`)
  let instantMs = wallClockMs
  let offset = '+01:00'
  for (let i = 0; i < 3; i++) {
    offset = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(instantMs)).find((part) => part.type === 'timeZoneName')!.value.replace('GMT', '')
    const offsetMinutes = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) * (offset[0] === '-' ? -1 : 1)
    const next = wallClockMs - offsetMinutes * 60_000
    if (next === instantMs) break
    instantMs = next
  }
  return `${value}${offset}`
}
