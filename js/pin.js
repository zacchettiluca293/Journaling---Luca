/* The PIN.
 *
 * Honest description of what this is: a privacy screen. The PIN is stored as a
 * salted hash, so the four digits themselves aren't sitting in the database —
 * but the entries are stored in readable form, exactly as chosen, so that a
 * forgotten PIN never costs you the journal. Someone with your unlocked phone
 * and patience could reach the data through developer tools. It stops the
 * casual glance, not a determined search.
 */

import * as db from './db.js';

const SALT_KEY = 'pin.salt';
const HASH_KEY = 'pin.hash';
const ENABLED_KEY = 'pin.enabled';

function randomSalt() {
  const bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Kept deliberately light. Stretching the hash would only slow down guessing
 * the four digits, and the entries themselves are stored readable by design —
 * so anyone who could run that attack could simply read the entries instead.
 * An instant unlock is worth more here than security theatre. */
const ROUNDS = 150;

/** Iterated SHA-256. Falls back to a simple hash where WebCrypto is missing
 *  (http:// on a local network, for instance) so the app still functions. */
async function hashPin(pin, salt) {
  const input = `${salt}:${pin}`;
  if (window.crypto && window.crypto.subtle) {
    const enc = new TextEncoder();
    let data = enc.encode(input);
    for (let i = 0; i < ROUNDS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      data = new Uint8Array(await window.crypto.subtle.digest('SHA-256', data));
    }
    return [...data].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `weak-${(h >>> 0).toString(16)}`;
}

export async function isEnabled() {
  return (await db.getMeta(ENABLED_KEY, false)) === true;
}

export async function hasPin() {
  return Boolean(await db.getMeta(HASH_KEY, null));
}

export async function setPin(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await db.setMeta(SALT_KEY, salt);
  await db.setMeta(HASH_KEY, hash);
  await db.setMeta(ENABLED_KEY, true);
}

export async function verify(pin) {
  const salt = await db.getMeta(SALT_KEY, null);
  const stored = await db.getMeta(HASH_KEY, null);
  if (!salt || !stored) return false;
  const hash = await hashPin(pin, salt);
  return hash === stored;
}

export async function disable() {
  await db.setMeta(ENABLED_KEY, false);
  await db.setMeta(HASH_KEY, null);
  await db.setMeta(SALT_KEY, null);
}
