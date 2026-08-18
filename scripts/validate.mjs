import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const absolute = join(directory, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) await walk(absolute);
    else if (extname(entry) === '.html') htmlFiles.push(absolute);
  }
}

function report(file, message) {
  failures.push(`${file.replace(root + '/', '')}: ${message}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await walk(root);

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const relative = file.replace(root + '/', '');
  const mainCount = (html.match(/<main(?:\s|>)/g) || []).length;
  const h1Count = (html.match(/<h1(?:\s|>)/g) || []).length;

  if (mainCount !== 1) report(file, `expected one <main>, found ${mainCount}`);
  if (h1Count !== 1) report(file, `expected one <h1>, found ${h1Count}`);
  if (!/<html[^>]+lang="en"/.test(html)) report(file, 'missing English language declaration');
  if (!/<meta\s+name="viewport"/.test(html)) report(file, 'missing viewport metadata');
  if (!/<a[^>]+class="[^"]*skip-link/.test(html)) report(file, 'missing skip link');
  if (!/<main(?=[^>]*\bid="main-content")(?=[^>]*\btabindex="-1")[^>]*>/.test(html)) {
    report(file, 'main skip-link target must be programmatically focusable');
  }

  for (const match of html.matchAll(/<a\b([^>]*target="_blank"[^>]*)>/g)) {
    if (!/rel="[^"]*noopener[^"]*"/.test(match[1])) report(file, 'target="_blank" link is missing rel="noopener"');
  }

  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(match[1])) report(file, `anchor #${match[1]} has no matching id`);
  }

  for (const match of html.matchAll(/(?:href|src)="([^"#?]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|tel:|data:)/.test(target)) continue;
    const localPath = target.startsWith('/') ? join(root, normalize(target)) : resolve(file, '..', target);
    if (!(await exists(localPath))) report(file, `missing local asset ${target}`);
  }

  const disallowed = [
    /all systems operational/i,
    /100% GitOps/i,
    /self-healing/i,
    /production-ready tools/i,
    /when you hire our team/i,
    /replaces (?:Datadog|PagerDuty|Terraform Cloud)/i
  ];
  for (const pattern of disallowed) {
    if (pattern.test(html)) report(file, `contains disallowed claim matching ${pattern}`);
  }

  if (relative === 'index.html' && !/Every system carries an evidence state/.test(html)) {
    report(file, 'homepage is missing its evidence-state explanation');
  }
}

if (failures.length) {
  console.error(`Validation failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Validated ${htmlFiles.length} HTML file${htmlFiles.length === 1 ? '' : 's'} with no structural, local-link, or claim-boundary errors.`);
}
