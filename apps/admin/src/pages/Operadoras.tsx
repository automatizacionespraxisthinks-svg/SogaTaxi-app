import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Hand,
  Headset,
  PhoneCall,
  X,
} from 'lucide-react';
import type { CarreraDeOperadora, FilaOperadora, PeriodoRapido, RideStatus, TableroOperadoras } from '@tax/shared';
import {
  ETIQUETA_PERIODO,
  MAX_DIAS_INFORME,
  PERIODOS_RAPIDOS,
  RIDE_STATUS_LABEL,
  RIDE_STATUS_TONE,
  diaLocal,
  diasDelRango,
  duracionCorta,
  formatRelative,
  formatTime,
  hoyLocal,
  periodoDelRango,
  rangoDePeriodo,
  textoDelRango,
} from '@tax/shared';
import { Button, Card, CardHeader, EmptyState, Segmented, Skeleton, Stat, StatusPill, cn, staggerItem, staggerList } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { ChartFrame, DataTable, HorizontalBars, StackedBars } from '../components/charts';
import { Casilla, RangoDeFechas } from '../components/Filtros';

/* --------------------------------------------------------------- formatos --- */

const numero = (n: number) => n.toLocaleString('es-CO');
const pct = (parte: number, total: number) => (total > 0 ? `${Math.round((parte / total) * 100)} %` : '—');
const hora = (h: number) => `${h}:00`;
const diaCorto = (dia: string) => {
  const [, m, d] = dia.split('-');
  return `${Number(d)}/${Number(m)}`;
};

/* ---------------------------------------------------------------- filtros --- */

interface Filtros {
  desde: string;
  hasta: string;
  sinPruebas: boolean;
  operadora?: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Como en Reportes: el periodo vive en la dirección, y recargar no lo borra. */
function useFiltros() {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo<Filtros>(() => {
    let desde = params.get('desde') ?? '';
    let hasta = params.get('hasta') ?? '';
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta || diasDelRango(desde, hasta) > MAX_DIAS_INFORME) {
      ({ desde, hasta } = rangoDePeriodo('7d'));
    }
    const operadora = params.get('operadora');
    return {
      desde,
      hasta,
      sinPruebas: params.get('pruebas') !== 'si',
      operadora: operadora && UUID.test(operadora) ? operadora : undefined,
    };
  }, [params]);

  const cambiar = (cambios: Partial<Filtros>) => {
    const s = { ...filtros, ...cambios };
    const nuevos = new URLSearchParams();
    const porDefecto = rangoDePeriodo('7d');
    if (s.desde !== porDefecto.desde || s.hasta !== porDefecto.hasta) {
      nuevos.set('desde', s.desde);
      nuevos.set('hasta', s.hasta);
    }
    if (!s.sinPruebas) nuevos.set('pruebas', 'si');
    if (s.operadora) nuevos.set('operadora', s.operadora);
    setParams(nuevos);
  };
  return { filtros, cambiar, hoy: hoyLocal() };
}

const consultaDe = (f: Filtros) =>
  new URLSearchParams({ desde: f.desde, hasta: f.hasta, sinPruebas: String(f.sinPruebas) }).toString();

/* ------------------------------------------------------------------ página --- */

/**
 * Operadoras (28/11/2026): el trabajo de cada persona de la oficina.
 *
 * Arriba el periodo; debajo lo que registró la oficina frente a lo que entró
 * por WhatsApp, la comparación entre operadoras y, al tocar una, su ficha:
 * a qué horas trabaja, cuánto por día y sus últimas carreras.
 *
 * Solo cuenta bien si cada operadora entra con su propio usuario: lo que se
 * registre con una cuenta compartida queda a nombre de esa cuenta.
 */
export function Operadoras() {
  const { filtros, cambiar, hoy } = useFiltros();
  const consulta = consultaDe(filtros);
  const tablero = useQuery({
    queryKey: ['operadoras', consulta],
    queryFn: () => api.get<TableroOperadoras>(`/v1/reports/operadoras?${consulta}`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const t = tablero.data;
  const actualizando = tablero.isFetching && tablero.isPlaceholderData;
  const elegida = t?.operadoras.find((o) => o.id === filtros.operadora);
  const periodo = periodoDelRango(filtros.desde, filtros.hasta, hoy);

  return (
    <div className="space-y-4 p-5">
      <div>
        <p className="text-base font-semibold text-ink">Qué registró y despachó cada persona de la oficina</p>
        <p className="text-caption text-ink-muted">
          {textoDelRango(filtros.desde, filtros.hasta)} · días completos en hora de Colombia
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-2">
        <Segmented<PeriodoRapido | 'personalizado'>
          ink
          value={periodo ?? 'personalizado'}
          onChange={(p) => {
            if (p !== 'personalizado') cambiar(rangoDePeriodo(p, hoy));
          }}
          options={PERIODOS_RAPIDOS.map((p) => ({ value: p, label: ETIQUETA_PERIODO[p] }))}
        />
        <RangoDeFechas desde={filtros.desde} hasta={filtros.hasta} hoy={hoy} onCambiar={cambiar} />
        <div className="ml-auto">
          <Casilla
            marcada={filtros.sinPruebas}
            onCambiar={(sinPruebas) => cambiar({ sinPruebas })}
            title="Deja fuera las carreras de los teléfonos y las cuentas de conductor marcados como de prueba"
          >
            No incluir pruebas
          </Casilla>
        </div>
      </Card>

      {tablero.isError ? (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="size-4" />}
            tone="critical"
            title="No se pudo cargar"
            description={tablero.error instanceof ApiError ? tablero.error.message : 'Revisa la conexión y vuelve a intentarlo.'}
            action={
              <Button size="sm" onClick={() => void tablero.refetch()}>
                Reintentar
              </Button>
            }
          />
        </Card>
      ) : !t ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div
          aria-busy={actualizando}
          className={cn('space-y-4 transition-opacity duration-150', actualizando && 'opacity-60')}
        >
          <EnPocasPalabras tablero={t} />
          <CifrasDeLaOficina tablero={t} />

          {t.oficina.creadas === 0 && t.oficina.asignacionesManuales + t.oficina.relanzamientos + t.oficina.cancelacionesHechas === 0 ? (
            <Card>
              <EmptyState
                icon={<Headset className="size-4" />}
                title="La oficina no registró carreras en este periodo"
                description="Aquí aparece cada persona que registre una carrera con «Nueva carrera», la asigne a mano, la relance o la cancele. Para que cuente a su nombre, cada operadora debe entrar con su propio usuario (Sistema › Usuarios)."
              />
            </Card>
          ) : (
            <>
              <Graficas tablero={t} elegida={elegida} />
              <Tabla
                filas={t.operadoras}
                dias={t.periodo.dias}
                elegida={filtros.operadora}
                onElegir={(id) => cambiar({ operadora: id === filtros.operadora ? undefined : id })}
              />
              {elegida ? (
                <Ficha
                  operadora={elegida}
                  fechas={t.fechas}
                  consulta={consulta}
                  onCerrar={() => cambiar({ operadora: undefined })}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- resumen --- */

function EnPocasPalabras({ tablero: t }: { tablero: TableroOperadoras }) {
  const total = t.oficina.creadas + t.asistente.creadas;
  const conCarreras = t.operadoras.filter((o) => o.creadas > 0);
  const primera = conCarreras[0];
  const F = ({ children }: { children: ReactNode }) => <strong className="font-bold">{children}</strong>;

  return (
    <Card>
      <p className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">En pocas palabras</p>
      <p className="mt-2 max-w-5xl text-lg leading-relaxed text-ink">
        {t.oficina.creadas === 0 ? (
          <>
            La oficina no registró carreras a mano en este periodo; por WhatsApp entraron{' '}
            <F>{numero(t.asistente.creadas)}</F>.
          </>
        ) : (
          <>
            La oficina registró <F>{numero(t.oficina.creadas)} {t.oficina.creadas === 1 ? 'carrera' : 'carreras'}</F> a mano
            {total > 0 ? <> ({pct(t.oficina.creadas, total)} de todas)</> : null}; por WhatsApp entraron{' '}
            <F>{numero(t.asistente.creadas)}</F>.{' '}
            {primera ? (
              conCarreras.length === 1 ? (
                <>
                  Todas las registró <F>{primera.nombre}</F>.{' '}
                </>
              ) : (
                <>
                  Quien más registró fue <F>{primera.nombre}</F>, con {numero(primera.creadas)} (
                  {pct(primera.creadas, t.oficina.creadas)}).{' '}
                </>
              )
            ) : null}
            {t.oficina.horaPico ? (
              <>
                La hora con más llamadas fue la de las <F>{hora(t.oficina.horaPico.hora)}</F>.
              </>
            ) : null}
          </>
        )}
      </p>
    </Card>
  );
}

function CifrasDeLaOficina({ tablero: t }: { tablero: TableroOperadoras }) {
  const o = t.oficina;
  const activas = t.operadoras.filter((x) => x.creadas > 0 || x.ultimaActividad).length;
  const fichas = [
    <Stat
      key="registradas"
      label="Registradas por la oficina"
      value={o.creadas}
      icon={<PhoneCall className="size-3.5" />}
      iconTone="info"
      hint={`${numero(activas)} ${activas === 1 ? 'persona con actividad' : 'personas con actividad'} · ${numero(t.asistente.creadas)} por WhatsApp`}
    />,
    <Stat
      key="terminadas"
      label="Terminadas"
      value={o.terminadas}
      tone={o.terminadas === 0 ? 'neutral' : 'positive'}
      icon={<CheckCircle2 className="size-3.5" />}
      iconTone="positive"
      hint={`${pct(o.terminadas, o.creadas)} de las suyas · WhatsApp ${pct(t.asistente.terminadas, t.asistente.creadas)}`}
    />,
    <Stat
      key="sin-taxi"
      label="Se quedaron sin taxi"
      value={o.sinTaxi}
      tone={o.sinTaxi > 0 ? 'critical' : 'positive'}
      icon={<AlertTriangle className="size-3.5" />}
      iconTone="critical"
      hint={`${numero(o.canceladas)} canceladas · ${numero(o.abiertas)} abiertas`}
    />,
    <Stat
      key="a-mano"
      label="Asignadas a mano"
      value={o.asignacionesManuales}
      icon={<Hand className="size-3.5" />}
      iconTone="neutral"
      hint={`${numero(o.relanzamientos)} relanzamientos · ${numero(o.cancelacionesHechas)} cancelaciones de la oficina`}
    />,
  ];

  return (
    <motion.div
      variants={staggerList(fichas.length)}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 gap-3 xl:grid-cols-4"
    >
      {fichas.map((f, i) => (
        <motion.div key={i} variants={staggerItem}>
          {f}
        </motion.div>
      ))}
    </motion.div>
  );
}

/* --------------------------------------------------------------- gráficas --- */

function Graficas({ tablero: t, elegida }: { tablero: TableroOperadoras; elegida?: FilaOperadora }) {
  const conCarreras = t.operadoras.filter((o) => o.creadas > 0);
  // De la primera a la última hora con carreras, con un mínimo de 6 a 22.
  const horasConCarreras = t.oficina.porHora.flatMap((n, h) => (n > 0 ? [h] : []));
  const primera = Math.min(6, horasConCarreras[0] ?? 6);
  const ultima = Math.max(22, horasConCarreras.at(-1) ?? 22);
  const horas = Array.from({ length: ultima - primera + 1 }, (_, i) => primera + i);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <ChartFrame
        title="Carreras registradas por operadora"
        subtitle="Las que cada una creó con «Nueva carrera» en el periodo"
        table={
          <DataTable
            head={['Operadora', 'Registradas', 'Terminadas', 'Sin taxi']}
            rows={conCarreras.map((o) => [o.nombre, o.creadas, o.terminadas, o.sinTaxi])}
          />
        }
      >
        {conCarreras.length === 0 ? (
          <p className="flex h-40 items-center justify-center text-caption text-ink-muted">
            Nadie registró carreras a mano en el periodo.
          </p>
        ) : (
          <HorizontalBars
            data={conCarreras.map((o) => ({
              label: o.nombre,
              value: o.creadas,
              hint: `${o.terminadas} terminadas · ${o.canceladas} canceladas · ${o.sinTaxi} sin taxi`,
            }))}
          />
        )}
      </ChartFrame>

      <ChartFrame
        title="A qué horas registra la oficina"
        subtitle={
          elegida
            ? `En amarillo, las de ${elegida.nombre}; en gris, las de las demás`
            : 'Carreras registradas a mano según la hora en que se crearon'
        }
        legend={
          elegida
            ? [
                { label: elegida.nombre, color: 'var(--brand)' },
                { label: 'Las demás', color: 'var(--muted)' },
              ]
            : undefined
        }
        table={
          <DataTable
            head={elegida ? ['Hora', elegida.nombre, 'Toda la oficina'] : ['Hora', 'Carreras']}
            rows={horas.map((h) =>
              elegida ? [hora(h), elegida.porHora[h] ?? 0, t.oficina.porHora[h] ?? 0] : [hora(h), t.oficina.porHora[h] ?? 0],
            )}
          />
        }
      >
        <StackedBars
          data={horas.map((h) => {
            const todas = t.oficina.porHora[h] ?? 0;
            const suyas = elegida?.porHora[h] ?? 0;
            return { label: String(h), values: elegida ? [suyas, todas - suyas] : [todas] };
          })}
          series={elegida ? [elegida.nombre, 'Las demás'] : ['Carreras']}
          colors={elegida ? ['var(--brand)', 'var(--muted)'] : undefined}
        />
      </ChartFrame>
    </div>
  );
}

/* ------------------------------------------------------------------ tabla --- */

type Orden = 'creadas' | 'terminadas' | 'canceladas' | 'sinTaxi' | 'asignacionesManuales' | 'relanzamientos' | 'cancelacionesHechas' | 'asignacionP50';

const COLUMNAS: { clave: Orden; titulo: string; ayuda: string; ver: (o: FilaOperadora) => string }[] = [
  { clave: 'creadas', titulo: 'Registró', ayuda: 'Carreras que creó con «Nueva carrera»', ver: (o) => numero(o.creadas) },
  { clave: 'terminadas', titulo: 'Terminadas', ayuda: 'De las que registró, las que terminaron con el pasajero', ver: (o) => (o.terminadas ? `${numero(o.terminadas)} · ${pct(o.terminadas, o.creadas)}` : '0') },
  { clave: 'canceladas', titulo: 'Canceladas', ayuda: 'De las que registró, las que canceló el cliente, la oficina o el conductor', ver: (o) => numero(o.canceladas) },
  { clave: 'sinTaxi', titulo: 'Sin taxi', ayuda: 'De las que registró, las que se quedaron sin conductor', ver: (o) => numero(o.sinTaxi) },
  { clave: 'asignacionesManuales', titulo: 'Asignó a mano', ayuda: 'Carreras que le puso a un conductor a mano, las haya creado quien las haya creado', ver: (o) => numero(o.asignacionesManuales) },
  { clave: 'relanzamientos', titulo: 'Relanzó', ayuda: 'Veces que pulsó «Relanzar» en una carrera sin asignar', ver: (o) => numero(o.relanzamientos) },
  { clave: 'cancelacionesHechas', titulo: 'Canceló', ayuda: 'Carreras que canceló en nombre de la oficina', ver: (o) => numero(o.cancelacionesHechas) },
  { clave: 'asignacionP50', titulo: 'Conseguir taxi', ayuda: 'Mediana de registrar la carrera a que un conductor la acepte', ver: (o) => (o.asignacionP50 === null ? '—' : duracionCorta(o.asignacionP50)) },
];

function Tabla({
  filas,
  dias,
  elegida,
  onElegir,
}: {
  filas: FilaOperadora[];
  dias: number;
  elegida?: string;
  onElegir: (id: string) => void;
}) {
  const [orden, setOrden] = useState<{ clave: Orden; desc: boolean }>({ clave: 'creadas', desc: true });
  const ordenadas = [...filas].sort((a, b) => {
    const x = a[orden.clave];
    const y = b[orden.clave];
    if (x === null) return 1;
    if (y === null) return -1;
    return orden.desc ? y - x : x - y;
  });

  return (
    <Card className="space-y-3">
      <CardHeader
        title="Operadoras"
        subtitle="Toca una persona para ver su ficha. Toca una columna para ordenar."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-left text-base">
          <thead>
            <tr className="border-b border-line text-micro uppercase tracking-[0.06em] text-ink-muted">
              <th className="py-2 pr-3 font-medium">Persona</th>
              {COLUMNAS.map((col) => (
                <th key={col.clave} className="py-2 pl-3 text-right font-medium" title={col.ayuda}>
                  <button
                    type="button"
                    onClick={() => setOrden((o) => ({ clave: col.clave, desc: o.clave === col.clave ? !o.desc : true }))}
                    className={cn('inline-flex items-center gap-1 uppercase hover:text-ink', orden.clave === col.clave && 'text-ink')}
                  >
                    {col.titulo}
                    {orden.clave === col.clave ? (
                      orden.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
                    ) : null}
                  </button>
                </th>
              ))}
              <th className="py-2 pl-3 text-right font-medium" title="Días del periodo en que registró al menos una carrera">
                Días
              </th>
              <th className="py-2 pl-3 text-right font-medium">Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((o) => {
              const sinNada = o.creadas === 0 && !o.ultimaActividad;
              return (
                <tr
                  key={o.id}
                  onClick={() => onElegir(o.id)}
                  aria-selected={o.id === elegida}
                  className={cn(
                    'cursor-pointer border-b border-line last:border-0',
                    'transition-colors duration-150 ease-[var(--ease-standard)]',
                    o.id === elegida ? 'bg-accent-soft' : 'hover:bg-surface-sunk',
                    sinNada && 'text-ink-muted',
                  )}
                >
                  <td className="py-2.5 pr-3">
                    <span className={cn(sinNada ? 'text-ink-muted' : 'text-ink', o.id === elegida && 'font-semibold')}>
                      {o.nombre}
                    </span>
                    <span className="ml-2 text-caption text-ink-muted">
                      {o.rol}
                      {o.activo ? '' : ' · inactiva'}
                    </span>
                  </td>
                  {COLUMNAS.map((col) => (
                    <td key={col.clave} className={cn('py-2.5 pl-3 text-right tnum', sinNada ? 'text-ink-muted' : 'text-ink')}>
                      {col.ver(o)}
                    </td>
                  ))}
                  <td className="py-2.5 pl-3 text-right tnum">
                    {o.diasConCarreras} de {dias}
                  </td>
                  <td className="py-2.5 pl-3 text-right text-caption text-ink-muted">
                    {o.ultimaActividad ? formatRelative(o.ultimaActividad) : 'Sin actividad'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-micro text-ink-muted">
        Cada carrera cuenta a nombre del usuario con el que se registró. Si dos personas comparten un usuario, sus
        carreras salen juntas: cree un usuario para cada operadora en Sistema › Usuarios.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ ficha --- */

function Ficha({
  operadora: o,
  fechas,
  consulta,
  onCerrar,
}: {
  operadora: FilaOperadora;
  fechas: string[];
  consulta: string;
  onCerrar: () => void;
}) {
  const carreras = useQuery({
    queryKey: ['operadoras', o.id, 'carreras', consulta],
    queryFn: () => api.get<CarreraDeOperadora[]>(`/v1/reports/operadoras/${o.id}/carreras?${consulta}`),
    staleTime: 60_000,
  });
  const pico = Math.max(...o.porHora);
  const horaPico = pico > 0 ? o.porHora.indexOf(pico) : null;
  const porDia = o.diasConCarreras > 0 ? Math.round((o.creadas / o.diasConCarreras) * 10) / 10 : null;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-on-brand">
            {o.nombre.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{o.nombre}</p>
            <p className="text-caption text-ink-muted">
              {o.usuario} · {o.rol}
              {o.activo ? '' : ' · cuenta inactiva'}
            </p>
          </div>
        </div>
        <Dato titulo="Por día trabajado" valor={porDia === null ? '—' : numero(porDia)} />
        <Dato titulo="Su hora más llena" valor={horaPico === null ? '—' : hora(horaPico)} />
        <Dato titulo="Conseguir taxi" valor={o.asignacionP50 === null ? '—' : duracionCorta(o.asignacionP50)} />
        <Button size="sm" variant="secondary" icon={<X className="size-3.5" />} onClick={onCerrar} className="ml-auto">
          Cerrar ficha
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title="Carreras registradas por día"
          subtitle="Un día sin barra es un día sin carreras suyas"
          table={<DataTable head={['Día', 'Carreras']} rows={fechas.map((d, i) => [d, o.porDia[i] ?? 0])} />}
        >
          <StackedBars
            data={fechas.map((d, i) => ({ label: diaCorto(d), values: [o.porDia[i] ?? 0] }))}
            series={['Carreras']}
            colors={['var(--brand)']}
          />
        </ChartFrame>

        <section className="rounded-lg bg-surface p-4 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Sus últimas carreras</h2>
          <p className="mt-0.5 text-caption text-ink-muted">Las 30 más recientes del periodo. Toca una para abrirla.</p>
          {carreras.isLoading ? (
            <Skeleton className="mt-3 h-40" />
          ) : !carreras.data?.length ? (
            <p className="flex h-40 items-center justify-center text-caption text-ink-muted">
              No registró carreras en este periodo.
            </p>
          ) : (
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {carreras.data.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/carreras/${c.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-sunk"
                  >
                    <Clock className="size-3.5 shrink-0 text-ink-muted" />
                    <span className="w-24 shrink-0 text-caption tnum text-ink-muted">
                      {diaCorto(diaLocal(new Date(c.creada)))} · {formatTime(new Date(c.creada))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-base text-ink">{c.recogida}</span>
                    {c.placa ? (
                      <span className="rounded-sm border border-ink bg-[var(--plate)] px-1.5 font-mono text-micro font-bold text-ink">
                        {c.placa}
                      </span>
                    ) : null}
                    <StatusPill tone={RIDE_STATUS_TONE[c.estado as RideStatus] ?? 'neutral'}>
                      {RIDE_STATUS_LABEL[c.estado as RideStatus] ?? c.estado}
                    </StatusPill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-[0.06em] text-ink-muted">{titulo}</p>
      <p className="text-lg font-semibold tnum text-ink">{valor}</p>
    </div>
  );
}
