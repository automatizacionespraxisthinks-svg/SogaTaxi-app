import { describe, expect, it } from 'vitest';
import {
  cedulaDeAutocab,
  celularDeAutocab,
  fechaDeAutocab,
  leerAutocab,
  leerCsv,
  nombreLimpio,
  placaLimpia,
} from '../modules/fleet/autocab';

/* Datos inventados con la forma de los archivos de Autocab: ninguno es de una persona real. */
const VEHICULOS = [
  'Numero de unidad,Marca,Linea,Placa,Tamaño,Vencimiento del Seguro Obligatorio,RTO expira,Nombre del propietario,Apellido del propietario,tipo de vehiculo,Modelo',
  '2006,RENAULT,CLIO,XGD829,4,15/3/27,,ANA,ROJAS,TAXI,2014',
  '12006,RENAULT CLIO,CLIO,XGD829 R,4,1/2/26,20/11/26,,,,',
  '2010,KIA,PICANTO,TLP219,4,,,,,,',
  '2077,RENAULT,LOGAN,RENAULT,4,,,,,,',
].join('\n');

const CONDUCTORES = [
  'Numero de unidad,PIN,Nombres,Apellidos,Estado de suspensión,Teléfono,Móvil,Licencia No.,La licencia caduca,Número de referencia',
  '2006,1111,"PEDRO  LUIS",GOMEZ de la ROSA,False,3001234567,,10575841 C2,5/8/27,XGD829',
  '12006,2222,PEDRO LUIS,GOMEZ DE LA ROSA,False,,300 123 45 67,,,XGD829 R',
  '2006-1,3333,MARTA,DIAZ,False,,,,1/1/25,XGD829',
  '2010-1,4444,MARTA,DIAZ,False,3109998877,,,,TLP219',
  '2010,5555,JOSE,PARRA,True,,,7654321,,TLP219',
  '2015,6666,LUIS,MORA,False,,,,,XGD999',
].join('\n');

describe('archivos de Autocab', () => {
  it('lee un CSV con comillas y BOM', () => {
    const filas = leerCsv('﻿a,b\n"uno, dos",2\n');
    expect(filas).toEqual([{ a: 'uno, dos', b: '2' }]);
  });

  it('limpia placas, fechas, celulares, cédulas y nombres', () => {
    expect(placaLimpia('xgd 829 R')).toBe('XGD829');
    expect(placaLimpia('RENAULT')).toBeNull();
    expect(fechaDeAutocab('5/8/27')).toBe('2027-08-05');
    expect(fechaDeAutocab('31/12/26')).toBe('2026-12-31');
    expect(fechaDeAutocab('12/31/26')).toBeNull();
    expect(celularDeAutocab('300 123 45 67')).toBe('+573001234567');
    expect(celularDeAutocab('7701234')).toBeNull();
    expect(cedulaDeAutocab('1057584123 C2')).toBe('1057584123');
    expect(cedulaDeAutocab('C2')).toBeNull();
    expect(nombreLimpio('PEDRO  LUIS GOMEZ de la ROSA')).toBe('Pedro Luis Gomez de la Rosa');
  });

  const leido = leerAutocab(VEHICULOS, CONDUCTORES);

  it('cada carro queda una sola vez, con lo mejor de sus dos unidades', () => {
    expect(leido.vehiculos.map((v) => v.placa).sort()).toEqual(['TLP219', 'XGD829']);
    const clio = leido.vehiculos.find((v) => v.placa === 'XGD829')!;
    expect(clio.interno).toBe('2006');
    expect(clio.marca).toBe('RENAULT CLIO');
    expect(clio.modelo).toBe(2014);
    expect(clio.propietario).toBe('Ana Rojas');
    // La fecha más lejana de las dos filas, y la que solo traía la del radio.
    expect(clio.soatVence).toBe('2027-03-15');
    expect(clio.tecnomecanicaVence).toBe('2026-11-20');
    expect(leido.avisos.some((a) => a.includes('«RENAULT»'))).toBe(true);
  });

  it('cada persona queda una sola vez, con su código y su PIN de la aplicación', () => {
    expect(leido.personas).toHaveLength(4);
    const pedro = leido.personas.find((p) => p.nombre.startsWith('Pedro'))!;
    // Dos filas —aplicación y radio—: la del radio no traía cédula y se junta por el nombre.
    expect(pedro).toMatchObject({
      cedula: '10575841',
      celular: '+573001234567',
      licenciaVence: '2027-08-05',
      codigo: '2006',
      pin: '1111',
      filas: 2,
      suspendido: false,
    });
    expect(pedro.carros).toEqual([{ placa: 'XGD829', rol: 'conductor' }]);
  });

  it('un relevo de dos carros queda con los dos, y sin cédula se reconoce por el nombre', () => {
    const marta = leido.personas.find((p) => p.nombre === 'Marta Diaz')!;
    expect(marta.cedula).toBeNull();
    expect(marta.codigo).toBe('20061');
    expect(marta.pin).toBe('3333');
    expect(marta.celular).toBe('+573109998877');
    expect(marta.carros).toEqual([
      { placa: 'XGD829', rol: 'relevador' },
      { placa: 'TLP219', rol: 'relevador' },
    ]);
  });

  it('el suspendido en todas sus unidades se marca, y la placa que no existe se avisa', () => {
    expect(leido.personas.find((p) => p.nombre === 'Jose Parra')!.suspendido).toBe(true);
    const luis = leido.personas.find((p) => p.nombre === 'Luis Mora')!;
    expect(luis.carros).toEqual([]);
    expect(leido.avisos.some((a) => a.includes('XGD999'))).toBe(true);
  });
});
