import { describe, expect, it } from 'vitest';
import {
  buscarLugar,
  nucleoDe,
  nuevoLugarSchema,
  normalizarParaBuscar,
  poligonoCircular,
  poligonosSeTocan,
  tieneNomenclatura,
  zonaMasCercana,
  zonasEncimadas,
} from '@tax/shared';

const LUGARES = [
  { id: 'terminal', name: 'Terminal de transporte', aliases: ['la terminal', 'terminal de buses'], uses: 3 },
  { id: 'duitama', name: 'Terminal de Duitama', aliases: [], uses: 1 },
  { id: 'parque', name: 'Parque principal', aliases: ['el parque', 'la plaza'], uses: 10 },
  { id: 'pacho', name: 'Tienda Don Pacho', aliases: ['donde don pacho'], uses: 0 },
];

describe('catálogo de lugares', () => {
  it('compara sin tildes, mayúsculas ni signos', () => {
    expect(normalizarParaBuscar('  ¡Frente a la Iglesia, Señor!  ')).toBe('frente a la iglesia senor');
  });

  it('reconoce un lugar por su palabra clave dentro de lo que dijo el cliente', () => {
    expect(buscarLugar('Estoy frente a LA TERMINAL, al lado de la panadería', LUGARES)?.lugar.id).toBe('terminal');
    expect(buscarLugar('Recójanme donde Don Pacho por favor', LUGARES)?.lugar.id).toBe('pacho');
    expect(buscarLugar('en la plaza', LUGARES)?.palabra).toBe('la plaza');
  });

  it('«el parque» también es «al parque» y «del parque»', () => {
    expect(buscarLugar('Estoy frente al parque', LUGARES)?.lugar.id).toBe('parque');
    expect(buscarLugar('A una cuadra del parque', LUGARES)?.lugar.id).toBe('parque');
    // «la» no se contrae: «a la terminal» ya contiene «la terminal».
    expect(buscarLugar('voy saliendo de la terminal', LUGARES)?.lugar.id).toBe('terminal');
  });

  it('un nombre con paréntesis también se reconoce sin ellos', () => {
    const lago = [{ id: 'lago', name: 'Lago Sochagota (malecón)', aliases: ['el lago'], uses: 0 }];
    expect(buscarLugar('Estoy en el malecón del lago Sochagota', lago)?.lugar.id).toBe('lago');
    expect(buscarLugar('recójanme en lago sochagota', lago)?.palabra).toBe('Lago Sochagota (malecón)');
  });

  /* --------------------------------------------- sin ser estricto (5/11) --- */

  const TERMINAL_PAIPA = [
    {
      id: 'terminal',
      name: 'Terminal de Transportes de Paipa',
      aliases: ['el terminal', 'la terminal', 'terminal de buses'],
      uses: 0,
    },
    { id: 'hospital', name: 'E.S.E. Hospital San Vicente de Paúl', aliases: ['el hospital', 'urgencias'], uses: 0 },
    { id: 'alcaldia', name: 'Alcaldía de Paipa', aliases: ['la alcaldía'], uses: 0 },
    { id: 'lago', name: 'Lago Sochagota (malecón)', aliases: ['el lago'], uses: 0 },
    { id: 'colonial', name: 'Hotel Colonial Colsubsidio', aliases: ['el Colonial'], uses: 0 },
    { id: 'd1', name: 'D1 Paipa Centro', aliases: ['el D1 del centro'], uses: 0 },
  ];
  const id = (texto: string) => buscarLugar(texto, TERMINAL_PAIPA)?.lugar.id ?? null;

  it('la palabra sola, sin el artículo de la palabra clave (el caso de producción)', () => {
    // El agente mandó `pickup.text: "terminal"` y la palabra clave era «el terminal».
    expect(id('terminal')).toBe('terminal');
    expect(id('Terminal')).toBe('terminal');
    expect(id('voy al terminal')).toBe('terminal');
    expect(id('a la salida del terminal')).toBe('terminal');
  });

  it('las preposiciones del medio no cuentan: «terminal de buses» es «terminal buses»', () => {
    expect(buscarLugar('estoy en terminal buses', TERMINAL_PAIPA)?.palabra).toBe('terminal de buses');
  });

  it('perdona un error de escritura en las palabras largas', () => {
    expect(id('frente al terminl')).toBe('terminal');
    expect(id('en el hopital')).toBe('hospital');
    expect(id('al lado de la alcadia')).toBe('alcaldia');
  });

  it('pero no confunde palabras distintas', () => {
    // Cortas: tienen que ser exactas. «lago» y «largo» están a una letra.
    expect(id('por un camino largo')).toBeNull();
    // Misma raíz no es un error de escritura.
    expect(id('donde termina la calle')).toBeNull();
    expect(id('barrio la colonia')).toBeNull();
    // Dos letras en una de ocho ya es otra palabra.
    expect(id('el hostal de la esquina')).toBeNull();
    // Con números, exactas: «D2» no es «D1».
    expect(id('frente al D2 del centro')).toBeNull();
    expect(id('frente al D1 del centro')).toBe('d1');
  });

  it('el núcleo de una palabra clave no lleva artículos ni preposiciones', () => {
    expect(nucleoDe('La Terminal')).toBe('terminal');
    expect(nucleoDe('el terminal')).toBe(nucleoDe('terminal'));
    expect(nucleoDe('terminal de buses')).toBe('terminal buses');
  });

  it('solo palabras enteras: «parque» no está en «parqueadero»', () => {
    expect(buscarLugar('en el parqueadero del hotel', LUGARES)).toBeNull();
  });

  it('gana la coincidencia más larga, que es la más precisa', () => {
    expect(buscarLugar('voy a la terminal de Duitama', LUGARES)?.lugar.id).toBe('duitama');
  });

  it('no inventa: sin coincidencia no hay lugar', () => {
    expect(buscarLugar('Calle 25 #18-40', LUGARES)).toBeNull();
  });

  it('distingue una dirección con nomenclatura de una que no la tiene', () => {
    expect(tieneNomenclatura('Calle 25 #18-40, Centro')).toBe(true);
    expect(tieneNomenclatura('cra 10 no. 5-20')).toBe(true);
    expect(tieneNomenclatura('Diagonal 3 con transversal 2')).toBe(true);
    expect(tieneNomenclatura('frente a la terminal')).toBe(false);
    expect(tieneNomenclatura('donde Don Pacho, casa 3')).toBe(false);
  });

  it('rechaza palabras clave de menos de tres letras', () => {
    expect(nuevoLugarSchema.safeParse({ name: 'Parque', aliases: ['el'], point: { lat: 5.78, lng: -73.11 } }).success).toBe(false);
    expect(nuevoLugarSchema.parse({ name: 'Parque', point: { lat: 5.78, lng: -73.11 } }).aliases).toEqual([]);
  });
});

describe('zonas circulares', () => {
  it('el círculo compartido es el mismo que guardó la migración 0014', () => {
    const centro = poligonoCircular(5.7803, -73.1142, 1.3);
    expect(centro.coordinates[0]).toHaveLength(65);
    expect(centro.coordinates[0]![0]).toEqual([-73.102449, 5.7803]);
    expect(centro.coordinates[0]![1]).toEqual([-73.102506, 5.781446]);
    expect(centro.coordinates[0]![64]).toEqual(centro.coordinates[0]![0]);
  });

  it('detecta cuándo dos zonas se montan', () => {
    const puntos = (lat: number, lng: number, r: number) =>
      poligonoCircular(lat, lng, r).coordinates[0]!.map(([x, y]) => ({ lat: y, lng: x }));
    const centro = puntos(5.7803, -73.1142, 1.3);
    expect(poligonosSeTocan(centro, puntos(5.7803, -73.1, 1))).toBe(true);
    // Lago Sochagota, a 3,2 km: no se tocan.
    expect(poligonosSeTocan(centro, puntos(5.756, -73.13, 1.2))).toBe(false);
  });

  describe('zonas por barrio (26/11/2026)', () => {
    const puntos = (lat: number, lng: number, r: number) =>
      poligonoCircular(lat, lng, r).coordinates[0]!.map(([x, y]) => ({ lat: y, lng: x }));
    // Dos barrios vecinos de Sogamoso, de 400 m, con los centros a 600 m: se pisan en el borde.
    const centro = { id: 'centro', kind: 'urbano' as const, polygon: puntos(5.7148, -72.9279, 0.4) };
    const laguito = { id: 'laguito', kind: 'urbano' as const, polygon: puntos(5.7202, -72.9279, 0.4) };
    const zonas = [centro, laguito];

    it('dos barrios vecinos se admiten; una zona encima de otra, no', () => {
      expect(poligonosSeTocan(centro.polygon, laguito.polygon)).toBe(true);
      expect(zonasEncimadas(centro.polygon, laguito.polygon)).toBe(false);
      // Centro a 100 m del de «centro»: es la misma zona dos veces.
      expect(zonasEncimadas(centro.polygon, puntos(5.7157, -72.9279, 0.4))).toBe(true);
    });

    it('en la franja que comparten dos barrios gana el del centro más cercano', () => {
      expect(zonaMasCercana({ lat: 5.7172, lng: -72.9279 }, zonas)?.zona.id).toBe('centro');
      expect(zonaMasCercana({ lat: 5.7178, lng: -72.9279 }, zonas)?.zona.id).toBe('laguito');
    });

    it('un punto fuera de todo barrio se anota en el más cercano, hasta 1 km de su borde', () => {
      // 1 km al sur del Centro: fuera de los dos, a 600 m del borde del Centro.
      const cerca = zonaMasCercana({ lat: 5.7058, lng: -72.9279 }, zonas);
      expect(cerca?.zona.id).toBe('centro');
      expect(cerca?.dentro).toBe(false);
      expect(cerca?.aKm).toBeCloseTo(0.6, 1);
      // 2 km al sur: un barrio ya no lo adopta (sus oleadas no llegarían).
      expect(zonaMasCercana({ lat: 5.6968, lng: -72.9279 }, zonas)).toBeUndefined();
    });

    it('una vereda adopta más lejos que un barrio: hasta 3 km', () => {
      const morca = { id: 'morca', kind: 'rural' as const, polygon: puntos(5.721, -72.8909, 1) };
      // 3 km al oriente de Morcá: a 2 km de su borde.
      expect(zonaMasCercana({ lat: 5.721, lng: -72.8638 }, [...zonas, morca])?.zona.id).toBe('morca');
      // 5 km al oriente: campo sin zona, oleadas anchas.
      expect(zonaMasCercana({ lat: 5.721, lng: -72.8457 }, [...zonas, morca])).toBeUndefined();
    });
  });
});
