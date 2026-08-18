/* In-memory state on top of the database, plus a tiny subscribe/notify loop.
 * Everything the views read comes from here. */

import * as db from './db.js';
import * as nlp from './nlp.js';
import * as analysis from './analysis.js';

const DEFAULT_SETTINGS = {
  theme: 'auto',            // 'auto' | 'light' | 'dark'
  micMode: 'keyboard',      // 'keyboard' (phone dictation) | 'inapp' (Web Speech)
  speechLang: '',           // '' = follow the phone's language
  autoLockMinutes: 1,       // minutes in the background before re-locking; -1 = never
  copyFormat: 'markdown',   // 'markdown' | 'json'
  seenMicHint: false,
};

let entries = [];           // always sorted oldest → newest
let settings = { ...DEFAULT_SETTINGS };
let cachedIndex = null;
// Per-entry topic analysis, kept across index rebuilds. See analysis.buildIndex.
const candidateCache = new Map();
const listeners = new Set();

function newId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sortEntries() {
  entries.sort((a, b) => a.createdAt - b.createdAt);
}

function invalidate() {
  cachedIndex = null;
}

function notify() {
  listeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error(err); }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── Loading ───────────────────────────────────────────────────────────── */

export async function load() {
  await db.init();
  entries = (await db.allEntries()).map(normalizeEntry);
  sortEntries();
  const saved = await db.getMeta('settings', null);
  settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  invalidate();
  return entries;
}

function normalizeEntry(raw) {
  return {
    id: raw.id,
    text: raw.text || '',
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    words: typeof raw.words === 'number' ? raw.words : nlp.countWords(raw.text || ''),
    source: raw.source === 'voice' ? 'voice' : 'type',
  };
}

/* ── Reading ───────────────────────────────────────────────────────────── */

export function all() {
  return entries;
}

export function allDesc() {
  return [...entries].reverse();
}

export function get(id) {
  return entries.find((e) => e.id === id) || null;
}

export function getIndex() {
  if (!cachedIndex) cachedIndex = analysis.buildIndex(entries, candidateCache);
  return cachedIndex;
}

export function tagsFor(id) {
  return getIndex().tagsFor.get(id) || [];
}

export function stats(now = Date.now()) {
  return analysis.overallStats(entries, now);
}

/* ── Writing ───────────────────────────────────────────────────────────── */

export async function add(text, source = 'type', createdAt = Date.now()) {
  const clean = text.trim();
  if (!clean) return null;
  const entry = {
    id: newId(),
    text: clean,
    createdAt,
    updatedAt: createdAt,
    words: nlp.countWords(clean),
    source,
  };
  entries.push(entry);
  sortEntries();
  invalidate();
  notify();
  await db.putEntry(entry);
  return entry;
}

export async function update(id, text) {
  const entry = get(id);
  if (!entry) return null;
  const clean = text.trim();
  if (!clean) return remove(id);
  entry.text = clean;
  entry.words = nlp.countWords(clean);
  entry.updatedAt = Date.now();
  invalidate();
  notify();
  await db.putEntry({ ...entry });
  return entry;
}

export async function remove(id) {
  entries = entries.filter((e) => e.id !== id);
  invalidate();
  notify();
  await db.deleteEntry(id);
  return null;
}

export async function clearAll() {
  entries = [];
  invalidate();
  notify();
  await db.clearEntries();
}

/**
 * Bring in entries from a backup file.
 *   mode 'merge'   – keep what's here, add anything new (matched on id)
 *   mode 'replace' – wipe first
 * Returns { added, skipped }.
 */
export async function importEntries(list, mode = 'merge') {
  const incoming = list
    .filter((raw) => raw && typeof raw.text === 'string' && raw.text.trim())
    .map((raw) => normalizeEntry({ ...raw, id: raw.id || newId() }));

  if (mode === 'replace') {
    await db.clearEntries();
    entries = [];
  }

  const seen = new Set(entries.map((e) => e.id));
  // A second guard against duplicates: same timestamp and same text.
  const fingerprint = new Set(entries.map((e) => `${e.createdAt}|${e.text}`));

  const toAdd = [];
  let skipped = 0;
  for (const entry of incoming) {
    const fp = `${entry.createdAt}|${entry.text}`;
    if (seen.has(entry.id) || fingerprint.has(fp)) { skipped += 1; continue; }
    seen.add(entry.id);
    fingerprint.add(fp);
    toAdd.push(entry);
  }

  entries = entries.concat(toAdd);
  sortEntries();
  invalidate();
  notify();
  await db.putEntries(toAdd);
  return { added: toAdd.length, skipped };
}

/* ── Search ────────────────────────────────────────────────────────────── */

function fold(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** All entries containing every word of the query, newest first. */
export function search(query) {
  const terms = fold(query).split(/\s+/).map((t) => t.replace(/^#/, '')).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const entry of entries) {
    const hay = fold(entry.text);
    if (terms.every((t) => hay.includes(t))) results.push(entry);
  }
  return results.reverse();
}

/** Entries whose auto-detected topics include this term. */
export function entriesForTerm(key) {
  const index = getIndex();
  const term = index.terms.get(key);
  if (!term) return [];
  const ids = new Set(term.entryIds);
  return entries.filter((e) => ids.has(e.id)).reverse();
}

/* ── Settings ──────────────────────────────────────────────────────────── */

export function getSettings() {
  return settings;
}

export async function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  notify();
  await db.setMeta('settings', settings);
}
