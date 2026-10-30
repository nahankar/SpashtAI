import { Prisma } from '@prisma/client'

/** Calendar days for Admin analytics. Every daily figure uses one explicitly displayed time zone. */
export const REPORT_TIMEZONE = 'Asia/Kolkata'

function localDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

function offsetMs(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant).map(p => [p.type, p.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The instant a calendar day starts in the time zone. */
export function zonedMidnight(day: string, timeZone: string) {
  const guess = Date.parse(`${day}T00:00:00Z`)
  return new Date(guess - offsetMs(new Date(guess - offsetMs(new Date(guess), timeZone)), timeZone))
}

/** Whole calendar days in the time zone: the last `days` days including today, from local midnight to now. */
export function dayRange(days: number, timeZone = REPORT_TIMEZONE, now = new Date()) {
  const lastDay = localDate(now, timeZone)
  const first = new Date(Date.parse(`${lastDay}T12:00:00Z`) - (days - 1) * 86_400_000)
  const firstDay = first.toISOString().slice(0, 10)
  const list: string[] = []
  for (let i = 0; i < days; i++) list.push(new Date(Date.parse(`${firstDay}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
  return { timeZone, firstDay, lastDay, days: list, since: zonedMidnight(firstDay, timeZone), until: now }
}
export type DayRange = ReturnType<typeof dayRange>

export function presentRange(days: number, range: DayRange) {
  return { days, timeZone: range.timeZone, firstDay: range.firstDay, lastDay: range.lastDay,
    since: range.since.toISOString(), until: range.until.toISOString() }
}

/** SQL for the local calendar day of a stored UTC timestamp column. */
export function localDaySql(column: Prisma.Sql, timeZone: string) {
  return Prisma.sql`to_char(timezone(${timeZone}, ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`
}
