# The gated site pattern

Dinis Cruz, 20 Nov 2026 (relayed by sites.b@SovereignWebsite.dinis): a site can have its public address and a well designed public page saying it is an early version, coming soon, while the site itself opens only for people holding its QR code. Private sites are not named, held or listed here: each lives in its own repository, and its own agent seals its vault.

## How it works

- The site's address serves a public landing page: what is coming, that it is an MVP or a test, and a box to scan, drop, choose or paste the QR code.
- The site itself is sealed in a private sgit vault. Only its ciphertext is published, as `private/<random id>.zip` beside the landing page.
- The landing page sets `<html data-vault-zip="private/<id>.zip">` and loads `open.js` (with `vendor/jsqr-1.4.0/` next to it). Its QR code and link carry only the key: `https://<site>/#key=<read key>`.
- A person scans the QR code with a phone camera, or drops or pastes the QR image or link on the page, and the site opens in their browser. Nothing is uploaded and the key never reaches a server.
- After the person approves, the Factory can make the site public, from the same vault.

## Making one

1. The site's own agent seals the site's files with a copy of `tools/make-private-vault.sh <name> <folder>`, in its own repository and container. It publishes only the ciphertext zip and writes the holder's link and QR code outside the repository, for Dinis only.
2. Copy `site/gate/index.html` as the starting point, give it the site's own design, and point `data-vault-zip` at the zip. The page needs the element ids it uses (`key`, `open`, `file`, `status`, `loading`, `loading-msg`, `dropping`, `viewer`, `tabs`, `close`, `frame`, `viewer-title`, `viewer-meta`).
3. Make the QR code from `https://<site>/#key=<read key>` and send it only to the person it is for.

## Demo

https://vault.sovereignwebsite.site/gate/ is a plain working demo with the made-up Example Ceramics Studio vault. Its QR code went to Dinis only.
