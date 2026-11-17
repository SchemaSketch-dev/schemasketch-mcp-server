// Fails when the npm package would be missing a file the stdio server needs.
// Follows every relative import from the package's bin entry and checks each
// file is in what `npm pack` would publish. Runs before `npm publish`
// (prepublishOnly) and by hand: npm run check-package
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const raw = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
// npm 11 prints a list with one entry per package; newer npm versions print
// a single object, or one keyed by package name. Accept all three.
const output = JSON.parse(raw);
const packed = [output, ...(Array.isArray(output) ? output : Object.values(output ?? {}))]
  .find((entry) => Array.isArray(entry?.files));
if (!packed) {
  console.error(`check-package: couldn't read the file list from \`npm pack --json\`. Its output was:\n${raw.slice(0, 2000)}`);
  process.exit(1);
}
const published = new Set(packed.files.map((f) => f.path));

const entries = [...new Set(Object.values(pkg.bin ?? {}).concat(pkg.main ?? []).map((f) => normalize(f)))];
const seen = new Set();
const missing = [];
const importRe = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!published.has(file)) missing.push(file);
  let source;
  try { source = readFileSync(join(root, file), 'utf8'); } catch { return; }
  for (const m of source.matchAll(importRe)) {
    const spec = m[1] ?? m[2];
    walk(normalize(relative(root, join(root, dirname(file), spec))).split('\\').join('/'));
  }
}
entries.forEach(walk);

if (missing.length) {
  console.error(`check-package: these files are imported but not published (add them to "files" in package.json):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-package: ok, ${seen.size} files reachable from ${entries.join(', ')} are all in the package (${published.size} files packed).`);
