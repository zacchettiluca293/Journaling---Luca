/* The Vault: search, quiet threads, and the periodic digests. */

import * as store from './store.js';
import * as analysis from './analysis.js';
import * as T from './time.js';
import * as fmt from './format.js';
import { $, h, icon, ICONS, toast, openPanel, openSheet, closeSheet, highlight } from './ui.js';
import { openEntryActions } from './feed.js';

let digestKind = 'week';
let periodLimit = 8;
let searchQuery = '';

/* ── Shared bits ───────────────────────────────────────────────────────── */

function section(title, { note = null, action = null } = {}) {
  const wrap = h('div', { class: 'section' });
  const head = h('div', { class: 'section__head' }, h('h2', { class: 'section__title', text: title }));
  if (action) head.append(action);
  wrap.append(head);
  if (note) wrap.append(h('p', { class: 'section__note', text: note }));
  return wrap;
}

function copyButton(getText, label = 'Copy for AI') {
  return h('button', {
    type: 'button',
    class: 'iconbtn',
    'aria-label': label,
    onclick: async (event) => {
      event.stopPropagation();
      const ok = await fmt.copyText(getText());
      toast(ok ? 'Copied — paste into your AI' : 'Copy failed');
    },
  }, icon(ICONS.copy, 19));
}

function row(title, sub, onClick, { side = null, badge = null, className = '' } = {}) {
  const main = h('div', { class: 'row__main' });
  const titleNode = h('div', { class: 'row__title' });
  if (badge) titleNode.append(h('span', { class: 'badge', text: badge }));
  titleNode.append(h('span', { text: title }));
  main.append(titleNode);
  if (sub) main.append(h('div', { class: 'row__sub row__sub--wrap', text: sub }));

  return h(
    'button',
    { type: 'button', class: `row ${className}`, onclick: onClick },
    main,
    side ? h('div', { class: 'row__side', text: side }) : null,
    icon(ICONS.chev, 18),
  );
}

/** A scrollable list of entries in the full-screen panel. */
export function openEntriesPanel({ title, sub, entries, exportTitle, note = null }) {
  openPanel({
    title,
    sub,
    onCopy: async () => {
      const index = store.getIndex();
      const format = store.getSettings().copyFormat;
      const text = format === 'json'
        ? fmt.entriesJson(entries, index, { scope: exportTitle || title })
        : fmt.entriesMarkdown(entries, index, { title: exportTitle || title, note });
      const ok = await fmt.copyText(text);
      toast(ok ? `Copied ${entries.length} entries — paste into your AI` : 'Copy failed');
    },
    render: (body) => {
      if (!entries.length) {
        body.append(h('p', { class: 'hollow', text: 'Nothing here.' }));
        return;
      }
      const card = h('div', { class: 'card', style: 'margin: 12px 14px;' });
      for (const entry of entries) {
        card.append(h('button', {
          type: 'button',
          class: 'result',
          onclick: () => openEntryActions(entry.id),
        },
        h('div', { class: 'result__date', text: `${T.fmtDayLabel(entry.createdAt)} · ${T.fmtTime(entry.createdAt)} · ${entry.words} words` }),
        h('div', { class: 'result__text', text: entry.text })));
      }
      body.append(card);
    },
  });
}

/* ── Search ────────────────────────────────────────────────────────────── */

function renderSearch() {
  const holder = $('#vault-search-results');
  holder.replaceChildren();
  const results = store.search(searchQuery);
  const terms = searchQuery.trim().split(/\s+/).filter(Boolean);

  const head = section(`${results.length} result${results.length === 1 ? '' : 's'}`, {
    action: results.length
      ? copyButton(() => {
        const index = store.getIndex();
        return store.getSettings().copyFormat === 'json'
          ? fmt.entriesJson([...results].reverse(), index, { scope: `search: ${searchQuery}` })
          : fmt.entriesMarkdown([...results].reverse(), index, {
            title: `Journal — entries matching "${searchQuery}"`,
          });
      })
      : null,
  });

  if (!results.length) {
    head.append(h('p', { class: 'hollow', text: 'No entries match those words.' }));
  } else {
    const card = h('div', { class: 'card' });
    for (const entry of results.slice(0, 100)) {
      card.append(h('button', {
        type: 'button',
        class: 'result',
        onclick: () => openEntryActions(entry.id),
      },
      h('div', { class: 'result__date', text: `${T.fmtDayLabel(entry.createdAt)} · ${T.fmtTime(entry.createdAt)}` }),
      h('div', { class: 'result__text', html: highlight(entry.text, terms) })));
    }
    head.append(card);
    if (results.length > 100) {
      head.append(h('p', { class: 'hollow', text: `Showing the 100 most recent of ${results.length}.` }));
    }
  }
  holder.append(head);
}

/* ── Quick exports ─────────────────────────────────────────────────────── */

function renderQuick() {
  const entries = store.all();
  if (!entries.length) return null;

  const wrap = section('Copy for AI', {
    note: 'Clean, tidy text you can paste straight into Claude, ChatGPT or Perplexity.',
  });
  const card = h('div', { class: 'card' });

  const range = (days, label) => {
    const cutoff = T.startOfDay(Date.now()) - (days - 1) * T.DAY_MS;
    const slice = entries.filter((e) => e.createdAt >= cutoff);
    card.append(row(label, `${slice.length} entr${slice.length === 1 ? 'y' : 'ies'}`, async () => {
      if (!slice.length) { toast('Nothing written in that window'); return; }
      const index = store.getIndex();
      const text = store.getSettings().copyFormat === 'json'
        ? fmt.entriesJson(slice, index, { scope: label })
        : fmt.entriesMarkdown(slice, index, { title: `Journal — ${label.toLowerCase()}` });
      toast(await fmt.copyText(text) ? `Copied ${slice.length} entries` : 'Copy failed');
    }));
  };

  range(7, 'The last 7 days');
  range(30, 'The last 30 days');
  card.append(row('Everything', `${entries.length} entries`, async () => {
    const index = store.getIndex();
    const text = store.getSettings().copyFormat === 'json'
      ? fmt.entriesJson(entries, index, { scope: 'full journal' })
      : fmt.entriesMarkdown(entries, index, { title: 'Journal — complete export' });
    toast(await fmt.copyText(text) ? 'Copied the whole journal' : 'Copy failed');
  }));

  wrap.append(card);
  return wrap;
}

/* ── Quiet threads ─────────────────────────────────────────────────────── */

function renderQuiet() {
  const holder = $('#vault-quiet');
  holder.replaceChildren();

  const entries = store.all();
  const index = store.getIndex();
  const quiet = analysis.quietThreads(index, Date.now());
  const fresh = analysis.newThreads(index, Date.now());

  if (entries.length < 8) {
    const wrap = section('Patterns');
    wrap.append(h('p', {
      class: 'hollow',
      text: 'Once there are a couple of weeks of entries here, this is where topics that have gone quiet will show up.',
    }));
    holder.append(wrap);
    return;
  }

  if (quiet.length) {
    const wrap = section('Gone quiet', {
      note: 'Topics that used to come up regularly and haven’t lately. Counts only — read into it whatever you like.',
      action: copyButton(() => fmt.quietThreadsMarkdown(quiet)),
    });
    const card = h('div', { class: 'card' });
    for (const t of quiet) {
      const cadence = t.cadence >= 1 ? `, previously about every ${t.cadence} day${t.cadence === 1 ? '' : 's'}` : '';
      card.append(row(
        t.label,
        `Last mentioned ${T.fmtAgo(t.last)} · ${t.mentions} mentions across ${t.dayCount} days${cadence}`,
        () => openTermPanel(t.key, t.label),
        { badge: `${t.daysSince}d`, className: 'quiet-row' },
      ));
    }
    wrap.append(card);
    holder.append(wrap);
  }

  if (fresh.length) {
    const wrap = section('New lately', {
      note: 'Topics that have appeared for the first time in the last 10 days.',
    });
    const card = h('div', { class: 'card' });
    for (const t of fresh) {
      card.append(row(
        t.label,
        `First mentioned ${T.fmtAgo(t.first)} · ${t.mentions} mentions`,
        () => openTermPanel(t.key, t.label),
      ));
    }
    wrap.append(card);
    holder.append(wrap);
  }

  if (!quiet.length && !fresh.length) {
    const wrap = section('Patterns');
    wrap.append(h('p', {
      class: 'hollow',
      text: 'Nothing has dropped off lately — every recurring topic has come up recently.',
    }));
    holder.append(wrap);
  }
}

function openTermPanel(key, label) {
  const entries = store.entriesForTerm(key);
  openEntriesPanel({
    title: label,
    sub: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} mention this`,
    entries: [...entries].reverse(),
    exportTitle: `Journal — every entry mentioning "${label}"`,
  });
}

/* ── Digests ───────────────────────────────────────────────────────────── */

function renderDigests() {
  const holder = $('#vault-digests');
  holder.replaceChildren();
  const entries = store.all();
  if (!entries.length) return;

  const wrap = section('Summaries', {
    note: 'Built on this phone from your own entries — numbers, topics and dates, nothing invented.',
  });

  const seg = h('div', { class: 'segmented' });
  [['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']].forEach(([kind, label]) => {
    seg.append(h('button', {
      type: 'button',
      class: digestKind === kind ? 'is-active' : '',
      onclick: () => { digestKind = kind; periodLimit = 8; renderDigests(); },
    }, label));
  });
  wrap.append(seg);

  const periods = analysis.periodsWithEntries(entries, digestKind);
  const card = h('div', { class: 'card' });
  for (const p of periods.slice(0, periodLimit)) {
    const isCurrent = p.start <= Date.now() && Date.now() < p.end;
    card.append(row(
      digestKind === 'week' ? `${p.shortLabel} · ${p.label}` : p.label,
      `${p.count} entr${p.count === 1 ? 'y' : 'ies'} · ${p.words.toLocaleString()} words${isCurrent ? ' · in progress' : ''}`,
      () => openDigest(digestKind, p.key),
    ));
  }
  wrap.append(card);

  if (periods.length > periodLimit) {
    wrap.append(h('button', {
      type: 'button',
      class: 'btn',
      style: 'margin-top:10px;',
      onclick: () => { periodLimit += 12; renderDigests(); },
    }, `Show older (${periods.length - periodLimit} more)`));
  }

  holder.append(wrap);
}

export function openDigest(kind, key) {
  const entries = store.all();
  const index = store.getIndex();
  const digest = analysis.buildDigest(entries, index, kind, key);
  const slice = entries.filter((e) => e.createdAt >= digest.start && e.createdAt < digest.end);
  const kindWord = { week: 'Week', month: 'Month', year: 'Year' }[kind];

  openPanel({
    title: kind === 'week' ? digest.shortLabel : digest.label,
    sub: kind === 'week' ? digest.label : `${kindWord} summary`,
    onCopy: () => openDigestCopySheet(digest, slice, index),
    render: (body) => body.append(digestNode(digest, slice)),
  });
}

function openDigestCopySheet(digest, slice, index) {
  openSheet('Copy for AI', (body) => {
    body.append(h('p', {
      class: 'note',
      text: 'The summary alone is compact. Adding the entries gives an AI the raw material to work with.',
    }));
    const menu = h('div', { class: 'menu' });
    const json = store.getSettings().copyFormat === 'json';

    const copy = async (text, label) => {
      closeSheet();
      toast(await fmt.copyText(text) ? `${label} copied — paste into your AI` : 'Copy failed');
    };

    menu.append(h('button', { type: 'button', onclick: () => copy(
      json ? fmt.digestJson(digest, null, index) : fmt.digestMarkdown(digest),
      'Summary',
    ) }, icon(ICONS.copy, 20), h('span', {}, h('span', { text: 'Summary only' }), h('small', { text: 'Numbers, topics, questions' }))));

    menu.append(h('button', { type: 'button', onclick: () => copy(
      json ? fmt.digestJson(digest, slice, index) : fmt.digestMarkdown(digest, { entries: slice, index }),
      'Summary and entries',
    ) }, icon(ICONS.doc, 20), h('span', {}, h('span', { text: 'Summary + every entry' }), h('small', { text: `${slice.length} entries, ${digest.stats.words.toLocaleString()} words` }))));

    body.append(menu);
  });
}

function digestNode(digest, slice) {
  const wrap = h('div', { class: 'digest' });
  const s = digest.stats;

  if (digest.isEmpty) {
    wrap.append(h('p', { class: 'hollow', text: 'Nothing was written in this period.' }));
    return wrap;
  }

  const lead = [
    `${s.entries} ${s.entries === 1 ? 'entry' : 'entries'}`,
    `${s.words.toLocaleString()} words`,
    `written on ${s.daysWritten} of ${s.periodDays} days`,
  ].join(', ');
  wrap.append(h('p', { class: 'digest__lead', text: `${lead}.` }));

  const grid = h('div', { class: 'statgrid' });
  const stat = (n, label) => grid.append(h('div', { class: 'stat' },
    h('div', { class: 'stat__n', text: String(n) }),
    h('div', { class: 'stat__l', text: label })));
  stat(s.entries, s.entries === 1 ? 'entry' : 'entries');
  stat(s.words.toLocaleString(), 'words');
  stat(`${s.daysWritten}/${s.periodDays}`, 'days written on');
  stat(s.longestStreak, 'longest run of days');
  wrap.append(grid);

  if (s.prevEntries) {
    const diff = s.entries - s.prevEntries;
    const phrase = diff === 0
      ? `Same number of entries as the previous ${digest.kind}.`
      : `${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'entry' : 'entries'} ${diff > 0 ? 'more' : 'fewer'} than the previous ${digest.kind} (${s.prevEntries}).`;
    wrap.append(h('p', { style: 'margin-top:10px; font-size:.86rem; color:var(--muted);', text: phrase }));
  }

  // When you wrote
  const active = digest.buckets.filter((b) => b.count);
  if (active.length) {
    wrap.append(h('h3', { text: 'When you wrote' }));
    const max = Math.max(...active.map((b) => b.count));
    const bars = h('div', { class: 'bars' });
    for (const b of digest.buckets) {
      bars.append(h('div', { class: 'bar' },
        h('div', { class: 'bar__l', text: b.name }),
        h('div', { class: 'bar__t' }, h('div', { class: 'bar__f', style: `width:${b.count ? Math.max(6, (b.count / max) * 100) : 0}%` })),
        h('div', { class: 'bar__n', text: String(b.count) })));
    }
    wrap.append(bars);
  }

  // Topics
  if (digest.topics.length) {
    wrap.append(h('h3', { text: 'What came up' }));
    const list = h('ul');
    const marks = { new: 'new this period', up: 'more than last time', down: 'less than last time', same: 'steady' };
    for (const t of digest.topics) {
      list.append(h('li', {
        html: `<b>${escape(t.label)}</b> — ${t.count} mention${t.count === 1 ? '' : 's'} in ${t.entries} ${t.entries === 1 ? 'entry' : 'entries'} <span style="color:var(--muted)">(${marks[t.delta]})</span>`,
      }));
    }
    wrap.append(list);
  }

  if (digest.faded.length) {
    wrap.append(h('h3', { text: 'There before, absent here' }));
    wrap.append(h('ul', {}, ...digest.faded.map((t) => h('li', {
      html: `<b>${escape(t.label)}</b> — ${t.prevCount} mention${t.prevCount === 1 ? '' : 's'} the previous ${digest.kind}, none this one`,
    }))));
  }

  if (digest.questions.length) {
    wrap.append(h('h3', { text: 'Questions you asked yourself' }));
    for (const q of digest.questions) {
      wrap.append(h('div', { class: 'quotebox' },
        h('p', { text: q.text }),
        h('cite', { text: T.fmtShortDate(q.ts) })));
    }
  }

  if (digest.moments.length) {
    wrap.append(h('h3', { text: 'Longest entries' }));
    for (const m of digest.moments) {
      wrap.append(h('div', { class: 'quotebox' },
        h('p', { text: m.text }),
        h('cite', { text: `${T.fmtShortDate(m.ts)} · ${m.words} words` })));
    }
  }

  const extras = [];
  if (digest.busiestDay) extras.push(`Busiest day: ${T.fmtShortDate(digest.busiestDay.ts)} with ${digest.busiestDay.count} entries.`);
  if (digest.quietestRun) extras.push(`Longest gap: ${digest.quietestRun.days} days between ${T.fmtDayMonth(digest.quietestRun.from)} and ${T.fmtDayMonth(digest.quietestRun.to)}.`);
  if (extras.length) {
    wrap.append(h('h3', { text: 'Rhythm' }));
    wrap.append(h('ul', {}, ...extras.map((line) => h('li', { text: line }))));
  }

  wrap.append(h('div', { style: 'margin-top:26px;' },
    h('button', {
      type: 'button',
      class: 'btn btn--primary',
      onclick: () => openEntriesPanel({
        title: digest.kind === 'week' ? digest.shortLabel : digest.label,
        sub: `${slice.length} entries`,
        entries: [...slice].reverse(),
        exportTitle: `Journal — ${digest.label}`,
      }),
    }, `Read all ${slice.length} entries`)));

  return wrap;
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Browse by month ───────────────────────────────────────────────────── */

function renderBrowse() {
  const holder = $('#vault-browse');
  holder.replaceChildren();
  const entries = store.all();
  if (!entries.length) {
    holder.append(h('p', { class: 'hollow', text: 'Once you write something, it will be here.' }));
    return;
  }

  const months = analysis.periodsWithEntries(entries, 'month');
  const wrap = section('Browse');
  const card = h('div', { class: 'card' });
  for (const m of months.slice(0, 24)) {
    card.append(row(m.label, `${m.count} entr${m.count === 1 ? 'y' : 'ies'} · ${m.words.toLocaleString()} words`, () => {
      const slice = entries.filter((e) => e.createdAt >= m.start && e.createdAt < m.end);
      openEntriesPanel({
        title: m.label,
        sub: `${slice.length} entries`,
        entries: [...slice].reverse(),
        exportTitle: `Journal — ${m.label}`,
      });
    }));
  }
  wrap.append(card);
  holder.append(wrap);
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

export function renderVault() {
  const searching = Boolean(searchQuery.trim());
  $('#vault-search-results').hidden = !searching;
  $('#vault-default').hidden = searching;

  if (searching) {
    renderSearch();
  } else {
    renderQuiet();
    renderDigests();
    renderBrowse();
    const quick = renderQuick();
    if (quick) $('#vault-browse').append(quick);
  }

  const s = store.stats();
  $('#vault-stats').textContent = s.entries
    ? `${s.entries} entries · ${s.words.toLocaleString()} words · ${s.days} days`
    : 'Nothing saved yet';
}

export function initVault() {
  const input = $('#vault-search');
  const clear = $('#vault-search-clear');

  input.addEventListener('input', () => {
    searchQuery = input.value;
    clear.hidden = !searchQuery;
    renderVault();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    clear.hidden = true;
    renderVault();
    input.focus();
  });

  store.subscribe(() => {
    if (!$('#view-vault').hidden) renderVault();
  });
}
