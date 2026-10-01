import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webPushSender } from '../src/services/push';

// web-push only speaks HTTPS, so the stand-in push service needs a (throwaway, self-signed) certificate.
const certDir = mkdtempSync(join(tmpdir(), 'splity-push-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // this test process only

/** A stand-in push service: records requests, answers 201 or 410 depending on the path. */
let received: { path: string; headers: IncomingHttpHeaders; bytes: number }[] = [];
const server = createServer({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    received.push({ path: req.url ?? '', headers: req.headers, bytes: Buffer.concat(chunks).length });
    res.writeHead(req.url?.includes('expired') ? 410 : 201).end();
  });
});
let base = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(certDir, { recursive: true, force: true });
});

/** A browser-like subscription: a real P-256 public key and a 16-byte auth secret. */
function subscription(path: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `${base}${path}`,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

describe('webPushSender', () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:admin@splity.local' };
  const send = webPushSender(vapid);
  const payload = { title: 'Goa Trip', body: 'Ayush added "Dinner"', url: '/groups/x', tag: 't' };

  it('sends an encrypted, VAPID-signed message', async () => {
    received = [];
    expect(await send(subscription('/push/abc'), payload)).toBe('ok');
    const [req] = received;
    expect(req!.path).toBe('/push/abc');
    expect(req!.headers['content-encoding']).toBe('aes128gcm');
    expect(req!.headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    expect(req!.headers.ttl).toBe(String(60 * 60 * 24));
    // Ciphertext, not the JSON: larger than the plaintext and doesn't contain it.
    expect(req!.bytes).toBeGreaterThan(JSON.stringify(payload).length);
  });

  it("reports 'gone' when the push service says the subscription expired", async () => {
    expect(await send(subscription('/push/expired'), payload)).toBe('gone');
  });
});
