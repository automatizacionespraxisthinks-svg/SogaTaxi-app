/**
 * Los avisos de la flota (26/11/2026): los vencimientos de los conductores y
 * los carros (licencia, SOAT, revisión técnico-mecánica), no las carreras
 * del momento. Solo vencimientos: los «datos por completar» se quitaron, la
 * empresa no los quiere como avisos. Van
 * en su propia sección del panel para no mezclarse con los avisos rojos de la
 * operación: una licencia por vencer no es urgente como una carrera sin taxi.
 */

/**
 * Con cuántos días de anticipación se avisa un vencimiento. Eran 30; la empresa
 * los pidió a 15 (27/11/2026): con un mes el aviso llegaba tan temprano que se
 * dejaba pasar.
 */
export const DIAS_DE_AVISO_DE_VENCIMIENTO = 15;

export type ClaseDeAvisoDeFlota =
  | 'licencia_vencida'
  | 'licencia_por_vencer'
  | 'soat_vencido'
  | 'soat_por_vencer'
  | 'tecnomecanica_vencida'
  | 'tecnomecanica_por_vencer'
  /** Un campo adicional de tipo fecha que definió la oficina (tarjeta de operación…). */
  | `extra_vencido:${string}`
  | `extra_por_vencer:${string}`;

export interface AvisoDeFlota {
  /** Id del conductor o del vehículo. */
  id: string;
  de: 'conductor' | 'vehiculo';
  /** El nombre del conductor o la placa del carro. */
  titulo: string;
  /** El código del conductor o el móvil del carro. */
  detalle: string | null;
  /** `AAAA-MM-DD`: cuándo vence. */
  fecha: string;
  /** Días que faltan (negativo: ya venció). */
  dias: number;
}

export interface GrupoDeAvisosDeFlota {
  clase: ClaseDeAvisoDeFlota;
  titulo: string;
  /** Qué hacer con ellos. */
  ayuda: string;
  /** `critical`: ya venció. `warning`: está por vencer. */
  tono: 'critical' | 'warning';
  avisos: AvisoDeFlota[];
}

export interface AvisosDeFlota {
  /** `AAAA-MM-DD`, la fecha en Sogamoso con la que se calcularon. */
  hoy: string;
  diasDeAviso: number;
  grupos: GrupoDeAvisosDeFlota[];
  /** Vencidos: lo que no puede esperar. Es el número del menú. */
  urgentes: number;
}
