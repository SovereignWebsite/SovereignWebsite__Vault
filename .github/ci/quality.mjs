// Quality checks on the built site, before anything is deployed. Any error fails the run.
// node .github/ci/quality.mjs _site   Writes a table of the checks to $GITHUB_STEP_SUMMARY.
// Seeded by SovereignWebsite__Factory. No dependencies (HTML validity and axe run as their own steps).
import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
const dir = process.argv[2] || '_site';
const host = existsSync(join(dir, 'CNAME')) ? readFileSync(join(dir, 'CNAME'), 'utf8').trim() : '';
const files = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } }; walk(dir);
const pages = files.filter((f) => f.endsWith('.html'));
const results = []; const add = (name, errors, warnings = []) => results.push({ name, errors, warnings });

// 1. Links and assets inside the site: every href and src must resolve to a file in the build.
const internal = [], external = new Map();
for (const p of pages) {
  const h = readFileSync(p, 'utf8'); const at = '/' + relative(dir, p).split('\\').join('/');
  for (const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (/^(mailto:|tel:|data:|javascript:|#)/.test(u)) continue;
    if (host && u.startsWith(`https://${host}/`)) u = u.slice(`https://${host}`.length);
    if (/^https?:\/\//.test(u)) { if (!external.has(u)) external.set(u, at); continue; }
    const path = u.split('#')[0].split('?')[0]; if (!path) continue;
    const abs = path.startsWith('/') ? path : posix.join(posix.dirname(at), path);
    const f = join(dir, decodeURI(abs)); const ok = existsSync(f) && (statSync(f).isFile() || existsSync(join(f, 'index.html')));
    if (!ok) internal.push(`${at}: ${u} is not in the site`);
  }
}
add('Internal links and assets', internal);

// 2. External links: 404 or 410 fails; a timeout or other error only warns.
const extErr = [], extWarn = [];
await Promise.all([...external].map(async ([u, at]) => {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    let r = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: ctl.signal }).catch(() => null);
    if (!r || r.status === 405 || r.status === 403) r = await fetch(u, { redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    if (r.status === 404 || r.status === 410) extErr.push(`${at}: ${u} answers ${r.status}`);
    else if (r.status >= 400) extWarn.push(`${at}: ${u} answers ${r.status}`);
  } catch (e) { extWarn.push(`${at}: ${u} did not answer (${e.name})`); }
}));
add(`External links (${external.size})`, extErr, extWarn);

// 3. No em dashes in visible text (the house style).
const dash = [];
for (const p of pages) {
  const text = readFileSync(p, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
  if (text.includes('\u2014')) dash.push(`${relative(dir, p)}: an em dash in visible text`);
}
add('No em dashes', dash);

// 4. A customer site carries no family strip above its header: only the top-right pop-up.
// One of SovereignWebsite's own sites (FAMILY=bar in the workflow) carries the family bar on every page instead.
const own = process.env.FAMILY === 'bar';
// FAMILY_DEMO lists pages (relative to the site) that stand in for a customer's page, so carry neither.
const demo = (process.env.FAMILY_DEMO || '').split(/\s+/).filter(Boolean);
const strip = pages.filter((p) => !demo.includes(relative(dir, p).split('\\').join('/')) && /<nav class="family"/.test(readFileSync(p, 'utf8')) !== own).map((p) => own ? `${relative(dir, p)}: no family bar (use build/family-bar.mjs)` : `${relative(dir, p)}: the family strip (use build/family-bar.mjs --credit)`);
add(own ? 'Family bar on every page' : 'No family strip', strip);

// 5. Leak scan: no private key, token or secret in any published file.
const LEAK = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{40,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk-[A-Za-z0-9_-]{32,}/, /\bxox[abpr]-[A-Za-z0-9-]{20,}/, /\bAIza[0-9A-Za-z_-]{35}\b/];
const leaks = [];
for (const f of files) { if (statSync(f).size > 5e6) continue; const s = readFileSync(f).toString('latin1'); for (const re of LEAK) if (re.test(s)) leaks.push(`${relative(dir, f)}: matches ${re.source.slice(0, 24)}`); }
add('Leak scan', leaks);

const failed = results.filter((r) => r.errors.length);
const lines = ['| Check | Result |', '|---|---|', ...results.map((r) => `| ${r.name} | ${r.errors.length ? `failed (${r.errors.length})` : r.warnings.length ? `passed, ${r.warnings.length} warning(s)` : 'passed'} |`)];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Quality checks\n\n' + lines.join('\n') + '\n\n');
for (const r of results) { for (const w of r.warnings) console.log(`::warning::${r.name}: ${w}`); for (const e of r.errors) console.log(`::error::${r.name}: ${e}`); }
console.log(lines.join('\n'));
process.exit(failed.length ? 1 : 0);
