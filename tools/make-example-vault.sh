#!/usr/bin/env bash
# Seal a folder of static files into an sgit vault and write its zip into site/examples/.
# Usage: tools/make-example-vault.sh <name> <folder of site files>
# The vault key stays in the vault's own folder ($VAULTS, outside this repository); only the
# zip (ciphertext and a manifest, no key) is published. Prints the public read key, which is
# published on purpose for examples only, and the link to open it.
set -euo pipefail
name=$1; src=$2; VAULTS=${VAULTS:-$HOME/.hub-secrets/vaults}; out="$(cd "$(dirname "$0")/.." && pwd)/site/examples"
mkdir -p -m 700 "$VAULTS"; cd "$VAULTS"
[ -d "$name" ] || sgit create "$name" --no-push >/dev/null
cp -r "$src"/. "$name"/; cd "$name"
sgit commit -m "Example site for the vault demo" >/dev/null || true
sgit push >/dev/null 2>&1 || echo "note: not pushed to the server (no access token); the zip still opens" >&2
rm -rf .sg_vault/backups; sgit vault backup --label demo >/dev/null
cp .sg_vault/backups/*.zip "$out/$name.zip"; chmod 644 "$out/$name.zip"
python3 - "$name" <<'PY'
import sys
from sgit_ai.crypto.Vault__Crypto import Vault__Crypto
c = Vault__Crypto(); k = c.derive_keys_from_vault_key(open('.sg_vault/local/vault_key').read().strip())
rk = c.format_read_key(k['read_key'], public=True)
print(rk); print(f'https://vault.sovereignwebsite.site/#zip=examples/{sys.argv[1]}.zip&key={rk}')
PY
