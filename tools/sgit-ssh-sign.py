#!/usr/bin/env python3
# Git SSH signing with an sgit pki key, without ever touching the private half.
#
# git calls gpg.ssh.program as `ssh-keygen -Y sign -n <ns> -f <public key file> [-U] <buffer>` and reads <buffer>.sig.
# This wrapper builds the SSHSIG "to be signed" blob (PROTOCOL.sshsig), has `sgit pki sign` sign it
# (ECDSA P-256 with SHA-256, the same as ecdsa-sha2-nistp256), and wraps the raw r||s signature as an
# armoured SSH signature. Every other call (verify, find-principals, check-novalidate) goes to ssh-keygen.
#
# Repo-local setup (nothing secret is stored in the repository):
#   git config gpg.format ssh
#   git config gpg.ssh.program "$PWD/tools/sgit-ssh-sign.py"
#   git config user.signingkey <file holding the OpenSSH public key, from: ssh-keygen -i -m PKCS8 -f sign.pem>
#   git config sgit.fingerprint <encryption fingerprint shown by sgit pki list>
#   git config sgit.passphraseFile <600 file outside the repository with: export SG_SEND_PASSPHRASE=...>
# Apache-2.0.
import base64, hashlib, json, os, struct, subprocess, sys, tempfile


def s(b):
    return struct.pack('>I', len(b)) + b


def mpint(i):
    b = i.to_bytes((i.bit_length() + 8) // 8, 'big') if i else b''
    return s(b)


def cfg(key):
    r = subprocess.run(['git', 'config', '--get', key], capture_output=True, text=True)
    return r.stdout.strip()


def env_with_passphrase():
    env = dict(os.environ)
    if not env.get('SG_SEND_PASSPHRASE'):
        path = cfg('sgit.passphraseFile')
        if path:
            for line in open(os.path.expanduser(path)):
                line = line.strip()
                if line.startswith('export '):
                    line = line[7:]
                if line.startswith('SG_SEND_PASSPHRASE='):
                    env['SG_SEND_PASSPHRASE'] = line.split('=', 1)[1].strip().strip('"\'')
    return env


def sign(args):
    ns = args[args.index('-n') + 1]
    keyfile = args[args.index('-f') + 1]
    buf = args[-1]
    pub = open(os.path.expanduser(keyfile)).read().split()
    if pub[0] != 'ecdsa-sha2-nistp256':
        sys.exit('sgit-ssh-sign: only ecdsa-sha2-nistp256 keys are supported')
    pubblob = base64.b64decode(pub[1])
    data = sys.stdin.buffer.read() if buf == '-' else open(buf, 'rb').read()
    tbs = b'SSHSIG' + s(ns.encode()) + s(b'') + s(b'sha512') + s(hashlib.sha512(data).digest())
    fp = cfg('sgit.fingerprint')
    if not fp:
        sys.exit('sgit-ssh-sign: set git config sgit.fingerprint')
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'tbs')
        open(f, 'wb').write(tbs)
        subprocess.run(['sgit', 'pki', 'sign', '--fingerprint', fp, f], check=True,
                       env=env_with_passphrase(), stdout=subprocess.DEVNULL)
        raw = base64.b64decode(json.load(open(f + '.sig'))['signature'])
    r, t = int.from_bytes(raw[:32], 'big'), int.from_bytes(raw[32:], 'big')
    sig = s(b'ecdsa-sha2-nistp256') + s(mpint(r) + mpint(t))
    blob = b'SSHSIG' + struct.pack('>I', 1) + s(pubblob) + s(ns.encode()) + s(b'') + s(b'sha512') + s(sig)
    b64 = base64.b64encode(blob).decode()
    armour = '-----BEGIN SSH SIGNATURE-----\n' + '\n'.join(b64[i:i + 70] for i in range(0, len(b64), 70)) \
        + '\n-----END SSH SIGNATURE-----\n'
    if buf == '-':
        sys.stdout.write(armour)
    else:
        open(buf + '.sig', 'w').write(armour)


if __name__ == '__main__':
    a = sys.argv[1:]
    if '-Y' in a and a[a.index('-Y') + 1] == 'sign':
        sign(a)
    else:
        os.execvp('ssh-keygen', ['ssh-keygen'] + a)
