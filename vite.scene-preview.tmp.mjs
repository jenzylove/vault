// TEMP (scene agent): standalone renderer server for screenshots; delete after use.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
export default { root: resolve('src/renderer'), publicDir: resolve('src/renderer/public'), plugins: [react()], server: { port: 5174, strictPort: true } };
