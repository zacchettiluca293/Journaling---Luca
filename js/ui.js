/* Small DOM helpers plus the two overlay surfaces: a bottom sheet for actions
 * and a full-screen panel for reading digests. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** "1 entry" / "2 entries" — counts read as sloppy when the plural is wrong. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

/** Terse element builder: h('div', { class: 'card' }, 'text', childEl). */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(paths, size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  edit: '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13"/>',
  share: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  down: '<path d="M12 5v11"/><path d="m8 13 4 4 4-4"/><path d="M5 20h14"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8 2 2-2 2 2 2-3 3-2-2-2 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Wrap every occurrence of the search terms in <mark>. Input is escaped. */
export function highlight(text, terms) {
  let html = escapeHtml(text);
  const clean = (terms || []).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!clean.length) return html;
  const re = new RegExp(`(${clean.join('|')})`, 'gi');
  html = html.replace(re, '<mark>$1</mark>');
  return html;
}

/* ── Toast ─────────────────────────────────────────────────────────────── */

let toastTimer = null;

export function toast(message, ms = 2200) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/* ── Sheet ─────────────────────────────────────────────────────────────── */

let sheetOnClose = null;

export function openSheet(title, render, { onClose = null } = {}) {
  const sheet = $('#sheet');
  const body = $('#sheet-body');
  $('#sheet-title').textContent = title;
  body.replaceChildren();
  render(body);
  sheet.hidden = false;
  $('#scrim').hidden = false;
  sheetOnClose = onClose;
  return { close: closeSheet };
}

export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  if ($('#panel').hidden) $('#scrim').hidden = true;
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (cb) cb();
}

/** A yes/no question in a sheet. Resolves to true only on confirm. */
export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
      closeSheet();
    };
    openSheet(title, (body) => {
      body.append(h('p', { class: 'note', html: message }));
      body.append(h(
        'div',
        { class: 'btnrow' },
        h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Cancel'),
        h('button', {
          type: 'button',
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          onclick: () => done(true),
        }, confirmLabel),
      ));
    }, { onClose: () => done(false) });
  });
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

let panelCopyHandler = null;

export function openPanel({ title, sub = '', onCopy = null, render }) {
  const panel = $('#panel');
  const body = $('#panel-body');
  $('#panel-title').textContent = title;
  $('#panel-sub').textContent = sub;
  $('#panel-copy').hidden = !onCopy;
  panelCopyHandler = onCopy;
  body.replaceChildren();
  body.scrollTop = 0;
  render(body);
  panel.hidden = false;
}

export function closePanel() {
  $('#panel').hidden = true;
  panelCopyHandler = null;
  if ($('#sheet').hidden) $('#scrim').hidden = true;
}

export function initOverlays() {
  $('#scrim').addEventListener('click', () => {
    if (!$('#sheet').hidden) closeSheet();
  });
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#panel-back').addEventListener('click', closePanel);
  $('#panel-copy').addEventListener('click', () => {
    if (panelCopyHandler) panelCopyHandler();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#sheet').hidden) closeSheet();
    else if (!$('#panel').hidden) closePanel();
  });
}
