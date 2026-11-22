// Deploys the browser build (web-dist/, made by npm run web) to the Vercel project "vault" as production.
// Uses the Vercel CLI login on this machine. Run it through npm run web:deploy, which builds first.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('web-dist/index.html')) {
  console.error('web-dist/index.html is missing: run npm run web first.');
  process.exit(1);
}
const r = spawnSync('npx', ['vercel', 'deploy', 'web-dist', '--prod', '--yes', '--project', 'vault'], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
