import { describe, expect, it } from 'vitest';
import { claveTrivial, validarEnv } from '../config/env';

const BASE = {
  DATABASE_URL: 'postgres://tax:x@localhost:55432/tax',
  REDIS_URL: 'redis://localhost:16379',
  SESSION_SECRET: '9f2c4e7a1b3d5f6081a2c3e4f5061728394a5b6c7d8e9f00',
  ENCRYPTION_KEY: '3f9a1c7e5b2d8046a1c3e5f7092b4d6f8a0c2e4f6b8d0a1c3e5f7092b4d6f8a0',
};

function errores(env: Record<string, string>): string[] {
  const r = validarEnv(env);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('validación del entorno', () => {
  it('acepta secretos aleatorios en producción', () => {
    expect(errores({ ...BASE, NODE_ENV: 'production' })).toEqual([]);
  });

  it('rechaza en producción la ENCRYPTION_KEY de ceros del .env.example', () => {
    const env = { ...BASE, NODE_ENV: 'production', ENCRYPTION_KEY: '0'.repeat(64) };
    expect(errores(env)).toContain('ENCRYPTION_KEY');
  });

  it('rechaza en producción el SESSION_SECRET de ejemplo', () => {
    const env = {
      ...BASE,
      NODE_ENV: 'production',
      SESSION_SECRET: 'cambia-esto-por-un-secreto-largo-de-desarrollo',
    };
    expect(errores(env)).toContain('SESSION_SECRET');
  });

  it('deja los valores de ejemplo en desarrollo', () => {
    const env = {
      ...BASE,
      NODE_ENV: 'development',
      ENCRYPTION_KEY: '0'.repeat(64),
      SESSION_SECRET: 'cambia-esto-por-un-secreto-largo-de-desarrollo',
    };
    expect(errores(env)).toEqual([]);
  });

  it('pide VAPID_SUBJECT si hay claves VAPID', () => {
    const env = { ...BASE, VAPID_PUBLIC_KEY: 'p'.repeat(40), VAPID_PRIVATE_KEY: 'q'.repeat(40) };
    expect(errores(env)).toContain('VAPID_SUBJECT');
    expect(errores({ ...env, VAPID_SUBJECT: 'mailto:soporte@example.com' })).toEqual([]);
  });

  it('una clave con pocos caracteres distintos es trivial', () => {
    expect(claveTrivial('01'.repeat(32))).toBe(true);
    expect(claveTrivial(BASE.ENCRYPTION_KEY)).toBe(false);
  });
});
