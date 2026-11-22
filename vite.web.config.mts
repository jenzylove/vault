// Browser build of the renderer (npm run web, output in web-dist/): the keyless sample run, no Electron.
// The Presage SDK imports resolve to a stub (live play needs the Windows app) and the page entry adds a
// short note on the title screen. The desktop build (electron.vite.config.ts) is untouched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = import.meta.dirname;

const webEntry = (): Plugin => ({
  name: 'vault-web-entry',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html
      .replace('src="/main.tsx"', 'src="../web/main.tsx"')
      .replace('<title>', '<link rel="icon" type="image/png" href="./icon.png" />\n    <title>'),
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'icon.png', source: readFileSync(resolve(__dirname, 'build/icon.png')) });
  },
});

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  publicDir: resolve(__dirname, 'src/renderer/public'),
  base: './',
  plugins: [webEntry(), react()],
  // the scene drops to lite on a machine that cannot hold a playable frame rate (scene/VaultScene.tsx)
  define: { 'import.meta.env.VITE_VAULT_WEB': JSON.stringify('1') },
  resolve: {
    alias: [{ find: /^@smartspectra\/node-sdk\/(renderer|messages)$/, replacement: resolve(__dirname, 'src/web/presageStub.ts') }],
  },
  build: { outDir: resolve(__dirname, 'web-dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
