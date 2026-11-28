import { z } from 'zod';
import type { TransitionActor } from './ride';

/**
 * Cancelación de una carrera por el conductor, por causa mayor.
 *
 * Solo antes de recoger al cliente: asignada o con el conductor en el lugar.
 * Con el pasajero a bordo la carrera se termina, no se cancela. La máquina de
 * estados (§5.3) ya lo permitía con «motivo obligatorio»; faltaba que el
 * conductor pudiera hacerlo y que quedara contado.
 *
 * El motivo se elige de una lista corta para poder contarlo en Reportes —por
 * conductor y en general—, con «Otro» y su explicación para lo que no cabe.
 */

export const MOTIVOS_CANCELACION_CONDUCTOR = [
  { clave: 'falla_mecanica', texto: 'Falla mecánica o pinchazo' },
  { clave: 'accidente', texto: 'Accidente o problema en la vía' },
  { clave: 'emergencia', texto: 'Emergencia personal o de salud' },
  { clave: 'cliente_no_aparece', texto: 'El cliente no aparece o no contesta' },
  { clave: 'otro', texto: 'Otro motivo' },
] as const;

export type MotivoCancelacionConductor = (typeof MOTIVOS_CANCELACION_CONDUCTOR)[number]['clave'];

const CLAVES = MOTIVOS_CANCELACION_CONDUCTOR.map((m) => m.clave) as [
  MotivoCancelacionConductor,
  ...MotivoCancelacionConductor[],
];

export const cancelacionConductorSchema = z
  .object({
    motivo: z.enum(CLAVES),
    /** Obligatorio con «Otro»; con los demás, opcional. */
    detalle: z.string().trim().max(200, 'Hasta 200 caracteres').optional(),
  })
  .refine((v) => v.motivo !== 'otro' || (v.detalle?.length ?? 0) >= 5, {
    message: 'Cuenta en pocas palabras por qué cancelas',
    path: ['detalle'],
  });
export type CancelacionConductor = z.infer<typeof cancelacionConductorSchema>;

/** «Falla mecánica o pinchazo», o lo que escribió el conductor con «Otro». */
export function textoDelMotivo(motivo: string | null | undefined, detalle?: string | null): string {
  const definido = MOTIVOS_CANCELACION_CONDUCTOR.find((m) => m.clave === motivo);
  if (!definido) return detalle?.trim() || 'Sin motivo';
  if (definido.clave === 'otro') return detalle?.trim() || definido.texto;
  return detalle?.trim() ? `${definido.texto}: ${detalle.trim()}` : definido.texto;
}

/** Quién canceló, en palabras de la oficina. */
export const QUIEN_CANCELA: Record<TransitionActor, string> = {
  customer: 'Cliente',
  operator: 'Oficina',
  driver: 'Conductor',
  system: 'Sistema',
};

/**
 * Fuerza mayor del conductor (21/11/2026): con estos motivos la carrera NO se
 * cancela, se le busca otro taxi al cliente y se le avisa cuando lo haya. Solo
 * «El cliente no aparece» cierra la carrera, porque ahí el que falta es él.
 */
export function cancelacionRelanza(motivo: MotivoCancelacionConductor | string | null | undefined): boolean {
  return motivo !== 'cliente_no_aparece';
}

/** Los estados desde los que el conductor todavía puede cancelar. */
export const CANCELABLE_POR_EL_CONDUCTOR = ['ASSIGNED', 'DRIVER_ARRIVED'] as const;

/* ------------------------------------------------ sanción por cancelar --- */

/**
 * La sanción por soltar una carrera ya aceptada (27/11/2026): 30 minutos sin
 * poder trabajar. El cliente se quedó esperando un taxi que le habían
 * prometido, y hasta ahora cancelar no le costaba nada al conductor.
 *
 * La regla:
 *  - «Otro motivo» es cancelar sin justificación: se sanciona siempre.
 *  - Falla mecánica, accidente o emergencia son fuerza mayor: la primera del
 *    día no se sanciona. Desde la segunda sí, y la oficina recibe el aviso:
 *    si no, bastaría con marcar siempre «falla mecánica».
 *  - «El cliente no aparece» no se sanciona, pero solo se puede marcar con el
 *    taxi ya en el punto (`puedeMarcarClienteNoAparece`).
 *
 * La carrera se relanza igual en todos los casos; la oficina puede levantar
 * la sanción desde la ficha del conductor.
 */
export const MINUTOS_DE_SANCION_POR_CANCELAR = 30;

/** Cuántas cancelaciones por fuerza mayor se le pasan a un conductor en un día. */
export const CANCELACIONES_JUSTIFICADAS_POR_DIA = 1;

export function sancionPorCancelar(
  motivo: MotivoCancelacionConductor | string,
  /** Las que ya llevaba hoy por fuerza mayor, sin contar esta. */
  justificadasHoy: number,
): { minutos: number; razon: string } | null {
  if (motivo === 'cliente_no_aparece') return null;
  if (motivo === 'otro') {
    return { minutos: MINUTOS_DE_SANCION_POR_CANCELAR, razon: 'canceló una carrera aceptada sin un motivo de fuerza mayor' };
  }
  if (justificadasHoy >= CANCELACIONES_JUSTIFICADAS_POR_DIA) {
    return {
      minutos: MINUTOS_DE_SANCION_POR_CANCELAR,
      razon: `es su cancelación número ${justificadasHoy + 1} de hoy por fuerza mayor`,
    };
  }
  return null;
}

/** «El cliente no aparece» solo vale con el taxi ya en el punto. */
export const puedeMarcarClienteNoAparece = (estadoDeLaCarrera: string) => estadoDeLaCarrera === 'DRIVER_ARRIVED';
