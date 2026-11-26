import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {
  AJUSTES_DESPACHO_DE_FABRICA,
  type AjustesDespacho,
  ZONA_CERCANA_MAX_KM,
  centroYRadioDe,
  haversineKm,
  type Point,
  type WaveConfig,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import { dispatchSettings, zones } from '../../db/schema';
import type { GeoJsonPolygon } from '../../db/schema/geo';

export interface LoadedZone {
  id: string;
  name: string;
  kind: 'urbano' | 'rural';
  tortuosity: number;
  waves: WaveConfig[];
  polygon: GeoJsonPolygon;
  /** El punto de partida de las carreras que no se pudieron ubicar. */
  esReferencia: boolean;
  /** Centro y radio del círculo, leídos del polígono al cargar. */
  center: Point;
  radiusKm: number;
}

/**
 * Zonas en memoria.
 *
 * Son unas decenas de polígonos que cambian muy de vez en cuando, así que
 * viven en el proceso y la clasificación urbano/rural se resuelve con Turf
 * sin tocar la base ni instalar PostGIS (ADR-04). El coste es recordar
 * invalidar la caché al editarlas, y para eso está `reload()`.
 */
@Injectable()
export class ZonesService implements OnModuleInit {
  private readonly logger = new Logger(ZonesService.name);
  private cache: LoadedZone[] = [];
  private ajustes: AjustesDespacho = AJUSTES_DESPACHO_DE_FABRICA;

  constructor(@Inject(DB) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    // En orden de creación: sin él, «la primera» dependía de cómo la base
    // devolviera las filas ese día.
    const rows = await this.db.select().from(zones).where(eq(zones.active, true)).orderBy(asc(zones.createdAt));

    this.cache = rows
      .filter((row) => row.kind === 'urbano' || row.kind === 'rural')
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as 'urbano' | 'rural',
        tortuosity: row.tortuosity,
        waves: row.waves,
        polygon: row.polygon,
        esReferencia: row.esReferencia,
        ...centroYRadioDe((row.polygon.coordinates[0] ?? []).map(([lng, lat]) => ({ lat, lng }))),
      }));

    this.logger.log(`Zonas cargadas en memoria: ${this.cache.length}`);

    // Los ajustes del despacho, de la misma ida: sin fila valen los de fábrica.
    const [fila] = await this.db.select().from(dispatchSettings).limit(1);
    this.ajustes = fila
      ? {
          rondas: [...fila.rondas].sort((a, b) => a.wave - b.wave) as AjustesDespacho['rondas'],
          lejanos: { candidatos: fila.lejanosCandidatos, hastaKm: fila.lejanosKm, margenKm: fila.lejanosMargenKm },
          posicionMaximaMin: fila.posicionMaximaMin,
        }
      : AJUSTES_DESPACHO_DE_FABRICA;
  }

  all(): LoadedZone[] {
    return this.cache;
  }

  byId(zoneId: string): LoadedZone | undefined {
    return this.cache.find((zone) => zone.id === zoneId);
  }

  /**
   * Clasifica un punto. Devuelve `undefined` cuando cae fuera de toda zona,
   * y eso no es un rechazo: la zona es para las estadísticas. Si el punto es
   * o no de Paipa lo decide `GeocodingService.cobertura`.
   */
  classify(point: Point): LoadedZone | undefined {
    // GeoJSON va en [lng, lat]; confundir el orden es el error clásico aquí.
    const coordinates: [number, number] = [point.lng, point.lat];
    // Los barrios vecinos se pisan en el borde: gana el del centro más cercano.
    return this.cache
      .filter((zone) => booleanPointInPolygon(coordinates, zone.polygon))
      .sort((a, b) => haversineKm(point, a.center) - haversineKm(point, b.center))[0];
  }

  /**
   * La zona de un punto para despachar y para las estadísticas: la que lo
   * contiene o, si no cae en ninguna, la más cercana (midiendo hasta su
   * borde) que lo tenga a su alcance: 1 km un barrio, 3 km una vereda
   * (`ZONA_CERCANA_MAX_KM`).
   *
   * No decide la cobertura —eso sigue siendo `classify` más Google, en
   * `GeocodingService.cobertura`—: aquí solo llegan puntos ya aceptados.
   */
  masCercana(point: Point): { zona: LoadedZone; dentro: boolean; aKm: number } | undefined {
    const dentro = this.classify(point);
    if (dentro) return { zona: dentro, dentro: true, aKm: 0 };

    let mejor: { zona: LoadedZone; aKm: number } | undefined;
    for (const zona of this.cache) {
      const aKm = Math.max(0, haversineKm(point, zona.center) - zona.radiusKm);
      if (aKm > ZONA_CERCANA_MAX_KM[zona.kind]) continue;
      if (!mejor || aKm < mejor.aKm) mejor = { zona, aKm };
    }
    if (!mejor) return undefined;
    return { zona: mejor.zona, dentro: false, aKm: Math.round(mejor.aKm * 100) / 100 };
  }

  /**
   * El rectángulo que envuelve toda la cobertura.
   *
   * Sale de los polígonos vivos, no de una constante: si mañana se añade una
   * vereda, el geocodificador la busca sin que nadie tenga que acordarse de
   * actualizar unos números a mano.
   */
  boundingBox(): { south: number; west: number; north: number; east: number } | undefined {
    const puntos = this.cache.flatMap((zona) => zona.polygon.coordinates.flat());
    if (puntos.length === 0) return undefined;

    // GeoJSON va en [lng, lat].
    const lngs = puntos.map(([lng]) => lng);
    const lats = puntos.map(([, lat]) => lat);

    return {
      south: Math.min(...lats),
      west: Math.min(...lngs),
      north: Math.max(...lats),
      east: Math.max(...lngs),
    };
  }

  /**
   * Un punto del pueblo desde el que despachar cuando no se sabe mas.
   *
   * El cliente da una direccion y el conductor la lee: esa parte no necesita
   * coordenadas. Pero el despacho si, porque las oleadas son radios, y un
   * radio necesita un centro. Antes de rechazar la carrera se usa el centro
   * de la zona marcada como punto de partida —el Centro, salvo que la
   * oficina elija otra—: desde ahi las oleadas cubren el casco, y el
   * conductor llega leyendo la direccion, como siempre se ha hecho.
   *
   * Antes era «la primera zona urbana» sin orden fijo, y con dos urbanas en
   * producción las carreras sin ubicar caían en Lago Sochagota.
   */
  puntoDeReferencia(): Point | undefined {
    const zona =
      this.cache.find((z) => z.esReferencia) ?? this.cache.find((z) => z.kind === 'urbano') ?? this.cache[0];
    if (!zona) return undefined;

    // El centro del rectángulo que la envuelve: en un círculo es el centro
    // exacto, y el promedio de vértices contaba dos veces el de cierre.
    const puntos = zona.polygon.coordinates.flat();
    const lats = puntos.map(([, y]) => y);
    const lngs = puntos.map(([x]) => x);
    return {
      lat: (Math.min(...lats) + Math.max(...lats)) / 2,
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    };
  }

  /**
   * Los ajustes del despacho, una sola regla para toda la ciudad (26/11/2026).
   *
   * El despacho es por cercanía —todos los taxis del rango, y el rango se va
   * ampliando— y no depende de en qué barrio cae el punto: los barrios son
   * para las estadísticas. Los ajustes viven en `dispatch_settings` y se
   * cambian desde el panel; se cargan en memoria junto con las zonas.
   */
  ajustesDespacho(): AjustesDespacho {
    return this.ajustes;
  }

  /** Los parámetros de la ronda N. */
  waveConfig(wave: 1 | 2 | 3): WaveConfig {
    return this.ajustes.rondas.find((r) => r.wave === wave) ?? AJUSTES_DESPACHO_DE_FABRICA.rondas[wave - 1]!;
  }
}
