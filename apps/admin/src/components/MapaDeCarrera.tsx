import { useEffect, useRef } from 'react';
import { GeoJSONSource, LngLatBounds, Map as MapLibreMap, NavigationControl } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Driver, Point, Zone } from '@tax/shared';
import { haversineKm } from '@tax/shared';
import { cn } from '@tax/ui';
import { CENTRO_DEL_MAPA, TILES_URL, buildStyle, readPalette, registerPmtiles, token } from '../map/style';
import { colorDelTaxi, rotulo } from '../map/taxis';
import 'maplibre-gl/dist/maplibre-gl.css';

const VACIO: FeatureCollection = { type: 'FeatureCollection', features: [] };
type Capa = 'zonas' | 'taxis' | 'punto' | 'linea';

const anillo = (puntos: Point[]) => [...puntos.map((p) => [p.lng, p.lat]), [puntos[0]!.lng, puntos[0]!.lat]];

/** Cuántos taxis disponibles se meten en el encuadre junto al punto. */
const TAXIS_EN_EL_ENCUADRE = 6;

/**
 * El mapa de «Nueva carrera» (27/11/2026).
 *
 * Mientras la operadora escribe la dirección, el mapa va al sitio y se
 * encuadra solo para que quepan el punto y los taxis disponibles más
 * cercanos: de un vistazo sabe si hay carro en el sector antes de colgar.
 * Cuando un conductor acepta, ese taxi queda resaltado con una línea hasta
 * el cliente.
 *
 * Un clic en el mapa corrige el punto. Los taxis llevan los mismos colores
 * que en Operación.
 */
export function MapaDeCarrera({
  punto,
  provisional,
  onMarcar,
  zonas,
  drivers,
  resaltado,
  className,
}: {
  /** Dónde irá el taxi: el punto marcado, o el que se dedujo de la dirección. */
  punto?: Point;
  /** El punto salió de la dirección y aún puede cambiar: se pinta más suave. */
  provisional?: boolean;
  /** Sin esto el mapa es solo para mirar (después de crear la carrera). */
  onMarcar?: (punto: Point) => void;
  zonas: Zone[];
  drivers: Driver[];
  /** El conductor que aceptó. */
  resaltado?: string | null;
  className?: string;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapLibreMap>(undefined);
  const alMarcar = useRef(onMarcar);
  alMarcar.current = onMarcar;
  const driversRef = useRef(drivers);
  driversRef.current = drivers;

  const ultimo = useRef<Record<Capa, FeatureCollection>>({ zonas: VACIO, taxis: VACIO, punto: VACIO, linea: VACIO });
  const publicar = (id: Capa, datos: FeatureCollection) => {
    ultimo.current[id] = datos;
    (mapa.current?.getSource(id) as GeoJSONSource | undefined)?.setData(datos);
  };

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    registerPmtiles();
    const colores = readPalette();
    const instancia = new MapLibreMap({
      container: contenedor.current,
      style: buildStyle(TILES_URL, colores),
      center: punto ? [punto.lng, punto.lat] : CENTRO_DEL_MAPA,
      zoom: punto ? 15 : 12.6,
      pitch: 0,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    instancia.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    instancia.on('load', () => {
      for (const id of ['zonas', 'linea', 'taxis', 'punto'] as const) {
        instancia.addSource(id, { type: 'geojson', data: ultimo.current[id] });
      }
      instancia.addLayer({
        id: 'zonas-borde',
        type: 'line',
        source: 'zonas',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.7 },
      });
      instancia.addLayer({
        id: 'linea',
        type: 'line',
        source: 'linea',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': token('--map-en-carrera'), 'line-width': 3, 'line-dasharray': [1.5, 1.5] },
      });
      // El taxi que aceptó: un aro ancho debajo, para que se vea de inmediato.
      instancia.addLayer({
        id: 'taxis-resaltado',
        type: 'circle',
        source: 'taxis',
        filter: ['get', 'resaltado'],
        paint: {
          'circle-radius': 22,
          'circle-color': token('--map-en-carrera'),
          'circle-opacity': 0.22,
          'circle-stroke-color': token('--map-en-carrera'),
          'circle-stroke-width': 2.5,
        },
      });
      instancia.addLayer({
        id: 'taxis',
        type: 'circle',
        source: 'taxis',
        paint: {
          // El zoom solo puede ir en el nivel de arriba de la expresión.
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            ['case', ['get', 'resaltado'], 9, 5],
            14,
            ['case', ['get', 'resaltado'], 11, 8],
            17,
            ['case', ['get', 'resaltado'], 13, 11],
          ],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'vieja'], 0.4, 1],
          'circle-stroke-color': colores.surface,
          'circle-stroke-width': 2.5,
        },
      });
      instancia.addLayer({
        id: 'taxis-rotulo',
        type: 'symbol',
        source: 'taxis',
        minzoom: 12.5,
        layout: {
          'text-field': ['get', 'rotulo'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['case', ['get', 'resaltado'], 15, 12],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': colores.ink, 'text-halo-color': colores.surface, 'text-halo-width': 1.8 },
      });
      // El cliente: rojo, como en Operación. Suave mientras es provisional.
      instancia.addLayer({
        id: 'punto-halo',
        type: 'circle',
        source: 'punto',
        paint: { 'circle-radius': 26, 'circle-color': token('--danger-fill'), 'circle-opacity': 0.14 },
      });
      instancia.addLayer({
        id: 'punto',
        type: 'circle',
        source: 'punto',
        paint: {
          'circle-radius': 11,
          'circle-color': token('--danger-fill'),
          'circle-opacity': ['case', ['get', 'provisional'], 0.75, 1],
          'circle-stroke-color': colores.surface,
          'circle-stroke-width': 3.5,
        },
      });
    });

    instancia.on('click', (evento) => alMarcar.current?.({ lat: evento.lngLat.lat, lng: evento.lngLat.lng }));
    mapa.current = instancia;
    return () => {
      instancia.remove();
      mapa.current = undefined;
    };
    // El mapa se crea una vez; lo demás se actualiza con `setData`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Con mano de marcar solo cuando se puede marcar.
  useEffect(() => {
    const lienzo = mapa.current?.getCanvas();
    if (lienzo) lienzo.style.cursor = onMarcar ? 'crosshair' : '';
  }, [onMarcar]);

  useEffect(() => {
    publicar('zonas', {
      type: 'FeatureCollection',
      features: zonas
        .filter((z) => z.polygon.length > 2)
        .map((z) => ({
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [anillo(z.polygon)] },
          properties: { color: token(z.kind === 'rural' ? '--success-fill' : '--brand-strong') },
        })),
    });
  }, [zonas]);

  useEffect(() => {
    publicar('taxis', {
      type: 'FeatureCollection',
      features: drivers
        .filter((d) => d.position && d.status !== 'OFF_SHIFT')
        .map((d) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [d.position!.lng, d.position!.lat] },
          properties: {
            rotulo: rotulo(d),
            color: colorDelTaxi(d.status),
            vieja: (d.positionAgeSeconds ?? 0) > 60,
            resaltado: d.id === resaltado,
          },
        })),
    });

    const elegido = resaltado ? drivers.find((d) => d.id === resaltado) : undefined;
    publicar(
      'linea',
      punto && elegido?.position
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [elegido.position.lng, elegido.position.lat],
                    [punto.lng, punto.lat],
                  ],
                },
                properties: {},
              },
            ],
          }
        : VACIO,
    );
  }, [drivers, resaltado, punto]);

  useEffect(() => {
    publicar(
      'punto',
      punto
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [punto.lng, punto.lat] },
                properties: { provisional: Boolean(provisional) },
              },
            ],
          }
        : VACIO,
    );
  }, [punto, provisional]);

  /*
   * El encuadre: el punto y los taxis que importan. Se recalcula cuando
   * cambia el punto o el taxi elegido, no con cada movimiento de la flota:
   * un mapa que se reacomoda solo cada dos segundos no se puede leer.
   */
  const hayElegido = Boolean(resaltado && drivers.some((d) => d.id === resaltado && d.position));
  useEffect(() => {
    const instancia = mapa.current;
    if (!instancia || !punto) return;
    const flota = driversRef.current;
    const elegido = resaltado ? flota.find((d) => d.id === resaltado) : undefined;

    const marco = new LngLatBounds([punto.lng, punto.lat], [punto.lng, punto.lat]);
    if (elegido?.position) {
      marco.extend([elegido.position.lng, elegido.position.lat]);
    } else {
      flota
        .filter((d) => d.status === 'AVAILABLE' && d.position && (d.positionAgeSeconds ?? 0) <= 60)
        .map((d) => ({ d, km: haversineKm(punto, d.position!) }))
        // Más lejos de 3 km ya no es «el sector»: alejaría el mapa para nada.
        .filter((x) => x.km <= 3)
        .sort((a, b) => a.km - b.km)
        .slice(0, TAXIS_EN_EL_ENCUADRE)
        .forEach((x) => marco.extend([x.d.position!.lng, x.d.position!.lat]));
    }
    instancia.fitBounds(marco, { padding: 70, maxZoom: 16, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punto?.lat, punto?.lng, resaltado, hayElegido]);

  return <div ref={contenedor} className={cn('overflow-hidden rounded-lg border border-line', className)} />;
}
