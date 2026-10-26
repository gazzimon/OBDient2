import { newSalt, pseudonym, sha256 } from '@/domain/privacy/hash';

describe('sha256 (published vectors)', () => {
  it('empty string', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('"abc"', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('a message of two blocks', () => {
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('non-ASCII text is hashed as UTF-8', () => {
    expect(sha256('Maná')).toBe(sha256('Maná'));
    expect(sha256('Maná')).not.toBe(sha256('Mana'));
  });
});

describe('pseudonym', () => {
  const VIN = '8AGEA76C0RR000043';

  it('is stable for one phone and hides the value', () => {
    const salt = newSalt(() => 0.3);
    expect(pseudonym(salt, VIN)).toBe(pseudonym(salt, VIN));
    expect(pseudonym(salt, VIN)).toMatch(/^[0-9a-f]{16}$/);
    expect(pseudonym(salt, VIN)).not.toContain('000043');
  });

  it('differs between installs and between values', () => {
    expect(pseudonym('a'.repeat(32), VIN)).not.toBe(pseudonym('b'.repeat(32), VIN));
    expect(pseudonym('a'.repeat(32), VIN)).not.toBe(pseudonym('a'.repeat(32), '8AGEA76C0RR000044'));
  });

  it('a salt is 32 hex characters', () => {
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
  });
});
