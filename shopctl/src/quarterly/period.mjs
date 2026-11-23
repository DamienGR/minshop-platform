/**
 * The period a quarterly report covers (ADR 0035): a calendar quarter in the
 * shop's own time zone, cut at the start of the follow-up when there is one.
 *
 * Pure. The dates a merchant reads are local ones — a quarter starts at
 * midnight in Paris, not in Greenwich — and every source is then asked in its
 * own terms: D1 in UTC timestamps, Search Console in calendar days, Umami in
 * milliseconds. One answer to « when does the quarter start », computed once.
 */
import { inputError, usageError } from '../errors.mjs';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const QUARTER = /^(\d{4})-[TQ]([1-4])$/i;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const pad = (value) => String(value).padStart(2, '0');

/** A calendar day, checked: `2026-02-30` is not one. */
export function parseDay(text, what = 'date') {
  const match = DAY.exec(String(text ?? '').trim());
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(Date.UTC(year, month - 1, day)) : null;
  if (!date || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw usageError(`${what} « ${text ?? ''} » n'est pas une date AAAA-MM-JJ.`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** The day after (or before) a calendar day. */
export function addDays(day, count) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + count));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The wall clock of an instant in a time zone, as numbers. */
function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
}

/** The calendar day an instant falls on, in a time zone. */
export function localDay(instant, timeZone) {
  const clock = wallClock(instant, timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/**
 * The instant a local day starts, in a time zone. Twice through the offset,
 * so that a day that starts on the other side of a change of hour (the last
 * Sunday of March or October) still starts at its own midnight.
 */
export function startOfDay(day, timeZone) {
  const [year, month, date] = day.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, date);
  const offset = (instant) => {
    const clock = wallClock(new Date(instant), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - instant;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

/** `2026-T4` out of `2026-T4` or `2026-Q4`, any case. */
export function parseQuarter(text) {
  const match = QUARTER.exec(String(text ?? '').trim());
  if (!match) throw usageError(`--quarter « ${text ?? ''} » n'est pas un trimestre.`, 'Attendu : AAAA-Tn, par exemple 2026-T4.');
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

/** The quarter a local day falls in. */
export function quarterOf(day) {
  const [year, month] = day.split('-').map(Number);
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}

/** The quarter before. */
export function previousQuarter({ year, quarter }) {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/** First day, and first day of the next quarter. */
export function quarterDays({ year, quarter }) {
  const first = `${year}-${pad(3 * (quarter - 1) + 1)}-01`;
  const next = quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(3 * quarter + 1)}-01`;
  return { first, next };
}

/** `4e trimestre 2026`. */
export function quarterLabel({ year, quarter }) {
  return `${quarter === 1 ? '1er' : `${quarter}e`} trimestre ${year}`;
}

/** `2026-T4`. */
export const quarterKey = ({ year, quarter }) => `${year}-T${quarter}`;

/** `1er octobre 2026`, `31 décembre 2026`. */
export function frenchDay(day) {
  const [year, month, date] = day.split('-').map(Number);
  return `${date === 1 ? '1er' : date} ${MONTHS[month - 1]} ${year}`;
}

/** What D1 stores in `created_at`: UTC, `AAAA-MM-JJ HH:MM:SS`. */
export function sqlTimestamp(instant) {
  return instant.toISOString().slice(0, 19).replace('T', ' ');
}

/** One quarter as every source asks for it. `to` is the last day, inclusive. */
function span(days, timeZone) {
  return {
    from: days.first,
    to: addDays(days.next, -1),
    start: startOfDay(days.first, timeZone),
    end: startOfDay(days.next, timeZone),
  };
}

/**
 * The period to report.
 *
 *   default      the quarter that ended last: what the schedule asks on the 5th
 *   quarter      a quarter that has ended, by name
 *   current      the quarter under way, up to now: a preview
 *
 * `since` is the start of the follow-up (fleet.json's `reportSince`): nothing
 * before it is reported, and a period that ends before it has nothing to say.
 * The previous quarter is the comparison, and only where it is a whole one
 * the follow-up covers: a cut quarter set against a whole one says nothing.
 *
 * @param {{ quarter?: string, current?: boolean, since?: string, now: Date, timeZone: string }} options
 */
export function resolvePeriod({ quarter = null, current = false, since = null, now, timeZone }) {
  if (quarter && current) throw usageError('--quarter et --current s\'excluent : un trimestre nommé est un trimestre terminé.');
  const today = localDay(now, timeZone);
  const sinceDay = since ? parseDay(since, '--since') : null;
  const thisQuarter = quarterOf(today);
  const chosen = current ? thisQuarter : quarter ? parseQuarter(quarter) : previousQuarter(thisQuarter);
  const days = quarterDays(chosen);
  if (!current && days.next > today) {
    throw inputError(
      `le ${quarterLabel(chosen)} n'est pas terminé (nous sommes le ${frenchDay(today)}).`,
      '--current produit l\'aperçu du trimestre en cours.',
    );
  }

  const whole = span(days, timeZone);
  const period = {
    key: quarterKey(chosen),
    label: quarterLabel(chosen),
    from: whole.from,
    to: whole.to,
    start: whole.start,
    end: whole.end,
    partial: current,
    clamped: false,
    previous: null,
  };
  if (current) {
    period.to = today;
    period.end = now;
  }
  if (sinceDay) {
    if (sinceDay > period.to) {
      throw inputError(
        `le ${period.label} se termine avant le début du suivi (${frenchDay(sinceDay)}) : rien à rapporter.`,
        'Demandez un trimestre qui suit le début du suivi, ou --current pour le trimestre en cours.',
      );
    }
    if (sinceDay > period.from) {
      period.from = sinceDay;
      period.start = startOfDay(sinceDay, timeZone);
      period.clamped = true;
    }
  }

  const before = previousQuarter(chosen);
  const beforeDays = quarterDays(before);
  if (!current && !period.clamped && (!sinceDay || sinceDay <= beforeDays.first)) {
    period.previous = { key: quarterKey(before), label: quarterLabel(before), ...span(beforeDays, timeZone) };
  }
  return period;
}

/** « du 1er octobre au 31 décembre 2026 », the year said once when it is the same. */
export function periodSentence(period) {
  const [fromYear] = period.from.split('-');
  const [toYear] = period.to.split('-');
  const from = frenchDay(period.from);
  return `du ${fromYear === toYear ? from.replace(` ${fromYear}`, '') : from} au ${frenchDay(period.to)}`;
}
