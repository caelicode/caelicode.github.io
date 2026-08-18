import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/styles.css', import.meta.url), 'utf8');
const script = await readFile(new URL('../assets/site.js', import.meta.url), 'utf8');

test('the platform inventory exposes all supported evidence states', () => {
  for (const label of [
    'Live · public',
    'Live · authenticated',
    'Active · private',
    'Source · public',
    'Reference · private'
  ]) {
    assert.match(html, new RegExp(label.replace('·', '\\·')));
  }
});

test('the page links to the strongest public evidence surfaces', () => {
  for (const url of [
    'https://github.com/caelicode/status-page',
    'https://github.com/caelicode/.github',
    'https://github.com/caelicode/send-email',
    'https://runnerly.caelicode.com/',
    'https://caelicode.com/runnerly',
    'https://caelicode.com/assets/caelicode-engineering-brief.pdf'
  ]) {
    assert.ok(html.includes(url), `missing public evidence link: ${url}`);
  }
});

test('the page avoids unsupported platform and workforce claims', () => {
  for (const claim of [
    'All systems operational',
    '100% GitOps',
    'self-healing',
    'six integrated',
    'production-grade',
    'our team',
    'hire us'
  ]) {
    assert.ok(!html.toLowerCase().includes(claim.toLowerCase()), `unsupported claim remains: ${claim}`);
  }
});

test('responsive and accessibility behaviors are present', () => {
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<main(?=[^>]*id="main-content")(?=[^>]*tabindex="-1")/);
  assert.doesNotMatch(css, /body\s*\{[^}]*min-width:\s*320px/s);
  assert.match(html, /role="tablist"/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /aria-pressed/);
});
