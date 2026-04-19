import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOverview } from './htmlUtils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INPUT =
  'This digest covers 38 commits from [182b8182](https://chromium.googlesource.com/chromium/src/+/182b81823747b960b02483ecfca2ce8a25b42a6f) to [086d34dd](https://chromium.googlesource.com/chromium/src/+/086d34dd83a6a42dddac8c33fbd1aef7c574ea4b). A major web platform change enabling `CSSPseudoElement` and `event.pseudoTarget` by default may require attention from web developers. Other changes include UI refinements on Android, accessibility improvements on macOS, and significant internal refactoring.';

test('renderOverview produces exactly 2 anchor links', () => {
  const result = renderOverview(INPUT);
  const links = result.match(/<a\s/g) ?? [];
  assert.equal(links.length, 2, `Expected 2 <a> tags, got ${links.length}:\n${result}`);
});

test('renderOverview produces no nested <a> tags', () => {
  const result = renderOverview(INPUT);
  const nestedAnchor = [...result.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)]
    .some(([, inner]) => /<a[\s>]/.test(inner));
  assert.ok(!nestedAnchor, `Found nested <a> tags in output:\n${result}`);
});

test('renderOverview produces exactly 2 <code> elements', () => {
  const result = renderOverview(INPUT);
  const codes = result.match(/<code\s/g) ?? [];
  assert.equal(codes.length, 2, `Expected 2 <code> elements, got ${codes.length}:\n${result}`);
});

test('renderOverview links point to chromium.googlesource.com for markdown links', () => {
  const result = renderOverview(INPUT);
  const hrefs = [...result.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(
    hrefs.every(href => href.startsWith('https://chromium.googlesource.com/')),
    `Expected all hrefs to be chromium.googlesource.com links, got:\n${JSON.stringify(hrefs, null, 2)}`
  );
});

// Write visual output file for manual inspection
const rendered = renderOverview(INPUT);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>renderOverview test output</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-gray-200 p-8 font-sans">
  <h1 class="text-xl font-bold mb-6 text-white">renderOverview visual test</h1>

  <section class="mb-8">
    <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Input</h2>
    <pre class="bg-gray-800 rounded p-4 text-sm whitespace-pre-wrap break-words text-gray-300">${INPUT}</pre>
  </section>

  <section class="mb-8">
    <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Rendered HTML source</h2>
    <pre class="bg-gray-800 rounded p-4 text-sm whitespace-pre-wrap break-words text-gray-300">${rendered.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </section>

  <section>
    <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Visual result</h2>
    <div class="bg-gray-800 rounded p-4 text-sm leading-relaxed">${rendered}</div>
  </section>
</body>
</html>`;

mkdirSync(join(__dirname, '../test-output'), { recursive: true });
const outPath = join(__dirname, '../test-output/renderOverview.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`Visual output written to: ${outPath}`);
