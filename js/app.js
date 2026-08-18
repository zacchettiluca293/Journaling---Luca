/* Boot, lock screen, tab routing. */

import * as store from './store.js';
import * as pin from './pin.js';
import { $, $$, initOverlays, toast, confirmSheet, closeSheet, closePanel } from './ui.js';
import { initFeed, renderFeed, pauseVoice, remeasureComposer } from './feed.js';
import { initVault, renderVault } from './vault.js';
import { openSettings, applyTheme, onPinChangeRequest } from './settings.js';

/* Apply the saved theme before anything paints, so there's no flash. */
try {
  const saved = localStorage.getItem('journal.theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* private mode without localStorage — the default is fine */ }

/* ── Lock screen ───────────────────────────────────────────────────────── */

const lock = {
  mode: 'verify',      // 'verify' | 'setup' | 'confirm' | 'change'
  buffer: '',
  firstEntry: '',
  attempts: 0,
  busy: false,
};

function paintDots() {
  $$('#pin-dots i').forEach((dot, i) => dot.classList.toggle('is-on', i < lock.buffer.length));
}

function setLockCopy(title, hint, { error = false } = {}) {
  $('#lock-title').textContent = title;
  const hintNode = $('#lock-hint');
  hintNode.textContent = hint;
  hintNode.classList.toggle('is-error', error);
}

function showLock(mode) {
  lock.mode = mode;
  lock.buffer = '';
  lock.firstEntry = '';
  lock.attempts = 0;
  paintDots();
  $('#lock').hidden = false;
  $('#lock-forgot').hidden = true;
  $('#key-cancel').textContent = mode === 'change' ? 'Cancel' : '';
  $('#key-cancel').style.visibility = mode === 'change' ? 'visible' : 'hidden';
  pauseVoice();

  if (mode === 'setup') setLockCopy('Choose a PIN', 'Four digits. This keeps a passing glance out.');
  else if (mode === 'change') setLockCopy('New PIN', 'Pick four digits.');
  else setLockCopy('Enter your PIN', '');
}

function hideLock() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  renderFeed();
  remeasureComposer();
}

function shake() {
  const dots = $('#pin-dots');
  dots.classList.add('is-shake');
  setTimeout(() => dots.classList.remove('is-shake'), 400);
  if (navigator.vibrate) navigator.vibrate(60);
}

async function submitPin() {
  const value = lock.buffer;
  lock.buffer = '';
  paintDots();

  if (lock.mode === 'setup' || lock.mode === 'change') {
    lock.firstEntry = value;
    lock.mode = 'confirm';
    setLockCopy('Confirm your PIN', 'Type the same four digits again.');
    return;
  }

  if (lock.mode === 'confirm') {
    if (value !== lock.firstEntry) {
      shake();
      lock.mode = 'setup';
      setLockCopy('Those did not match', 'Start again — choose four digits.', { error: true });
      return;
    }
    await pin.setPin(value);
    const wasChange = !$('#app').hidden;
    setLockCopy('PIN set', '');
    hideLock();
    toast(wasChange ? 'PIN changed' : 'PIN set — you can always change it in Settings');
    return;
  }

  // Verifying.
  lock.busy = true;
  const ok = await pin.verify(value);
  lock.busy = false;
  if (ok) {
    hideLock();
    return;
  }

  lock.attempts += 1;
  shake();
  setLockCopy('Enter your PIN', 'That PIN did not match.', { error: true });
  if (lock.attempts >= 3) $('#lock-forgot').hidden = false;
}

function pressKey(key) {
  if (lock.busy) return;
  if (key === 'del') {
    lock.buffer = lock.buffer.slice(0, -1);
    paintDots();
    return;
  }
  if (key === 'cancel') {
    if (lock.mode === 'change' || lock.mode === 'confirm') hideLock();
    return;
  }
  if (!/^[0-9]$/.test(key) || lock.buffer.length >= 4) return;
  lock.buffer += key;
  paintDots();
  if (lock.buffer.length === 4) setTimeout(submitPin, 130);
}

function initLock() {
  $('#keypad').addEventListener('click', (event) => {
    const button = event.target.closest('[data-key]');
    if (button) pressKey(button.dataset.key);
  });

  document.addEventListener('keydown', (event) => {
    if ($('#lock').hidden) return;
    if (/^[0-9]$/.test(event.key)) pressKey(event.key);
    else if (event.key === 'Backspace') pressKey('del');
  });

  $('#lock-forgot').addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Reset your PIN?',
      message: 'Your entries stay exactly where they are — you chose a PIN you can always get past. '
        + 'Resetting means anyone holding this phone right now could set a new one and read the journal.',
      confirmLabel: 'Reset the PIN',
      danger: true,
    });
    if (ok) showLock('setup');
  });
}

/* ── Auto-lock ─────────────────────────────────────────────────────────── */

let hiddenSince = null;

function initAutoLock() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
      pauseVoice();
      return;
    }
    if (hiddenSince === null || !$('#lock').hidden) return;
    const minutes = store.getSettings().autoLockMinutes;
    const away = Date.now() - hiddenSince;
    hiddenSince = null;
    if (minutes < 0) return;
    if (!(await pin.isEnabled())) return;
    if (away >= minutes * 60000) {
      closeSheet();
      closePanel();
      $('#app').hidden = true;
      showLock('verify');
    }
  });
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

function switchTo(view) {
  $$('#tabbar .tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.view === view));
  $('#view-feed').hidden = view !== 'feed';
  $('#view-vault').hidden = view !== 'vault';
  if (view === 'vault') renderVault();
  else renderFeed();
}

function initTabs() {
  $('#tabbar').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) switchTo(tab.dataset.view);
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-lock').addEventListener('click', async () => {
    if (!(await pin.hasPin())) { showLock('setup'); return; }
    closeSheet();
    closePanel();
    $('#app').hidden = true;
    showLock('verify');
  });
}

/* ── Keyboard-aware layout (iOS) ───────────────────────────────────────── */

function initViewportFit() {
  const vv = window.visualViewport;
  if (!vv) return;
  const app = $('#app');
  const fit = () => {
    app.style.top = `${vv.offsetTop}px`;
    app.style.bottom = 'auto';
    app.style.height = `${vv.height}px`;
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

/* ── Service worker ────────────────────────────────────────────────────── */

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is a bonus, not a requirement */ });
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

async function boot() {
  await store.load();

  const settings = store.getSettings();
  applyTheme(settings.theme);
  if (settings.micMode === undefined) await store.setSetting('micMode', 'keyboard');

  initOverlays();
  initLock();
  initTabs();
  initAutoLock();
  initViewportFit();
  initFeed();
  initVault();
  onPinChangeRequest(() => showLock('change'));

  if (await pin.hasPin()) {
    showLock('verify');
  } else {
    showLock('setup');
  }

  initServiceWorker();
}

if (location.protocol !== 'file:') {
  boot().catch((err) => {
    console.error(err);
    const box = $('#boot-error');
    box.hidden = false;
    box.querySelector('h1').textContent = 'Something went wrong starting up';
    box.querySelector('p').textContent = String(err && err.message ? err.message : err);
  });
}
