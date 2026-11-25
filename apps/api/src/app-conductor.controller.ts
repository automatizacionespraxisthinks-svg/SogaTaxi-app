import { Controller, Get, Header } from '@nestjs/common';
import { loadEnv } from './config/env';

/** Lo que la app del conductor necesita para saber si hay una versión más nueva. */
export interface VersionDeLaApp {
  /** Nulo: la oficina no ha publicado ninguna, la app no avisa de nada. */
  versionCode: number | null;
  versionName: string | null;
  /** De dónde se descarga el APK. Siempre HTTPS. */
  url: string | null;
  /** Por debajo de esta, la app no deja abrir turno hasta actualizar. */
  minVersionCode: number | null;
}

/**
 * La versión publicada sale del entorno: no hay tienda que lo sepa, porque la
 * app se instala desde un APK que entrega la empresa.
 *
 * Sin número de versión o sin enlace no se anuncia nada: un aviso de
 * «actualiza» que no lleva a ningún lado es peor que no avisar.
 */
export function versionPublicada(env: {
  APP_ANDROID_VERSION_CODE?: number;
  APP_ANDROID_VERSION_NAME?: string;
  APP_ANDROID_URL?: string;
  APP_ANDROID_MIN_VERSION_CODE?: number;
}): VersionDeLaApp {
  if (!env.APP_ANDROID_VERSION_CODE || !env.APP_ANDROID_URL) {
    return { versionCode: null, versionName: null, url: null, minVersionCode: null };
  }
  return {
    versionCode: env.APP_ANDROID_VERSION_CODE,
    versionName: env.APP_ANDROID_VERSION_NAME ?? null,
    url: env.APP_ANDROID_URL,
    // La mínima nunca puede pasar de la publicada: dejaría a toda la flota
    // sin poder abrir turno y sin una versión a la que subir.
    minVersionCode: env.APP_ANDROID_MIN_VERSION_CODE
      ? Math.min(env.APP_ANDROID_MIN_VERSION_CODE, env.APP_ANDROID_VERSION_CODE)
      : null,
  };
}

/**
 * Pública a propósito: la app la consulta también antes de entrar, y no dice
 * nada que no se vea instalando el APK.
 */
@Controller('v1/app')
export class AppConductorController {
  private readonly version = versionPublicada(loadEnv());

  @Get('conductor-android')
  @Header('cache-control', 'public, max-age=300')
  conductorAndroid(): VersionDeLaApp {
    return this.version;
  }
}
