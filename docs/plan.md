# The Vault: plan

By hub.b@SovereignWebsite.dinis, 19 November 2026, for Dinis Cruz.

vault.sovereignwebsite.site is the base for sovereign websites powered by sgit vaults. hub.sovereignwebsite.site (SovereignWebsite__Hub) is the gallery of sites; this repository holds the vault side: the drop page, the example vaults and the pattern for keeping a site's vault and repository in step.

Sources: Dinis Cruz's articles "Your website from a vault", "A hub for agentic sites" and "Deploy sgit in your own environment, from a CI pipeline" on newsroom.sgit.ai; the sgit CLI (sgit-ai v0.27.0) and its source.

## What Dinis decided (this session, 19 Nov 2026)

- The drop page is on vault.sovereignwebsite.site and opens a vault from a link, a QR code or a zip.
- Made-up sites as examples. Zips and the browser's own storage first: the vault zips are published on this site and the page reads them directly.
- The sgit server is the usual one (dev.send.sgraph.ai). The page may talk to it directly, but nothing is uploaded from the browser.
- Only this agent creates vaults here, for now.

## What exists now

- `site/index.html` and `site/open.js`: the drop page. It takes a vault zip (as written by `sgit vault backup`) and a read key, from the link after the #, a QR code, a paste or a dropped file. It decrypts in the browser with WebCrypto, keeps the files in this browser's IndexedDB until the person forgets them, and shows the site in a sandboxed frame with no network access. A vault with a `designs/` folder shows each design one tap apart. A vault key (write capability) is refused.
- `site/examples/`: two made-up example vaults, Example Orange Grove (three designs) and Example Community Run (one page), with their zips and QR codes. Their read keys are public on purpose.
- `tools/make-example-vault.sh`: seals a folder into a vault and writes its zip here. Vault keys stay outside the repository.
- `team/keys.json` and `tools/sgit-ssh-sign.py`: this agent's public key, and git SSH signing through `sgit pki sign`.

Tested in Chromium (Playwright, phone width): open from a link, three designs, a link between pages inside the frame, kept on the device after reload, a wrong key and a vault key refused, no console errors.

## How the page reads a vault

The zip holds `bare/refs`, `bare/data` (the encrypted objects) and `manifest.json` (the vault id), and no key. Every ref, commit, tree, file name and blob is AES-256-GCM with a 12-byte IV in front, under the read key; a blob may be deflated first (the `\0sgz1` envelope). The page decrypts every ref, takes the newest commit, walks its tree and rebuilds the files. Styles, images and scripts are inlined into the frame, and a content security policy inside the frame blocks every request.

## Next

1. Push the example vaults to dev.send.sgraph.ai, so `sgit clone` works too (needs an access token, see below).
2. Open a vault straight from the server: fetch objects by id from the server instead of a zip, read only.
3. The demo cell: a name in, designs made by agents, sealed in one vault, the link and QR code out.
4. CI that keeps a site's vault and repository in step: on each release push the files to the vault, compare both trees, write the result to a status file the hub reads.
5. On a yes, the factory makes the site's repository from the same vault.

## Open questions for Dinis

1. An access token for dev.send.sgraph.ai, saved as a network secret for this environment (never in chat or in the repository), so the example vaults can be pushed.
2. The vault keys of the examples live in this container and go when it is reclaimed. Where should they be kept: a vault of their own, a CI secret, or nowhere (examples only)?
3. Should the examples also appear on the hub gallery?
