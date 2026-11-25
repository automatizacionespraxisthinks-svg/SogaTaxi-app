import { describe, expect, it } from 'vitest';
import { versionPublicada } from '../app-conductor.controller';
import { validarEnv } from '../config/env';

const NADA = { versionCode: null, versionName: null, url: null, minVersionCode: null };

describe('versión publicada de la app del conductor', () => {
  it('sin configurar no se anuncia nada', () => {
    expect(versionPublicada({})).toEqual(NADA);
  });

  it('sin enlace de descarga tampoco: un aviso que no lleva a ningún lado no sirve', () => {
    expect(versionPublicada({ APP_ANDROID_VERSION_CODE: 7 })).toEqual(NADA);
    expect(versionPublicada({ APP_ANDROID_URL: 'https://x.co/app.apk' })).toEqual(NADA);
  });

  it('con versión y enlace se anuncia tal cual', () => {
    expect(
      versionPublicada({
        APP_ANDROID_VERSION_CODE: 7,
        APP_ANDROID_VERSION_NAME: '1.2.0',
        APP_ANDROID_URL: 'https://conductor.sogataxi.co/sogataxi.apk',
      }),
    ).toEqual({
      versionCode: 7,
      versionName: '1.2.0',
      url: 'https://conductor.sogataxi.co/sogataxi.apk',
      minVersionCode: null,
    });
  });

  it('la mínima obligatoria nunca pasa de la publicada', () => {
    const v = versionPublicada({
      APP_ANDROID_VERSION_CODE: 7,
      APP_ANDROID_URL: 'https://x.co/app.apk',
      APP_ANDROID_MIN_VERSION_CODE: 9,
    });
    expect(v.minVersionCode).toBe(7);
  });
});

describe('el enlace de descarga en el entorno', () => {
  const BASE = {
    DATABASE_URL: 'postgres://tax:x@localhost:55432/tax',
    REDIS_URL: 'redis://localhost:16379',
    SESSION_SECRET: '9f2c4e7a1b3d5f6081a2c3e4f5061728394a5b6c7d8e9f00',
    ENCRYPTION_KEY: '3f9a1c7e5b2d8046a1c3e5f7092b4d6f8a0c2e4f6b8d0a1c3e5f7092b4d6f8a0',
  };

  it('en producción tiene que ser HTTPS', () => {
    const r = validarEnv({
      ...BASE,
      NODE_ENV: 'production',
      APP_ANDROID_VERSION_CODE: '7',
      APP_ANDROID_URL: 'http://conductor.sogataxi.co/sogataxi.apk',
    });
    expect(r.success).toBe(false);
  });

  it('en desarrollo se admite HTTP para probar en la red local', () => {
    const r = validarEnv({
      ...BASE,
      APP_ANDROID_VERSION_CODE: '7',
      APP_ANDROID_URL: 'http://192.168.1.3:5174/sogataxi.apk',
    });
    expect(r.success).toBe(true);
  });
});
