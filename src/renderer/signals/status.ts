// Status plumbing shared by every SignalSource, plus the plain words the player sees for SDK codes.
import type { SourceError, SourceStatus } from './types';

/** Holds a source's status and tells listeners about every change. */
export class StatusHub {
  private s: SourceStatus = { processing: 'idle', validation: null, error: null, stream: null };
  private subs = new Set<(s: SourceStatus) => void>();

  get(): SourceStatus { return this.s; }

  set(patch: Partial<SourceStatus>): void {
    this.s = { ...this.s, ...patch };
    for (const cb of this.subs) {
      try { cb(this.s); } catch (e) { console.error('status listener threw', e); }
    }
  }

  on(cb: (s: SourceStatus) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }
}

// SmartSpectra ValidationCode values used by the game.
export const V_OK = 0;
export const V_NO_FACE = 1;
export const V_MANY_FACES = 2;
export const V_TOO_DARK = 5;
export const V_CHEST_HIDDEN = 7;
export const V_FACE_TOO_LOW = 16;

/** Player facing text never carries dashes; SDK hints get the same treatment. */
export function noDashes(s: string): string {
  return s
    .replace(/\s*[‒–—―]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/(\w)-(\w)/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The SDK's validation hint in plain words: a big line and an optional smaller one. */
export function validationWords(code: number, hint: string): { big: string; small?: string } {
  switch (code) {
    case V_NO_FACE: return { big: 'No face found.', small: 'Put your face inside the oval.' };
    case V_MANY_FACES: return { big: 'Only one face, please.', small: 'He reads one player at a time.' };
    case V_TOO_DARK: return { big: 'More light on your face.', small: 'Put a lamp or a window in front of you, not behind.' };
    case V_CHEST_HIDDEN: return { big: 'Show more of your chest.', small: 'Sit back until your shoulders reach the curve.' };
    case V_FACE_TOO_LOW: return { big: 'Move up, or tilt the camera down.' };
    default: {
      const h = noDashes(hint || '');
      return { big: h || 'Hold still while the camera settles.' };
    }
  }
}

/** SDK error codes (SmartSpectraErrorCode) that the live source treats specially. */
export const E_AUTH = 2;
export const E_CREDITS = 4;
export const E_NETWORK = 5;
export const E_SERVER = 6;
export const E_INPUT = 7;
export const E_PROCESSING = 8;
export const E_NOT_AUTHORIZED = 13;
export const E_LOW_FPS = 14;

/** Turn an SDK error into what the player reads. The raw message stays in `message`. */
export function sdkError(code: number | string, message: string, retryable: boolean): SourceError {
  let say: string;
  switch (code) {
    case E_AUTH: say = 'Presage did not accept that key. Check it and try again.'; break;
    case E_CREDITS: say = 'This Presage key is out of credits.'; break;
    case E_NETWORK: say = 'The connection to Presage dropped. Check your internet and try again.'; break;
    case E_SERVER: say = 'Presage is not answering right now. Try again in a minute.'; break;
    case E_INPUT: say = 'The camera is not available. Close any other app using it and try again.'; break;
    case E_PROCESSING: say = 'The camera reader stalled while starting. Try again.'; break;
    case E_LOW_FPS: say = 'Your computer is too busy to keep up with the camera. Close other apps and try again.'; break;
    case 'camera': say = 'The camera did not turn on. Allow camera access and close any other app using it.'; break;
    default: say = 'The camera reader stopped. Try again.';
  }
  return { code, message, say, retryable };
}
