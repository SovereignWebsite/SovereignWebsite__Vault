// Quality checks on the built site, before anything is deployed. Any error fails the run.
// node .github/ci/quality.mjs _site   Writes a table of the checks to $GITHUB_STEP_SUMMARY.
// Seeded by SovereignWebsite__Factory. No dependencies (HTML validity and axe run as their own steps).
import { readFileSync, readdirSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';
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

// 4. A customer site carries no family strip above its header: only the top-right pop-up. The organisation's
//    own sites (SWS_OWN_SITE=1, set in their pages.yml) keep the family bar.
const strip = process.env.SWS_OWN_SITE === '1' ? [] : pages.filter((p) => /<nav class="family"/.test(readFileSync(p, 'utf8'))).map((p) => `${relative(dir, p)}: the family strip (use build/family-bar.mjs --credit)`);
add('No family strip', strip);

// 4b. Agent Behaviour Policy: every site publishes its policy (/policy/abp.json) and a plain-English page about it
//     (/policy/). Dinis, 21 Nov 2026 16:45 UTC: "make sure that every site has an ABP policy and explanation of how it
//     works and what it does".
const abp = [];
{ const f = join(dir, 'policy', 'abp.json'); let p = null;
  if (!existsSync(f)) abp.push('policy/abp.json is missing');
  else { try { p = JSON.parse(readFileSync(f, 'utf8')); } catch { abp.push('policy/abp.json is not valid JSON'); } }
  if (p) {
    if (p.version !== 1) abp.push('policy/abp.json: version must be 1');
    for (const k of ['about', 'owner', 'roles', 'pipelines', 'changes']) if (!p[k]) abp.push(`policy/abp.json: ${k} is missing`);
    const k = p.roles?.keeper;
    if (!k || !Array.isArray(k.may_change) || !k.may_change.length) abp.push('policy/abp.json: roles.keeper.may_change is missing');
    if ((k?.branches || []).includes('main')) abp.push('policy/abp.json: no agent may push to main');
    if (/{{[a-z_]+}}/.test(JSON.stringify(p))) abp.push('policy/abp.json: a {{placeholder}} was never filled in');
    // The floor (security.b, review 026): a keeper may add rules, never remove the core ones or widen what the pipeline may do.
    const CORE = ["push to main", "print, commit or read a private key or token", "name a private person without their consent", "invent a fact, a price or a customer", "add a server, cookies or tracking"];
    for (const c of CORE) if (!(k?.never || []).includes(c)) abp.push(`policy/abp.json: roles.keeper.never must keep "${c}"`);
    const ALLOWED = ["build the site", "deploy it to GitHub Pages", "tag the released commit with its version"];
    for (const a of p.pipelines?.pages?.allowed || []) if (!ALLOWED.includes(a)) abp.push(`policy/abp.json: pipelines.pages.allowed may not add "${a}"`);
  }
  if (!existsSync(join(dir, 'policy', 'index.html'))) abp.push('policy/index.html (the plain-English page) is missing');
}
add('Agent Behaviour Policy', abp);

// 5. Leak scan: no private key, token or secret in any published file.
// The same shapes as the Factory's build/leak-scan.mjs (SHAPES and the bare sgit vault key), kept in step by its tests.
const DASHES = '-{5}';
const LEAK = [
  new RegExp(`${DASHES}BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?${DASHES}`),
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/,
  /aws_?secret_?(?:access_?)?key\s*["']?\s*[:=]\s*["']?[A-Za-z0-9\/+]{40}(?![A-Za-z0-9\/+])/i,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/,
  /\bsgit_(?:private_vault|private_read|vk1|rk1)_[A-Za-z0-9:]{8,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
];
// A bare sgit vault key, {passphrase}:{vault_id}: the passphrase side mixes letters and digits and is not pure hex.
const VAULT_PAIR = /(?<![A-Za-z0-9_\/.-])([a-z0-9]{16,64}):([a-z0-9]{4,24})(?![A-Za-z0-9_\/.-])/g;
const vaultPair = (s) => { for (const m of s.matchAll(VAULT_PAIR)) { const p = m[1]; if (/[a-z]/.test(p) && /[0-9]/.test(p) && !/^[0-9a-f]+$/.test(p)) return true; } return false; };
const leaks = [];
// A zip (found by its content, whatever its name) is opened and every entry is scanned: a sealed vault's entries are
// ciphertext and pass, a plain zip with a key inside does not. A zip that cannot be read fails (security.b, reviews 004).
const MAX_ENTRY = 200 * 1024 * 1024;
function zipEntries(b) {
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65558); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('no end of central directory');
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = [];
  for (let k = 0; k < n; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged central directory');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28); const raw = b.subarray(start, start + csize);
    if (!name.endsWith('/')) { if (method === 0) out.push([name, raw]); else if (method === 8) out.push([name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY })]); else throw new Error(`${name}: compression method ${method}`); }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const isZip = (b) => b.length >= 22 && (b.readUInt32LE(0) === 0x04034b50 || b.subarray(Math.max(0, b.length - 65558)).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])));
// Large files are scanned in 4 MB pieces that overlap by 8 KB, so a secret across a boundary is still found.
const scan = (label, buf) => { const step = 4 * 1024 * 1024, lap = 8192;
  for (let o = 0; o < buf.length; o += step) { const s = buf.subarray(o, Math.min(buf.length, o + step + lap)).toString('latin1'); for (const re of LEAK) if (re.test(s)) leaks.push(`${label}: matches ${re.source.slice(0, 24)}`); if (vaultPair(s)) leaks.push(`${label}: an sgit vault key shape (passphrase:vault_id)`); } };
// A vault (any zip with a manifest.json) must hold only ciphertext: each entry but manifest.json over 1 KB must look
// random (more than 7.5 bits of entropy per byte), so a plaintext letter inside it fails even with no secret in it.
// Entropy cannot tell an unencrypted JPEG or PDF from ciphertext: the sealing tool is the real control here.
const entropy = (b) => { const c = new Array(256).fill(0); for (const x of b) c[x]++; let h = 0; for (const n of c) if (n) { const p = n / b.length; h -= p * Math.log2(p); } return h; };
for (const f of files) {
  const at = relative(dir, f).split('\\').join('/'); const b = readFileSync(f);
  if (isZip(b) || at.endsWith('.zip')) {
    try {
      const entries = zipEntries(b); const vault = entries.some(([name]) => name === 'manifest.json');
      for (const [name, data] of entries) {
        scan(`${at}!${name}`, data);
        if (vault && name !== 'manifest.json' && data.length > 1024 && entropy(data) <= 7.5) leaks.push(`${at}!${name}: not ciphertext (${entropy(data).toFixed(2)} bits per byte): a sealed vault holds only encrypted objects`);
      }
    } catch (e) { leaks.push(`${at}: ${at.endsWith('.zip') ? 'named .zip' : 'looks like a zip (a zip header or end record was found)'} but is not a readable zip (${e.message})`); }
    continue;
  }
  scan(at, b);
}
add('Leak scan', leaks);

const failed = results.filter((r) => r.errors.length);
const lines = ['| Check | Result |', '|---|---|', ...results.map((r) => `| ${r.name} | ${r.errors.length ? `failed (${r.errors.length})` : r.warnings.length ? `passed, ${r.warnings.length} warning(s)` : 'passed'} |`)];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Quality checks\n\n' + lines.join('\n') + '\n\n');
for (const r of results) { for (const w of r.warnings) console.log(`::warning::${r.name}: ${w}`); for (const e of r.errors) console.log(`::error::${r.name}: ${e}`); }
console.log(lines.join('\n'));
process.exit(failed.length ? 1 : 0);
