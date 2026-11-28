import type { Capacidad } from './capacidades';
import type { Point } from './geo';
import type { VehicleType } from './ride';

export const DRIVER_STATUSES = ['OFF_SHIFT', 'AVAILABLE', 'ON_RIDE', 'PAUSED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/**
 * El taxi del turno abierto. Sin turno no hay taxi: entonces solo viene la
 * placa «—» y lo demás queda sin dato, en vez de inventar «sedán, 4
 * pasajeros, activo» como hacía el panel (17/11/2026).
 */
export interface Vehicle {
  plate: string;
  type?: VehicleType;
  capacity?: number;
  active?: boolean;
}

export interface MovilVinculado {
  /** El vehículo: lo que se manda al fijar los permitidos. */
  vehiculoId?: string;
  /** Si lo puso el listado maestro o la oficina en el panel. */
  origen?: 'listado' | 'panel';
  /** El número del móvil en la empresa: «002». */
  interno?: string;
  placa: string;
  marca?: string;
  modelo?: number;
  rol: 'conductor' | 'relevador';
  activo: boolean;
}

export interface Driver {
  id: string;
  /** Código interno del conductor; junto con placa y PIN forma el acceso (§8.1). */
  code: string;
  name: string;
  phone: string;
  status: DriverStatus;
  vehicle: Vehicle;
  /** Última posición conocida. Solo se registra con turno abierto (§9.2). */
  position?: Point;
  /** Antigüedad de la posición en segundos; >60 s descarta al candidato (§5.2). */
  positionAgeSeconds?: number;
  /** Si sigue trabajando. Un conductor inactivo no entra en ninguna oleada. */
  active: boolean;
  /** Cuenta con la que el equipo prueba; Reportes la puede dejar fuera. */
  esPrueba?: boolean;
  /** Recibe pagos electrónicos: solo a estos les llegan las carreras que se pagan así. */
  aceptaPagoElectronico?: boolean;
  /** Los medios de pago que recibe y los servicios que presta. */
  capacidades?: Capacidad[];
  /**
   * Suspendido por el reglamento interno hasta esta fecha (ISO). Solo viene
   * mientras la suspensión sigue en pie; una ya cumplida no se manda.
   */
  suspendidoHasta?: string;
  motivoSuspension?: string;
  /** Del listado maestro: vencimiento de la licencia (`AAAA-MM-DD`) y su restricción. */
  licenciaVence?: string;
  licenciaRestriccion?: string;
  /** Si tiene la cédula registrada. La cédula en sí no viaja al panel. */
  tieneCedula?: boolean;
  /** Los campos adicionales de la oficina, por id del campo. */
  extra?: Record<string, string>;
  /** Los móviles a los que está vinculado, como conductor o relevador. */
  moviles?: MovilVinculado[];
  shiftStartedAt?: string;
  /**
   * El turno abierto es en un móvil al que el listado maestro no lo vincula
   * (17/11/2026): se le deja trabajar, y la oficina lo ve marcado.
   */
  fueraDeListado?: boolean;
  deviceRegistered: boolean;
}

/* -------------------------------------------------- campos adicionales --- */

/**
 * Un campo adicional que definió la oficina para los conductores o para los
 * vehículos (26/11/2026): un dato que el sistema no trae de fábrica.
 */
export interface CampoExtra {
  id: string;
  entidad: 'conductor' | 'vehiculo';
  nombre: string;
  tipo: 'texto' | 'numero' | 'fecha';
  activo: boolean;
}

export const TIPO_DE_CAMPO_EXTRA: Record<CampoExtra['tipo'], string> = {
  texto: 'Texto',
  numero: 'Número',
  fecha: 'Fecha',
};

/** Cuántos campos adicionales admite cada ficha: más ya no es una ficha. */
export const MAX_CAMPOS_EXTRA = 20;

/**
 * Si un texto es una fecha `AAAA-MM-DD` que existe. `Date.parse` no basta:
 * acepta «2026-02-31» y lo convierte en el 3 de marzo; la base no, y la
 * petición acababa en un error 500 en vez de un aviso claro.
 */
export function fechaIsoValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/** Si un valor sirve para un campo de ese tipo. Vacío siempre sirve: lo borra. */
export function valorDeCampoExtraValido(tipo: CampoExtra['tipo'], valor: string): boolean {
  const v = valor.trim();
  if (v === '') return true;
  if (v.length > 200) return false;
  if (tipo === 'numero') return /^-?\d+([.,]\d+)?$/.test(v);
  if (tipo === 'fecha') return fechaIsoValida(v);
  return true;
}
