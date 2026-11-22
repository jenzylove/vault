// The player's Presage key, saved in the app's data folder (userData/presage-key.json). It is encrypted by the
// operating system through Electron safeStorage (DPAPI on Windows) whenever that is available. The key is only
// ever handed to the SmartSpectra SDK constructor: nothing here logs it, and the page never reads it back.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'presage-key.json';
let cached: string | null | undefined; // undefined until the file has been read once

const keyFile = (): string => join(app.getPath('userData'), FILE);

/** A pasted key, tidied: trimmed, outer quotes dropped. Null when it cannot be a key (empty, spaces inside, too long). */
export function cleanKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return v.length >= 8 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v) ? v : null;
}

export const canEncrypt = (): boolean => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };

/** The saved key, or null. A file this user cannot decrypt (copied from elsewhere) counts as no key. */
export function savedKey(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const f = keyFile();
    if (!existsSync(f)) return null;
    const s = JSON.parse(readFileSync(f, 'utf8')) as { enc?: unknown; data?: unknown };
    if (typeof s.data !== 'string') return null;
    const raw = Buffer.from(s.data, 'base64');
    cached = cleanKey(s.enc === true ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch { cached = null; }
  return cached;
}

/** Saves the key (encrypted when the system allows). It is used for this run even if the file cannot be written. */
export function saveKey(key: string): { saved: boolean; encrypted: boolean } {
  cached = key;
  const encrypted = canEncrypt();
  try {
    const data = (encrypted ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')).toString('base64');
    writeFileSync(keyFile(), JSON.stringify({ v: 1, enc: encrypted, data }), { mode: 0o600 });
    return { saved: true, encrypted };
  } catch {
    return { saved: false, encrypted: false };
  }
}

export function forgetKey(): void {
  cached = null;
  try { rmSync(keyFile(), { force: true }); } catch { /* already gone */ }
}
