export function parseClockTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 29 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Invalid clock time: ${value}`)
  }

  return hours * 60 + minutes
}

export function formatClockTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`
}
