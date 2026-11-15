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
export interface SignalSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(cb: (f: SignalFrame) => void): () => void;
  kind: 'live' | 'replay' | 'simulated';
}
