/**
 * Medios de pago y servicios (27/11/2026).
 *
 * Antes la carrera solo decía «efectivo» o «pago electrónico». La empresa
 * necesita el medio exacto —Nequi, Daviplata o Llave—, porque cada conductor
 * recibe unos y no otros, y además presta servicios que no todos hacen:
 * llevar mascotas, domicilios de licorera y cables de inicio.
 *
 * Todo eso son «capacidades» del conductor, como en el sistema anterior
 * (Autocab), donde cada una era una letra. La carrera dice qué exige —su
 * medio de pago y, si lo hay, su servicio— y solo se le ofrece a los
 * conductores que lo tienen todo. No cambian la tarifa ni las oleadas: son
 * un filtro más, como el tipo de vehículo.
 */

/** Los medios electrónicos que la empresa maneja. */
export const MEDIOS_ELECTRONICOS = ['nequi', 'daviplata', 'llave'] as const;
export type MedioElectronico = (typeof MEDIOS_ELECTRONICOS)[number];

/** Lo que se le pregunta al cliente. */
export const MEDIOS_DE_PAGO = ['efectivo', ...MEDIOS_ELECTRONICOS] as const;

/**
 * El medio de una carrera. `electronico` es el de antes de este cambio:
 * «paga con algo electrónico», sin decir cuál. Lo siguen mandando las
 * carreras viejas y un flujo de n8n sin actualizar; se le ofrece a quien
 * reciba cualquiera de los medios electrónicos.
 */
export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number] | 'electronico';
export const MEDIOS_DE_PAGO_ACEPTADOS = [...MEDIOS_DE_PAGO, 'electronico'] as const;

/** Los servicios que no presta cualquier conductor. */
export const SERVICIOS = ['mascotas', 'licorera', 'cables'] as const;
export type Servicio = (typeof SERVICIOS)[number];

/** Lo que un conductor puede tener marcado en su ficha. */
export const CAPACIDADES = [...MEDIOS_ELECTRONICOS, ...SERVICIOS] as const;
export type Capacidad = (typeof CAPACIDADES)[number];

export const MEDIO_DE_PAGO_LABEL: Record<MedioDePago, string> = {
  efectivo: 'Efectivo',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  llave: 'Llave',
  electronico: 'Pago electrónico',
};

export const SERVICIO_LABEL: Record<Servicio, string> = {
  mascotas: 'Mascotas',
  licorera: 'Licorera',
  cables: 'Cables de inicio',
};

/** Cómo se le dice al conductor qué servicio es. */
export const SERVICIO_PARA_EL_CONDUCTOR: Record<Servicio, string> = {
  mascotas: 'Lleva mascota',
  licorera: 'Domicilio de licorera',
  cables: 'Cables de inicio',
};

export const CAPACIDAD_LABEL: Record<Capacidad, string> = {
  nequi: MEDIO_DE_PAGO_LABEL.nequi,
  daviplata: MEDIO_DE_PAGO_LABEL.daviplata,
  llave: MEDIO_DE_PAGO_LABEL.llave,
  ...SERVICIO_LABEL,
};

/** La letra que tenía cada capacidad en Autocab, para cargar el listado. */
export const LETRA_DE_AUTOCAB: Record<string, Capacidad> = {
  N: 'nequi',
  D: 'daviplata',
  K: 'llave',
  M: 'mascotas',
  L: 'licorera',
  C: 'cables',
};

export const esMedioElectronico = (medio: string): medio is MedioElectronico =>
  (MEDIOS_ELECTRONICOS as readonly string[]).includes(medio);

/** Solo las capacidades que existen, sin repetir y en el orden de siempre. */
export function capacidadesValidas(lista: readonly string[] | null | undefined): Capacidad[] {
  const dadas = new Set(lista ?? []);
  return CAPACIDADES.filter((c) => dadas.has(c));
}

/**
 * Si un conductor puede atender una carrera con ese medio de pago y ese
 * servicio. `aceptaElectronico` es la marca de antes: vale para el medio sin
 * especificar, no para uno concreto.
 */
export function conductorPuede(
  conductor: { capacidades?: readonly string[] | null; aceptaPagoElectronico?: boolean | null },
  carrera: { medioPago?: MedioDePago | null; servicio?: Servicio | null },
): boolean {
  const tiene = new Set(conductor.capacidades ?? []);
  const medio = carrera.medioPago ?? 'efectivo';
  if (medio === 'electronico') {
    if (!conductor.aceptaPagoElectronico && !MEDIOS_ELECTRONICOS.some((m) => tiene.has(m))) return false;
  } else if (medio !== 'efectivo' && !tiene.has(medio)) {
    // La marca vieja vale mientras no tenga ningún medio anotado (igual que el despacho).
    if (!conductor.aceptaPagoElectronico || MEDIOS_ELECTRONICOS.some((m) => tiene.has(m))) return false;
  }
  return !carrera.servicio || tiene.has(carrera.servicio);
}

/** Por qué no puede, en palabras para la oficina; `null` si sí puede. */
export function porQueNoPuede(
  conductor: { capacidades?: readonly string[] | null; aceptaPagoElectronico?: boolean | null },
  carrera: { medioPago?: MedioDePago | null; servicio?: Servicio | null },
): string | null {
  if (conductorPuede(conductor, { medioPago: carrera.medioPago }) === false) {
    const medio = carrera.medioPago ?? 'efectivo';
    return medio === 'electronico' ? 'no recibe pagos electrónicos' : `no recibe ${MEDIO_DE_PAGO_LABEL[medio]}`;
  }
  if (carrera.servicio && !conductorPuede(conductor, { servicio: carrera.servicio })) {
    return `no presta el servicio de ${SERVICIO_LABEL[carrera.servicio].toLowerCase()}`;
  }
  return null;
}

/** «Nequi · Lleva mascota», para una etiqueta corta; vacío si es efectivo y sin servicio. */
export function resumenDeExigencias(carrera: { medioPago?: MedioDePago | null; servicio?: Servicio | null }): string {
  const partes: string[] = [];
  const medio = carrera.medioPago ?? 'efectivo';
  if (medio !== 'efectivo') partes.push(MEDIO_DE_PAGO_LABEL[medio]);
  if (carrera.servicio) partes.push(SERVICIO_PARA_EL_CONDUCTOR[carrera.servicio]);
  return partes.join(' · ');
}
