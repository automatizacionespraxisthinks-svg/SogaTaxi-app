import { uuidv7 } from 'uuidv7';
import { poligonoCircular } from '@tax/shared';
import type { Database } from './db.module';
import * as schema from './schema';

/**
 * Lo que la operación necesita para existir: las zonas de Sogamoso con su factor
 * de tortuosidad y sus oleadas, y la tabla de tarifas vigente.
 *
 * Vive aparte del sembrado de desarrollo a propósito. Ese otro crea además
 * conductores de mentira con un PIN conocido y un usuario de oficina con una
 * contraseña de ejemplo, y ejecutarlo contra producción sería abrirle la
 * puerta a cualquiera que haya leído el repositorio. Separando los datos, el
 * sembrado de producción no puede crear esas cosas ni por descuido.
 *
 * Las zonas y las tarifas sí son reales y las confirma la empresa; aquí están
 * las vigentes al desplegar.
 */

/** El mismo círculo que dibuja el panel al crear una zona. */
export const circulo = poligonoCircular;

/**
 * Las zonas de Sogamoso, como círculos.
 *
 * PROVISIONAL, hasta que SogaTaxi confirme las suyas: solo el casco urbano,
 * un círculo de 2,0 km alrededor de la plaza (Nominatim: 5.7148, -72.9279).
 * No más: el límite con el municipio vecino pasa a 2,0 km al occidente de la
 * plaza, y con 2,6 km un 5 % del círculo quedaba fuera de Sogamoso (dentro de
 * una zona el punto se acepta sin preguntarle a Google).
 * Se llama «Centro» para que sea la zona de referencia de las carreras sin
 * ubicar (migración 0019).
 *
 * Las veredas no hacen falta para despachar: un punto fuera de toda zona entra
 * igual si Google dice que es de Sogamoso (`GeocodingService.cobertura`). Sí
 * sirven para las estadísticas, para las oleadas rurales, más anchas, y como
 * respaldo cuando Google no contesta, porque entonces se usa el rectángulo que
 * envuelve las zonas. Se agregan desde el panel, en *Zonas*.
 */
export const ZONES = [
  { name: 'Centro', kind: 'urbano' as const, lat: 5.7148, lng: -72.9279, radioKm: 2.0, tortuosity: 1.3 },
];

/** En lo urbano la oleada 1 es estrecha y rápida; en vereda, ancha y paciente. */
export const URBAN_WAVES = [
  { wave: 1 as const, radiusKm: 1.5, candidates: 3, timeoutSeconds: 45 },
  { wave: 2 as const, radiusKm: 3.5, candidates: 5, timeoutSeconds: 60 },
  { wave: 3 as const, radiusKm: 12, candidates: 12, timeoutSeconds: 90 },
];

export const RURAL_WAVES = [
  { wave: 1 as const, radiusKm: 5, candidates: 3, timeoutSeconds: 70 },
  { wave: 2 as const, radiusKm: 10, candidates: 6, timeoutSeconds: 90 },
  { wave: 3 as const, radiusKm: 20, candidates: 14, timeoutSeconds: 120 },
];

export async function sembrarZonas(db: Database): Promise<number> {
  for (const zone of ZONES) {
    await db
      .insert(schema.zones)
      .values({
        id: uuidv7(),
        name: zone.name,
        kind: zone.kind,
        polygon: circulo(zone.lat, zone.lng, zone.radioKm),
        tortuosity: zone.tortuosity,
        waves: zone.kind === 'urbano' ? URBAN_WAVES : RURAL_WAVES,
      })
      .onConflictDoNothing();
  }
  return ZONES.length;
}
