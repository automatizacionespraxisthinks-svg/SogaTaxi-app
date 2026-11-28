import { DIAS_DE_AVISO_DE_VENCIMIENTO } from './avisos-flota';

/**
 * Los documentos que un conductor necesita al día para trabajar (27/11/2026):
 * su licencia y, del carro que maneja, el SOAT y la revisión técnico-mecánica.
 *
 * Dos usos:
 *  - Avisarle al conductor al entrar a la aplicación: «Su SOAT vence en 8
 *    días», «Su licencia está vencida».
 *  - Si la empresa activa el bloqueo, no dejarle abrir turno ni ofrecerle
 *    carreras con alguno vencido.
 *
 * Una fecha vacía no bloquea ni avisa: a la carga inicial le faltan muchas, y
 * dejar por fuera a quien solo tiene el dato sin digitar sería injusto. Esas
 * se ven en «Avisos» y en la ficha, para completarlas.
 */

export type ClaseDeDocumento = 'licencia' | 'soat' | 'tecnomecanica';

export interface AvisoDeDocumento {
  clase: ClaseDeDocumento;
  /** La placa del carro, para el SOAT y la técnico-mecánica. */
  placa?: string;
  /** `AAAA-MM-DD`. */
  fecha: string;
  /** Días que faltan; negativo si ya venció. */
  dias: number;
  vencido: boolean;
  /** La frase lista para mostrarle al conductor. */
  texto: string;
}

export interface CarroConDocumentos {
  placa: string;
  soat: string | null;
  tecnomecanica: string | null;
}

const NOMBRE: Record<ClaseDeDocumento, string> = {
  licencia: 'Su licencia de conducción',
  soat: 'El SOAT',
  tecnomecanica: 'La revisión técnico-mecánica',
};

const diasEntre = (hoy: string, fecha: string) =>
  Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);

const fechaEnPalabras = (fecha: string) =>
  new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function aviso(clase: ClaseDeDocumento, fecha: string, hoy: string, placa?: string): AvisoDeDocumento | null {
  const dias = diasEntre(hoy, fecha);
  if (dias > DIAS_DE_AVISO_DE_VENCIMIENTO) return null;
  const que = `${NOMBRE[clase]}${placa ? ` del carro ${placa}` : ''}`;
  const texto =
    dias < 0
      ? `${que} venció el ${fechaEnPalabras(fecha)}.`
      : dias === 0
        ? `${que} vence hoy.`
        : `${que} vence en ${dias} ${dias === 1 ? 'día' : 'días'} (${fechaEnPalabras(fecha)}).`;
  return { clase, placa, fecha, dias, vencido: dias < 0, texto };
}

/**
 * Lo que está vencido o por vencer, lo vencido primero. `hoy` es la fecha en
 * Sogamoso (`AAAA-MM-DD`), no la del servidor.
 */
export function avisosDeDocumentos(
  hoy: string,
  licenciaVence: string | null | undefined,
  carros: CarroConDocumentos[],
): AvisoDeDocumento[] {
  const lista: (AvisoDeDocumento | null)[] = [licenciaVence ? aviso('licencia', licenciaVence, hoy) : null];
  for (const carro of carros) {
    if (carro.soat) lista.push(aviso('soat', carro.soat, hoy, carro.placa));
    if (carro.tecnomecanica) lista.push(aviso('tecnomecanica', carro.tecnomecanica, hoy, carro.placa));
  }
  return lista.filter((a): a is AvisoDeDocumento => a !== null).sort((a, b) => a.dias - b.dias);
}

/** Lo que le impide trabajar, en una frase; `null` si nada está vencido. */
export function documentosVencidos(avisos: AvisoDeDocumento[]): string | null {
  const vencidos = avisos.filter((a) => a.vencido);
  if (vencidos.length === 0) return null;
  return vencidos.map((a) => a.texto).join(' ');
}
