/** Self hosted faces (SIL OFL, licences beside the files in public/fonts). Relative URLs so file:// works. */
const FACES: [family: string, file: string, weight: string, style: string][] = [
  ['Vault Display', 'cormorant-garamond-latin-500-normal.woff2', '500', 'normal'],
  ['Vault Display', 'cormorant-garamond-latin-600-normal.woff2', '600', 'normal'],
  ['Vault Display', 'cormorant-garamond-latin-500-italic.woff2', '500', 'italic'],
  ['Vault Sans', 'jost-latin-400-normal.woff2', '400', 'normal'],
  ['Vault Sans', 'jost-latin-500-normal.woff2', '500', 'normal'],
];

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (loading) return loading;
  loading = Promise.all(FACES.map(async ([family, file, weight, style]) => {
    try {
      const url = new URL(`./fonts/${file}`, document.baseURI).href;
      const face = new FontFace(family, `url(${url}) format('woff2')`, { weight, style, display: 'swap' });
      document.fonts.add(await face.load());
    } catch { /* fall back to the serif stack */ }
  })).then(() => undefined);
  return loading;
}
