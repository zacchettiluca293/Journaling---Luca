/* Settings, backup, and the honest explanations that go with them. */

import * as store from './store.js';
import * as db from './db.js';
import * as pin from './pin.js';
import * as fmt from './format.js';
import * as speech from './speech.js';
import * as T from './time.js';
import { $, h, icon, ICONS, toast, openSheet, closeSheet, confirmSheet } from './ui.js';

let requestPinChange = null; // set by app.js so settings can hand control back

export function onPinChangeRequest(fn) {
  requestPinChange = fn;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Mirrored outside the database so the next launch can paint before the
  // database has finished opening.
  try { localStorage.setItem('journal.theme', theme); } catch { /* fine without it */ }
}

function select(label, value, options, onChange) {
  const field = h('div', { class: 'field' });
  field.append(h('label', { text: label }));
  const sel = h('select', { onchange: (event) => onChange(event.target.value) });
  for (const [val, text] of options) {
    const option = h('option', { value: val, text });
    if (String(val) === String(value)) option.selected = true;
    sel.append(option);
  }
  field.append(sel);
  return field;
}

export function openSettings() {
  const settings = store.getSettings();

  openSheet('Settings', (body) => {
    /* ── Appearance and input ── */
    body.append(select('Appearance', settings.theme, [
      ['auto', 'Match my phone'],
      ['light', 'Always light'],
      ['dark', 'Always dark'],
    ], async (value) => {
      applyTheme(value);
      await store.setSetting('theme', value);
    }));

    body.append(select('Microphone button', settings.micMode, [
      ['keyboard', 'Point me at the keyboard mic (private)'],
      ['inapp', 'Record inside the app'],
    ], async (value) => {
      await store.setSetting('micMode', value);
      toast(value === 'keyboard' ? 'The mic button will open your keyboard' : 'The mic button will record in-app');
    }));

    body.append(h('p', { class: 'note', html: 'Your iPhone keyboard\'s own dictation runs <strong>on the phone</strong> — the audio never leaves it. In-app recording uses the browser\'s speech service, which sends audio to Apple or Google to be transcribed. Same words, different route.' }));

    if (speech.supported()) {
      body.append(select('In-app dictation language', settings.speechLang || '', [
        ['', 'Follow my phone'],
        ['en-US', 'English (US)'],
        ['en-GB', 'English (UK)'],
        ['it-IT', 'Italiano'],
        ['es-ES', 'Español'],
        ['fr-FR', 'Français'],
        ['de-DE', 'Deutsch'],
        ['pt-BR', 'Português (BR)'],
      ], (value) => store.setSetting('speechLang', value)));
    }

    body.append(select('"Copy for AI" format', settings.copyFormat, [
      ['markdown', 'Markdown — easiest to read'],
      ['json', 'JSON — structured data'],
    ], (value) => store.setSetting('copyFormat', value)));

    body.append(select('Lock again after', String(settings.autoLockMinutes), [
      ['0', 'Straight away'],
      ['1', '1 minute in the background'],
      ['5', '5 minutes in the background'],
      ['-1', 'Never — only when I tap the lock'],
    ], (value) => store.setSetting('autoLockMinutes', Number(value))));

    /* ── Actions ── */
    const menu = h('div', { class: 'menu' });
    menu.append(h('hr'));

    menu.append(h('button', { type: 'button', onclick: () => { closeSheet(); if (requestPinChange) requestPinChange(); } },
      icon(ICONS.key, 20), h('span', {}, h('span', { text: 'Change PIN' }))));

    menu.append(h('button', { type: 'button', onclick: () => { closeSheet(); openBackup(); } },
      icon(ICONS.share, 20), h('span', {}, h('span', { text: 'Backup & restore' }), h('small', { text: 'Save a copy, or bring one back' }))));

    menu.append(h('button', { type: 'button', onclick: () => { closeSheet(); openAbout(); } },
      icon(ICONS.info, 20), h('span', {}, h('span', { text: 'Where your journal lives' }))));

    menu.append(h('hr'));

    menu.append(h('button', { type: 'button', class: 'is-danger', onclick: async () => {
      closeSheet();
      const ok = await confirmSheet({
        title: 'Erase everything?',
        message: 'Every entry on this device will be deleted. If you have not saved a backup, there is no way back.',
        confirmLabel: 'Erase everything',
        danger: true,
      });
      if (!ok) return;
      const sure = await confirmSheet({
        title: 'Really sure?',
        message: 'Last check. This deletes all your entries permanently.',
        confirmLabel: 'Yes, erase',
        danger: true,
      });
      if (!sure) return;
      await store.clearAll();
      toast('All entries deleted');
    } }, icon(ICONS.trash, 20), h('span', {}, h('span', { text: 'Delete all entries' }))));

    body.append(menu);
  });
}

/* ── Backup ────────────────────────────────────────────────────────────── */

export function openBackup() {
  openSheet('Backup & restore', (body) => {
    const stats = store.stats();
    body.append(h('p', {
      class: 'note',
      html: 'Your journal lives only on this device. Clearing your browser data, losing the phone, or switching phones takes it with you. <strong>Save a backup file somewhere safe every so often</strong> — iCloud Drive, Google Drive, an email to yourself.',
    }));

    const menu = h('div', { class: 'menu' });

    menu.append(h('button', { type: 'button', onclick: async () => {
      const text = fmt.backupJson(store.all(), { entryCount: stats.entries });
      const name = `journal-backup-${T.dayKey(Date.now())}.json`;
      const result = await fmt.saveFile(name, text);
      if (result === 'shared' || result === 'downloaded') toast('Backup saved');
      else if (result === 'cancelled') toast('Backup cancelled');
      else toast('Could not save the file — try copying it instead');
    } }, icon(ICONS.down, 20), h('span', {}, h('span', { text: 'Save a backup file' }), h('small', { text: `${stats.entries} entries · goes to Files, Drive, wherever you like` }))));

    menu.append(h('button', { type: 'button', onclick: async () => {
      const text = fmt.backupJson(store.all(), { entryCount: stats.entries });
      toast(await fmt.copyText(text) ? 'Backup copied — paste it somewhere safe' : 'Copy failed');
    } }, icon(ICONS.copy, 20), h('span', {}, h('span', { text: 'Copy the backup as text' }), h('small', { text: 'For pasting into a note or an email' }))));

    menu.append(h('hr'));

    const fileInput = h('input', { type: 'file', accept: 'application/json,.json,text/plain', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      await handleRestore(text);
    });
    body.append(fileInput);

    menu.append(h('button', { type: 'button', onclick: () => fileInput.click() },
      icon(ICONS.doc, 20), h('span', {}, h('span', { text: 'Restore from a file' }), h('small', { text: 'Pick a backup you saved earlier' }))));

    menu.append(h('button', { type: 'button', onclick: () => { closeSheet(); openPasteRestore(); } },
      icon(ICONS.edit, 20), h('span', {}, h('span', { text: 'Restore from pasted text' }))));

    body.append(menu);
  });
}

function openPasteRestore() {
  openSheet('Paste a backup', (body) => {
    body.append(h('p', { class: 'note', text: 'Paste the contents of a backup file below.' }));
    const area = h('textarea', { class: 'codebox', placeholder: '{ "kind": "journal-backup", … }' });
    body.append(area);
    body.append(h('div', { class: 'btnrow', style: 'margin-top:12px;' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: () => handleRestore(area.value) }, 'Restore')));
  });
}

async function handleRestore(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    toast("That doesn't look like a backup file");
    return;
  }
  const list = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(list) || !list.length) {
    toast('No entries found in that file');
    return;
  }

  closeSheet();
  const mode = await chooseRestoreMode(list.length);
  if (!mode) return;

  const result = await store.importEntries(list, mode);
  toast(result.skipped
    ? `Restored ${result.added} entries (${result.skipped} were already here)`
    : `Restored ${result.added} entries`, 3200);
}

function chooseRestoreMode(count) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (value) => {
      if (answered) return;
      answered = true;
      closeSheet();
      resolve(value);
    };
    openSheet(`Restore ${count} entries`, (body) => {
      body.append(h('p', { class: 'note', text: 'How should these fit with what is already on this phone?' }));
      const menu = h('div', { class: 'menu' });
      menu.append(h('button', { type: 'button', onclick: () => done('merge') },
        icon(ICONS.doc, 20), h('span', {}, h('span', { text: 'Add to what I have' }), h('small', { text: 'Duplicates are skipped. The safe choice.' }))));
      menu.append(h('button', { type: 'button', class: 'is-danger', onclick: () => done('replace') },
        icon(ICONS.trash, 20), h('span', {}, h('span', { text: 'Replace everything' }), h('small', { text: 'Deletes the current entries first' }))));
      body.append(menu);
    }, { onClose: () => done(null) });
  });
}

/* ── About / storage ───────────────────────────────────────────────────── */

async function openAbout() {
  const usage = await db.estimateUsage();
  const persisted = await db.requestPersistence();
  const stats = store.stats();

  openSheet('Where your journal lives', (body) => {
    body.append(h('p', { class: 'note', html: `
      Everything you write is stored in this browser's own database on this device.
      It is never uploaded, there is no account, and no server ever sees it — which is
      also why it costs nothing to run.
    ` }));
    body.append(h('p', { class: 'note', html: `
      <strong>The trade:</strong> if you clear this browser's data, delete the app from your
      Home Screen along with its data, or lose the phone, the entries go with it. The PIN keeps
      a passing glance out; it is not encryption.
    ` }));

    const facts = h('div', { class: 'card' });
    const line = (label, value) => facts.append(h('div', { class: 'row' },
      h('div', { class: 'row__main' }, h('div', { class: 'row__title', text: label })),
      h('div', { class: 'row__side', text: value })));

    line('Entries', String(stats.entries));
    line('Words', stats.words.toLocaleString());
    if (stats.first) line('First entry', T.fmtShortDate(stats.first));
    if (usage !== null) line('Space used', `${(usage / 1048576).toFixed(1)} MB`);
    line('Storage', db.isFallback() ? 'Simple (fallback)' : 'IndexedDB');
    line('Protected from cleanup', persisted ? 'Yes' : 'Not granted');
    body.append(facts);

    if (speech.isIOS() && !speech.isStandalone()) {
      body.append(h('p', { class: 'note', style: 'margin-top:16px;', html: `
        <strong>Tip:</strong> tap Share in Safari, then <em>Add to Home Screen</em>. It then opens
        like a normal app, full screen, and the storage is more durable.
      ` }));
    }
  });
}
