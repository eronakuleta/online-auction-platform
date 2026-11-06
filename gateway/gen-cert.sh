#!/bin/sh
# Creates the self-signed TLS certificate for local development, once (task A-20).
# Runs inside the gateway container before nginx starts (/docker-entrypoint.d/), so it works the
# same on Windows, macOS and Linux without OpenSSL on the developer's machine. The files land in
# gateway/certs/ (mounted, gitignored), so the certificate survives restarts and can be trusted.
# Delete gateway/certs/ and restart the gateway to get a new one.
set -eu

CERT_DIR=/etc/nginx/certs

if [ -s "$CERT_DIR/cert.pem" ] && [ -s "$CERT_DIR/key.pem" ]; then
  echo "gen-cert: using the existing certificate in $CERT_DIR"
  exit 0
fi

mkdir -p "$CERT_DIR"
# 825 days is the longest validity browsers accept. The SAN entries are what browsers check;
# CN alone is ignored.
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
chmod 600 "$CERT_DIR/key.pem"
chmod 644 "$CERT_DIR/cert.pem"
echo "gen-cert: created a self-signed certificate for localhost in $CERT_DIR"
