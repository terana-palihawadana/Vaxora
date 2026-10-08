// Fails when a hardcoded hex color appears outside the design tokens.
// Colors belong in src/styles/variables.css; use var(--color-*) elsewhere.
// Usage: npm run lint:colors
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

// Files allowed to hold raw hex values.
const ALLOWED = [
  'styles/variables.css', // the palette itself
  'styles/admin.css', // admin portal is not migrated yet
  'features/admin/', // admin portal is not migrated yet
  'features/patient/services/carePlanPdfService.js', // jsPDF needs literal colors
];

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
const EXTENSIONS = ['.css', '.js', '.jsx'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
for (const file of walk(root)) {
  const rel = relative(root, file).split(sep).join('/');
  if (!EXTENSIONS.some((ext) => rel.endsWith(ext))) continue;
  if (ALLOWED.some((allowed) => rel.startsWith(allowed))) continue;
  if (/\.(test|spec)\.jsx?$/.test(rel)) continue;

  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const match of line.matchAll(HEX)) {
      if (line[match.index - 1] === '&') continue; // HTML entity like &#123;
      problems.push(`src/${rel}:${i + 1}  ${match[0]}`);
    }
  });
}

if (problems.length) {
  console.error(`Found ${problems.length} hardcoded color(s). Use a token from src/styles/variables.css instead:\n`);
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('No hardcoded colors outside the design tokens.');
