// The Presage key screen, shown when the player picks live play and no key is ready, or when a live start
// failed. A pasted key goes to the main process (App.tsx createSource), which saves it encrypted in the
// app's data folder and gives it only to the SmartSpectra SDK. The field is a password field, so the key
// never shows on screen, and this page never reads a saved key back.
import { useEffect, useState } from 'react';
import { Btn } from './parts';
import { announceKeyChange, onKeyChange, presageBridge, type PresageStatus } from './presageKey';

const GET_KEY = 'https://physiology.presagetech.com';

export function KeyEntry({ draft, setDraft, err, keyOnFile, onLive, onSim, onForget }: {
  draft: string; setDraft: (s: string) => void; err: string | null; keyOnFile: boolean; onLive: () => void; onSim: () => void; onForget: () => void;
}): JSX.Element {
  const [st, setSt] = useState<PresageStatus | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => { void presageBridge()?.presage().then((s) => { if (live) setSt(s); }).catch(() => { /* no bridge */ }); };
    check();
    const off = onKeyChange(check);
    return () => { live = false; off(); };
  }, []);

  const forget = async () => {
    try { await presageBridge()?.key?.forget(); } catch { /* nothing saved */ }
    onForget();
    announceKeyChange();
  };

  if (st && !st.sdk) {
    return (
      <div className="center">
        <div className="sheet key-entry">
          <div className="eyebrow">Presage key</div>
          <div className="display">Live play is off on this computer.</div>
          <div className="body">The Presage SDK could not start here, so the camera cannot read you. The sample run still plays the whole game.</div>
          {err && <div className="err">{err}</div>}
          <div className="actions"><Btn primary k="S" onClick={onSim}>Try a sample run (no camera)</Btn></div>
        </div>
      </div>
    );
  }

  const ready = st ? st.hasKey : keyOnFile;
  const saved = st?.from === 'saved';
  // A key set outside the game (environment or .env) wins over a pasted one, so there is nothing to paste.
  const fixed = st?.from === 'env' || st?.from === 'file';
  const kept = st?.encrypted === false ? 'kept on this computer' : 'kept on this computer, encrypted,';
  return (
    <div className="center">
      <div className="sheet key-entry">
        <div className="eyebrow">Presage key</div>
        <div className="display">{saved ? 'Your Presage key is saved.' : ready ? 'Your Presage key is ready.' : 'Paste your Presage API key.'}</div>
        <div className="body">
          {fixed ? 'A key is set up on this computer. Press Enter to use your camera.'
            : saved ? <>It is {kept} and only goes to the Presage SDK. Press Enter to use your camera, or paste a new key.</>
              : <>Live play reads your breath, blinks and pulse from your webcam with Presage SmartSpectra.
                {' '}Get a free key at <a className="link" href={GET_KEY} target="_blank" rel="noreferrer">physiology.presagetech.com</a>, then paste it here.</>}
        </div>
        {!fixed && (
          <form style={{ marginTop: 18 }} onSubmit={(e) => { e.preventDefault(); onLive(); }}>
            <input className="field" type="password" spellCheck={false} autoComplete="off" placeholder={saved ? 'paste a new key' : 'your Presage API key'}
              value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Presage API key" />
          </form>
        )}
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <Btn primary k="Enter" onClick={onLive}>Use my camera</Btn>
          <Btn ghost k="S" onClick={onSim}>Try a sample run (no camera)</Btn>
        </div>
        <div className="small" style={{ marginTop: 14 }}>
          {!ready && <>Your key is {kept} and only goes to the Presage SDK. </>}
          No key? The sample run plays the whole game with a simulated body and made up signals, clearly marked on screen.
          {saved && <> <button className="link" onClick={() => void forget()}>Forget my key</button></>}
        </div>
      </div>
    </div>
  );
}
