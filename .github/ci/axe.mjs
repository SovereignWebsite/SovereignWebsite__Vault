// Accessibility: axe-core on the home page and every page under designs/ (and each top-level page), served locally.
// node .github/ci/axe.mjs _site   Needs playwright and @axe-core/playwright (installed by the workflow). Fails on any violation.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync, appendFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const dir = process.argv[2] || '_site';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain' };
const server = createServer((q, r) => { let f = join(dir, decodeURI(q.url.split('?')[0])); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html'); if (!existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f)); });
await new Promise((ok) => server.listen(0, ok)); const base = `http://127.0.0.1:${server.address().port}`;
const paths = ['/'];
for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && existsSync(join(dir, e.name, 'index.html'))) paths.push(`/${e.name}/`);
if (existsSync(join(dir, 'designs'))) for (const e of readdirSync(join(dir, 'designs'), { withFileTypes: true })) { if (e.isDirectory() && existsSync(join(dir, 'designs', e.name, 'index.html'))) paths.push(`/designs/${e.name}/`); else if (e.name.endsWith('.html')) paths.push(`/designs/${e.name}`); }
const b = await chromium.launch(); const rows = []; let bad = 0;
for (const p of [...new Set(paths)]) {
  const ctx = await b.newContext(); const page = await ctx.newPage(); await page.goto(base + p);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of r.violations) console.log(`::error::axe ${p}: ${v.id} (${v.impact}) on ${v.nodes.length} element(s): ${v.help}`);
  rows.push(`| ${p} | ${r.violations.length ? `failed (${r.violations.map((v) => v.id).join(', ')})` : 'passed'} |`); bad += r.violations.length; await ctx.close();
}
await b.close(); server.close();
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Accessibility (axe-core)\n\n| Page | Result |\n|---|---|\n' + rows.join('\n') + '\n\n');
console.log(rows.join('\n')); process.exit(bad ? 1 : 0);
