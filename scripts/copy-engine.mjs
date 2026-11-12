// Copies the Stockfish 19 lite single-threaded engine files from the npm
// package into public/engine/ so Vite serves them as static assets.
// The .js locates its .wasm by its own file name, so names are kept identical.
// Re-runnable: overwrites existing copies. Run via `npm run copy-engine`.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'stockfish');
const outDir = join(root, 'public', 'engine');

const files = [
  { from: join(pkg, 'bin', 'stockfish-19-lite-single.js'), to: join(outDir, 'stockfish-19-lite-single.js') },
  { from: join(pkg, 'bin', 'stockfish-19-lite-single.wasm'), to: join(outDir, 'stockfish-19-lite-single.wasm') },
  { from: join(pkg, 'Copying.txt'), to: join(outDir, 'Copying.txt') },
];

mkdirSync(outDir, { recursive: true });
for (const { from, to } of files) {
  if (!existsSync(from)) {
    console.error(`Missing source: ${from}\nRun "npm install" first.`);
    process.exit(1);
  }
  copyFileSync(from, to);
  console.log(`copied ${to.replace(root + '\\', '').replace(root + '/', '')}`);
}
console.log('Engine files ready in public/engine/');
