import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const assetDir = join(process.cwd(), 'dist', 'assets');
const assets = readdirSync(assetDir).map(name => {
  const bytes = readFileSync(join(assetDir, name));
  return { name, raw: bytes.length, gzip: gzipSync(bytes).length };
});
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const js = assets.filter(asset => asset.name.endsWith('.js'));
const css = assets.filter(asset => asset.name.endsWith('.css'));
const wasm = assets.filter(asset => asset.name.endsWith('.wasm'));
const entry = js.filter(asset => asset.name.startsWith('index-')).sort((a, b) => b.raw - a.raw)[0];
const largestJs = [...js].sort((a, b) => b.gzip - a.gzip)[0];
const largestCss = [...css].sort((a, b) => b.gzip - a.gzip)[0];
const largestWasm = [...wasm].sort((a, b) => b.raw - a.raw)[0];

assert(entry && entry.gzip <= 90_000, `entry JavaScript is ${entry?.gzip ?? 0} gzip bytes (budget 90000)`);
assert(largestJs && largestJs.gzip <= 180_000, `largest JavaScript chunk ${largestJs?.name} is ${largestJs?.gzip ?? 0} gzip bytes (budget 180000)`);
assert(!largestCss || largestCss.gzip <= 20_000, `CSS is ${largestCss?.gzip ?? 0} gzip bytes (budget 20000)`);
assert(!largestWasm || largestWasm.raw <= 25_000_000, `WASM ${largestWasm?.name} is ${largestWasm?.raw ?? 0} bytes (budget 25000000)`);
assert(js.some(asset => asset.name.startsWith('transformers.web-')), 'semantic-search transformer must remain a separate lazy chunk');

if (failures.length) {
  console.error(failures.map(item => `PERFORMANCE BUDGET: ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Performance budgets passed: entry ${entry.gzip} B gzip; largest JS ${largestJs.gzip} B gzip; CSS ${largestCss?.gzip ?? 0} B gzip; WASM ${largestWasm?.raw ?? 0} B raw.`);
