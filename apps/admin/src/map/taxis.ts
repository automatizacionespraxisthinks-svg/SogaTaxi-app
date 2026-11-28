import type { Driver } from '@tax/shared';
import { token } from './style';

/*
 * Los colores de los taxis en el mapa (27/11/2026): disponible verde, en
 * carrera azul, en pausa naranja, fuera de turno gris. En carrera era el
 * amarillo de la marca, que sobre el terreno claro casi no se veía y se
 * confundía con el naranja de la pausa; el azul no se parece a ningún otro.
 *
 * Lo comparten el mapa de Operación y el de «Nueva carrera»: un taxi tiene
 * que verse igual en los dos.
 */
const COLOR_DEL_TAXI: Record<Driver['status'], string> = {
  AVAILABLE: '--t-positive-solid',
  ON_RIDE: '--map-en-carrera',
  PAUSED: '--t-warning-solid',
  OFF_SHIFT: '--t-neutral-solid',
};

export const colorDelTaxi = (status: Driver['status']) => token(COLOR_DEL_TAXI[status]);

/** El número del móvil en la empresa si se conoce; si no, la placa. */
export function rotulo(driver: Driver): string {
  const movil = driver.moviles?.find((m) => m.placa === driver.vehicle.plate && m.interno);
  return movil?.interno ?? driver.vehicle.plate;
}

/** «Móvil 045» o, si no tiene número, nada: la placa ya se muestra aparte. */
export function movilDe(driver: Driver): string | null {
  return driver.moviles?.find((m) => m.placa === driver.vehicle.plate && m.interno)?.interno ?? null;
}
