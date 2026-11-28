import { describe, expect, it } from 'vitest';
import {
  MINUTOS_DE_SANCION_POR_CANCELAR,
  avisosDeDocumentos,
  documentosVencidos,
  puedeMarcarClienteNoAparece,
  sancionPorCancelar,
} from '@tax/shared';

/** La sanción por soltar una carrera ya aceptada (27/11/2026). */
describe('sanción por cancelar', () => {
  it('«otro motivo» se sanciona siempre', () => {
    expect(sancionPorCancelar('otro', 0)?.minutos).toBe(MINUTOS_DE_SANCION_POR_CANCELAR);
  });

  it('la fuerza mayor se pasa una vez al día', () => {
    for (const motivo of ['falla_mecanica', 'accidente', 'emergencia']) {
      expect(sancionPorCancelar(motivo, 0)).toBeNull();
      expect(sancionPorCancelar(motivo, 1)?.minutos).toBe(30);
      expect(sancionPorCancelar(motivo, 4)?.razon).toContain('número 5');
    }
  });

  it('«el cliente no aparece» no se sanciona, pero solo vale en el punto', () => {
    expect(sancionPorCancelar('cliente_no_aparece', 9)).toBeNull();
    expect(puedeMarcarClienteNoAparece('DRIVER_ARRIVED')).toBe(true);
    expect(puedeMarcarClienteNoAparece('ASSIGNED')).toBe(false);
  });
});

/** Los documentos que se le avisan al conductor y que, con el bloqueo, lo dejan fuera. */
describe('documentos del conductor', () => {
  const hoy = '2026-11-27';

  it('sin fechas no hay nada que avisar ni que bloquear', () => {
    const avisos = avisosDeDocumentos(hoy, null, [{ placa: 'XGD989', soat: null, tecnomecanica: null }]);
    expect(avisos).toEqual([]);
    expect(documentosVencidos(avisos)).toBeNull();
  });

  it('avisa lo vencido y lo que vence en 15 días, lo vencido primero', () => {
    const avisos = avisosDeDocumentos(hoy, '2026-12-05', [{ placa: 'XGD989', soat: '2026-11-20', tecnomecanica: '2027-06-01' }]);
    expect(avisos.map((a) => [a.clase, a.vencido, a.dias])).toEqual([
      ['soat', true, -7],
      ['licencia', false, 8],
    ]);
    expect(avisos[0]!.texto).toBe('El SOAT del carro XGD989 venció el 20 de noviembre.');
    expect(avisos[1]!.texto).toBe('Su licencia de conducción vence en 8 días (5 de diciembre).');
  });

  it('el día del vencimiento todavía no está vencido', () => {
    const [aviso] = avisosDeDocumentos(hoy, hoy, []);
    expect(aviso?.vencido).toBe(false);
    expect(aviso?.texto).toBe('Su licencia de conducción vence hoy.');
  });

  it('lo que vence a más de 15 días no se avisa', () => {
    expect(avisosDeDocumentos(hoy, '2026-12-13', [])).toEqual([]);
    expect(avisosDeDocumentos(hoy, '2026-12-12', [])).toHaveLength(1);
  });

  it('solo lo vencido impide trabajar', () => {
    expect(documentosVencidos(avisosDeDocumentos(hoy, '2026-12-01', []))).toBeNull();
    expect(documentosVencidos(avisosDeDocumentos(hoy, '2026-11-01', []))).toBe('Su licencia de conducción venció el 1 de noviembre.');
  });
});
