#!/usr/bin/env bash
# Seal a folder of static files into a private sgit vault.
# Usage: tools/make-private-vault.sh <name> <folder of site files>
# Publishes only ciphertext: site/private/<random id>.zip (a vault backup, no key).
# The read key goes ONLY into a link and a QR code written to $OUT/<name>/ (outside this
# repository, mode 600), for the holder. This script never prints a key.
set -euo pipefail
name=$1; src=$2
VAULTS=${VAULTS:-$HOME/.hub-secrets/vaults}; OUT=${OUT:-$HOME/.hub-secrets/out}
repo="$(cd "$(dirname "$0")/.." && pwd)"; mkdir -p -m 700 "$VAULTS" "$OUT/$name"; umask 077
cd "$VAULTS"; [ -d "$name" ] || sgit create "$name" --no-push >/dev/null
cp -r "$src"/. "$name"/; cd "$name"
sgit commit -m "Private example site for the vault demo" >/dev/null || true
sgit push >/dev/null 2>&1 || echo "note: not pushed to the server (no access token); the zip still opens" >&2
rm -rf .sg_vault/backups; sgit vault backup --label demo >/dev/null
id_file="$OUT/$name/zip-id"; [ -s "$id_file" ] || openssl rand -hex 8 > "$id_file"
zip_id=$(cat "$id_file"); mkdir -p "$repo/site/private"
cp .sg_vault/backups/*.zip "$repo/site/private/$zip_id.zip"; chmod 644 "$repo/site/private/$zip_id.zip"
python3 - "$zip_id" "$OUT/$name" <<'PY'
import sys, qrcode
from sgit_ai.crypto.Vault__Crypto import Vault__Crypto
zip_id, out = sys.argv[1], sys.argv[2]
c = Vault__Crypto(); k = c.derive_keys_from_vault_key(open('.sg_vault/local/vault_key').read().strip())
link = f'https://vault.sovereignwebsite.site/#zip=private/{zip_id}.zip&key={c.format_read_key(k["read_key"])}'
open(f'{out}/link.txt', 'w').write(link + '\n')
qrcode.make(link, box_size=8, border=3).save(f'{out}/qr.png')
PY
echo "site/private/$zip_id.zip; link and QR code in $OUT/$name/"
