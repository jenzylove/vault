// The browser build's title screen note. It lives outside the game's React tree and shows only while the
// title screen is up (the game marks its screen on .vui[data-screen]).
const RELEASE = 'https://github.com/jenzylove/vault/releases/tag/v0.1.0';

const CSS = `
.web-note { display: none; position: fixed; left: 50%; bottom: max(18px, 3vh); transform: translateX(-50%);
  z-index: 20; max-width: min(760px, calc(100vw - 32px)); padding: 9px 16px; border-radius: 12px; text-align: center;
  font: 400 var(--fs-xs, 13px)/1.45 'Heist Sans', 'Rubik', system-ui, sans-serif; color: #f4e8d3;
  background: rgba(42, 5, 12, 0.78); border: 1px solid rgba(244, 232, 211, 0.22); }
.web-note a { color: #f4e8d3; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
body:has(.vui[data-screen="title"]) .web-note { display: block; }
`;

export function mountWebNote(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const note = document.createElement('div');
  note.className = 'web-note';
  note.setAttribute('role', 'note');
  note.append('This browser version plays the sample run. Live play reads you on camera and needs the ');
  const a = document.createElement('a');
  a.href = RELEASE;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Windows app';
  note.append(a, '.');
  document.body.appendChild(note);
}
