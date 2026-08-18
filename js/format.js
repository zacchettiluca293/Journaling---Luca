/* Turning entries into clean text: Markdown and JSON for pasting into an AI,
 * plus backup files. */

import * as T from './time.js';
import * as nlp from './nlp.js';

const AI_FOOTER = [
  '## How to use this',
  '',
  "I'd like to think out loud about what's above. Please stick to what is actually written:",
  'recap the facts, point out connections between entries, and ask me questions where',
  "context is missing. Don't assume anything I haven't said, and don't give advice unless I ask for it.",
].join('\n');

function num(n) {
  return Number(n || 0).toLocaleString();
}

function tagLine(tags) {
  if (!tags || !tags.length) return '';
  return tags.map((t) => t.label).join(', ');
}

/* ── Markdown ──────────────────────────────────────────────────────────── */

export function entryMarkdown(entry, tags, { withFooter = true } = {}) {
  const lines = [];
  lines.push(`# Journal entry — ${T.fmtFullDate(entry.createdAt)}, ${T.fmtTime(entry.createdAt)}`);
  const meta = [
    `${num(entry.words)} words`,
    `~${nlp.readingMinutes(entry.words)} min read`,
    T.timeBucket(entry.createdAt).toLowerCase(),
  ];
  const t = tagLine(tags);
  if (t) meta.push(`topics: ${t}`);
  lines.push(`*${meta.join(' · ')}*`, '', entry.text.trim());
  if (withFooter) lines.push('', '---', '', AI_FOOTER);
  return lines.join('\n');
}

/**
 * A set of entries, grouped by day. Used for "copy this month", search
 * results, and the full-journal export.
 */
export function entriesMarkdown(entries, index, { title, note, withFooter = true } = {}) {
  const lines = [];
  const words = entries.reduce((sum, e) => sum + (e.words || 0), 0);
  const days = new Set(entries.map((e) => T.dayKey(e.createdAt)));

  lines.push(`# ${title || 'Journal export'}`);
  lines.push('');
  lines.push(`*${num(entries.length)} entries · ${num(words)} words · ${days.size} day${days.size === 1 ? '' : 's'}*`);
  if (note) lines.push('', note);
  lines.push('');

  let currentDay = null;
  for (const entry of entries) {
    const day = T.dayKey(entry.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      lines.push('', `## ${T.fmtFullDate(entry.createdAt)}`, '');
    }
    const tags = index ? tagLine(index.tagsFor.get(entry.id)) : '';
    lines.push(`**${T.fmtTime(entry.createdAt)}** — ${T.timeBucket(entry.createdAt).toLowerCase()}${tags ? ` · ${tags}` : ''}`);
    lines.push('');
    lines.push(entry.text.trim());
    lines.push('');
  }

  if (withFooter) lines.push('---', '', AI_FOOTER);
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

const KIND_WORD = { week: 'Weekly', month: 'Monthly', year: 'Yearly' };

export function digestMarkdown(digest, { entries = null, index = null } = {}) {
  const s = digest.stats;
  const lines = [];

  lines.push(`# ${KIND_WORD[digest.kind]} digest — ${digest.label}`);
  lines.push('');
  lines.push('*Generated on this device from the entries below. Counts only — nothing here is interpretation.*');
  lines.push('');

  lines.push('## The numbers');
  lines.push('');
  lines.push(`- ${num(s.entries)} entries, ${num(s.words)} words`);
  lines.push(`- Wrote on ${s.daysWritten} of ${s.periodDays} days (longest run: ${s.longestStreak} day${s.longestStreak === 1 ? '' : 's'})`);
  lines.push(`- Average entry: ${num(s.avgWords)} words`);
  if (s.prevEntries) {
    const diff = s.entries - s.prevEntries;
    const dir = diff === 0 ? 'the same as' : `${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)} from`;
    lines.push(`- Previous period: ${num(s.prevEntries)} entries (${dir} then)`);
  }
  if (digest.busiestDay) {
    lines.push(`- Busiest day: ${T.fmtShortDate(digest.busiestDay.ts)} (${digest.busiestDay.count} entries)`);
  }
  if (digest.moments.length) {
    lines.push(`- Longest entry: ${num(digest.moments[0].words)} words on ${T.fmtShortDate(digest.moments[0].ts)}`);
  }
  if (digest.quietestRun) {
    lines.push(`- Longest silence: ${digest.quietestRun.days} days (${T.fmtDayMonth(digest.quietestRun.from)} → ${T.fmtDayMonth(digest.quietestRun.to)})`);
  }
  lines.push('');

  const active = digest.buckets.filter((b) => b.count);
  if (active.length) {
    lines.push('## When you wrote');
    lines.push('');
    active.forEach((b) => lines.push(`- ${b.name}: ${b.count}`));
    lines.push('');
  }

  if (digest.topics.length) {
    lines.push('## What came up');
    lines.push('');
    digest.topics.forEach((t) => {
      const marks = { new: 'new this period', up: 'more than last period', down: 'less than last period', same: 'steady' };
      lines.push(`- **${t.label}** — ${t.count} mention${t.count === 1 ? '' : 's'} across ${t.entries} entr${t.entries === 1 ? 'y' : 'ies'} (${marks[t.delta]})`);
    });
    lines.push('');
  }

  if (digest.faded.length) {
    lines.push('## Present last period, absent this one');
    lines.push('');
    digest.faded.forEach((t) => lines.push(`- ${t.label} (${t.prevCount} mentions before)`));
    lines.push('');
  }

  if (digest.questions.length) {
    lines.push('## Questions you asked yourself');
    lines.push('');
    digest.questions.forEach((q) => lines.push(`- "${q.text}" — ${T.fmtDayMonth(q.ts)}`));
    lines.push('');
  }

  if (digest.moments.length) {
    lines.push('## Longest entries');
    lines.push('');
    digest.moments.forEach((m) => {
      lines.push(`- **${T.fmtDayMonth(m.ts)}** (${num(m.words)} words): ${m.text}`);
    });
    lines.push('');
  }

  if (entries && entries.length) {
    lines.push('---');
    lines.push('');
    lines.push('# Full entries for this period');
    lines.push('');
    let currentDay = null;
    for (const entry of entries) {
      const day = T.dayKey(entry.createdAt);
      if (day !== currentDay) {
        currentDay = day;
        lines.push(`## ${T.fmtFullDate(entry.createdAt)}`, '');
      }
      const tags = index ? tagLine(index.tagsFor.get(entry.id)) : '';
      lines.push(`**${T.fmtTime(entry.createdAt)}**${tags ? ` · ${tags}` : ''}`, '', entry.text.trim(), '');
    }
  }

  lines.push('---', '', AI_FOOTER);
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

export function quietThreadsMarkdown(threads, now = Date.now()) {
  const lines = ['# Threads that have gone quiet', ''];
  lines.push('*Topics that used to appear regularly in my journal and have not come up lately. Counts only — no interpretation.*', '');
  threads.forEach((t) => {
    lines.push(`- **${t.label}** — last mentioned ${T.fmtAgo(t.last, now)} (${T.fmtShortDate(t.last)}). ${t.mentions} mentions across ${t.dayCount} days${t.cadence ? `, previously about every ${t.cadence} day${t.cadence === 1 ? '' : 's'}` : ''}.`);
  });
  lines.push('', '---', '', AI_FOOTER);
  return lines.join('\n');
}

/* ── JSON ──────────────────────────────────────────────────────────────── */

function entryJsonShape(entry, tags) {
  return {
    id: entry.id,
    createdAt: new Date(entry.createdAt).toISOString(),
    localDate: T.dayKey(entry.createdAt),
    localTime: T.fmtTime(entry.createdAt),
    dayOfWeek: new Date(entry.createdAt).toLocaleDateString(undefined, { weekday: 'long' }),
    timeOfDay: T.timeBucket(entry.createdAt),
    words: entry.words || 0,
    readingMinutes: nlp.readingMinutes(entry.words || 0),
    source: entry.source || 'type',
    topics: (tags || []).map((t) => t.label),
    text: entry.text,
  };
}

export function entriesJson(entries, index, meta = {}) {
  return JSON.stringify({
    kind: 'journal-export',
    version: 1,
    generatedAt: new Date().toISOString(),
    ...meta,
    entryCount: entries.length,
    wordCount: entries.reduce((sum, e) => sum + (e.words || 0), 0),
    entries: entries.map((e) => entryJsonShape(e, index && index.tagsFor.get(e.id))),
  }, null, 2);
}

export function digestJson(digest, entries, index) {
  return JSON.stringify({
    kind: 'journal-digest',
    version: 1,
    generatedAt: new Date().toISOString(),
    period: { kind: digest.kind, key: digest.key, label: digest.label,
              start: new Date(digest.start).toISOString(), end: new Date(digest.end).toISOString() },
    stats: digest.stats,
    writingTimes: digest.buckets,
    topics: digest.topics.map((t) => ({ topic: t.label, mentions: t.count, entries: t.entries, previousPeriodMentions: t.prevCount, change: t.delta })),
    absentSincePreviousPeriod: digest.faded.map((t) => ({ topic: t.label, previousPeriodMentions: t.prevCount })),
    questionsAsked: digest.questions.map((q) => ({ question: q.text, date: T.dayKey(q.ts) })),
    entries: entries ? entries.map((e) => entryJsonShape(e, index && index.tagsFor.get(e.id))) : undefined,
  }, null, 2);
}

export function backupJson(entries, meta = {}) {
  return JSON.stringify({
    kind: 'journal-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...meta,
    entries,
  }, null, 2);
}

/* ── Getting text out of the app ───────────────────────────────────────── */

/** Copy to the clipboard, with a fallback for older WebKit. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Hand a file to the user. On iPhone the share sheet is the natural route
 * ("Save to Files"); elsewhere a normal download link works.
 */
export async function saveFile(filename, text, mime = 'application/json') {
  const file = new File([text], filename, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
