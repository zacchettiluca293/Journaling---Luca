/* The Feed: a running stream of everything you've written, newest at the
 * bottom, with the composer always in reach. */

import * as store from './store.js';
import * as T from './time.js';
import * as nlp from './nlp.js';
import * as fmt from './format.js';
import * as speech from './speech.js';
import { $, h, icon, ICONS, toast, openSheet, closeSheet, confirmSheet, escapeHtml } from './ui.js';

const DRAFT_KEY = 'journal.draft';
const PAGE = 150;

let visibleCount = PAGE;
let listening = null;
let stickToBottom = true;

/* ── Rendering ─────────────────────────────────────────────────────────── */

export function renderFeed() {
  const list = $('#feed-list');
  const entries = store.all();
  const scroller = $('#feed-scroll');
  const wasAtBottom = stickToBottom;

  $('#feed-empty').hidden = entries.length > 0;

  const slice = entries.slice(Math.max(0, entries.length - visibleCount));
  const nodes = [];

  if (slice.length < entries.length) {
    nodes.push(h('button', {
      type: 'button',
      class: 'btn',
      style: 'margin: 0 auto 10px; max-width: 15rem;',
      onclick: () => {
        const scrollBefore = scroller.scrollHeight - scroller.scrollTop;
        visibleCount += PAGE * 2;
        renderFeed();
        scroller.scrollTop = scroller.scrollHeight - scrollBefore;
      },
    }, `Show earlier entries (${entries.length - slice.length} more)`));
  }

  let lastDay = null;
  for (const entry of slice) {
    const day = T.dayKey(entry.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      nodes.push(h('div', { class: 'daysep', text: T.fmtDayLabel(entry.createdAt) }));
    }
    nodes.push(bubble(entry));
  }

  list.replaceChildren(...nodes);
  updateFeedStats();

  if (wasAtBottom) scrollToBottom();
}

function bubble(entry) {
  const tags = store.tagsFor(entry.id);
  const node = h('article', { class: 'bubble', dataset: { id: entry.id } });

  node.append(h('div', {
    class: 'bubble__text',
    html: escapeHtml(entry.text).replace(/#([\p{L}\p{N}_-]+)/gu, '<span class="tagref">#$1</span>'),
  }));

  if (tags.length) {
    node.append(h('div', { class: 'chips' }, ...tags.map((t) => h('span', { class: 'chip', text: t.label }))));
  }

  const meta = h('div', { class: 'bubble__meta' });
  if (entry.source === 'voice') meta.append(icon(ICONS.mic, 12));
  meta.append(h('span', { text: T.fmtTime(entry.createdAt) }));
  meta.append(h('span', { class: 'dot', text: '·' }));
  meta.append(h('span', { text: `${entry.words} words` }));
  if (entry.words >= 160) {
    meta.append(h('span', { class: 'dot', text: '·' }));
    meta.append(h('span', { text: `${nlp.readingMinutes(entry.words)} min` }));
  }
  if (entry.updatedAt - entry.createdAt > 60000) {
    meta.append(h('span', { class: 'dot', text: '·' }));
    meta.append(h('span', { text: 'edited' }));
  }
  node.append(meta);

  node.addEventListener('click', () => {
    // Don't hijack the tap when the user is selecting text to copy by hand.
    const selection = window.getSelection();
    if (selection && String(selection).length > 0) return;
    openEntryActions(entry.id);
  });

  return node;
}

function updateFeedStats() {
  const s = store.stats();
  const bits = [];
  if (s.today) bits.push(`${s.today} today`);
  if (s.streak > 1) bits.push(`${s.streak}-day streak`);
  else if (s.streak === 1) bits.push('writing today');
  if (!bits.length && s.entries) bits.push(`${s.entries} entries`);
  if (!bits.length) bits.push('Your journal starts here');
  $('#feed-stats').textContent = bits.join(' · ');
}

function scrollToBottom(smooth = false) {
  const scroller = $('#feed-scroll');
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

/* ── Entry actions ─────────────────────────────────────────────────────── */

export function openEntryActions(id) {
  const entry = store.get(id);
  if (!entry) return;
  const tags = store.tagsFor(id);
  const title = `${T.fmtDayLabel(entry.createdAt)}, ${T.fmtTime(entry.createdAt)}`;

  openSheet(title, (body) => {
    body.append(h('p', {
      class: 'note',
      text: `${entry.words} words · ~${nlp.readingMinutes(entry.words)} min read · ${T.timeBucket(entry.createdAt).toLowerCase()}${tags.length ? ` · ${tags.map((t) => t.label).join(', ')}` : ''}`,
    }));

    const menu = h('div', { class: 'menu' });
    const format = store.getSettings().copyFormat;

    menu.append(h('button', { type: 'button', onclick: async () => {
      const text = format === 'json'
        ? fmt.entriesJson([entry], store.getIndex(), { scope: 'single entry' })
        : fmt.entryMarkdown(entry, tags);
      closeSheet();
      toast(await fmt.copyText(text) ? `Copied as ${format === 'json' ? 'JSON' : 'Markdown'} — paste into your AI` : 'Copy failed');
    } }, icon(ICONS.copy, 20), h('span', {}, h('span', { text: 'Copy for AI' }), h('small', { text: `Clean ${format === 'json' ? 'JSON' : 'Markdown'}, ready to paste` }))));

    menu.append(h('button', { type: 'button', onclick: async () => {
      closeSheet();
      toast(await fmt.copyText(entry.text) ? 'Copied' : 'Copy failed');
    } }, icon(ICONS.doc, 20), h('span', {}, h('span', { text: 'Copy plain text' }))));

    menu.append(h('hr'));

    menu.append(h('button', { type: 'button', onclick: () => { closeSheet(); openEditor(entry.id); } },
      icon(ICONS.edit, 20), h('span', {}, h('span', { text: 'Edit' }))));

    menu.append(h('button', { type: 'button', class: 'is-danger', onclick: async () => {
      closeSheet();
      const ok = await confirmSheet({
        title: 'Delete this entry?',
        message: 'It will be removed from this device. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) {
        await store.remove(entry.id);
        toast('Entry deleted');
      }
    } }, icon(ICONS.trash, 20), h('span', {}, h('span', { text: 'Delete' }))));

    body.append(menu);
  });
}

function openEditor(id) {
  const entry = store.get(id);
  if (!entry) return;
  openSheet('Edit entry', (body) => {
    const field = h('div', { class: 'field' });
    const area = h('textarea', { rows: 8 });
    area.value = entry.text;
    field.append(area);
    body.append(field);
    body.append(h('div', { class: 'btnrow' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: async () => {
        await store.update(entry.id, area.value);
        closeSheet();
        toast('Saved');
      } }, 'Save')));
    setTimeout(() => area.focus(), 60);
  });
}

/* ── Composer ──────────────────────────────────────────────────────────── */

function autoGrow(area) {
  area.style.height = 'auto';
  // While the app is behind the lock screen it has no layout, so scrollHeight
  // reads 0. Leaving the height on `auto` keeps the one-line default instead
  // of collapsing the box to nothing.
  if (!area.scrollHeight) return;
  area.style.height = `${Math.min(area.scrollHeight, window.innerHeight * 0.42)}px`;
}

/** Re-measure once the app is actually on screen (after unlocking). */
export function remeasureComposer() {
  autoGrow($('#composer-input'));
}

async function send() {
  const area = $('#composer-input');
  const text = area.value.trim();
  if (!text) return;
  const source = area.dataset.usedVoice === '1' ? 'voice' : 'type';
  stopListening();
  area.value = '';
  delete area.dataset.usedVoice;
  autoGrow(area);
  syncSendButton();
  localStorage.removeItem(DRAFT_KEY);

  stickToBottom = true;
  const entry = await store.add(text, source);
  if (entry) {
    const node = $(`.bubble[data-id="${entry.id}"]`);
    if (node) node.classList.add('is-flash');
  }
  scrollToBottom(true);
}

function syncSendButton() {
  $('#btn-send').disabled = !$('#composer-input').value.trim();
}

/* ── Voice ─────────────────────────────────────────────────────────────── */

function appendToComposer(text) {
  const area = $('#composer-input');
  const current = area.value;
  const needsSpace = current && !/\s$/.test(current);
  area.value = current + (needsSpace ? ' ' : '') + text;
  area.dataset.usedVoice = '1';
  autoGrow(area);
  syncSendButton();
  saveDraft();
}

function showKeyboardDictationHint({ persistent }) {
  const hint = $('#composer-hint');
  hint.replaceChildren();
  hint.append(h('span', {}, 'Tap the ', h('strong', { text: '🎤' }), ' on your keyboard to dictate — your voice stays on this iPhone. '));
  if (speech.supported()) {
    hint.append(h('button', {
      type: 'button',
      onclick: () => { hint.hidden = true; startListening(); },
    }, 'Use in-app mic instead'));
  }
  hint.hidden = false;
  $('#composer-input').focus();
  if (!persistent) setTimeout(() => { hint.hidden = true; }, 7000);
}

function startListening() {
  if (listening) return;
  if (!speech.supported()) {
    toast('This browser has no built-in dictation — use your keyboard mic');
    return;
  }
  const settings = store.getSettings();
  const live = $('#composer-live');
  const liveText = $('#composer-live-text');
  liveText.textContent = 'Listening…';
  live.hidden = false;
  $('#btn-mic').classList.add('is-rec');

  listening = speech.listen({
    lang: settings.speechLang || undefined,
    onPartial: (text) => { liveText.textContent = text; },
    onFinal: (text) => {
      appendToComposer(text);
      liveText.textContent = 'Listening…';
    },
    onError: (err) => {
      const message = err === 'not-allowed' || err === 'service-not-allowed'
        ? 'Microphone access was blocked — allow it in your browser settings'
        : 'Dictation stopped. Your keyboard mic always works.';
      toast(message, 3200);
    },
    onEnd: () => { stopListening(); },
  });
}

function stopListening() {
  const handle = listening;
  listening = null;
  if (handle) handle.stop();
  $('#composer-live').hidden = true;
  $('#btn-mic').classList.remove('is-rec');
}

async function onMicTap() {
  if (listening) { stopListening(); return; }
  const settings = store.getSettings();
  const preferKeyboard = settings.micMode === 'keyboard';

  if (preferKeyboard) {
    showKeyboardDictationHint({ persistent: !settings.seenMicHint });
    if (!settings.seenMicHint) await store.setSetting('seenMicHint', true);
    return;
  }
  startListening();
}

/* ── Drafts ────────────────────────────────────────────────────────────── */

let draftTimer = null;

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const value = $('#composer-input').value;
    if (value.trim()) localStorage.setItem(DRAFT_KEY, value);
    else localStorage.removeItem(DRAFT_KEY);
  }, 400);
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

export function initFeed() {
  const area = $('#composer-input');

  const draft = localStorage.getItem(DRAFT_KEY);
  if (draft) area.value = draft;
  autoGrow(area);

  area.addEventListener('input', () => { autoGrow(area); syncSendButton(); saveDraft(); });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  });

  $('#btn-send').addEventListener('click', send);
  $('#btn-mic').addEventListener('click', onMicTap);
  $('#btn-stop-rec').addEventListener('click', stopListening);

  $('#feed-scroll').addEventListener('scroll', () => {
    const scroller = $('#feed-scroll');
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  });

  syncSendButton();
  store.subscribe(renderFeed);
  renderFeed();
  scrollToBottom();
}

export function pauseVoice() {
  stopListening();
}
