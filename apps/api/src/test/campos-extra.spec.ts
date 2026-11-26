import { describe, expect, it } from 'vitest';
import { fechaIsoValida, valorDeCampoExtraValido } from '@tax/shared';

describe('campos adicionales y fechas de la ficha (26/11/2026)', () => {
  it('una fecha tiene que existir, no solo parecerlo', () => {
    expect(fechaIsoValida('2026-12-10')).toBe(true);
    expect(fechaIsoValida('2028-02-29')).toBe(true);
    // `Date.parse` la aceptaba y la convertía en el 3 de marzo; la base la rechazaba con un 500.
    expect(fechaIsoValida('2026-02-31')).toBe(false);
    expect(fechaIsoValida('2027-02-29')).toBe(false);
    expect(fechaIsoValida('10/12/2026')).toBe(false);
    expect(fechaIsoValida('')).toBe(false);
  });

  it('cada tipo de campo acepta lo suyo, y vacío siempre sirve porque borra el valor', () => {
    expect(valorDeCampoExtraValido('texto', 'Asprotaxi')).toBe(true);
    expect(valorDeCampoExtraValido('texto', 'x'.repeat(201))).toBe(false);
    expect(valorDeCampoExtraValido('numero', '1520')).toBe(true);
    expect(valorDeCampoExtraValido('numero', '12,5')).toBe(true);
    expect(valorDeCampoExtraValido('numero', 'doce')).toBe(false);
    expect(valorDeCampoExtraValido('fecha', '2027-03-01')).toBe(true);
    expect(valorDeCampoExtraValido('fecha', '2027-13-01')).toBe(false);
    for (const tipo of ['texto', 'numero', 'fecha'] as const) expect(valorDeCampoExtraValido(tipo, '  ')).toBe(true);
  });
});
