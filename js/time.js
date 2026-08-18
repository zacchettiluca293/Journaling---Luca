/* Date helpers. Everything is local time — a journal entry belongs to the day
 * it felt like, not to UTC. */

export const DAY_MS = 86400000;

const LOCALE = undefined; // let the browser use the phone's own locale

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Whole calendar days between two timestamps (b later than a → positive). */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function fmtFullDate(ts) {
  return new Date(ts).toLocaleDateString(LOCALE, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDayMonth(ts) {
  return new Date(ts).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** "Today", "Yesterday", or a written-out date for the feed separators. */
export function fmtDayLabel(ts, now = Date.now()) {
  const diff = daysBetween(ts, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString(LOCALE, {
    weekday: diff < 7 ? 'long' : undefined,
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

/** "3 days ago" style phrasing, always factual. */
export function fmtAgo(ts, now = Date.now()) {
  const d = daysBetween(ts, now);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 31) return `${d} days ago`;
  const months = Math.round(d / 30.4);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(d / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function timeBucket(ts) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 22) return 'Evening';
  return 'Late night';
}

export const BUCKETS = ['Morning', 'Afternoon', 'Evening', 'Late night'];

/* ── ISO weeks ─────────────────────────────────────────────────────────── */

/** ISO-8601 week number and its week-owning year. */
export function isoWeek(ts) {
  const d = new Date(startOfDay(ts));
  // Thursday of the current week decides which year the week belongs to.
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const year = d.getFullYear();
  const jan4 = new Date(year, 0, 4);
  jan4.setDate(jan4.getDate() + 3 - ((jan4.getDay() + 6) % 7));
  const week = 1 + Math.round((d - jan4) / (7 * DAY_MS));
  return { year, week };
}

function mondayOfIsoWeek(year, week) {
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/* ── Period keys: 'week' | 'month' | 'year' ────────────────────────────── */

export function periodKey(kind, ts) {
  const d = new Date(ts);
  if (kind === 'year') return `${d.getFullYear()}`;
  if (kind === 'month') return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
  const { year, week } = isoWeek(ts);
  return `${year}-W${`${week}`.padStart(2, '0')}`;
}

export function periodRange(kind, key) {
  if (kind === 'year') {
    const y = Number(key);
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
  }
  if (kind === 'month') {
    const [y, m] = key.split('-').map(Number);
    return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
  }
  const [y, w] = key.split('-W').map(Number);
  const start = mondayOfIsoWeek(y, w).getTime();
  return { start, end: start + 7 * DAY_MS };
}

export function periodLabel(kind, key) {
  const { start, end } = periodRange(kind, key);
  if (kind === 'year') return key;
  if (kind === 'month') {
    return new Date(start).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
  }
  const last = new Date(end - DAY_MS);
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  try {
    // formatRange writes the range the way the reader's locale does it
    // ("Aug 10 – 16, 2026" / "10–16 ago 2026") rather than gluing two dates.
    return new Intl.DateTimeFormat(LOCALE, opts).formatRange(new Date(start), last);
  } catch {
    return `${new Date(start).toLocaleDateString(LOCALE, opts)} – ${last.toLocaleDateString(LOCALE, opts)}`;
  }
}

export function periodShortLabel(kind, key) {
  if (kind === 'year') return key;
  if (kind === 'month') {
    const { start } = periodRange(kind, key);
    return new Date(start).toLocaleDateString(LOCALE, { month: 'long' });
  }
  return `Week ${Number(key.split('-W')[1])}`;
}

/** The period immediately before the given one. */
export function previousPeriodKey(kind, key) {
  const { start } = periodRange(kind, key);
  return periodKey(kind, start - DAY_MS);
}

export function daysInRange(start, end) {
  return Math.max(1, Math.round((end - start) / DAY_MS));
}
