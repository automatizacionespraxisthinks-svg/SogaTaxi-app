import { LETRA_DE_AUTOCAB, capacidadesValidas, type Capacidad } from '@tax/shared';
/**
 * Los dos archivos que exporta Autocab, el sistema anterior de la empresa:
 * `Vehiculos.csv` y `Conductores.csv` (26/11/2026).
 *
 * Aquí solo se leen y se limpian; lo que se hace con el resultado está en
 * `cli/importar-autocab.ts`. Autocab repite cada cosa varias veces y hay que
 * deshacerlo antes de cargar:
 *
 *  - cada carro sale dos veces: la unidad de la aplicación («2006») y la del
 *    radio («12006», con la placa terminada en R). Aquí queda una sola vez,
 *    con la placa limpia y el número de cuatro dígitos como móvil;
 *  - cada persona sale una vez por terminal y por carro: «2006», «2006-1»,
 *    «12006». Aquí queda una sola vez, con todos los carros que maneja.
 *
 * A la persona se la reconoce por la cédula —viene en la columna «Licencia
 * No.»— y, si no la trae, por el nombre completo.
 */

export interface VehiculoDeAutocab {
  placa: string;
  /** El número de unidad de cuatro dígitos: el móvil. */
  interno: string;
  marca: string | null;
  modelo: number | null;
  capacidad: number;
  tipo: 'sedan' | 'camioneta';
  propietario: string | null;
  /** `AAAA-MM-DD`. */
  soatVence: string | null;
  tecnomecanicaVence: string | null;
}

export interface PersonaDeAutocab {
  nombre: string;
  /** Solo dígitos, o nulo si Autocab no la tiene. */
  cedula: string | null;
  /** E.164, o nulo. */
  celular: string | null;
  licenciaVence: string | null;
  /** El número con que entraba en Autocab, sin guion: su código aquí. */
  codigo: string | null;
  /** El PIN de esa misma unidad, para que entre con el que ya conoce. */
  pin: string | null;
  /** Suspendido en todas sus unidades de Autocab: se carga desactivado. */
  suspendido: boolean;
  carros: { placa: string; rol: 'conductor' | 'relevador' }[];
  /**
   * Los medios de pago que recibe y los servicios que presta: las letras de
   * «Capacidades» que el sistema conoce (N, D, K, M, L, C), de todas sus
   * unidades juntas.
   */
  capacidades: Capacidad[];
  /** Cuántas filas de Autocab eran esta persona. */
  filas: number;
}

export interface AutocabLeido {
  vehiculos: VehiculoDeAutocab[];
  personas: PersonaDeAutocab[];
  avisos: string[];
}

/* ----------------------------------------------------------------- CSV --- */

/** CSV con comillas y saltos de línea dentro de un campo (RFC 4180). */
export function leerCsv(texto: string): Record<string, string>[] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (entreComillas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  const [cabecera, ...datos] = filas;
  if (!cabecera) return [];
  const nombres = cabecera.map((n) => n.trim());
  return datos
    .filter((f) => f.some((c) => c.trim() !== ''))
    .map((f) => Object.fromEntries(nombres.map((n, i) => [n, (f[i] ?? '').trim()])));
}

/** El valor de la columna cuyo nombre empieza así: Autocab los alarga según el idioma. */
const col = (fila: Record<string, string>, prefijo: string): string => {
  const clave = Object.keys(fila).find((k) => k.toLowerCase().startsWith(prefijo.toLowerCase()));
  return clave ? (fila[clave] ?? '') : '';
};

/* ------------------------------------------------------------ limpieza --- */

/** «XGD829 R», «xgd 829», «XGD829R» → «XGD829». Nulo si no es una placa. */
export function placaLimpia(valor: string): string | null {
  const m = valor.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^([A-Z]{3}\d{3})R?$/);
  return m ? m[1]! : null;
}

/** `d/m/aa` de Autocab → `AAAA-MM-DD`. */
export function fechaDeAutocab(valor: string): string | null {
  const m = valor.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Diez dígitos que empiezan por 3 → +57…; lo demás no es un celular. */
export function celularDeAutocab(valor: string): string | null {
  const d = valor.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, '');
  return /^3\d{9}$/.test(d) ? `+57${d}` : null;
}

/** «1057584123 C2» → «1057584123». Entre 6 y 10 dígitos al comienzo. */
export function cedulaDeAutocab(valor: string): string | null {
  const m = valor.trim().match(/^(\d{6,10})(?!\d)/);
  return m ? m[1]! : null;
}

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
/** «JAIRO  PEREZ de la CRUZ» → «Jairo Perez de la Cruz». */
export function nombreLimpio(valor: string): string {
  return valor
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

const claveDeNombre = (valor: string) =>
  valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** «2006», «2006-1», «12006» → móvil 2006, si es del radio y el relevo. */
function unidad(valor: string): { base: string; radio: boolean; relevo: string | null } | null {
  const m = valor.trim().match(/^(1?)(\d{4})(?:-(\d))?$/);
  return m ? { base: m[2]!, radio: m[1] === '1', relevo: m[3] ?? null } : null;
}

const laMayor = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/* ------------------------------------------------------------- lectura --- */

export function leerAutocab(csvVehiculos: string, csvConductores: string): AutocabLeido {
  const avisos: string[] = [];

  /* Carros: una fila por placa, con lo mejor de sus dos unidades. */
  const carros = new Map<string, VehiculoDeAutocab & { deRadio: boolean }>();
  for (const f of leerCsv(csvVehiculos)) {
    const placa = placaLimpia(col(f, 'Placa'));
    const u = unidad(col(f, 'Numero de unidad'));
    if (!placa || !u) {
      avisos.push(`Vehículo «${col(f, 'Numero de unidad')}» con placa «${col(f, 'Placa')}»: no es una placa; se salta.`);
      continue;
    }
    const marca = [col(f, 'Marca'), col(f, 'Linea')]
      .join(' ')
      .toUpperCase()
      .split(/\s+/)
      .filter((p, i, todas) => p && todas.indexOf(p) === i)
      .join(' ');
    const anio = Number(col(f, 'Modelo'));
    const nombre = nombreLimpio(`${col(f, 'Nombre del propietario')} ${col(f, 'Apellido del propietario')}`);
    const esta: VehiculoDeAutocab & { deRadio: boolean } = {
      placa,
      interno: u.base,
      marca: marca || null,
      modelo: Number.isInteger(anio) && anio >= 1980 && anio <= 2030 ? anio : null,
      capacidad: Number(col(f, 'Tamaño')) >= 2 ? Number(col(f, 'Tamaño')) : 4,
      tipo: /CAMION|SUV|WAGON/i.test(col(f, 'tipo de vehiculo')) ? 'camioneta' : 'sedan',
      propietario: nombre || null,
      soatVence: fechaDeAutocab(col(f, 'Vencimiento del Seguro')),
      tecnomecanicaVence: fechaDeAutocab(col(f, 'RTO expira')),
      deRadio: u.radio,
    };
    const ya = carros.get(placa);
    if (!ya) {
      carros.set(placa, esta);
      continue;
    }
    // Manda la unidad de la aplicación; la del radio rellena lo que falte.
    const [principal, otra] = ya.deRadio && !esta.deRadio ? [esta, ya] : [ya, esta];
    carros.set(placa, {
      ...principal,
      marca: principal.marca ?? otra.marca,
      modelo: principal.modelo ?? otra.modelo,
      propietario: principal.propietario ?? otra.propietario,
      tipo: principal.tipo === 'camioneta' || otra.tipo === 'camioneta' ? 'camioneta' : 'sedan',
      soatVence: laMayor(principal.soatVence, otra.soatVence),
      tecnomecanicaVence: laMayor(principal.tecnomecanicaVence, otra.tecnomecanicaVence),
    });
  }

  // Dos carros con el mismo móvil: el índice de la base no lo admite.
  const porInterno = new Map<string, string>();
  for (const carro of carros.values()) {
    const otra = porInterno.get(carro.interno);
    if (otra) avisos.push(`Las placas ${otra} y ${carro.placa} tienen el mismo móvil ${carro.interno}: la segunda queda sin móvil.`);
    else porInterno.set(carro.interno, carro.placa);
  }
  const vehiculos = [...carros.values()].map(({ deRadio: _deRadio, ...v }) => ({
    ...v,
    interno: porInterno.get(v.interno) === v.placa ? v.interno : '',
  }));

  /* Personas: se juntan las filas de la misma cédula y, sin cédula, del mismo nombre. */
  interface Fila {
    nombre: string;
    clave: string;
    cedula: string | null;
    celular: string | null;
    licenciaVence: string | null;
    unidad: ReturnType<typeof unidad>;
    codigo: string | null;
    pin: string | null;
    suspendido: boolean;
    placa: string | null;
    capacidades: Capacidad[];
  }
  const filas: Fila[] = leerCsv(csvConductores).map((f) => {
    const nombre = nombreLimpio(`${col(f, 'Nombres')} ${col(f, 'Apellidos')}`);
    const u = unidad(col(f, 'Numero de unidad'));
    return {
      nombre,
      clave: claveDeNombre(nombre),
      cedula: cedulaDeAutocab(col(f, 'Licencia No')),
      celular: celularDeAutocab(col(f, 'Teléfono')) ?? celularDeAutocab(col(f, 'Móvil')),
      licenciaVence: fechaDeAutocab(col(f, 'La licencia caduca')),
      unidad: u,
      codigo: u ? `${u.radio ? '1' : ''}${u.base}${u.relevo ?? ''}` : null,
      pin: /^\d{4}$/.test(col(f, 'PIN')) ? col(f, 'PIN') : null,
      suspendido: col(f, 'Estado de suspensi').toLowerCase() === 'true',
      placa: placaLimpia(col(f, 'Número de referencia')),
      // «MFELRND»: una letra por capacidad. Las que no son nuestras se saltan.
      capacidades: capacidadesValidas(
        [...col(f, 'Capacidades').toUpperCase()].map((letra) => LETRA_DE_AUTOCAB[letra]).filter((c) => c !== undefined),
      ),
    };
  });

  // Una persona con cédula «adopta» las filas sin cédula de su mismo nombre,
  // si el nombre es de una sola cédula: con dos, no se sabe de cuál son.
  const cedulasDelNombre = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!f.cedula) continue;
    const s = cedulasDelNombre.get(f.clave) ?? new Set<string>();
    s.add(f.cedula);
    cedulasDelNombre.set(f.clave, s);
  }
  const grupos = new Map<string, Fila[]>();
  for (const f of filas) {
    if (!f.clave) continue;
    const delNombre = cedulasDelNombre.get(f.clave);
    const identidad = f.cedula
      ? `c:${f.cedula}`
      : delNombre?.size === 1
        ? `c:${[...delNombre][0]}`
        : `n:${f.clave}`;
    grupos.set(identidad, [...(grupos.get(identidad) ?? []), f]);
  }

  const placasConocidas = new Set(vehiculos.map((v) => v.placa));
  const placasDesconocidas = new Set<string>();
  // La unidad de la aplicación sin relevo es la principal: con ella entraba.
  const prioridad = (f: Fila) => (!f.unidad ? 9 : f.unidad.radio ? 2 : f.unidad.relevo ? 1 : 0);

  const personas: PersonaDeAutocab[] = [];
  for (const [identidad, grupo] of grupos) {
    const orden = [...grupo].sort((a, b) => prioridad(a) - prioridad(b) || (a.codigo ?? '').localeCompare(b.codigo ?? ''));
    const principal = orden.find((f) => f.codigo && f.pin) ?? orden[0]!;
    const carrosDeLaPersona = new Map<string, 'conductor' | 'relevador'>();
    for (const f of grupo) {
      if (!f.placa) continue;
      if (!placasConocidas.has(f.placa)) {
        placasDesconocidas.add(f.placa);
        continue;
      }
      const rol = f.unidad?.relevo ? 'relevador' : 'conductor';
      if (rol === 'conductor' || !carrosDeLaPersona.has(f.placa)) carrosDeLaPersona.set(f.placa, rol);
    }
    personas.push({
      capacidades: capacidadesValidas(grupo.flatMap((f) => f.capacidades)),
      nombre: principal.nombre,
      cedula: identidad.startsWith('c:') ? identidad.slice(2) : null,
      celular: orden.find((f) => f.celular)?.celular ?? null,
      licenciaVence: grupo.reduce<string | null>((mayor, f) => laMayor(mayor, f.licenciaVence), null),
      codigo: principal.codigo,
      pin: principal.codigo ? principal.pin : null,
      suspendido: grupo.every((f) => f.suspendido),
      carros: [...carrosDeLaPersona].map(([placa, rol]) => ({ placa, rol })),
      filas: grupo.length,
    });
  }

  if (placasDesconocidas.size) {
    avisos.push(
      `Placas que tienen conductor pero no están en el archivo de vehículos (${placasDesconocidas.size}): ${[...placasDesconocidas].sort().join(', ')}. Esos vínculos no se cargan.`,
    );
  }
  return { vehiculos, personas, avisos };
}
