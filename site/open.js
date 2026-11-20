// Open an sgit vault in the browser: a vault zip (sgit vault backup) and a read key.
// The key comes from the link after the #, a QR code or a paste; it never leaves this page.
// Decrypts with WebCrypto (AES-256-GCM, the sgit envelope), keeps the files on this device
// (IndexedDB), and shows the site in a sandboxed frame that cannot reach the network.
// No server code, no cookies, no tracking, no third-party scripts. Apache-2.0.
'use strict';

const $ = (s) => document.querySelector(s);
// Files next to this script (the QR reader), wherever the page that loads it lives.
const HERE = typeof document !== 'undefined' && document.currentScript ? new URL('.', document.currentScript.src) : null;
// A gated site: <html data-vault-zip="private/<id>.zip"> fixes the vault, so its link and QR code carry only the key.
const GATE_ZIP = typeof document !== 'undefined' ? document.documentElement.dataset.vaultZip || null : null;
const enc = new TextEncoder(), dec = new TextDecoder();
const DEFLATE_MAGIC = [0x00, 0x73, 0x67, 0x7a, 0x31]; // "\0sgz1": iv + AES-GCM(deflate(plaintext))

// ---------- keys ----------
function readKeyHex(input) {
  const k = (input || '').trim();
  if (/^(sgit_private_vault_|sgit_vk1_)/.test(k)) throw new Error('That is a vault key, which can write. This page only takes a read key.');
  const m = k.match(/^(?:sgit_public_read_|sgit_private_read_|sgit_rk1_)?([0-9a-f]{64})(?::[a-z0-9]{4,24})?$/i);
  if (!m) throw new Error('That does not look like an sgit read key.');
  return m[1].toLowerCase();
}
const hexBytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

// ---------- zip (stored and deflated entries) ----------
async function inflate(bytes, format) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function unzip(buf) {
  const b = new Uint8Array(buf), v = new DataView(buf);
  let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a zip file.');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The zip is damaged.');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = b.subarray(start, start + csize);
    if (!name.endsWith('/')) files.set(name, method === 8 ? await inflate(raw, 'deflate-raw') : raw.slice());
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// ---------- sgit decryption ----------
async function decryptor(keyHex) {
  const key = await crypto.subtle.importKey('raw', hexBytes(keyHex), 'AES-GCM', false, ['decrypt']);
  const gcm = (d) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, key, d.subarray(12)).then((x) => new Uint8Array(x));
  return async (data) => {
    if (DEFLATE_MAGIC.every((x, i) => data[i] === x) && data.length > 17) {
      try { return await inflate(await gcm(data.subarray(5)), 'deflate'); } catch (_) { /* a v1 object whose iv starts with the magic */ }
    }
    return gcm(data);
  };
}
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function openVault(zipBuf, keyHex) {
  const zip = await unzip(zipBuf);
  const manifest = zip.get('manifest.json') ? JSON.parse(dec.decode(zip.get('manifest.json'))) : {};
  const decrypt = await decryptor(keyHex);
  const obj = async (id) => {
    const d = zip.get('bare/data/' + id);
    if (!d) throw new Error('The zip is missing an object of this vault.');
    return decrypt(d);
  };
  const json = async (id) => JSON.parse(dec.decode(await obj(id)));
  // The newest commit any branch ref points to (named and clone branches alike).
  let head = null, wrongKey = 0, refs = 0;
  for (const [name, data] of zip) {
    if (!name.startsWith('bare/refs/')) continue;
    refs++;
    let ref;
    try { ref = JSON.parse(dec.decode(await decrypt(data))); } catch (_) { wrongKey++; continue; }
    if (!ref.commit_id) continue;
    const c = await json(ref.commit_id);
    if (!head || c.timestamp_ms > head.timestamp_ms) head = c;
  }
  if (!refs) throw new Error('This zip holds no sgit vault.');
  if (!head) throw new Error(wrongKey ? 'This key does not open this vault.' : 'The vault has no commits.');
  const files = new Map();
  const meta = async (s) => (s ? dec.decode(await decrypt(b64(s))) : null);
  async function walk(treeId, prefix) {
    const t = await json(treeId);
    for (const en of t.entries || []) {
      const name = await meta(en.name_enc);
      if (!name || name.includes('/') || name === '..' || name === '.') continue;
      if (en.tree_id) await walk(en.tree_id, prefix + name + '/');
      else if (en.blob_id && !en.large) files.set(prefix + name, { bytes: await obj(en.blob_id), type: await meta(en.content_type_enc) });
    }
  }
  await walk(head.tree_id, '');
  const message = await meta(head.message_enc).catch(() => null);
  return { vaultId: manifest.vault_id || 'vault', commit: head, message, files };
}

// ---------- the site inside ----------
const TYPES = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff',
  json: 'application/json', txt: 'text/plain', md: 'text/plain', pdf: 'application/pdf' };
const typeOf = (path, f) => TYPES[path.split('.').pop().toLowerCase()] || (f && f.type) || 'application/octet-stream';

function resolve(from, ref) {
  if (!ref || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return null;
  const clean = ref.split('#')[0].split('?')[0];
  if (!clean) return null;
  const parts = (clean.startsWith('/') ? [] : from.split('/').slice(0, -1));
  for (const seg of decodeURI(clean).split('/')) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
// A link to a folder ("decks/", "/") means its index page.
function pageFor(files, p) {
  if (p == null) return null;
  if (files.has(p)) return p;
  for (const n of ['index.html', 'index.htm']) { const q = (p ? p.replace(/\/$/, '') + '/' : '') + n; if (files.has(q)) return q; }
  return null;
}
function dataUri(files, path) {
  const f = files.get(path);
  if (!f) return null;
  let s = '';
  for (let i = 0; i < f.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 0x8000));
  return `data:${typeOf(path, f)};base64,${btoa(s)}`;
}
function cssInline(files, from, css) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
    const p = resolve(from, u), d = p && dataUri(files, p);
    return d ? `url("${d}")` : m;
  });
}
function pages(files) {
  const html = [...files.keys()].filter((p) => /\.html?$/i.test(p));
  const designs = [...new Set(html.map((p) => (p.match(/^designs\/([^/]+)\/index\.html?$/i) || [])[1]).filter(Boolean))].sort();
  if (designs.length) return designs.map((d) => ({ label: 'Design ' + d, path: html.find((p) => p.toLowerCase() === `designs/${d}/index.html`) || `designs/${d}/index.htm` }));
  const root = html.find((p) => /^index\.html?$/i.test(p)) || html.sort()[0];
  return root ? [{ label: 'Site', path: root }] : [];
}

// Builds a self-contained page: styles, images and scripts inlined, links between pages
// turned into messages to this page. A CSP blocks every network request from inside.
function render(files, path) {
  const f = files.get(path);
  if (!f) return '<p>Page not found in the vault.</p>';
  const doc = new DOMParser().parseFromString(dec.decode(f.bytes), 'text/html');
  doc.querySelectorAll('meta[http-equiv]').forEach((m) => m.remove());
  for (const l of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const p = resolve(path, l.getAttribute('href')), c = p && files.get(p);
    const st = doc.createElement('style');
    if (c) st.textContent = cssInline(files, p, dec.decode(c.bytes));
    l.replaceWith(st);
  }
  for (const s of doc.querySelectorAll('style')) s.textContent = cssInline(files, path, s.textContent);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', cssInline(files, path, el.getAttribute('style')));
  for (const el of doc.querySelectorAll('img[src],source[src],video[src],audio[src],link[rel~="icon"][href],video[poster]')) {
    for (const a of ['src', 'href', 'poster']) {
      const p = el.hasAttribute(a) && resolve(path, el.getAttribute(a)), d = p && dataUri(files, p);
      if (d) el.setAttribute(a, d);
    }
    el.removeAttribute('srcset');
  }
  for (const s of doc.querySelectorAll('script[src]')) {
    const p = resolve(path, s.getAttribute('src')), c = p && files.get(p);
    s.removeAttribute('src');
    s.textContent = c ? dec.decode(c.bytes) : '';
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    const p = /^\/$/.test(href.split(/[?#]/)[0]) ? '' : resolve(path, href);
    const t = pageFor(files, p);
    if (t) a.setAttribute('data-vault-page', t);
  }
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  doc.head.prepend(csp);
  const nav = doc.createElement('script');
  nav.textContent = "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var p=a.getAttribute('data-vault-page');if(p){e.preventDefault();parent.postMessage({vaultPage:p},'*');}else if(!(a.getAttribute('href')||'').startsWith('#')){e.preventDefault();}});";
  doc.body.append(nav);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

// ---------- this device (IndexedDB) ----------
// The person pastes or scans the key once. On the first good open, this page makes a key pair with
// WebCrypto for its own URL (RSA-OAEP 2048, private key not extractable), encrypts the read key with the
// public key and keeps only that ciphertext, with where the vault zip is. CryptoKey objects live in
// IndexedDB, so the pair and the saved key survive a browser restart. Decrypted files are never stored.
// "Forget" deletes the saved key, and the key pair with the last one.
const SCOPE = typeof location !== 'undefined' ? location.pathname : '/';
const FLAG = 'sv-saved:' + SCOPE; // a plain "something is saved here" flag, so the opening screen shows at once
function db() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('sovereign-vault', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (d.objectStoreNames.contains('vaults')) d.deleteObjectStore('vaults'); // version 1 kept decrypted files
      if (!d.objectStoreNames.contains('keypair')) d.createObjectStore('keypair');
      if (!d.objectStoreNames.contains('saved')) d.createObjectStore('saved', { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function tx(name, mode, fn) {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction(name, mode), r = fn(t.objectStore(name));
    t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); t.onabort = () => no(t.error);
  });
}
async function keyPair(create) {
  let p = await tx('keypair', 'readonly', (s) => s.get(SCOPE));
  if (p || !create) return p || null;
  p = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
  await tx('keypair', 'readwrite', (s) => s.put(p, SCOPE));
  return p;
}
const flag = (on) => { try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (_) { /* storage may be blocked */ } };
const savedId = (v, zip) => SCOPE + '|' + (zip || 'vault:' + v.vaultId);
async function saveKey(v, keyHex, zip, buf) {
  const pair = await keyPair(true);
  const ct = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pair.publicKey, enc.encode(keyHex));
  const rec = { id: savedId(v, zip), scope: SCOPE, zip: zip || null, zipBytes: zip ? null : buf, vaultId: v.vaultId, name: v.name, ct, opened: Date.now() };
  await tx('saved', 'readwrite', (s) => s.put(rec));
  flag(true);
  return rec.id;
}
const getSaved = (id) => tx('saved', 'readonly', (s) => s.get(id)).catch(() => null);
const listSaved = () => tx('saved', 'readonly', (s) => s.getAll()).then((all) => all.filter((r) => r.scope === SCOPE)).catch(() => []);
async function forget(id) {
  await tx('saved', 'readwrite', (s) => s.delete(id)).catch(() => null);
  if (!(await listSaved()).length) { await tx('keypair', 'readwrite', (s) => s.delete(SCOPE)).catch(() => null); flag(false); }
}
async function openSaved(rec) {
  loading(true); status('Opening the vault saved on this device...');
  try {
    const pair = await keyPair(false);
    if (!pair) throw new Error('The saved key is gone from this browser.');
    const keyHex = dec.decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, rec.ct));
    let buf = rec.zipBytes;
    if (rec.zip) { const r = await fetch(rec.zip, { credentials: 'omit' }); if (!r.ok) throw new Error('Could not fetch ' + rec.zip); buf = await r.arrayBuffer(); }
    const v = await openVault(buf, keyHex);
    v.name = titleOf(v.files, (pages(v.files)[0] || {}).path); v.savedId = rec.id;
    status(`Opened ${v.name} with the key saved on this device.`);
    show(v);
  } catch (err) {
    await forget(rec.id);
    status('The key saved on this device no longer opens this vault, so it has been forgotten. Scan or paste the key again. (' + (err.message || err) + ')', true);
    refreshLocal();
  }
}

// ---------- page ----------
function titleOf(files, first) {
  const readme = files.get('README.md');
  const h = readme && dec.decode(readme.bytes).match(/^#\s+(.+)$/m);
  if (h) return h[1].trim();
  const f = first && files.get(first);
  const t = f && dec.decode(f.bytes).match(/<title>([^<]*)<\/title>/i);
  return t ? t[1].trim() : 'Vault';
}
function status(msg, bad) { const s = $('#status'); s.textContent = msg; s.className = bad ? 'bad' : ''; if (bad) loading(false); }
// A centred "Opening the vault..." while a link, key, QR image or zip is being opened; the landing page stays hidden.
function loading(on, msg) { document.documentElement.classList.toggle('loading', !!on); if (on) $('#loading-msg').textContent = msg || 'Opening the vault...'; }

let current = null;
function show(v) {
  current = v;
  const list = pages(v.files);
  if (!list.length) { status('The vault opened, but it holds no web page.', true); return; }
  $('#viewer-title').textContent = v.name;
  $('#viewer-meta').textContent = `vault ${v.vaultId}, commit ${new Date(v.commit.timestamp_ms).toISOString().slice(0, 10)}, ${v.files.size} files`;
  const tabs = $('#tabs'); tabs.textContent = '';
  list.forEach((pg, i) => {
    const b = document.createElement('button');
    b.textContent = pg.label; b.type = 'button';
    b.onclick = () => { tabs.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); go(pg.path); };
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    tabs.append(b);
  });
  $('#viewer').hidden = false; document.body.classList.add('viewing'); loading(false);
  go(list[0].path);
}
function go(path) {
  // Pages render in the frame; any other file (a PDF, an image) is handed to the browser from memory, never fetched.
  if (!/\.html?$/i.test(path)) {
    const f = current.files.get(path); if (!f) return;
    const url = URL.createObjectURL(new Blob([f.bytes], { type: typeOf(path, f) }));
    const a = document.createElement('a'); a.href = url; a.download = path.split('/').pop(); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }
  $('#frame').srcdoc = render(current.files, path);
}
window.addEventListener('message', (e) => {
  if (current && e.source === $('#frame').contentWindow && e.data && typeof e.data.vaultPage === 'string' && current.files.has(e.data.vaultPage)) go(e.data.vaultPage);
});

async function openZip(buf, keyInput, zip) {
  status('Opening the vault in this browser...'); loading(true);
  try {
    const keyHex = readKeyHex(keyInput);
    const v = await openVault(buf, keyHex);
    v.name = titleOf(v.files, (pages(v.files)[0] || {}).path);
    // Saved only after the vault has opened, so a wrong key is never kept.
    v.savedId = await saveKey(v, keyHex, zip, buf).catch(() => null);
    status(v.savedId ? `Opened ${v.name}. Its key is kept on this device, encrypted, until you forget it.` : `Opened ${v.name}.`);
    show(v); refreshLocal();
  } catch (err) { status(err.message || String(err), true); }
}
async function refreshLocal() {
  const ul = $('#local'); if (!ul) return;
  const all = (await listSaved()).sort((a, b) => b.opened - a.opened);
  ul.textContent = '';
  $('#local-empty').hidden = all.length > 0;
  for (const r of all) {
    const li = document.createElement('li');
    const o = document.createElement('button'); o.type = 'button'; o.textContent = r.name;
    o.onclick = () => openSaved(r);
    const f = document.createElement('button'); f.type = 'button'; f.className = 'quiet'; f.textContent = 'Forget';
    f.onclick = async () => { await forget(r.id); refreshLocal(); };
    li.append(o, ' ', f); ul.append(li);
  }
}

async function fromFragment() {
  const h = location.hash.slice(1);
  if (!h) {
    // A gated page opens its vault at once when this browser has its key saved.
    const rec = GATE_ZIP ? await getSaved(SCOPE + '|' + GATE_ZIP) : null;
    if (rec) openSaved(rec); else { loading(false); if (GATE_ZIP) flag(false); }
    return;
  }
  history.replaceState(null, '', location.pathname + location.search); // the key leaves the address bar
  const q = new URLSearchParams(h), key = q.get('key'), zip = q.get('zip') || GATE_ZIP;
  if (key) $('#key').value = key;
  if (!zip) { loading(false); status('Key received. Now choose or drop the vault zip.'); return; }
  loading(true);
  if (zip !== GATE_ZIP && !/^(examples|private)\/[a-z0-9-]+\.zip$/.test(zip)) { status('Only zips published on this site can be opened from a link.', true); return; }
  try {
    const r = await fetch(zip, { credentials: 'omit' });
    if (!r.ok) throw new Error('Could not fetch ' + zip);
    await openZip(await r.arrayBuffer(), key, zip);
  } catch (err) { status(err.message, true); }
}

// A link pasted or read from a QR code: only this site's own links are followed.
function useLink(text) {
  const v = (text || '').trim(), i = v.indexOf('#');
  if (i < 0) return false;
  const base = v.slice(0, i);
  if (base && base.replace(/\/$/, '') !== location.origin && !base.startsWith(location.origin + '/')) {
    status('That link is not for this site, so it was not opened.', true); return true;
  }
  location.hash = v.slice(i + 1);
  return true;
}
// QR codes in an image: the browser's own BarcodeDetector where it has one, else jsQR,
// a pinned copy served from this site (vendor/jsqr-1.4.0, Apache-2.0), loaded only when needed.
let jsqrLoad = null;
function loadJsQR() {
  jsqrLoad = jsqrLoad || new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = new URL('vendor/jsqr-1.4.0/jsQR.js', HERE || location.href).href; s.onload = () => ok(window.jsQR); s.onerror = () => no(new Error('Could not load the QR reader.'));
    document.head.append(s);
  });
  return jsqrLoad;
}
async function decodeQr(file) {
  const bmp = await createImageBitmap(file);
  if ('BarcodeDetector' in window) {
    try { const c = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp); if (c.length) return c[0].rawValue; } catch (_) { /* fall back to jsQR */ }
  }
  const jsQR = await loadJsQR();
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, w, h);
  const r = jsQR(cx.getImageData(0, 0, w, h).data, w, h);
  return r ? r.data : null;
}
async function readQr(file) {
  status('Reading the QR code...'); loading(true, 'Reading the QR code...');
  try {
    const text = await decodeQr(file);
    if (!text || !useLink(text)) status('No vault link found in that image.', true);
  } catch (err) { status('Could not read that image: ' + (err.message || err), true); }
}

function init() {
  const pick = async (file) => {
    if (!file) return;
    if (/^image\//.test(file.type)) return readQr(file);
    openZip(await file.arrayBuffer(), $('#key').value);
  };
  $('#file').onchange = (e) => { pick(e.target.files[0]); e.target.value = ''; };
  // The whole window is the drop target: a vault zip or a QR code image.
  let depth = 0;
  const over = (on) => document.documentElement.classList.toggle('dropping', on);
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; over(true); });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; over(false); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; over(false);
    if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); else useLink(e.dataTransfer.getData('text/plain'));
  });
  $('#key').addEventListener('input', () => { if (/#.*key=[^&]*[0-9a-f]{64}/i.test($('#key').value)) useLink($('#key').value); });
  $('#key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#open').click(); });
  $('#open').onclick = () => {
    const v = $('#key').value.trim();
    if (!v) { status('Paste a vault link or a read key first.', true); return; }
    if (!useLink(v)) {
      try { readKeyHex(v); if (GATE_ZIP) location.hash = 'key=' + encodeURIComponent(v); else status('Key ready. Now choose or drop the vault zip.'); }
      catch (err) { status(err.message, true); }
    }
  };
  document.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData && e.clipboardData.files || [])][0];
    if (f) { e.preventDefault(); pick(f); return; }
    if (e.target !== $('#key') && useLink(e.clipboardData && e.clipboardData.getData('text'))) e.preventDefault();
  });
  if ($('#forget')) $('#forget').onclick = async () => {
    if (current && current.savedId) await forget(current.savedId);
    $('#close').click(); status('Forgotten: this device no longer holds the key for that vault.'); refreshLocal();
  };
  $('#close').onclick = () => { $('#viewer').hidden = true; document.body.classList.remove('viewing'); $('#frame').srcdoc = ''; current = null; };
  window.addEventListener('hashchange', fromFragment);
  refreshLocal(); fromFragment();
}
if (typeof document !== 'undefined') init();
