import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from '@tax/shared';
import {
  GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { User } from 'lucide-react';
import type { Driver, Ride } from '@tax/shared';
import { DRIVER_STATUS_LABEL, RIDE_STATUS_LABEL, RIDE_STATUS_TONE } from '@tax/shared';
import { cn } from '@tax/ui';
import { useLive } from '../live/store';
import { CENTRO_DEL_MAPA, TILES_URL, buildStyle, readPalette, registerPmtiles, token } from '../map/style';
import { colorDelTaxi, rotulo } from '../map/taxis';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Mapa de operación (ADR-08).
 *
 * MapLibre GL sobre un archivo PMTiles estático de Sogamoso generado de
 * OpenStreetMap: el navegador lo cachea y el servidor no gasta CPU ni dinero
 * por consulta. Sin servidor de rutas, que es el gigabyte de RAM que el
 * documento decide no gastar.
 *
 * Todo lo que se mueve —conductores, pines, oleada, ruta— son fuentes GeoJSON
 * que se actualizan con `setData`. Con 62 taxis reportando posición, pintar
 * marcadores del DOM sería mover 62 nodos a la vez; así es un solo dibujo por
 * fotograma en la GPU.
 */

/** Color de un tono del sistema de diseño, resuelto para MapLibre. */
function toneColor(tone: string): string {
  return token(`--t-${tone}-solid`);
}

/*
 * El icono de las carreras: una persona, como el de «Flota» en el menú pero
 * de una sola. Es el cliente que espera la recogida, y así no se confunde con
 * los puntos de los conductores.
 *
 * Las capas de MapLibre no leen SVG: se dibuja en un lienzo y se registra como
 * imagen. Va en blanco y a doble resolución; el color lo pone el círculo de
 * debajo, el rojo del cliente por recoger.
 */
const ICONO_PERSONA = 'persona';
const ICONO_PIXEL_RATIO = 2;

function iconoPersona(): ImageData {
  const lado = 20 * ICONO_PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext('2d')!;

  // La figura de lucide «user» en su caja de 24, rellena y al 60 % del lado.
  const escala = (lado * 0.6) / 24;
  ctx.translate((lado - 24 * escala) / 2, (lado - 24 * escala) / 2);
  ctx.scale(escala, escala);
  ctx.fillStyle = token('--c-surface');
  ctx.beginPath();
  ctx.arc(12, 7, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fill(new Path2D('M3.5 21.5v-1.5a5.5 5.5 0 0 1 5.5-5.5h6a5.5 5.5 0 0 1 5.5 5.5v1.5z'));

  return ctx.getImageData(0, 0, lado, lado);
}


/*
 * El deslizamiento (27/11/2026). El teléfono reporta cada 2 s: pintado tal
 * cual, el taxi salta de un punto al siguiente. Aquí cada punto recorre el
 * tramo durante casi todo ese intervalo, así que se ve rodar. Un tramo
 * larguísimo no es un taxi andando sino el GPS que se reubicó: ese salta.
 */
const DESLIZAMIENTO_MS = 1800;
/** Lo que dura un cuadro del deslizamiento: 20 por segundo. */
const CUADRO_MS = 50;
const SALTO_MAXIMO_GRADOS = 0.005; // unos 500 m
interface Tramo {
  de: Point;
  a: Point;
  inicio: number;
}

/*
 * Pasajero a bordo (21/11/2026): con la carrera en curso, el cliente va en el
 * taxi. Su pin deja el punto de recogida y se dibuja donde está el taxi, con
 * el borde azul del conductor en carrera: una sola figura que se mueve. El
 * punto del conductor se oculta mientras tanto para no dibujarlo dos veces.
 */
function aBordo(rides: Ride[], drivers: Driver[]): Map<string, { lat: number; lng: number }> {
  const posicion = new Map(drivers.filter((d) => d.position).map((d) => [d.id, d.position!]));
  const enCurso = new Map<string, { lat: number; lng: number }>();
  for (const ride of rides) {
    if (ride.status !== 'IN_PROGRESS' || !ride.driverId) continue;
    const p = posicion.get(ride.driverId);
    if (p) enCurso.set(ride.id, p);
  }
  return enCurso;
}

function driversToGeoJson(drivers: Driver[], ocultos: Set<string> = new Set()): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: drivers
      .filter((driver) => driver.position && !ocultos.has(driver.id))
      .map((driver) => ({
        type: 'Feature' as const,
        id: driver.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [driver.position!.lng, driver.position!.lat],
        },
        properties: {
          id: driver.id,
          code: driver.code,
          name: driver.name,
          plate: driver.vehicle.plate,
          rotulo: rotulo(driver),
          estado: DRIVER_STATUS_LABEL[driver.status],
          color: colorDelTaxi(driver.status),
          enCarrera: driver.status === 'ON_RIDE',
          // Una posición vieja no sirve para prometer un ETA (§5.2): se
          // dibuja apagada para que el operador no cuente con ella.
          vieja: (driver.positionAgeSeconds ?? 0) > 60,
          edad: driver.positionAgeSeconds ?? 0,
        },
      })),
  };
}

function ridesToGeoJson(
  rides: Ride[],
  selectedId?: string | null,
  enElTaxi: Map<string, { lat: number; lng: number }> = new Map(),
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rides
      // Una carrera sin ubicar tiene punto —el de partida del pueblo, desde
      // donde se despacha—, pero no es donde está el cliente: pintarla ahí
      // es lo que hacía creer que la dirección se había ubicado mal. Con el
      // pasajero a bordo sí se pinta: está donde está el taxi.
      .filter((ride) => enElTaxi.has(ride.id) || (ride.pickup.point && ride.pickupSource !== 'sin_ubicar'))
      .map((ride) => ({
        type: 'Feature' as const,
        id: ride.id,
        geometry: {
          type: 'Point' as const,
          coordinates: enElTaxi.has(ride.id)
            ? [enElTaxi.get(ride.id)!.lng, enElTaxi.get(ride.id)!.lat]
            : [ride.pickup.point!.lng, ride.pickup.point!.lat],
        },
        properties: {
          id: ride.id,
          code: ride.code,
          estado: RIDE_STATUS_LABEL[ride.status],
          // El pin es el cliente, y el cliente por recoger va siempre en rojo
          // (HU-UI-01): el rojo del mapa no se confunde con ningún conductor.
          // Con el pasajero ya a bordo no queda nadie por recoger, así que el
          // punto toma el verde de «En curso».
          color:
            ride.status === 'IN_PROGRESS'
              ? toneColor(RIDE_STATUS_TONE.IN_PROGRESS)
              : token('--danger-fill'),
          // Lo que espera a alguien lleva halo; lo que ya está en marcha, no.
          esperando:
            ride.status === 'NOTIFIED' || ride.status === 'UNASSIGNED' || ride.status === 'PENDING',
          seleccionada: ride.id === selectedId,
          aBordo: enElTaxi.has(ride.id),
          borde: enElTaxi.has(ride.id) ? colorDelTaxi('ON_RIDE') : token('--c-surface'),
        },
      })),
  };
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const OVERLAY_SOURCES = ['zonas', 'conductores', 'pines', 'ruta', 'oleada'] as const;

type OverlaySource = (typeof OVERLAY_SOURCES)[number];

/** Fuente GeoJSON ya tipada, o nada si el estilo aún no la montó. */
function overlay(instance: MapLibreMap | undefined, id: OverlaySource): GeoJSONSource | undefined {
  const source = instance?.getSource(id);
  return source instanceof GeoJSONSource ? source : undefined;
}

export interface MapCanvasProps {
  rides: Ride[];
  selectedRideId?: string | null;
  onSelectRide?: (rideId: string) => void;
  className?: string;
}

export function MapCanvas({ rides, selectedRideId, onSelectRide, className }: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap>(undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<{
    code: string;
    name: string;
    plate: string;
    estado: string;
    edad: number;
  } | null>(null);

  const drivers = useLive((s) => s.drivers);
  const zones = useLive((s) => s.zones);
  const sweepZoneId = useLive((s) => s.sweepZoneId);

  // El manejador vive en una referencia para que el mapa no se recree cada
  // vez que el padre cambia la función.
  const selectHandler = useRef(onSelectRide);
  selectHandler.current = onSelectRide;

  /*
   * Último dato conocido de cada capa.
   *
   * Si el estilo se reemplaza entero, las capas propias se vuelven a montar
   * con sus fuentes vacías. Apoyarse en un indicador de
   * «listo» no sirve: pasa a falso y a verdadero en el mismo ciclo de React,
   * que no ve cambio y no vuelve a ejecutar los efectos. Así que el remontaje
   * siembra las fuentes él mismo con lo que haya aquí.
   */
  const latest = useRef<Record<OverlaySource, FeatureCollection>>({
    zonas: EMPTY,
    conductores: EMPTY,
    pines: EMPTY,
    ruta: EMPTY,
    oleada: EMPTY,
  });

  const publish = (id: OverlaySource, data: FeatureCollection) => {
    latest.current[id] = data;
    overlay(map.current, id)?.setData(data);
  };

  useEffect(() => {
    if (!container.current || map.current) return;
    registerPmtiles();

    const palette = readPalette();
    const instance = new MapLibreMap({
      container: container.current,
      style: buildStyle(TILES_URL, palette),
      center: CENTRO_DEL_MAPA,
      zoom: 12.4,
      // El operador mira un plano, no un paisaje: sin inclinación ni giro se
      // lee más rápido y no queda torcido por un arrastre accidental.
      pitch: 0,
      dragRotate: false,
      attributionControl: { compact: true },
    });

    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    instance.on('error', (event: { error?: { message?: string } }) => {
      const message = String(event.error?.message ?? '');

      /*
       * Los errores del mapa no se tragan: un estilo inválido o un azulejo
       * que no llega dejan el lienzo en blanco sin decir por qué, y depurar
       * eso a ciegas cuesta horas.
       */
      if (import.meta.env.DEV) console.warn('[mapa]', message, event);

      // Que falte un azulejo suelto no es alarma; que falte el archivo, sí.
      if (message.includes('pmtiles') || message.includes('sogamoso')) setFailed(true);
    });

    /** Las capas propias se montan sobre el estilo, y se remontan al cambiarlo. */
    const addOverlays = () => {
      // Idempotente: `style.load` también se emite en la carga inicial.
      if (instance.getLayer('conductores')) return;
      const colors = readPalette();

      for (const id of OVERLAY_SOURCES) {
        if (!instance.getSource(id)) {
          instance.addSource(id, { type: 'geojson', data: latest.current[id] });
        }
      }

      // Las imágenes se pierden con el estilo, igual que las capas.
      if (!instance.hasImage(ICONO_PERSONA)) {
        instance.addImage(ICONO_PERSONA, iconoPersona(), { pixelRatio: ICONO_PIXEL_RATIO });
      }

      instance.addLayer({
        id: 'zonas-relleno',
        type: 'fill',
        source: 'zonas',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.06 },
      });
      // Borde de 2 px: dorado la zona urbana, verde las veredas y el lago.
      instance.addLayer({
        id: 'zonas-borde',
        type: 'line',
        source: 'zonas',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
      });
      instance.addLayer({
        id: 'zonas-nombre',
        type: 'symbol',
        source: 'zonas',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.08,
        },
        paint: {
          'text-color': ['get', 'texto'],
          'text-halo-color': colors.land,
          'text-halo-width': 1.5,
        },
      });

      instance.addLayer({
        id: 'oleada',
        type: 'circle',
        source: 'oleada',
        paint: {
          'circle-radius': ['get', 'radio'],
          'circle-color': 'transparent',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': ['get', 'opacidad'],
        },
      });

      instance.addLayer({
        id: 'ruta',
        type: 'line',
        source: 'ruta',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.85,
        },
      });

      instance.addLayer({
        id: 'pines-halo',
        type: 'circle',
        source: 'pines',
        filter: ['get', 'esperando'],
        paint: { 'circle-radius': 20, 'circle-color': ['get', 'color'], 'circle-opacity': 0.14 },
      });
      // El círculo es rojo y recibe los clics; la persona va encima, en
      // blanco. Todos los marcadores llevan borde blanco de 2,5 px.
      instance.addLayer({
        id: 'pines',
        type: 'circle',
        source: 'pines',
        paint: {
          'circle-radius': ['case', ['get', 'seleccionada'], 13, 10],
          'circle-color': ['get', 'color'],
          // A bordo, el borde es el azul del taxi en carrera: el cliente va en él.
          'circle-stroke-color': ['get', 'borde'],
          'circle-stroke-width': ['case', ['get', 'aBordo'], 3.5, ['get', 'seleccionada'], 3, 2.5],
        },
      });
      instance.addLayer({
        id: 'pines-persona',
        type: 'symbol',
        source: 'pines',
        layout: {
          'icon-image': ICONO_PERSONA,
          'icon-size': ['case', ['get', 'seleccionada'], 1.3, 1],
          // Un cliente esperando no se esconde porque haya otro cerca.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      instance.addLayer({
        id: 'conductores-halo',
        type: 'circle',
        source: 'conductores',
        filter: ['get', 'enCarrera'],
        paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.18 },
      });
      // Crecen con el acercamiento: de lejos no se tapan, de cerca se ven bien.
      instance.addLayer({
        id: 'conductores',
        type: 'circle',
        source: 'conductores',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 14, 7, 17, 10],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'vieja'], 0.4, 1],
          'circle-stroke-color': colors.surface,
          'circle-stroke-width': 2.5,
          'circle-stroke-opacity': ['case', ['get', 'vieja'], 0.6, 1],
        },
      });
      // El número del móvil, de cerca: de lejos serían letras encimadas.
      instance.addLayer({
        id: 'conductores-rotulo',
        type: 'symbol',
        source: 'conductores',
        minzoom: 13.5,
        layout: {
          'text-field': ['get', 'rotulo'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.25],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': colors.ink,
          'text-halo-color': colors.surface,
          'text-halo-width': 1.6,
        },
      });

      setReady(true);
    };

    /*
     * `style.load` y no `styledata`: el segundo se emite durante la carga,
     * cuando el estilo todavía no está listo, y deja de emitirse en cuanto lo
     * está. Si el estilo se reemplazara, las capas propias nunca volverían y
     * el operador se quedaría con el mapa pero sin conductores ni carreras.
     */
    instance.on('style.load', addOverlays);

    instance.on('load', () => {
      addOverlays();

      instance.on('click', 'pines', (event: MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') selectHandler.current?.(id);
      });

      instance.on('mouseenter', 'pines', () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', 'pines', () => {
        instance.getCanvas().style.cursor = '';
      });

      instance.on('mousemove', 'conductores', (event: MapLayerMouseEvent) => {
        const p = event.features?.[0]?.properties;
        if (!p) return;
        setHovered({
          code: String(p.code),
          name: String(p.name),
          plate: String(p.plate),
          estado: String(p.estado),
          edad: Number(p.edad),
        });
      });
      instance.on('mouseleave', 'conductores', () => setHovered(null));
    });

    map.current = instance;
    if (import.meta.env.DEV) {
      // Asa para inspeccionar el mapa desde la consola mientras se ajusta el
      // estilo. No existe en producción.
      (window as unknown as { mapa?: MapLibreMap }).mapa = instance;
    }

    return () => {
      instance.remove();
      map.current = undefined;
      setReady(false);
    };
  }, []);

  /* ------------------------------------------------------------ datos --- */

  const zonesGeoJson = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: zones
        .filter((zone) => zone.polygon.length > 2)
        .map((zone) => ({
          type: 'Feature' as const,
          id: zone.id,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                ...zone.polygon.map((p) => [p.lng, p.lat] as [number, number]),
                [zone.polygon[0]!.lng, zone.polygon[0]!.lat] as [number, number],
              ],
            ],
          },
          // El borde puede ir en el verde de relleno; el nombre, que es
          // texto, en el verde que se lee sobre el terreno.
          properties: {
            name: zone.name,
            color: zone.kind === 'rural' ? toneColor('positive') : token('--brand-strong'),
            texto: zone.kind === 'rural' ? token('--t-positive-ink') : token('--t-info-ink'),
          },
        })),
    }),
    [zones],
  );

  useEffect(() => {
    publish('zonas', zonesGeoJson);
  }, [zonesGeoJson, ready]);

  /*
   * Lo que se mueve —taxis, el cliente que va a bordo y la línea hacia la
   * recogida— lo pinta una sola función, fuera de React: mientras algún taxi
   * se desliza corre una vez por cuadro, y cuando todos llegan se detiene.
   */
  const datos = useRef({ rides, drivers, selectedRideId });
  datos.current = { rides, drivers, selectedRideId };
  const tramos = useRef(new Map<string, Tramo>());
  const destinos = useRef(new Map<string, Point>());
  const mostrados = useRef(new Map<string, Point>());
  const cuadro = useRef(0);
  const ultimoCuadro = useRef(0);
  const hayRuta = useRef(false);

  /** Pinta un cuadro. Devuelve si algún taxi sigue en camino. */
  const pintar = (ahora: number, todo: boolean): boolean => {
    const { rides, drivers, selectedRideId } = datos.current;
    let enCamino = false;

    const visibles = drivers.map((driver) => {
      if (!driver.position) return driver;
      const tramo = tramos.current.get(driver.id);
      if (!tramo) {
        mostrados.current.set(driver.id, driver.position);
        return driver;
      }
      const k = Math.min(1, (ahora - tramo.inicio) / DESLIZAMIENTO_MS);
      const punto = {
        lat: tramo.de.lat + (tramo.a.lat - tramo.de.lat) * k,
        lng: tramo.de.lng + (tramo.a.lng - tramo.de.lng) * k,
      };
      mostrados.current.set(driver.id, punto);
      if (k < 1) enCamino = true;
      else tramos.current.delete(driver.id);
      return { ...driver, position: punto };
    });

    // Las carreras en curso, con la posición en vivo del taxi que las lleva.
    const enElTaxi = aBordo(rides, visibles);
    const llevanPasajero = new Set(
      rides.filter((r) => enElTaxi.has(r.id) && r.driverId).map((r) => r.driverId!),
    );
    publish('conductores', driversToGeoJson(visibles, llevanPasajero));
    // Los clientes solo se mueven si van a bordo: sin ninguno, no se repintan.
    if (todo || enElTaxi.size > 0) publish('pines', ridesToGeoJson(rides, selectedRideId, enElTaxi));

    /* Línea entre el conductor asignado y el punto de recogida. */
    const ride = rides.find((r) => r.id === selectedRideId);
    const driver = ride?.driverId ? visibles.find((d) => d.id === ride.driverId) : undefined;
    if (!ride?.pickup.point || ride.pickupSource === 'sin_ubicar' || !driver?.position) {
      if (todo || hayRuta.current) publish('ruta', EMPTY);
      hayRuta.current = false;
      return enCamino;
    }
    hayRuta.current = true;
    publish('ruta', {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [driver.position.lng, driver.position.lat],
              [ride.pickup.point.lng, ride.pickup.point.lat],
            ],
          },
          // Yendo a recoger: dorado hacia el punto. En curso: el recorrido desde
          // la recogida hasta donde va el taxi, en el verde de «En curso».
          properties: { color: ride.status === 'IN_PROGRESS' ? toneColor(RIDE_STATUS_TONE.IN_PROGRESS) : token('--brand-strong') },
        },
      ],
    });
    return enCamino;
  };

  useEffect(() => {
    // Qué taxis cambiaron de sitio desde la última tanda: esos se deslizan.
    const ahora = performance.now();
    const vivos = new Set<string>();
    for (const driver of drivers) {
      if (!driver.position) continue;
      vivos.add(driver.id);
      const destino = destinos.current.get(driver.id);
      if (destino && destino.lat === driver.position.lat && destino.lng === driver.position.lng) continue;
      destinos.current.set(driver.id, driver.position);
      const desde = mostrados.current.get(driver.id);
      if (
        !desde ||
        Math.abs(desde.lat - driver.position.lat) > SALTO_MAXIMO_GRADOS ||
        Math.abs(desde.lng - driver.position.lng) > SALTO_MAXIMO_GRADOS
      ) {
        tramos.current.delete(driver.id);
      } else {
        tramos.current.set(driver.id, { de: desde, a: driver.position, inicio: ahora });
      }
    }
    for (const id of [...destinos.current.keys()]) {
      if (vivos.has(id)) continue;
      destinos.current.delete(id);
      tramos.current.delete(id);
      mostrados.current.delete(id);
    }

    const seguir = pintar(ahora, true);
    if (seguir && cuadro.current === 0) {
      const paso = (t: number) => {
        // Con toda la flota moviéndose el bucle no para nunca: a 20 cuadros
        // por segundo el taxi se ve igual de suave y el mapa trabaja un tercio.
        if (t - ultimoCuadro.current < CUADRO_MS) {
          cuadro.current = requestAnimationFrame(paso);
          return;
        }
        ultimoCuadro.current = t;
        cuadro.current = pintar(t, false) ? requestAnimationFrame(paso) : 0;
      };
      cuadro.current = requestAnimationFrame(paso);
    }
  }, [drivers, rides, selectedRideId, ready]);

  useEffect(() => () => cancelAnimationFrame(cuadro.current), []);

  /* -------------------------------------------------------- animaciones --- */

  /** Barrido de la oleada: un anillo que crece desde el centro de la zona. */
  useEffect(() => {
    const instance = map.current;
    const zone = zones.find((z) => z.id === sweepZoneId);
    if (!instance) return;

    if (!zone || zone.polygon.length === 0) {
      publish('oleada', EMPTY);
      return;
    }

    const center = zone.polygon.reduce(
      (acc, p) => ({
        lng: acc.lng + p.lng / zone.polygon.length,
        lat: acc.lat + p.lat / zone.polygon.length,
      }),
      { lng: 0, lat: 0 },
    );
    const color = toneColor('info');
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = ((now - start) % 2200) / 2200;
      publish('oleada', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
            properties: { radio: 10 + progress * 110, opacidad: 0.55 * (1 - progress), color },
          },
        ],
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sweepZoneId, zones, ready]);

  /** El guion de la ruta avanza hacia el punto de recogida. */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    const patterns: [number, number][] = [
      [2, 2],
      [1.5, 2.5],
      [1, 3],
      [0.5, 3.5],
    ];
    let step = 0;
    let last = 0;
    let frame = 0;

    const tick = (now: number) => {
      // Sin ruta a la vista no hay nada que animar: se ahorra el repintado.
      if (hayRuta.current && now - last > 110) {
        last = now;
        step = (step + 1) % patterns.length;
        if (instance.getLayer('ruta')) {
          instance.setPaintProperty('ruta', 'line-dasharray', patterns[step]!);
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  const onShift = drivers.filter((d) => d.position).length;

  return (
    <div
      className={cn(
        'mapa-marca relative overflow-hidden rounded-lg border border-transparent shadow-sm',
        className,
      )}
    >
      <div ref={container} className="size-full" />

      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-sunk p-6 text-center">
          <p className="max-w-sm text-caption text-ink-muted">
            Falta el mapa de Sogamoso. Genéralo con{' '}
            <code className="font-mono text-ink">pnpm --filter @tax/tiles build:tiles</code>.
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <Legend />
        <span className="mr-10 rounded-md border border-transparent bg-ink px-2 py-1 text-micro text-on-ink">
          {onShift} en turno
        </span>
      </div>

      {hovered ? (
        <div className="pointer-events-none absolute bottom-8 left-3 rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-md">
          <p className="text-caption font-medium text-ink">
            {hovered.code} · {hovered.name}
          </p>
          <p className="text-micro text-ink-muted">
            {hovered.plate} · {hovered.estado} · {hovered.edad} s
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Leyenda en una píldora de tinta. Los puntos usan la variante clara de cada
 * color de estado, la que se distingue sobre fondo oscuro.
 */
function Legend() {
  const items = [
    { dot: 'bg-legend-success', label: 'Disponible' },
    { dot: 'bg-legend-ride', label: 'En carrera' },
    { dot: 'bg-legend-warning', label: 'En pausa' },
    { dot: 'bg-legend-success opacity-40', label: 'Sin señal reciente' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-transparent bg-ink px-2.5 py-1.5">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-micro text-on-ink">
          <span className={cn('size-2 rounded-full', item.dot)} />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 border-l border-on-ink-muted/40 pl-3 text-micro text-on-ink">
        <span className="flex size-3.5 items-center justify-center rounded-full bg-legend-danger">
          <User className="size-2.5 text-on-accent" strokeWidth={3} />
        </span>
        Cliente por recoger
      </span>
    </div>
  );
}
