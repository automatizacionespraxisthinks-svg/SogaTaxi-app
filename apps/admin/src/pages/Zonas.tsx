import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, MapPin, Plus, Radar, Save } from 'lucide-react';
import type { AjustesDespacho, Place, Zone } from '@tax/shared';
import { AJUSTES_DESPACHO_DE_FABRICA, ajustesDespachoSchema } from '@tax/shared';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  StatusPill,
  Tabs,
  staggerItem,
  staggerList,
  transition,
  useToast,
} from '@tax/ui';
import { ApiError, api } from '../api/client';
import { usePlaces, usePuede } from '../api/queries';
import { actions, useLive, zoneOf } from '../live/store';
import { FormularioLugar, FormularioMoverZona, FormularioZona } from '../components/FormulariosCatalogo';

type Tab = 'zonas' | 'lugares';

/**
 * Zonas y lugares.
 *
 * Arriba, los ajustes del despacho: una sola regla para toda la ciudad, por
 * cercanía. Las zonas son los barrios y las veredas, y sirven para las
 * estadísticas: no deciden a quién se le avisa. Los lugares, los sitios que los clientes nombran sin dirección («la
 * terminal»), con las palabras clave con que el asistente los reconoce. Los
 * dos se crean aquí, en una ventana sobre la vista.
 *
 * Crear una zona o cambiar los ajustes del despacho pide «Gestionar zonas y
 * oleadas»: cambia cómo se despacha. Los lugares, «Gestionar lugares». Sin ellos, las
 * dos pestañas se ven pero no se tocan.
 */
export function Zonas() {
  const [tab, setTab] = useState<Tab>('zonas');
  const zoneCount = useLive((s) => s.zones.length);
  const places = usePlaces();
  const puede = usePuede();
  const zonasEditables = puede('zonas.gestionar');
  const lugaresEditables = puede('lugares.gestionar');

  const [zonaNueva, setZonaNueva] = useState(false);
  const [lugarAbierto, setLugarAbierto] = useState<Place | 'nuevo' | null>(null);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'zonas', label: 'Zonas y despacho', count: zoneCount },
            { value: 'lugares', label: 'Catálogo de lugares', count: places.data?.length },
          ]}
        />
        {tab === 'zonas' && zonasEditables ? (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setZonaNueva(true)}>
            Nueva zona
          </Button>
        ) : null}
        {tab === 'lugares' && lugaresEditables ? (
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setLugarAbierto('nuevo')}>
            Nuevo lugar
          </Button>
        ) : null}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={transition.base}
        >
          {tab === 'zonas' ? <ZonasYOleadas editable={zonasEditables} /> : null}
          {tab === 'lugares' ? (
            <Lugares
              places={places.data ?? []}
              onAbrir={lugaresEditables ? (lugar) => setLugarAbierto(lugar) : undefined}
              onNuevo={lugaresEditables ? () => setLugarAbierto('nuevo') : undefined}
            />
          ) : null}
        </motion.div>
      </AnimatePresence>

      <FormularioZona open={zonaNueva} onClose={() => setZonaNueva(false)} />
      <FormularioLugar
        open={lugarAbierto !== null}
        onClose={() => setLugarAbierto(null)}
        lugar={lugarAbierto && lugarAbierto !== 'nuevo' ? lugarAbierto : undefined}
        lugares={places.data ?? []}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- zonas */

function ZonasYOleadas({ editable }: { editable: boolean }) {
  const zones = useLive((s) => s.zones);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <TarjetaDespacho editable={editable} />
      <motion.div
        variants={staggerList(zones.length)}
        initial="hidden"
        animate="visible"
        className="grid gap-3 lg:grid-cols-2"
      >
        {zones.map((zone) => (
          <motion.div key={zone.id} variants={staggerItem}>
            <TarjetaZona
              zone={zone}
              editable={editable}
              open={editing === zone.id}
              onToggle={() => setEditing(editing === zone.id ? null : zone.id)}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Los ajustes del despacho de toda la ciudad (26/11/2026).
 *
 * El despacho es por cercanía y no depende de la zona: cada ronda avisa a
 * todos los taxis disponibles dentro de su rango y se la lleva el primero que
 * acepta; si nadie la toma, el rango se amplía. Antes cada zona tenía sus
 * propias oleadas; ahora es una sola regla y vive aquí.
 */
function TarjetaDespacho({ editable }: { editable: boolean }) {
  const { push } = useToast();
  const [guardados, setGuardados] = useState<AjustesDespacho | null>(null);
  const [ajustes, setAjustes] = useState<AjustesDespacho>(AJUSTES_DESPACHO_DE_FABRICA);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .get<AjustesDespacho>('/v1/admin/dispatch')
      .then((datos) => {
        if (!vivo) return;
        setGuardados(datos);
        setAjustes(datos);
      })
      .catch((causa: unknown) => {
        if (vivo) setError(causa instanceof ApiError ? causa.message : 'No se pudieron leer los ajustes.');
      });
    return () => {
      vivo = false;
    };
  }, []);

  const ronda = (wave: 1 | 2 | 3, cambio: { radiusKm?: number; timeoutSeconds?: number }) =>
    setAjustes((a) => ({ ...a, rondas: a.rondas.map((r) => (r.wave === wave ? { ...r, ...cambio } : r)) }));
  const lejanos = (cambio: Partial<AjustesDespacho['lejanos']>) =>
    setAjustes((a) => ({ ...a, lejanos: { ...a.lejanos, ...cambio } }));

  const sinCambios = guardados !== null && JSON.stringify(guardados) === JSON.stringify(ajustes);

  const guardar = async () => {
    const validacion = ajustesDespachoSchema.safeParse(ajustes);
    if (!validacion.success) {
      setError(validacion.error.issues[0]?.message ?? 'Revisa los valores');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const datos = await api.patch<AjustesDespacho>('/v1/admin/dispatch', validacion.data);
      setGuardados(datos);
      setAjustes(datos);
      push({
        tone: 'positive',
        title: 'Despacho actualizado',
        description: 'Las próximas carreras se despachan con los nuevos valores, en toda la ciudad.',
      });
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card className="space-y-3">
      <CardHeader
        title="Despacho por cercanía"
        subtitle="Una sola regla para toda la ciudad. Cada ronda avisa a todos los taxis disponibles dentro de su rango, y se la lleva el primero que acepta. Si nadie la toma, se amplía el rango."
      />

      <div className="grid gap-2 sm:grid-cols-3">
        {ajustes.rondas.map((r) => (
          <div key={r.wave} className="space-y-2 rounded-md border border-line bg-surface-sunk px-2.5 py-2">
            <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
              <Radar className="size-3" />
              Ronda {r.wave}
            </p>
            <Field label="Rango (km)">
              <Input
                type="number"
                step="0.1"
                min="0.2"
                disabled={!editable}
                value={r.radiusKm}
                onChange={(e) => ronda(r.wave, { radiusKm: Number(e.target.value) })}
              />
            </Field>
            <Field label="Espera (segundos)">
              <Input
                type="number"
                step="5"
                min="15"
                disabled={!editable}
                value={r.timeoutSeconds}
                onChange={(e) => ronda(r.wave, { timeoutSeconds: Number(e.target.value) })}
              />
            </Field>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-md border border-line px-3 py-2.5">
        <p className="text-base text-ink">Si no hay ningún taxi dentro del rango</p>
        <p className="text-micro text-ink-muted">
          Pasa en las veredas y de madrugada. Se avisa a los taxis más cercanos que haya, aunque estén
          más lejos que la ronda 3, pero solo a los que estén a una distancia parecida a la del primero.
          Si no contestan, en cada reintento se suman los siguientes. Si sí había taxis en el rango y
          ninguno aceptó, no se avisa más lejos: la carrera se vuelve a ofrecer cerca. Con 0 taxis no
          se avisa lejos.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Taxis más cercanos a avisar">
            <Input
              type="number"
              min="0"
              disabled={!editable}
              value={ajustes.lejanos.candidatos}
              onChange={(e) => lejanos({ candidatos: Number(e.target.value) })}
            />
          </Field>
          <Field label="Hasta qué distancia (km)">
            <Input
              type="number"
              step="1"
              min="3"
              disabled={!editable}
              value={ajustes.lejanos.hastaKm}
              onChange={(e) => lejanos({ hastaKm: Number(e.target.value) })}
            />
          </Field>
          <Field label="Margen sobre el más cercano (km)">
            <Input
              type="number"
              step="0.5"
              min="0.2"
              disabled={!editable}
              value={ajustes.lejanos.margenKm}
              onChange={(e) => lejanos({ margenKm: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink">Tope de seguridad de la ubicación</p>
          <p className="text-micro text-ink-muted">
            Un taxi que lleva más de estos minutos sin reportar su ubicación no recibe ofertas en ninguna
            ronda: no se sabe dónde está. Vuelve a recibirlas apenas su aplicación reporte de nuevo.
          </p>
        </div>
        <div className="w-36 shrink-0">
          <Field label="Minutos">
            <Input
              type="number"
              step="5"
              min="2"
              disabled={!editable}
              value={ajustes.posicionMaximaMin}
              onChange={(e) => setAjustes((a) => ({ ...a, posicionMaximaMin: Number(e.target.value) }))}
            />
          </Field>
        </div>
      </div>

      {error ? <p className="text-caption text-[var(--t-critical-ink)]">{error}</p> : null}

      {editable ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-micro text-ink-muted">
            Las rondas suman: quien no contestó sigue con la oferta en la siguiente. El cambio queda en
            la bitácora de auditoría.
          </p>
          <Button
            variant="primary"
            icon={<Save className="size-3.5" />}
            loading={guardando}
            disabled={sinCambios}
            onClick={() => void guardar()}
          >
            Guardar
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function TarjetaZona({
  zone,
  editable,
  open,
  onToggle,
}: {
  zone: Zone;
  editable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { push } = useToast();
  /*
   * Conductores en turno cuya última posición cae dentro de la zona. Antes
   * decía «0 conductores habituales» a todas: el dato no existía.
   */
  const enLaZona = useLive(
    (s) => s.drivers.filter((d) => d.status !== 'OFF_SHIFT' && d.position && zoneOf(d.position)?.id === zone.id).length,
  );
  const [error, setError] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [moviendo, setMoviendo] = useState(false);

  /** Hace de esta zona el punto de partida de las carreras que no se ubican. */
  const usarDePartida = async () => {
    setMarcando(true);
    setError(null);
    try {
      await api.patch(`/v1/admin/zones/${zone.id}`, { esReferencia: true });
      await actions.refreshZones();
      push({
        tone: 'positive',
        title: `${zone.name} es el punto de partida`,
        description: 'Las carreras que no se puedan ubicar se despachan desde su centro.',
      });
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo cambiar.');
    } finally {
      setMarcando(false);
    }
  };

  const abrirOCerrar = () => {
    setError(null);
    onToggle();
  };

  return (
    <Card className="space-y-3">
      <CardHeader
        title={zone.name}
        subtitle={`Factor de tortuosidad ${zone.tortuosity.toFixed(2)} · ${enLaZona} ${enLaZona === 1 ? 'conductor' : 'conductores'} en la zona ahora`}
        actions={
          <>
            {zone.esReferencia ? (
              <span title="Las carreras que no se pueden ubicar se despachan desde el centro de esta zona">
                <StatusPill tone="accent" dot={false}>
                  <Crosshair className="size-3" /> punto de partida
                </StatusPill>
              </span>
            ) : null}
            <StatusPill tone={zone.kind === 'urbano' ? 'info' : 'positive'} dot={false}>
              {zone.kind === 'urbano' ? 'urbano' : 'vereda'}
            </StatusPill>
            {editable ? (
              <Button size="sm" variant="ghost" onClick={() => setMoviendo(true)}>
                Mover
              </Button>
            ) : null}
            {editable ? (
              <Button size="sm" onClick={abrirOCerrar}>
                {open ? 'Cerrar' : 'Opciones'}
              </Button>
            ) : null}
          </>
        }
      />

      <FormularioMoverZona zona={zone} open={moviendo} onClose={() => setMoviendo(false)} />

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={transition.base}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-line pt-3">
              {error ? <p className="text-caption text-[var(--t-critical-ink)]">{error}</p> : null}

              <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-base text-ink">Punto de partida de las carreras sin ubicar</p>
                  <p className="text-micro text-ink-muted">
                    Cuando no se encuentra la dirección ni hay ubicación, las rondas arrancan desde el
                    centro de esta zona y el conductor llega leyendo la dirección. Solo una zona lo es.
                  </p>
                </div>
                {zone.esReferencia ? (
                  <span className="shrink-0 text-caption font-medium text-ink-secondary">Es esta</span>
                ) : (
                  <Button
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    loading={marcando}
                    onClick={() => void usarDePartida()}
                  >
                    Usar esta
                  </Button>
                )}
              </div>

            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

/* ------------------------------------------------------------------ lugares */

function Lugares({
  places,
  onAbrir,
  onNuevo,
}: {
  places: Place[];
  /** Sin él, el catálogo es de solo lectura. */
  onAbrir?: (lugar: Place) => void;
  onNuevo?: () => void;
}) {
  const [query, setQuery] = useState('');

  if (places.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<MapPin className="size-4" />}
          title="Catálogo vacío"
          description="Agrega los sitios que los clientes nombran sin dirección: la terminal, el parque, los hoteles. El asistente los reconoce por sus palabras clave."
          action={
            onNuevo ? (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={onNuevo}>
                Agregar el primero
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const buscada = query.trim().toLowerCase();
  const rows = places
    .filter(
      (place) =>
        !buscada ||
        place.name.toLowerCase().includes(buscada) ||
        place.aliases.some((alias) => alias.toLowerCase().includes(buscada)),
    )
    .sort((a, b) => b.uses - a.uses);

  const max = Math.max(1, ...places.map((p) => p.uses));

  return (
    <Card flush className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Catálogo de lugares</h2>
          <p className="text-micro text-ink-muted">
            Cuando el cliente no manda ubicación ni dirección, el asistente busca aquí el lugar que nombró.
            {onAbrir ? ' Toca uno para editarlo.' : ''}
          </p>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar lugar o palabra clave…"
          className="w-60"
          aria-label="Buscar lugar"
        />
      </div>

      <ul>
        {rows.map((place) => (
          <li key={place.id} className="border-b border-line last:border-0">
            <button
              type="button"
              disabled={!onAbrir}
              onClick={() => onAbrir?.(place)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ease-[var(--ease-standard)] enabled:hover:bg-surface-sunk"
            >
              <MapPin className="size-3.5 shrink-0 text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-ink">{place.name}</p>
                <p className="truncate text-micro text-ink-muted">
                  {place.aliases.length > 0 ? `También: ${place.aliases.join(', ')}` : 'Sin palabras clave: solo por su nombre'}
                </p>
              </div>
              <StatusPill tone={place.kind === 'rural' || place.kind === 'vereda' ? 'positive' : 'info'} dot={false}>
                {place.kind === 'rural' || place.kind === 'vereda' ? 'vereda' : 'urbano'}
              </StatusPill>
              {/* Barra de uso: magnitud en una sola rampa, sin ejes ni leyenda. */}
              <div className="hidden w-28 items-center gap-2 sm:flex" title="Veces que reconoció un pedido">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunk">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(place.uses / max) * 100}%` }}
                    transition={{ duration: 0.56, ease: [0.05, 0.7, 0.1, 1] }}
                    className="h-full rounded-full bg-[var(--c-series-1)]"
                  />
                </div>
                <span className="tnum w-8 text-right text-micro text-ink-muted">{place.uses}</span>
              </div>
            </button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-4 py-6 text-center text-caption text-ink-muted">Ningún lugar coincide con «{query}».</li>
        ) : null}
      </ul>
    </Card>
  );
}
