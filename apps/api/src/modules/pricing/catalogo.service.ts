import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { AjustesDespacho, CambiosLugar, CambiosZona, NuevaZona, NuevoLugar, Point } from '@tax/shared';
import {
  ZONA_POR_DEFECTO,
  buscarLugar,
  centroYRadioDe,
  haversineKm,
  nucleoDe,
  poligonoCircular,
  zonasEncimadas,
} from '@tax/shared';
import { DB, type Database } from '../../db/db.module';
import { dispatchSettings, places, zones } from '../../db/schema';
import { dentroDelMunicipio } from '../../db/limite-municipal';
import { AppError } from '../../common/problem';
import { isUniqueViolation } from '../../common/pg-errors';
import { AuditService } from '../audit/audit.service';
import { ZonesService } from './zones.service';

export interface ActorDelPanel {
  id?: string;
  name: string;
  role: string;
  ip?: string;
}

const comoPuntos = (anillo: [number, number][]): Point[] => anillo.map(([lng, lat]) => ({ lat, lng }));

/** Sin repetidas, contando «La Terminal» y «la terminal» como la misma. */
function sinRepetidas(palabras: string[]): string[] {
  const vistas = new Set<string>();
  return palabras
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter((p) => {
      // «la terminal» y «el terminal» son la misma para el buscador.
      const clave = nucleoDe(p);
      if (!clave || vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });
}

/**
 * Zonas y lugares que se crean y editan desde el panel.
 *
 * Las zonas se crean como círculos, igual que las sembradas, y no pueden
 * montarse sobre otra: un punto en dos zonas no sabría con qué oleadas
 * despacharse. Los lugares llevan sus palabras clave, que son como los
 * nombran los clientes; con ellas `reconocer()` ubica un pedido que llega sin
 * ubicación y sin dirección («frente a la terminal»).
 *
 * Cada cambio queda en la bitácora, y las zonas se recargan en memoria en el
 * acto: la próxima carrera ya se clasifica con ellas.
 */
@Injectable()
export class CatalogoService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ZonesService) private readonly zonas: ZonesService,
  ) {}

  /* -------------------------------------------------------------- zonas --- */

  async crearZona(entrada: NuevaZona, actor: ActorDelPanel) {
    const poligono = poligonoCircular(entrada.center.lat, entrada.center.lng, entrada.radiusKm);
    const nueva = comoPuntos(poligono.coordinates[0]!);
    const encima = this.zonas.all().find((z) => zonasEncimadas(nueva, comoPuntos(z.polygon.coordinates[0] ?? [])));
    if (encima) {
      throw new AppError(
        'ZONE_OVERLAP',
        `Queda encima de «${encima.name}». Mueve el centro o achica el radio: pueden ser vecinas, no la misma.`,
      );
    }

    const id = uuidv7();
    const valores = {
      id,
      name: entrada.name.trim(),
      kind: entrada.kind,
      polygon: poligono,
      tortuosity: entrada.tortuosity ?? ZONA_POR_DEFECTO[entrada.kind].tortuosity,
      // La columna se conserva por historia; el despacho no la lee.
      waves: this.zonas.ajustesDespacho().rondas,
    };

    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(zones).values(valores);
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: 'Creó una zona',
            entity: 'zones',
            entityId: valores.name,
            after: { kind: valores.kind, center: entrada.center, radiusKm: entrada.radiusKm, tortuosity: valores.tortuosity },
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'zones_name_key')) {
        throw new AppError('NAME_TAKEN', `Ya hay una zona que se llama «${valores.name}»`);
      }
      throw error;
    }

    await this.zonas.reload();
    return { id, name: valores.name };
  }

  /**
   * Los ajustes del despacho de toda la ciudad: las rondas por cercanía y
   * qué hacer cuando no hay ningún taxi en el rango. Una sola fila; el cambio
   * queda en la bitácora con el antes y el después.
   */
  async cambiarAjustesDespacho(ajustes: AjustesDespacho, actor: ActorDelPanel) {
    const antes = this.zonas.ajustesDespacho();
    const rondas = [...ajustes.rondas].sort((a, b) => a.wave - b.wave);
    const valores = {
      rondas,
      lejanosCandidatos: ajustes.lejanos.candidatos,
      lejanosKm: ajustes.lejanos.hastaKm,
      lejanosMargenKm: ajustes.lejanos.margenKm,
      posicionMaximaMin: ajustes.posicionMaximaMin,
      updatedAt: new Date(),
    };

    await this.db.transaction(async (tx) => {
      await tx
        .insert(dispatchSettings)
        .values({ id: 1, ...valores })
        .onConflictDoUpdate({ target: dispatchSettings.id, set: valores });
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Cambió los ajustes del despacho',
          entity: 'dispatch_settings',
          entityId: 'despacho',
          before: antes,
          after: { rondas, lejanos: ajustes.lejanos, posicionMaximaMin: ajustes.posicionMaximaMin },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });

    await this.zonas.reload();
    return this.zonas.ajustesDespacho();
  }

  /** El factor de tortuosidad de una zona, su sitio y su tamaño. */
  async cambiarZona(zoneId: string, cambios: CambiosZona, actor: ActorDelPanel) {
    const [antes] = await this.db
      .select({
        name: zones.name,
        tortuosity: zones.tortuosity,
        waves: zones.waves,
        esReferencia: zones.esReferencia,
        polygon: zones.polygon,
      })
      .from(zones)
      .where(eq(zones.id, zoneId))
      .limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'Esa zona no existe');

    /*
     * Mover la zona o cambiarle el tamaño.
     *
     * El polígono se vuelve a generar con la misma función que al crearla, y
     * se comprueba igual que no se monte sobre otra, excluyéndose a sí misma:
     * por supuesto que se toca con su propio sitio.
     *
     * Las carreras ya creadas conservan la zona que tenían, que es dato
     * histórico; el cambio manda sobre las que entren de aquí en adelante.
     */
    const geometria =
      cambios.center && cambios.radiusKm
        ? poligonoCircular(cambios.center.lat, cambios.center.lng, cambios.radiusKm)
        : undefined;

    if (geometria) {
      const nueva = comoPuntos(geometria.coordinates[0]!);
      const encima = this.zonas
        .all()
        .filter((z) => z.id !== zoneId)
        .find((z) => zonasEncimadas(nueva, comoPuntos(z.polygon.coordinates[0] ?? [])));
      if (encima) {
        throw new AppError(
          'ZONE_OVERLAP',
          `Queda encima de «${encima.name}». Mueve el centro o achica el radio: pueden ser vecinas, no la misma.`,
        );
      }
    }

    const despues = {
      tortuosity: cambios.tortuosity ?? antes.tortuosity,
      waves: antes.waves,
      ...(geometria ? { polygon: geometria } : {}),
    };

    await this.db.transaction(async (tx) => {
      /*
       * Punto de partida de las carreras sin ubicar: una sola zona. Se quita
       * de la que lo tenía y se pone en esta en la misma transacción; el
       * índice `zones_una_referencia` impide que queden dos.
       */
      if (cambios.esReferencia && !antes.esReferencia) {
        const [anterior] = await tx
          .update(zones)
          .set({ esReferencia: false, updatedAt: new Date() })
          .where(eq(zones.esReferencia, true))
          .returning({ name: zones.name });
        await tx.update(zones).set({ esReferencia: true, updatedAt: new Date() }).where(eq(zones.id, zoneId));
        await this.audit.record(
          {
            actorId: actor.id,
            actorName: actor.name,
            role: actor.role,
            action: 'Cambió el punto de partida de las carreras sin ubicar',
            entity: 'zones',
            entityId: antes.name,
            before: { zona: anterior?.name ?? null },
            after: { zona: antes.name },
            ip: actor.ip,
          },
          tx as unknown as Database,
        );
      }
      if (cambios.tortuosity === undefined && !geometria) return;

      await tx.update(zones).set({ ...despues, updatedAt: new Date() }).where(eq(zones.id, zoneId));
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: geometria
            ? 'Movió o cambió el tamaño de una zona'
            : 'Cambió el factor de una zona',
          entity: 'zones',
          entityId: antes.name,
          /*
           * En la bitácora va el centro y el radio, no el polígono: son los
           * dos números que alguien escribió, y 64 vértices por cambio
           * dejarían el registro ilegible.
           */
          before: {
            tortuosity: antes.tortuosity,
            waves: antes.waves,
            ...(geometria ? centroYRadioDe(comoPuntos(antes.polygon.coordinates[0] ?? [])) : {}),
          },
          after: geometria
            ? {
                tortuosity: despues.tortuosity,
                waves: despues.waves,
                center: cambios.center,
                radiusKm: cambios.radiusKm,
              }
            : despues,
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });

    await this.zonas.reload();
    return { id: zoneId, ...despues, esReferencia: Boolean(cambios.esReferencia) || antes.esReferencia };
  }

  /* ------------------------------------------------------------ lugares --- */

  async crearLugar(entrada: NuevoLugar, actor: ActorDelPanel) {
    const zona = this.zonaDelPunto(entrada.point);
    const aliases = sinRepetidas(entrada.aliases);
    await this.comprobarPalabras(entrada.name, aliases);

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(places).values({
        id,
        name: entrada.name.trim(),
        kind: zona.kind,
        zoneId: zona.id,
        lat: entrada.point.lat,
        lng: entrada.point.lng,
        aliases,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: 'Agregó un lugar al catálogo',
          entity: 'places',
          entityId: entrada.name.trim(),
          after: {
            zona: zona.id ? (this.zonas.byId(zona.id)?.name ?? null) : 'Sin zona',
            aliases,
            point: entrada.point,
          },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });
    return { id };
  }

  async cambiarLugar(placeId: string, cambios: CambiosLugar, actor: ActorDelPanel) {
    const [antes] = await this.db.select().from(places).where(eq(places.id, placeId)).limit(1);
    if (!antes) throw new AppError('NOT_FOUND', 'Ese lugar no existe');

    const name = cambios.name?.trim() ?? antes.name;
    const aliases = cambios.aliases ? sinRepetidas(cambios.aliases) : antes.aliases;
    const point = cambios.point ?? { lat: antes.lat, lng: antes.lng };
    const active = cambios.active ?? antes.active;
    const zona = cambios.point ? this.zonaDelPunto(point) : null;
    if (active) await this.comprobarPalabras(name, aliases, placeId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(places)
        .set({
          name,
          aliases,
          lat: point.lat,
          lng: point.lng,
          active,
          ...(zona ? { zoneId: zona.id, kind: zona.kind } : {}),
        })
        .where(eq(places.id, placeId));
      await this.audit.record(
        {
          actorId: actor.id,
          actorName: actor.name,
          role: actor.role,
          action: active ? 'Editó un lugar del catálogo' : 'Quitó un lugar del catálogo',
          entity: 'places',
          entityId: antes.name,
          before: { name: antes.name, aliases: antes.aliases, point: { lat: antes.lat, lng: antes.lng }, active: antes.active },
          after: { name, aliases, point, active },
          ip: actor.ip,
        },
        tx as unknown as Database,
      );
    });
    return { id: placeId };
  }

  /**
   * El lugar del catálogo que nombra el texto de un pedido, si alguno, y
   * cuenta el uso: los más usados ganan los empates y salen primero en el
   * panel.
   */
  async reconocer(texto: string): Promise<{ id: string; name: string; point: Point; palabra: string } | null> {
    if (!texto.trim()) return null;
    const activos = await this.db
      .select({
        id: places.id,
        name: places.name,
        aliases: places.aliases,
        uses: places.uses,
        lat: places.lat,
        lng: places.lng,
      })
      .from(places)
      .where(eq(places.active, true));

    const hallado = buscarLugar(texto, activos);
    if (!hallado) return null;

    await this.db.update(places).set({ uses: sql`${places.uses} + 1` }).where(eq(places.id, hallado.lugar.id));
    return {
      id: hallado.lugar.id,
      name: hallado.lugar.name,
      point: { lat: hallado.lugar.lat, lng: hallado.lugar.lng },
      palabra: hallado.palabra,
    };
  }

  /**
   * El lugar del catálogo donde cae una ubicación compartida, si cae en
   * alguno: el más cercano a menos de `metros`. Con él el conductor lee
   * «Terminal de Transportes» además de la nomenclatura, que es como la
   * oficina y los clientes nombran ese sitio. No cuenta un uso: aquí el
   * lugar no resolvió nada, el punto ya venía exacto.
   */
  async cercano(point: Point, metros = 60): Promise<{ id: string; name: string } | null> {
    const activos = await this.db
      .select({ id: places.id, name: places.name, lat: places.lat, lng: places.lng })
      .from(places)
      .where(eq(places.active, true));

    let mejor: { id: string; name: string; distancia: number } | null = null;
    for (const lugar of activos) {
      const distancia = haversineKm(point, { lat: lugar.lat, lng: lugar.lng }) * 1000;
      if (distancia <= metros && (!mejor || distancia < mejor.distancia)) {
        mejor = { id: lugar.id, name: lugar.name, distancia };
      }
    }
    return mejor ? { id: mejor.id, name: mejor.name } : null;
  }

  /* ------------------------------------------------------------- apoyo --- */

  /**
   * La zona de un lugar: la que lo contiene o la más cercana, igual que las
   * carreras (`ZonesService.masCercana`). Si no hay ninguna a su alcance, el
   * lugar se guarda SIN zona (26/11/2026): las zonas son para las
   * estadísticas y el despacho es por cercanía, así que el hospital o la
   * terminal no pueden depender de que alguien haya dibujado su barrio. Lo
   * único que se exige es que el punto sea de Sogamoso.
   */
  private zonaDelPunto(point: Point): { id: string | null; kind: 'urbano' | 'rural' } {
    const zona = this.zonas.masCercana(point)?.zona;
    if (zona) return { id: zona.id, kind: zona.kind };
    if (!dentroDelMunicipio(point)) {
      throw new AppError('OUT_OF_COVERAGE', 'El punto queda fuera de Sogamoso: allí no se despacha.');
    }
    // Lejos de todo barrio definido: lo más probable es que sea una vereda.
    return { id: null, kind: 'rural' };
  }

  /**
   * Ningún nombre ni palabra clave puede ser de dos lugares a la vez: «el
   * parque» en dos sitios haría que el taxi fuera a uno al azar. Se compara
   * el núcleo, como busca el buscador: «la terminal» en un lugar y
   * «terminal» en otro también chocan.
   */
  private async comprobarPalabras(nombre: string, aliases: string[], excepto?: string) {
    const otros = await this.db
      .select({ name: places.name, aliases: places.aliases })
      .from(places)
      .where(excepto ? and(eq(places.active, true), ne(places.id, excepto)) : eq(places.active, true));

    const ocupadas = new Map<string, string>();
    for (const otro of otros) {
      for (const palabra of [otro.name, ...otro.aliases]) ocupadas.set(nucleoDe(palabra), otro.name);
    }

    const duenoDelNombre = ocupadas.get(nucleoDe(nombre));
    if (duenoDelNombre) {
      throw new AppError('NAME_TAKEN', `«${nombre.trim()}» ya está en el catálogo como «${duenoDelNombre}»`);
    }
    for (const palabra of aliases) {
      const dueno = ocupadas.get(nucleoDe(palabra));
      if (dueno) throw new AppError('KEYWORD_TAKEN', `«${palabra}» ya es palabra clave de «${dueno}»`);
    }
  }
}
