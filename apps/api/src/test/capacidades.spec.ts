import { describe, expect, it } from 'vitest';
import { capacidadesValidas, conductorPuede, porQueNoPuede, resumenDeExigencias } from '@tax/shared';
import { leerAutocab } from '../modules/fleet/autocab';

/**
 * Medios de pago y servicios (27/11/2026): a quién se le puede ofrecer una
 * carrera. El filtro SQL del despacho (`cumpleLasExigencias`) tiene que decir
 * lo mismo que `conductorPuede`.
 */
describe('capacidades del conductor', () => {
  const soloEfectivo = { capacidades: [] };
  const conNequi = { capacidades: ['nequi'] };
  const conTodo = { capacidades: ['nequi', 'daviplata', 'llave', 'mascotas', 'licorera', 'cables'] };
  const marcaVieja = { capacidades: [], aceptaPagoElectronico: true };

  it('el efectivo lo recibe cualquiera', () => {
    expect(conductorPuede(soloEfectivo, { medioPago: 'efectivo' })).toBe(true);
    expect(conductorPuede(soloEfectivo, {})).toBe(true);
  });

  it('un medio exacto solo lo recibe quien lo tiene marcado', () => {
    expect(conductorPuede(conNequi, { medioPago: 'nequi' })).toBe(true);
    expect(conductorPuede(conNequi, { medioPago: 'daviplata' })).toBe(false);
    expect(conductorPuede(soloEfectivo, { medioPago: 'llave' })).toBe(false);
    // La marca de antes vale mientras no tenga ningún medio anotado: el día
    // de la actualización nadie lo tiene, y una carrera con Nequi no puede
    // quedarse sin a quién ofrecérsela.
    expect(conductorPuede(marcaVieja, { medioPago: 'nequi' })).toBe(true);
    // Con un medio ya anotado, vale solo lo anotado.
    expect(conductorPuede({ capacidades: ['daviplata'], aceptaPagoElectronico: true }, { medioPago: 'nequi' })).toBe(false);
  });

  it('el pago electrónico sin especificar vale con cualquier medio o con la marca de antes', () => {
    expect(conductorPuede(conNequi, { medioPago: 'electronico' })).toBe(true);
    expect(conductorPuede(marcaVieja, { medioPago: 'electronico' })).toBe(true);
    expect(conductorPuede(soloEfectivo, { medioPago: 'electronico' })).toBe(false);
  });

  it('el servicio se exige además del pago', () => {
    expect(conductorPuede(conNequi, { medioPago: 'nequi', servicio: 'mascotas' })).toBe(false);
    expect(conductorPuede(conTodo, { medioPago: 'nequi', servicio: 'mascotas' })).toBe(true);
    expect(conductorPuede({ capacidades: ['cables'] }, { servicio: 'cables' })).toBe(true);
  });

  it('dice por qué no puede', () => {
    expect(porQueNoPuede(soloEfectivo, { medioPago: 'daviplata' })).toBe('no recibe Daviplata');
    expect(porQueNoPuede(conNequi, { medioPago: 'nequi', servicio: 'licorera' })).toBe('no presta el servicio de licorera');
    expect(porQueNoPuede(conTodo, { medioPago: 'llave', servicio: 'cables' })).toBeNull();
  });

  it('resume lo que la carrera exige', () => {
    expect(resumenDeExigencias({ medioPago: 'efectivo' })).toBe('');
    expect(resumenDeExigencias({ medioPago: 'nequi', servicio: 'mascotas' })).toBe('Nequi · Lleva mascota');
  });

  it('limpia una lista de capacidades', () => {
    expect(capacidadesValidas(['mascotas', 'nequi', 'nequi', 'volar'])).toEqual(['nequi', 'mascotas']);
  });

  it('lee las letras de capacidades de Autocab', () => {
    const vehiculos = ['Numero de unidad,Marca,Linea,Placa,Tamaño', '2000,KIA,2015,XGD989,4'].join('\n');
    const conductores = [
      'Numero de unidad,PIN,Nombres,Apellidos,Capacidades,Estado de suspensión,Teléfono,Licencia No,La licencia caduca,Número de referencia,Móvil',
      '2000,1234,Ana,Pérez Gómez,MFELRND,False,3001234567,1234567,,XGD989,',
      '2001,4321,Luis,Rojas Díaz,KC,False,3007654321,7654321,,XGD989,',
    ].join('\n');
    const leido = leerAutocab(vehiculos, conductores);
    const de = (nombre: string) => leido.personas.find((p) => p.nombre.toLowerCase().includes(nombre))?.capacidades;
    // M, L, N y D son nuestras; F, E y R no (farmacia, expreso, restaurante).
    expect(de('ana')).toEqual(['nequi', 'daviplata', 'mascotas', 'licorera']);
    expect(de('luis')).toEqual(['llave', 'cables']);
  });
});
