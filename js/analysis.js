/* Pattern detection over the journal.
 *
 * Deliberately factual: this module counts, dates, and compares. It never
 * interprets, diagnoses, or advises — that is the user's job, or the job of
 * whichever AI they paste an export into.
 */

import * as nlp from './nlp.js';
import * as T from './time.js';

/* ── Corpus index ──────────────────────────────────────────────────────── */

/**
 * Build the term index over every entry.
 *
 * The whole index is rebuilt whenever the journal changes, which is only
 * affordable because the expensive half — pulling candidate topics out of an
 * entry's text — is cached per entry. Saving a new thought then costs one
 * entry's worth of analysis, not the entire history's.
 *
 * Pass a plain Map as `cache` to keep that work between rebuilds.
 */
export function buildIndex(entries, cache = null) {
  const terms = new Map();
  const entryTerms = new Map();
  const live = cache ? new Set() : null;

  for (const entry of entries) {
    let cand;
    if (cache) {
      // Keyed on the edit time, so editing an entry re-analyses just that one.
      const key = `${entry.id}:${entry.updatedAt}`;
      live.add(key);
      cand = cache.get(key);
      if (!cand) {
        cand = nlp.candidates(entry.text);
        cache.set(key, cand);
      }
    } else {
      cand = nlp.candidates(entry.text);
    }
    entryTerms.set(entry.id, cand);
    const day = T.startOfDay(entry.createdAt);
    for (const [key, info] of cand) {
      let t = terms.get(key);
      if (!t) {
        t = {
          key,
          label: info.label,
          kind: info.kind,
          count: 0,
          df: 0,
          dayset: new Set(),
          days: [],
          first: entry.createdAt,
          last: entry.createdAt,
          entryIds: [],
        };
        terms.set(key, t);
      }
      t.count += info.count;
      t.df += 1;
      t.entryIds.push(entry.id);
      if (!t.dayset.has(day)) {
        t.dayset.add(day);
        t.days.push(day);
      }
      if (entry.createdAt < t.first) t.first = entry.createdAt;
      if (entry.createdAt > t.last) t.last = entry.createdAt;
      // Prefer the richest surface form we've seen for display.
      if (rank(info.kind) > rank(t.kind)) {
        t.kind = info.kind;
        t.label = info.label;
      }
    }
  }

  for (const t of terms.values()) t.days.sort((a, b) => a - b);

  // Drop cache entries for deleted or edited-away entries.
  if (cache) {
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);
  }

  const n = Math.max(1, entries.length);
  const tagsFor = new Map();
  for (const entry of entries) {
    const cand = entryTerms.get(entry.id);
    const scored = [];
    for (const [key, info] of cand) {
      const df = terms.get(key).df;
      // A tag is only worth showing if it organises something: a word or
      // phrase that has recurred somewhere else in the journal, a name, or a
      // #tag typed by hand. One-offs ("cleared", "started thinking") label
      // nothing and only add noise under every entry.
      if (df < 2 && info.kind !== 'tag' && info.kind !== 'entity') continue;
      // Down-weight terms that show up in most entries; always stays positive.
      const idf = Math.log(1 + n / (1 + df));
      scored.push({
        key,
        label: info.label,
        kind: info.kind,
        score: info.count * idf * nlp.kindBoost(info.kind),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    tagsFor.set(entry.id, dedupeTerms(scored).slice(0, 3));
  }

  return { n: entries.length, terms, entryTerms, tagsFor };
}

function rank(kind) {
  return { word: 0, phrase: 1, entity: 2, tag: 3 }[kind] ?? 0;
}

/**
 * Collapse terms that say the same thing, keeping the strongest.
 *
 * Two ways of being a duplicate:
 *   1. They share a word — "Project Atlas" and "atlas review" are one thread,
 *      as are "morning routine" and "routine properly".
 *   2. They keep turning up in the same entries. Six words lifted out of one
 *      recurring thread ("walk", "coffee", "six", "twenty"…) are one topic,
 *      not six, and without this they crowd everything else off the list.
 */
function dedupeTerms(list, getIds = null, overlap = 0.55) {
  const kept = [];
  const keptIds = [];
  for (const item of list) {
    if (kept.some((k) => sharesWord(k.key, item.key))) continue;
    if (getIds) {
      const ids = getIds(item);
      if (keptIds.some((other) => jaccard(ids, other) > overlap)) continue;
      keptIds.push(ids);
    }
    kept.push(item);
  }
  return kept;
}

function sharesWord(a, b) {
  if (a === b) return true;
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  return wordsA.some((w) => wordsB.includes(w));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const id of small) if (large.has(id)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/* ── Quiet threads (gap detection) ─────────────────────────────────────── */

const MIN_DAYS_TRACKED = 3;    // must have come up on at least this many days
const MIN_SPAN_DAYS = 10;      // ...spread over at least this long
const MIN_SILENCE_DAYS = 12;   // never flag anything younger than this
const MAX_SILENCE_DAYS = 240;  // stop mentioning long-abandoned topics

export function quietThreads(index, now = Date.now(), limit = 6) {
  const out = [];
  for (const t of index.terms.values()) {
    if (t.days.length < MIN_DAYS_TRACKED) continue;
    const spanDays = T.daysBetween(t.first, t.last);
    if (spanDays < MIN_SPAN_DAYS) continue;

    const daysSince = T.daysBetween(t.last, now);
    if (daysSince > MAX_SILENCE_DAYS) continue;

    const cadence = medianGap(t.days);
    const threshold = Math.max(MIN_SILENCE_DAYS, Math.round(cadence * 2.5));
    if (daysSince < threshold) continue;

    out.push({
      key: t.key,
      label: t.label,
      kind: t.kind,
      daysSince,
      cadence,
      mentions: t.count,
      dayCount: t.days.length,
      spanDays,
      first: t.first,
      last: t.last,
      ids: new Set(t.entryIds),
      // Names and phrases make far better labels than the loose words around
      // them, so they win ties for who represents a thread.
      score: (t.days.length * Math.log(1 + spanDays) * nlp.kindBoost(t.kind)) / Math.sqrt(daysSince),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return dedupeTerms(out, (t) => t.ids).slice(0, limit);
}

/** Topics that only started showing up recently. */
export function newThreads(index, now = Date.now(), windowDays = 10, limit = 4) {
  const out = [];
  for (const t of index.terms.values()) {
    if (T.daysBetween(t.first, now) > windowDays) continue;
    if (t.days.length < 2 || t.count < 2) continue;
    out.push({
      key: t.key,
      label: t.label,
      kind: t.kind,
      mentions: t.count,
      dayCount: t.days.length,
      first: t.first,
      ids: new Set(t.entryIds),
      score: (t.count + t.days.length) * nlp.kindBoost(t.kind),
    });
  }
  out.sort((a, b) => b.score - a.score);
  return dedupeTerms(out, (t) => t.ids).slice(0, limit);
}

function medianGap(days) {
  if (days.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < days.length; i += 1) {
    gaps.push(Math.round((days[i] - days[i - 1]) / T.DAY_MS));
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

/* ── Periods ───────────────────────────────────────────────────────────── */

/** Every period of the given kind that actually contains entries, newest first. */
export function periodsWithEntries(entries, kind) {
  const map = new Map();
  for (const e of entries) {
    const key = T.periodKey(kind, e.createdAt);
    const row = map.get(key) || { kind, key, count: 0, words: 0 };
    row.count += 1;
    row.words += e.words || 0;
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      ...T.periodRange(kind, row.key),
      label: T.periodLabel(kind, row.key),
      shortLabel: T.periodShortLabel(kind, row.key),
    }))
    .sort((a, b) => b.start - a.start);
}

function entriesInRange(entries, start, end) {
  return entries.filter((e) => e.createdAt >= start && e.createdAt < end);
}

/** Aggregate term counts across a slice of entries. */
function termCounts(index, slice) {
  const counts = new Map();
  for (const e of slice) {
    const cand = index.entryTerms.get(e.id);
    if (!cand) continue;
    for (const [key, info] of cand) {
      const row = counts.get(key)
        || { key, label: info.label, kind: info.kind, count: 0, entries: 0, ids: new Set() };
      row.count += info.count;
      row.entries += 1;
      row.ids.add(e.id);
      if (rank(info.kind) > rank(row.kind)) { row.kind = info.kind; row.label = info.label; }
      counts.set(key, row);
    }
  }
  return counts;
}

function rankTerms(counts, limit) {
  const list = [...counts.values()]
    .filter((r) => r.entries >= 2 || r.kind === 'tag' || r.kind === 'entity')
    .map((r) => ({ ...r, score: r.count * nlp.kindBoost(r.kind) }))
    .sort((a, b) => b.score - a.score);
  return dedupeTerms(list, (r) => r.ids).slice(0, limit);
}

/* ── Digests ───────────────────────────────────────────────────────────── */

export function buildDigest(entries, index, kind, key) {
  const { start, end } = T.periodRange(kind, key);
  const slice = entriesInRange(entries, start, end);
  const prevKey = T.previousPeriodKey(kind, key);
  const prevRange = T.periodRange(kind, prevKey);
  const prevSlice = entriesInRange(entries, prevRange.start, prevRange.end);

  const words = slice.reduce((sum, e) => sum + (e.words || 0), 0);
  const dayMap = new Map();
  for (const e of slice) {
    const d = T.startOfDay(e.createdAt);
    dayMap.set(d, (dayMap.get(d) || 0) + 1);
  }
  const daysWritten = [...dayMap.keys()].sort((a, b) => a - b);
  const periodDays = T.daysInRange(start, Math.min(end, Date.now() + T.DAY_MS));

  // Time-of-day rhythm.
  const buckets = T.BUCKETS.map((name) => ({ name, count: 0 }));
  for (const e of slice) {
    const b = buckets.find((x) => x.name === T.timeBucket(e.createdAt));
    if (b) b.count += 1;
  }

  // Topics, compared against the previous period of the same kind.
  const nowCounts = termCounts(index, slice);
  const prevCounts = termCounts(index, prevSlice);
  const topics = rankTerms(nowCounts, 8).map((t) => {
    const prev = prevCounts.get(t.key);
    const prevCount = prev ? prev.count : 0;
    let delta = 'same';
    if (!prevCount) delta = 'new';
    else if (t.count >= prevCount * 1.5) delta = 'up';
    else if (t.count * 1.5 <= prevCount) delta = 'down';
    return { ...t, prevCount, delta };
  });

  const faded = rankTerms(prevCounts, 14)
    .filter((t) => !nowCounts.has(t.key) && t.count >= 2)
    .slice(0, 5)
    .map((t) => ({ label: t.label, prevCount: t.count }));

  // Open questions: anything the user actually asked themselves.
  const questions = [];
  const askedAlready = new Set();
  for (const e of slice) {
    for (const s of nlp.sentences(e.text)) {
      if (!s.endsWith('?') || s.length <= 12) continue;
      const fingerprint = s.toLowerCase();
      if (askedAlready.has(fingerprint)) continue;
      askedAlready.add(fingerprint);
      questions.push({ text: s, ts: e.createdAt });
    }
  }

  const moments = [...slice]
    .sort((a, b) => (b.words || 0) - (a.words || 0))
    .slice(0, 3)
    .map((e) => ({ ts: e.createdAt, words: e.words || 0, text: nlp.excerpt(e.text, 200), id: e.id }));

  // Only worth naming when the day actually stood out.
  let busiestDay = null;
  for (const [ts, count] of dayMap) {
    if (count >= 2 && (!busiestDay || count > busiestDay.count)) busiestDay = { ts, count };
  }

  return {
    kind,
    key,
    label: T.periodLabel(kind, key),
    shortLabel: T.periodShortLabel(kind, key),
    start,
    end,
    stats: {
      entries: slice.length,
      words,
      daysWritten: daysWritten.length,
      periodDays,
      longestStreak: longestRun(daysWritten),
      avgWords: slice.length ? Math.round(words / slice.length) : 0,
      prevEntries: prevSlice.length,
      prevWords: prevSlice.reduce((sum, e) => sum + (e.words || 0), 0),
    },
    buckets,
    topics,
    faded,
    questions: questions.slice(0, 8),
    moments,
    busiestDay,
    quietestRun: longestSilence(daysWritten, start, Math.min(end, Date.now())),
    entryIds: slice.map((e) => e.id),
    isEmpty: slice.length === 0,
  };
}

function longestRun(sortedDays) {
  if (!sortedDays.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i += 1) {
    const gap = Math.round((sortedDays[i] - sortedDays[i - 1]) / T.DAY_MS);
    run = gap === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Longest stretch inside the period with nothing written. */
function longestSilence(sortedDays, start, end) {
  if (sortedDays.length < 2) return null;
  let best = null;
  for (let i = 1; i < sortedDays.length; i += 1) {
    const gap = Math.round((sortedDays[i] - sortedDays[i - 1]) / T.DAY_MS) - 1;
    if (gap >= 2 && (!best || gap > best.days)) {
      best = { days: gap, from: sortedDays[i - 1], to: sortedDays[i] };
    }
  }
  void start; void end;
  return best;
}

/* ── Headline numbers ──────────────────────────────────────────────────── */

export function overallStats(entries, now = Date.now()) {
  const days = new Set(entries.map((e) => T.startOfDay(e.createdAt)));
  const sorted = [...days].sort((a, b) => b - a);
  const today = T.startOfDay(now);

  let streak = 0;
  if (sorted.length) {
    let cursor = days.has(today) ? today : today - T.DAY_MS;
    if (days.has(cursor)) {
      while (days.has(cursor)) {
        streak += 1;
        cursor -= T.DAY_MS;
      }
    }
  }

  return {
    entries: entries.length,
    words: entries.reduce((sum, e) => sum + (e.words || 0), 0),
    days: days.size,
    streak,
    today: entries.filter((e) => T.startOfDay(e.createdAt) === today).length,
    first: entries.length ? entries[0].createdAt : null,
    last: entries.length ? entries[entries.length - 1].createdAt : null,
  };
}
