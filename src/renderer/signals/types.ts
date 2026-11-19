export interface SignalFrame {
  t: number;            // ms since session start
  chest?: number;       // raw upper breathing trace sample (unitless, relative)
  abdomen?: number;     // raw lower breathing trace sample
  cardio?: number;      // arterial pressure trace sample (beat waveform)
  pulse?: number;       // bpm, 12 s average
  blink?: boolean;      // blink detected at this sample
  talking?: boolean;
  expr?: Partial<Record<'neutral'|'happy'|'sad'|'surprise'|'fear'|'disgust'|'anger'|'contempt', number>>;
  conf: number;         // 0..1 confidence of the sample
  stable: boolean;
}

/** SDK ProcessingStatus, by name. */
export type ProcessingState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** Latest SDK validationStatus packet. `code` is a SmartSpectra ValidationCode (0 = ok). */
export interface ValidationInfo {
  code: number;
  hint: string;   // the SDK's own hint text, as given
  at: number;     // performance.now() when it arrived
}

/** A session ending error, already turned into plain words for the player. */
export interface SourceError {
  code: number | string;  // SmartSpectraErrorCode, or a string for non SDK failures
  message: string;        // raw message (for the console only, never shown as is)
  say: string;            // what the player reads
  retryable: boolean;
}

export interface SourceStatus {
  processing: ProcessingState;
  validation: ValidationInfo | null;
  error: SourceError | null;
  /** The camera stream for a preview (live only; null when the camera is off). */
  stream: MediaStream | null;
}

export interface SignalSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (f: SignalFrame) => void): () => void;
  kind: 'live' | 'replay' | 'simulated';
  /** Current processing status, latest validation code and hint, last error and the preview stream. */
  status(): SourceStatus;
  /** Called on every status change (processing, validation packet, error, stream). */
  onStatus(cb: (s: SourceStatus) => void): () => void;
}
