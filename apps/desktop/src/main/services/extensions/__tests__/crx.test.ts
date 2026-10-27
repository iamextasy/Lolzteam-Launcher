import { describe, expect, it } from 'vitest';
import { MAX_CRX_HEADER, idFromPublicKey, isCrx, parseCrx } from '../crx';
import { ExtensionError } from '../errors';
import { idOf, makeCrx2, makeCrx3, makeEcKey, makeRsaKey, zipTree } from './helpers';

const developer = makeRsaKey();
/** Stands in for the store's own publisher key, which signs every store package next to the developer's. */
const store = makeRsaKey();
const zip = zipTree({ 'manifest.json': '{"manifest_version":3}', 'a.js': 'void 0;' });

const failure = (fn: () => unknown): ExtensionError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ExtensionError) return err;
    throw err;
  }
  throw new Error('expected a failure');
};

describe('idFromPublicKey', () => {
  it('is the first half of the SHA-256, spelled a–p', () => {
    const id = idFromPublicKey(developer.publicDer);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(id).toBe(idOf(developer.publicDer));
  });
});

describe('parseCrx — CRX3', () => {
  it('hands back the archive, the developer key and the id it gives', () => {
    const pkg = parseCrx(makeCrx3(zip, [developer]));
    expect(pkg.zip.equals(zip)).toBe(true);
    expect(pkg.publicKey?.equals(developer.publicDer)).toBe(true);
    expect(pkg.id).toBe(idOf(developer.publicDer));
  });

  it('picks the key whose hash is the declared id, wherever it sits among the proofs', () => {
    const pkg = parseCrx(makeCrx3(zip, [store, developer], { idKey: developer }));
    expect(pkg.publicKey?.equals(developer.publicDer)).toBe(true);
    expect(pkg.id).toBe(idOf(developer.publicDer));
  });

  it('checks ECDSA proofs too', () => {
    const ec = makeEcKey();
    expect(parseCrx(makeCrx3(zip, [developer], { ecdsa: [ec] })).id).toBe(
      idOf(developer.publicDer),
    );
    const forged = makeCrx3(zip, [developer], { ecdsa: [ec], forgeEcdsa: true });
    expect(failure(() => parseCrx(forged)).message).toMatch(/signature/);
  });

  it('refuses an archive that is not the one that was signed', () => {
    const tampered = makeCrx3(zip, [developer], {
      swapZip: zipTree({ 'manifest.json': '{"manifest_version":3}', 'a.js': 'evil();' }),
    });
    const err = failure(() => parseCrx(tampered));
    expect(err.code).toBe('bad_package');
    expect(err.message).toMatch(/signature/);
  });

  it('refuses a flipped byte anywhere in the archive', () => {
    const crx = makeCrx3(zip, [developer]);
    crx[crx.length - 30] = (crx[crx.length - 30] ?? 0) ^ 0xff;
    expect(failure(() => parseCrx(crx)).code).toBe('bad_package');
  });

  it('refuses a declared id no proof answers for', () => {
    const crx = makeCrx3(zip, [developer], { idKey: store });
    expect(failure(() => parseCrx(crx)).message).toMatch(/no key proof matches/);
  });

  it('falls back to the first key without a signed header, and to no key without proofs', () => {
    const noHeader = parseCrx(makeCrx3(zip, [developer], { idKey: null }));
    expect(noHeader.id).toBe(idOf(developer.publicDer));
    const unsigned = parseCrx(makeCrx3(zip, [], { idKey: null }));
    expect(unsigned).toMatchObject({ publicKey: null, id: null });
    expect(unsigned.zip.equals(zip)).toBe(true);
  });

  it('refuses a header over the cap or past the end of the file', () => {
    const huge = makeCrx3(zip, [developer], { headerLength: MAX_CRX_HEADER + 1 });
    expect(failure(() => parseCrx(huge)).code).toBe('bad_package');
    const short = makeCrx3(zip, [developer], { headerLength: 10_000_000 });
    expect(failure(() => parseCrx(short)).code).toBe('bad_package');
  });

  it('refuses garbage where the header should be', () => {
    const crx = makeCrx3(zip, [developer]);
    const headerLen = crx.readUInt32LE(8);
    crx.fill(0xff, 12, 12 + Math.min(headerLen, 16));
    expect(failure(() => parseCrx(crx)).code).toBe('bad_package');
  });
});

describe('parseCrx — other formats', () => {
  it('reads and verifies a CRX2', () => {
    const pkg = parseCrx(makeCrx2(zip, developer));
    expect(pkg.id).toBe(idOf(developer.publicDer));
    expect(pkg.zip.equals(zip)).toBe(true);
    const tampered = makeCrx2(zip, developer, zipTree({ 'a.js': 'evil();' }));
    expect(failure(() => parseCrx(tampered)).code).toBe('bad_package');
  });

  it('refuses unknown versions and non-CRX files', () => {
    const v4 = makeCrx3(zip, [developer]);
    v4.writeUInt32LE(4, 4);
    expect(failure(() => parseCrx(v4)).message).toMatch(/version 4/);
    expect(failure(() => parseCrx(zip)).code).toBe('bad_package');
    expect(failure(() => parseCrx(Buffer.from('Cr24'))).code).toBe('bad_package');
    expect(isCrx(zip)).toBe(false);
    expect(isCrx(makeCrx3(zip, [developer]))).toBe(true);
  });
});
