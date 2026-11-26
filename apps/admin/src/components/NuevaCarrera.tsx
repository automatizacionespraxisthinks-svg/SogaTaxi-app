import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CarFront, CheckCircle2, MapPin, Plus, Radar } from 'lucide-react';
import type { Point, Ride, VehicleType } from '@tax/shared';
import {
  MAX_CARRERAS_ACTIVAS,
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABEL,
  buscarLugar,
  crearCarreraOficinaSchema,
  telefonoColombiano,
} from '@tax/shared';
import { Banner, Button, Field, Input, Modal, SectionLabel, Select, Switch, Textarea, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { usePlaces } from '../api/queries';
import { useLive } from '../live/store';
import { SelectorDePunto } from './SelectorDePunto';

/**
 * La carrera de un cliente que llamó o llegó a la oficina (24/11/2026).
 *
 * La operadora la registra aquí y desde ahí sigue el flujo de siempre: la
 * API la crea igual que las de WhatsApp —ubica la dirección con el catálogo
 * o el geocodificador, comprueba el municipio y el cupo del teléfono— y la
 * despacha por oleadas. El conductor nunca crea carreras: la recibe en su
 * teléfono y la acepta.
 *
 * El punto en el mapa es opcional. Sin él la dirección se ubica sola, como
 * las de WhatsApp; con él, el taxi va al metro que se marcó.
 *
 * Al crearla la ventana no se cierra: pasa a mostrar la búsqueda en vivo y,
 * apenas un conductor acepta, la placa y el nombre en grande (26/11/2026).
 * El cliente está al teléfono y la operadora tiene que decirle qué taxi va;
 * antes había que cerrar, ir a Carreras y abrir la ficha para saberlo.
 */
export function NuevaCarrera({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const zonas = useLive((s) => s.zones);
  const { data: lugares = [] } = usePlaces();

  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [punto, setPunto] = useState<Point | undefined>();
  const [destino, setDestino] = useState('');
  const [pasajeros, setPasajeros] = useState('1');
  const [tipo, setTipo] = useState<VehicleType>('sedan');
  const [cantidad, setCantidad] = useState('1');
  const [pagoElectronico, setPagoElectronico] = useState(false);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Las carreras recién creadas, mientras se le dice al cliente qué taxi va. */
  const [creadas, setCreadas] = useState<{ id: string; code: string }[] | null>(null);

  const reiniciar = () => {
    setTelefono('');
    setNombre('');
    setDireccion('');
    setReferencia('');
    setPunto(undefined);
    setDestino('');
    setPasajeros('1');
    setTipo('sedan');
    setCantidad('1');
    setPagoElectronico(false);
    setNotas('');
    setError(null);
  };

  const cerrar = () => {
    if (guardando) return;
    // El seguimiento es de esta llamada: al cerrar se suelta, y la carrera
    // sigue su curso en «Carreras».
    setCreadas(null);
    onClose();
  };

  const pedido = {
    customerPhone: telefono,
    customerName: nombre,
    pickup: {
      text: direccion.trim(),
      reference: referencia.trim() || undefined,
      point: punto,
    },
    dropoff: destino.trim() ? { text: destino.trim() } : undefined,
    vehicleType: tipo,
    passengers: pasajeros,
    cantidad,
    pagoElectronico,
    notes: notas.trim() || undefined,
  };
  const validacion = crearCarreraOficinaSchema.safeParse(pedido);
  const primerProblema = validacion.success ? null : (validacion.error.issues[0]?.message ?? 'Revisa los datos');

  // Lo mismo que hará la API con la dirección: si nombra un lugar del
  // catálogo, el taxi va a ese punto. Se avisa antes de enviar.
  const lugar = useMemo(
    () => (direccion.trim().length >= 3 ? buscarLugar(direccion, lugares) : null),
    [direccion, lugares],
  );

  const telefonoNormalizado = telefono.trim() ? telefonoColombiano(telefono) : '';

  // Si ya se empezó a llenar y falta algo, se dice qué: con el botón apagado
  // y sin explicación, la operadora no sabía por qué no podía crearla.
  const empezado = Boolean(telefono.trim() || nombre.trim() || direccion.trim());
  const CAMPO: Record<string, string> = {
    customerPhone: 'Celular',
    customerName: 'Nombre',
    pickup: 'Dirección o lugar',
    dropoff: 'Destino',
    passengers: 'Pasajeros',
    cantidad: 'Taxis',
    notes: 'Notas',
  };
  const primerFallo = validacion.success ? undefined : validacion.error.issues[0];
  const campoQueFalta = primerFallo ? CAMPO[String(primerFallo.path[0])] : undefined;
  // «Dirección o lugar: escribe al menos 3 caracteres»: el mensaje solo no
  // decía de qué campo hablaba.
  const falta =
    empezado && primerFallo
      ? `${campoQueFalta ? `${campoQueFalta}: ` : ''}${primerFallo.message.charAt(0).toLowerCase()}${primerFallo.message.slice(1)}`
      : null;

  // Los lugares del catálogo, del más pedido al menos, como sugerencias
  // mientras se escribe la dirección: «terminal», «hospital».
  const sugerencias = useMemo(() => [...lugares].sort((a, b) => b.uses - a.uses).slice(0, 200), [lugares]);

  const guardar = async () => {
    if (!validacion.success) {
      setError(primerProblema);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const creada = await api.post<{
        id?: string;
        code?: string;
        cantidad?: number;
        rides?: { id: string; code: string }[];
      }>('/v1/admin/rides', validacion.data);
      const lista = creada.rides?.length ? creada.rides : creada.id ? [{ id: creada.id, code: creada.code ?? '' }] : [];
      reiniciar();
      if (lista.length > 0) {
        // No se cierra: se queda mostrando quién la toma.
        setCreadas(lista.map((r) => ({ id: r.id, code: r.code })));
      } else {
        toast.push({ tone: 'positive', title: 'Carrera creada', description: 'Ya está buscando taxi.' });
        onClose();
      }
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo crear. Revisa la conexión y vuelve a intentarlo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={cerrar}
      width="lg"
      title={creadas ? (creadas.length > 1 ? `${creadas.length} carreras creadas` : 'Carrera creada') : 'Nueva carrera'}
      subtitle={
        creadas
          ? 'Dígale al cliente qué taxi va apenas un conductor acepte. Puede cerrar: la carrera sigue sola.'
          : 'Para un cliente que llamó o llegó a la oficina. Se despacha igual que las de WhatsApp.'
      }
      footer={
        creadas ? (
          <>
            <p className="mr-auto hidden text-micro text-ink-muted sm:block">
              La encuentra después en «Carreras».
            </p>
            <Button size="lg" onClick={cerrar}>
              Cerrar
            </Button>
            <Button variant="primary" size="lg" icon={<Plus className="size-4" />} onClick={() => setCreadas(null)}>
              Otra carrera
            </Button>
          </>
        ) : (
        <>
          {falta ? (
            <p className="mr-auto flex items-center gap-1.5 text-caption text-ink-secondary">
              <AlertTriangle className="size-3.5 shrink-0" />
              {falta}
            </p>
          ) : (
            <p className="mr-auto hidden text-micro text-ink-muted sm:block">Enter crea la carrera · Esc cierra</p>
          )}
          <Button size="lg" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Plus className="size-4" />}
            loading={guardando}
            disabled={!validacion.success}
            onClick={() => void guardar()}
          >
            Crear y despachar
          </Button>
        </>
        )
      }
    >
      {creadas ? (
        <div className="space-y-3">
          {creadas.map((c, i) => (
            <SeguimientoDeCarrera
              key={c.id}
              id={c.id}
              code={c.code}
              titulo={creadas.length > 1 ? `Taxi ${i + 1} de ${creadas.length}` : undefined}
            />
          ))}
        </div>
      ) : (
      <div
        className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
        onKeyDown={(e) => {
          // Enter crea la carrera desde cualquier campo de una línea; en las
          // notas hace salto de línea, y en una lista desplegable la elige.
          const destino = e.target as HTMLElement;
          if (e.key !== 'Enter' || e.shiftKey || destino.tagName !== 'INPUT') return;
          e.preventDefault();
          if (!guardando) void guardar();
        }}
      >
        <div className="space-y-4">
          <SectionLabel>Cliente</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Celular"
              required
              hint={
                telefonoNormalizado && telefonoNormalizado !== telefono.trim() ? `Se guarda como ${telefonoNormalizado}` : undefined
              }
            >
              <Input
                autoFocus
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="300 123 4567"
              />
            </Field>
            <Field label="Nombre" required>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="María Rodríguez" />
            </Field>
          </div>

          <SectionLabel>Recogida</SectionLabel>
          <Field label="Dirección o lugar" required>
            <Input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Calle 11 # 10-45, o «la terminal»"
              list="lugares-del-catalogo"
              autoComplete="off"
            />
          </Field>
          <datalist id="lugares-del-catalogo">
            {sugerencias.map((l) => (
              <option key={l.id} value={l.name} />
            ))}
          </datalist>
          {lugar ? (
            <p className="-mt-2 flex items-center gap-1.5 text-caption text-[var(--t-positive-ink)]">
              <CheckCircle2 className="size-3.5" />
              Es «{lugar.lugar.name}» del catálogo: el taxi va a ese punto.
            </p>
          ) : null}
          <Field label="Referencia" hint="Lo que ayuda al conductor a encontrar al cliente.">
            <Input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Portón verde, frente a la panadería"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Pasajeros">
              <Input type="number" min={1} max={8} value={pasajeros} onChange={(e) => setPasajeros(e.target.value)} />
            </Field>
            <Field label="Vehículo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as VehicleType)}>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Taxis" hint={`Hasta ${MAX_CARRERAS_ACTIVAS}, al mismo punto.`}>
              <Input
                type="number"
                min={1}
                max={MAX_CARRERAS_ACTIVAS}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Field>
          </div>

          <Switch
            checked={pagoElectronico}
            onChange={setPagoElectronico}
            label="Paga con pago electrónico (solo se ofrece a quien lo acepta)"
          />

          <Field label="Destino" hint="Opcional. Si no se sabe, se toma de donde finalice el conductor.">
            <Input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Hospital Regional" />
          </Field>
          <Field label="Notas para el conductor">
            <Textarea rows={2} maxLength={280} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </Field>

          {error ? (
            <Banner tone="critical" icon={<AlertTriangle className="size-4" />}>
              {error}
            </Banner>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>Punto exacto (opcional)</SectionLabel>
          <SelectorDePunto valor={punto} onCambiar={setPunto} zonas={zonas} className="min-h-96 flex-1" />
          {punto ? (
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
                <MapPin className="size-3.5" />
                El taxi va a este punto; la dirección queda como texto para el conductor.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPunto(undefined)}>
                Quitar punto
              </Button>
            </div>
          ) : (
            <p className="text-caption text-ink-muted">
              Sin punto, la dirección se ubica sola con el catálogo o Google, como las de WhatsApp.
            </p>
          )}
        </div>
      </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ seguimiento --- */

const BUSCANDO: Ride['status'][] = ['PENDING', 'NOTIFIED'];
const CON_TAXI: Ride['status'][] = ['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

/**
 * Una carrera recién creada, en vivo: la búsqueda y, cuando alguien acepta,
 * el taxi que va, en grande, para leérselo al cliente por teléfono.
 *
 * Pregunta a la API cada pocos segundos mientras busca, en vez de depender
 * del listado en vivo: la carrera acaba de nacer y puede no estar todavía en
 * él, y aquí lo que importa es no fallar el momento en que alguien acepta.
 */
function SeguimientoDeCarrera({ id, code, titulo }: { id: string; code: string; titulo?: string }) {
  const drivers = useLive((s) => s.drivers);
  const [ride, setRide] = useState<Ride | null>(null);
  const [desde] = useState(() => Date.now());
  const [ahora, setAhora] = useState(() => Date.now());

  const estado = ride?.status;
  const sigueViva = !estado || BUSCANDO.includes(estado) || estado === 'UNASSIGNED';

  useEffect(() => {
    let vivo = true;
    const leer = () =>
      api
        .get<Ride>(`/v1/admin/rides/${id}`)
        .then((datos) => {
          if (vivo) setRide(datos);
        })
        .catch(() => undefined);
    void leer();
    if (!sigueViva) return () => { vivo = false; };
    const cada = window.setInterval(() => void leer(), 2500);
    const reloj = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => {
      vivo = false;
      window.clearInterval(cada);
      window.clearInterval(reloj);
    };
  }, [id, sigueViva]);

  const driver = ride?.driverId ? drivers.find((d) => d.id === ride.driverId) : undefined;
  const segundos = Math.max(0, Math.round((ahora - desde) / 1000));
  const conAviso = ride?.offers?.filter((o) => o.response === 'pending').length ?? 0;
  const ronda = ride?.waveLog?.at(-1);

  const cabecera = (
    <p className="flex items-center justify-between gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-muted">
      <span>{titulo ?? 'Carrera'}</span>
      <span className="font-mono normal-case tracking-normal">{code}</span>
    </p>
  );

  if (estado && CON_TAXI.includes(estado)) {
    return (
      <div className="tone-positive space-y-2 rounded-md border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3">
        {cabecera}
        <p className="flex items-center gap-2 text-base font-semibold text-[var(--tone-ink)]">
          <CarFront className="size-4" />
          Taxi asignado
        </p>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <p className="text-micro text-ink-muted">Placa</p>
            <p className="tnum text-[2.5rem] font-bold leading-none tracking-wide text-ink">
              {driver?.vehicle.plate ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-micro text-ink-muted">Conductor</p>
            <p className="text-title font-semibold text-ink">{driver?.name ?? 'Cargando…'}</p>
          </div>
          {driver?.code ? (
            <div>
              <p className="text-micro text-ink-muted">Código</p>
              <p className="tnum text-title font-semibold text-ink">{driver.code}</p>
            </div>
          ) : null}
          {ride?.etaMinutes ? (
            <div>
              <p className="text-micro text-ink-muted">Llega en</p>
              <p className="tnum text-title font-semibold text-ink">{ride.etaMinutes === 1 ? '1 min' : `unos ${ride.etaMinutes} min`}</p>
            </div>
          ) : null}
        </div>
        <p className="text-caption text-ink-secondary">
          Para decirle al cliente: «Va el taxi de placa {driver?.vehicle.plate ?? '…'}
          {driver?.name ? `, conductor ${driver.name}` : ''}
          {ride?.etaMinutes ? (ride.etaMinutes === 1 ? ', llega en un minuto' : `, llega en unos ${ride.etaMinutes} minutos`) : ''}».
        </p>
      </div>
    );
  }

  if (estado === 'CANCELLED') {
    return (
      <div className="space-y-1 rounded-md border border-line px-4 py-3">
        {cabecera}
        <p className="text-base text-ink">La carrera se canceló.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-sunk px-4 py-3">
      {cabecera}
      <p className="flex items-center gap-2 text-base font-semibold text-ink">
        <Radar className="size-4 animate-pulse" />
        Buscando taxi… <span className="tnum font-normal text-ink-muted">{segundos} s</span>
      </p>
      <p className="text-caption text-ink-secondary">
        {estado === 'UNASSIGNED'
          ? 'Nadie la ha tomado todavía. Se vuelve a ofrecer sola; aquí aparece el taxi apenas alguien acepte.'
          : conAviso > 0
            ? `${conAviso} ${conAviso === 1 ? 'taxi tiene' : 'taxis tienen'} el aviso ahora${
                ronda ? ` · ${ronda.wave === 4 ? 'los más cercanos que hay' : `ronda ${ronda.wave}, hasta ${ronda.radiusKm} km`}` : ''
              }.`
            : 'Avisando a los taxis más cercanos.'}
      </p>
    </div>
  );
}
