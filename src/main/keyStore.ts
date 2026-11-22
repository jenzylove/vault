// The player's Presage key, saved in the app's data folder (userData/presage-key.json). It is encrypted by the
// operating system through Electron safeStorage (DPAPI on Windows) whenever that is available. The key is only
// ever handed to the SmartSpectra SDK constructor: nothing here logs it, and the page never reads it back.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = 'presage-key.json';
let cached: Promise<string | null> | null = null; // the file is read once, then kept in step by save and forget

const keyFile = (): string => join(app.getPath('userData'), FILE);

/** A pasted key, tidied: trimmed, outer quotes dropped. Null when it cannot be a key (empty, spaces inside, too long). */
export function cleanKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return v.length >= 8 && v.length <= 512 && /^[\x21-\x7e]+$/.test(v) ? v : null;
}

export async function canEncrypt(): Promise<boolean> {
  try { return await safeStorage.isAsyncEncryptionAvailable(); } catch { return false; }
}

/** A file this user cannot decrypt (copied from elsewhere) counts as no key. */
async function readSaved(): Promise<string | null> {
  try {
    const f = keyFile();
    if (!existsSync(f)) return null;
    const s = JSON.parse(readFileSync(f, 'utf8')) as { enc?: unknown; data?: unknown };
    if (typeof s.data !== 'string') return null;
    const raw = Buffer.from(s.data, 'base64');
    return cleanKey(s.enc === true ? (await safeStorage.decryptStringAsync(raw)).result : raw.toString('utf8'));
  } catch { return null; }
}

export function savedKey(): Promise<string | null> {
  cached ??= readSaved();
  return cached;
}

/** Saves the key (encrypted when the system allows). It is used for this run even if the file cannot be written. */
export async function saveKey(key: string): Promise<{ saved: boolean; encrypted: boolean }> {
  cached = Promise.resolve(key);
  try {
    const encrypted = await canEncrypt();
    const data = (encrypted ? await safeStorage.encryptStringAsync(key) : Buffer.from(key, 'utf8')).toString('base64');
    writeFileSync(keyFile(), JSON.stringify({ v: 1, enc: encrypted, data }), { mode: 0o600 });
    return { saved: true, encrypted };
  } catch {
    return { saved: false, encrypted: false };
  }
}

export function forgetKey(): void {
  cached = Promise.resolve(null);
  try { rmSync(keyFile(), { force: true }); } catch { /* already gone */ }
}
