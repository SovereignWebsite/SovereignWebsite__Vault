// Build _site from site/: copy it, write version.json, and put the version chip on every page.
// node .github/ci/build.mjs   (env: SITE_VERSION, GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID)
// The version is made by this pipeline from the git tags, never typed by hand. The chip's CSS is a file
// (/assets/sws-version.css), not inline, so a strict style-src 'self' policy needs no exception (security.b, review 001). Seeded by SovereignWebsite__Factory.
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const e = process.env;
const version = e.SITE_VERSION || 'v0.0.0';
const commit = (e.GITHUB_SHA || 'local').slice(0, 7);
const date = new Date().toISOString().slice(0, 10);
const run = e.GITHUB_RUN_ID ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}` : '';
rmSync('_site', { recursive: true, force: true });
cpSync('site', '_site', { recursive: true });
writeFileSync('_site/version.json', JSON.stringify({ version, commit, date, run, built_at: new Date().toISOString() }, null, 1) + '\n');
const chip = `<a class="sws-version" href="${run || '/version.json'}" title="This build: its checks and its deploy">${version} · ${commit} · ${date}</a>`;
const css = '.sws-version{display:block;width:max-content;margin:1.5rem auto 1rem;padding:.15rem .55rem;border:1px solid rgba(127,127,127,.35);border-radius:999px;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:inherit;font-size:11px;text-decoration:none}.sws-version:hover,.sws-version:focus-visible{text-decoration:underline}@media print{.sws-version{display:none}}';
const link = '<link rel="stylesheet" href="/assets/sws-version.css">';
mkdirSync('_site/assets', { recursive: true });
writeFileSync('_site/assets/sws-version.css', css + '\n');
let n = 0;
const walk = (d) => { for (const x of readdirSync(d, { withFileTypes: true })) { const p = join(d, x.name); if (x.isDirectory()) walk(p); else if (x.name.endsWith('.html')) {
  let s = readFileSync(p, 'utf8');
  if (/<meta\s+http-equiv="refresh"/i.test(s)) continue;
  s = s.replace(/<a class="sws-version"[^>]*>[^<]*<\/a>/g, '').replace(/<link rel="stylesheet" href="\/assets\/sws-version\.css">\n?/g, '').replace(/<\/head>/i, `${link}\n</head>`);
  // Inside the page's footer (a landmark), or in a footer of its own: axe's "region" rule (design.b, 20 Nov 2026).
  const last = s.lastIndexOf('</footer>');
  s = last >= 0 ? s.slice(0, last) + `${chip}\n` + s.slice(last) : s.replace(/<\/body>/i, `<footer class="sws-version-foot">${chip}</footer>\n</body>`);
  writeFileSync(p, s); n++;
} } };
walk('_site');
console.log(`built _site: ${version} · ${commit} · ${date}, chip on ${n} pages`);
