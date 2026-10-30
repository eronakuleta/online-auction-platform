import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPublicKey } from '../index';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'shared-auth-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeKeyFile(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

function rsaPems(modulusLength: number): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

describe('loadPublicKey', () => {
  it('loads a 2048-bit RSA public key', () => {
    const path = writeKeyFile('public.pem', rsaPems(2048).publicPem);
    expect(loadPublicKey(path).asymmetricKeyType).toBe('rsa');
  });

  it('refuses a private key, because only auth-service may hold it', () => {
    const path = writeKeyFile('private.pem', rsaPems(2048).privatePem);
    expect(() => loadPublicKey(path)).toThrow(/private key/);
  });

  it('refuses an RSA key shorter than 2048 bits', () => {
    const path = writeKeyFile('weak.pem', rsaPems(1024).publicPem);
    expect(() => loadPublicKey(path)).toThrow(/at least 2048/);
  });

  it('refuses a non-RSA key', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const path = writeKeyFile(
      'ec.pem',
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );
    expect(() => loadPublicKey(path)).toThrow(/RSA public key/);
  });

  it('fails fast with a hint when the file is missing', () => {
    expect(() => loadPublicKey(join(dir, 'missing.pem'))).toThrow(/gen-keys/);
  });
});
