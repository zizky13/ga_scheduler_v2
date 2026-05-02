import { describe, expect, it } from 'vitest';
import { loginBodySchema, registerBodySchema } from '../../../src/api/schemas/auth';

describe('loginBodySchema', () => {
  it('accepts a well-formed login body', () => {
    const out = loginBodySchema.parse({
      email: 'kaprodi@upj.ac.id',
      password: 'whatever-the-real-password-is',
    });
    expect(out.email).toBe('kaprodi@upj.ac.id');
    expect(out.password).toBe('whatever-the-real-password-is');
  });

  it('rejects missing password', () => {
    const result = loginBodySchema.safeParse({ email: 'a@b.co' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email syntax', () => {
    const result = loginBodySchema.safeParse({ email: 'not-an-email', password: 'whatever-x' });
    expect(result.success).toBe(false);
  });
});

describe('registerBodySchema', () => {
  it('accepts a strong password with letter + digit and a valid role', () => {
    const out = registerBodySchema.parse({
      email: 'user1@upj.ac.id',
      password: 'correct-horse-9',
      fullName: 'Pak Budi',
      role: 'user',
    });
    expect(out.role).toBe('user');
  });

  it('rejects a too-short password', () => {
    const result = registerBodySchema.safeParse({
      email: 'a@b.co',
      password: 'short9',
      fullName: 'Pak A',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password missing a digit', () => {
    const result = registerBodySchema.safeParse({
      email: 'a@b.co',
      password: 'all-letters-only',
      fullName: 'Pak A',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown role', () => {
    const result = registerBodySchema.safeParse({
      email: 'a@b.co',
      password: 'correct-horse-9',
      fullName: 'Pak A',
      role: 'superuser',
    });
    expect(result.success).toBe(false);
  });
});
