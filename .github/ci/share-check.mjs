// Fails the deploy when a page has no link preview: every HTML page under site/ needs its Open Graph and Twitter
// tags, and a 1200x630 JPEG share card under 300 KB, served from this site. node .github/ci/share-check.mjs _site
// Seeded by SovereignWebsite__Factory. No dependencies.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const dir = process.argv[2] || 'site';
const host = existsSync(join(dir, 'CNAME')) ? readFileSync(join(dir, 'CNAME'), 'utf8').trim() : '';
const NEED = ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name', 'og:locale', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'];
// The seed's own neutral card: allowed so a new site deploys, but the site's agent replaces it with the owner's.
const SEED_CARD = 'sovereignwebsite-seed-card'; // a JPEG comment in the seed's card
const errors = [], notes = [];
const pages = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push(p); } };
walk(dir);
const meta = (h, k) => { const m = h.match(new RegExp(`<meta\\s+(?:property|name)="${k.replace(/[.:]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i')); return m ? m[1] : null; };
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const checked = new Set();
for (const p of pages) {
  const h = readFileSync(p, 'utf8'); const at = relative(dir, p);
  if (/<meta\s+http-equiv="refresh"/i.test(h)) continue; // a redirect page has no preview of its own
  for (const k of NEED) if (!meta(h, k)) errors.push(`${at}: no ${k}`);
  const url = meta(h, 'og:url'), img = meta(h, 'og:image');
  if (url && !/^https:\/\//.test(url)) errors.push(`${at}: og:url must be an absolute https address`);
  if (meta(h, 'twitter:card') && meta(h, 'twitter:card') !== 'summary_large_image') errors.push(`${at}: twitter:card must be summary_large_image`);
  if (meta(h, 'og:image:width') && meta(h, 'og:image:width') !== '1200') errors.push(`${at}: og:image:width must be 1200`);
  if (meta(h, 'og:image:height') && meta(h, 'og:image:height') !== '630') errors.push(`${at}: og:image:height must be 630`);
  if (!img) continue;
  const m = img.match(/^https:\/\/([^/]+)(\/.*)$/);
  if (!m) { errors.push(`${at}: og:image must be an absolute https address`); continue; }
  if (host && m[1] !== host) { errors.push(`${at}: og:image must be served from ${host}, not ${m[1]}`); continue; }
  const file = join(dir, decodeURI(m[2]));
  if (checked.has(file)) continue; checked.add(file);
  if (!existsSync(file)) { errors.push(`${at}: og:image ${m[2]} is not in ${dir}/`); continue; }
  const b = readFileSync(file); const s = jpegSize(b);
  if (!s) errors.push(`${m[2]}: not a JPEG`);
  else if (s.w !== 1200 || s.h !== 630) errors.push(`${m[2]}: ${s.w}x${s.h}, must be 1200x630`);
  if (statSync(file).size > 300 * 1024) errors.push(`${m[2]}: ${Math.round(statSync(file).size / 1024)} KB, must be under 300 KB`);
  if (b.includes(SEED_CARD)) notes.push(`${m[2]} is still the seed's neutral card: make the owner's own with build/share-card.mjs in SovereignWebsite__Factory`);
}
for (const n of notes) console.log(`::warning::${n}`);
if (errors.length) { for (const e of errors) console.log(`::error::${e}`); process.exit(1); }
console.log(`share check: ${pages.length} pages OK`);
