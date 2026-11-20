# The gated site pattern

Dinis Cruz, 20 Nov 2026 (relayed by sites.b@SovereignWebsite.dinis): a site can have its public address and a well designed public page saying it is an early version, coming soon, while the site itself opens only for people holding its QR code. Private sites are not named, held or listed here: each lives in its own repository, and its own agent seals its vault.

## How it works

- The site's address serves a public landing page: what is coming, that it is an MVP or a test, and a box to scan, drop, choose or paste the QR code.
- The site itself is sealed in a private sgit vault. Only its ciphertext is published, as `private/<random id>.zip` beside the landing page.
- The landing page sets `<html data-vault-zip="private/<id>.zip">` and loads `open.js` (with `vendor/jsqr-1.4.0/` next to it). Its QR code and link carry only the key: `https://<site>/#key=<read key>`.
- A person scans the QR code with a phone camera, or drops or pastes the QR image or link on the page, and the site opens in their browser. Nothing is uploaded and the key never reaches a server.
- After the person approves, the Factory can make the site public, from the same vault.

## The key is brought once

Dinis, 20 Nov 2026 (relayed by sites.b@): "the user should only have to paste the key or QR code once", linked to the URL and the browser, surviving a browser restart.

- On the first open that succeeds, `open.js` makes a key pair with WebCrypto for this page's URL (RSA-OAEP 2048, SHA-256; the private key is not extractable) and keeps it in IndexedDB, which holds CryptoKey objects across restarts.
- It encrypts the read key with the public key and stores only that ciphertext, with the zip's path (or, for a zip dropped from the device, the zip itself, which is ciphertext). Decrypted files are never stored.
- Next time, a gated page with no key in its link opens straight away, behind the opening screen. On the drop page, the vault is listed under "On this device".
- A key is saved only after the vault opens, so a wrong key is never kept. If a saved key stops working, for example after a rekey, it is forgotten and the person is asked again.
- "Forget on this device", in the viewer bar or the list, deletes the saved key, and the key pair with the last one.
- Limits: anyone using the same browser profile can open the site again, as with a saved password. Clearing site data, or a private window, removes it.

## Making one

1. The site's own agent seals the site's files with a copy of `tools/make-private-vault.sh <name> <folder>`, in its own repository and container. It publishes only the ciphertext zip and writes the holder's link and QR code outside the repository, for Dinis only.
2. Copy `site/gate/index.html` as the starting point, give it the site's own design, and point `data-vault-zip` at the zip. The page needs the element ids it uses (`key`, `open`, `file`, `status`, `loading`, `loading-msg`, `dropping`, `viewer`, `tabs`, `close`, `frame`, `viewer-title`, `viewer-meta`).
3. Make the QR code from `https://<site>/#key=<read key>` and send it only to the person it is for.

## Demo

https://vault.sovereignwebsite.site/gate/ is a plain working demo with the made-up Example Ceramics Studio vault. Its QR code went to Dinis only.
