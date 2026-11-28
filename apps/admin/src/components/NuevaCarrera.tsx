import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import {
  AlertTriangle,
  Banknote,
  CarFront,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  MapPin,
  Plus,
  Radar,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import type { Driver, Place, Point, Ride, Servicio, VehicleType } from '@tax/shared';
import {
  MAX_CARRERAS_ACTIVAS,
  MEDIOS_DE_PAGO,
  MEDIO_DE_PAGO_LABEL,
  SERVICIOS,
  conductorPuede,
  resumenDeExigencias,
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABEL,
  buscarLugar,
  crearCarreraOficinaSchema,
  haversineKm,
  normalizarParaBuscar,
  telefonoColombiano,
  tieneNomenclatura,
} from '@tax/shared';
import { Banner, Button, Input, Modal, Select, Textarea, cn, useToast } from '@tax/ui';
import { ApiError, api } from '../api/client';
import { toRideDetail, type ApiRideDetail } from '../api/mappers';
import { usePlaces } from '../api/queries';
import { useLive } from '../live/store';
import { movilDe, rotulo } from '../map/taxis';
import { MapaDeCarrera } from './MapaDeCarrera';
import { leerCoordenadas } from './SelectorDePunto';

/**
 * La carrera de un cliente que llamó o llegó a la oficina (24/11/2026).
 *
 * La operadora la registra aquí y desde ahí sigue el flujo de siempre: la
 * API la crea igual que las de WhatsApp —ubica la dirección con el catálogo
 * o el geocodificador, comprueba el municipio y el cupo del teléfono— y la
 * despacha por oleadas. El conductor nunca crea carreras: la recibe en su
 * teléfono y la acepta.
 *
 * Rehecha el 27/11/2026 para digitar rápido y sin errores, con el cliente al
 * teléfono:
 *  - Letra y campos grandes, en el orden en que se pregunta: celular,
 *    nombre, dirección, pago. Lo que casi nunca cambia queda plegado.
 *  - El celular reconoce al cliente: pone su nombre y ofrece sus últimas
 *    direcciones.
 *  - La dirección sugiere mientras se escribe y se elige con las flechas.
 *  - El mapa va al sitio y muestra los taxis del sector; al aceptar un
 *    conductor, su taxi queda resaltado y la placa en grande.
 *  - Todo con el teclado: Enter crea, Esc cierra.
 */

/** Un campo de la ventana: etiqueta legible y control grande. */
function Campo({
  etiqueta,
  obligatorio,
  ayuda,
  children,
  className,
}: {
  etiqueta: string;
  obligatorio?: boolean;
  ayuda?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 flex items-center gap-1 text-base font-semibold text-ink-secondary">
        {etiqueta}
        {obligatorio ? <span className="text-[var(--t-critical-ink)]">*</span> : null}
      </span>
      {children}
      {ayuda ? <span className="mt-1.5 block text-base text-ink-muted">{ayuda}</span> : null}
    </label>
  );
}

/** En los botones no cabe «Cables de inicio». */
const SERVICIO_CORTO: Record<Servicio, string> = { mascotas: 'Mascota', licorera: 'Licorera', cables: 'Cables' };

const GRANDE = 'h-14 px-4 text-[1.5rem] font-semibold';
const MEDIANO = 'h-12 px-4 text-xl';

function Entrada({ className, ...resto }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={cn(MEDIANO, className)} {...resto} />;
}

/** Varias opciones a la vista, una elegida: se cambia con un clic o con las flechas. */
function Opciones<T extends string>({
  nombre,
  valor,
  onCambiar,
  opciones,
}: {
  nombre: string;
  valor: T;
  onCambiar: (valor: T) => void;
  opciones: { valor: T; texto: string; icono?: ReactNode }[];
}) {
  return (
    <div role="radiogroup" aria-label={nombre} className="flex gap-2">
      {opciones.map((o) => {
        const elegida = o.valor === valor;
        return (
          <label
            key={o.valor}
            className={cn(
              'flex h-12 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border-2 px-2 text-lg font-semibold transition-colors duration-150',
              'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-accent-soft',
              elegida
                ? 'border-ink bg-ink text-on-ink'
                : 'border-line bg-surface text-ink-secondary hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={nombre}
              className="sr-only"
              checked={elegida}
              onChange={() => onCambiar(o.valor)}
            />
            {o.icono}
            {o.texto}
          </label>
        );
      })}
    </div>
  );
}

interface Recogida {
  texto: string;
  referencia: string | null;
  punto: Point | null;
  veces: number;
}

interface ClienteConocido {
  nombre: string | null;
  recogidas: Recogida[];
}

/** Lo que se ofrece bajo la dirección: una recogida anterior o un lugar del catálogo. */
type Sugerencia =
  | { clase: 'reciente'; clave: string; texto: string; detalle: string; recogida: Recogida }
  | { clase: 'lugar'; clave: string; texto: string; detalle: string; lugar: Place };

function distancia(km: number): string {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

export function NuevaCarrera({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const zonas = useLive((s) => s.zones);
  const drivers = useLive((s) => s.drivers);
  const { data: lugares = [] } = usePlaces();

  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');
  const [referencia, setReferencia] = useState('');
  /** El punto que alguien puso a propósito: en el mapa, pegado o de una recogida anterior. */
  const [punto, setPunto] = useState<Point | undefined>();
  const [destino, setDestino] = useState('');
  const [pasajeros, setPasajeros] = useState('1');
  const [tipo, setTipo] = useState<VehicleType>('sedan');
  const [cantidad, setCantidad] = useState('1');
  const [pago, setPago] = useState<(typeof MEDIOS_DE_PAGO)[number]>('efectivo');
  /** `normal` es una carrera corriente; lo demás, un servicio que no presta cualquiera. */
  const [servicio, setServicio] = useState<Servicio | 'normal'>('normal');
  const [notas, setNotas] = useState('');
  const [masDatos, setMasDatos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Las carreras recién creadas, mientras se le dice al cliente qué taxi va. */
  const [creadas, setCreadas] = useState<{ id: string; code: string }[] | null>(null);
  /** Cómo va cada una, para el mapa: dónde es y quién la tomó. */
  const [seguidas, setSeguidas] = useState<Record<string, Ride>>({});

  const campoTelefono = useRef<HTMLInputElement>(null);

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
    setPago('efectivo');
    setServicio('normal');
    setNotas('');
    setMasDatos(false);
    setError(null);
  };

  const cerrar = () => {
    if (guardando) return;
    // El seguimiento es de esta llamada: al cerrar se suelta, y la carrera
    // sigue su curso en «Carreras».
    setCreadas(null);
    setSeguidas({});
    onClose();
  };

  const creadaEn = useRef(0);
  const otraCarrera = () => {
    // El Enter que creó la carrera, repetido, no descarta el seguimiento.
    if (Date.now() - creadaEn.current < 800) return;
    setCreadas(null);
    setSeguidas({});
    window.setTimeout(() => campoTelefono.current?.focus(), 50);
  };

  /* ------------------------------------------------- el cliente que llama */

  const telefonoNormalizado = telefono.trim() ? telefonoColombiano(telefono) : '';
  const telefonoCompleto = /^\+57\d{10}$/.test(telefonoNormalizado);
  const [cliente, setCliente] = useState<ClienteConocido | null>(null);
  const nombreTocado = useRef(false);
  /** El nombre que se rellenó solo, para quitarlo si el teléfono cambia. */
  const nombrePuesto = useRef<string | null>(null);

  useEffect(() => {
    setCliente(null);
    const puesto = nombrePuesto.current;
    if (puesto !== null) {
      nombrePuesto.current = null;
      setNombre((actual) => (actual === puesto ? '' : actual));
    }
    if (!open || !telefonoCompleto) return;
    let vivo = true;
    const espera = window.setTimeout(() => {
      api
        .post<{ cliente: ClienteConocido | null }>('/v1/admin/rides/cliente', { telefono: telefonoNormalizado })
        .then((r) => {
          if (!vivo || !r.cliente) return;
          setCliente(r.cliente);
          // El nombre se pone solo si la operadora no escribió otro.
          if (r.cliente.nombre && !nombreTocado.current) {
            nombrePuesto.current = r.cliente.nombre;
            setNombre(r.cliente.nombre);
          }
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
  }, [open, telefonoCompleto, telefonoNormalizado]);

  /* -------------------------------------------------------- la dirección */

  // Lo mismo que hará la API con la dirección: si nombra un lugar del
  // catálogo, el taxi va a ese punto. Se avisa antes de enviar.
  const lugar = useMemo(
    () => (direccion.trim().length >= 3 ? buscarLugar(direccion, lugares) : null),
    [direccion, lugares],
  );
  const conNomenclatura = tieneNomenclatura(direccion);

  /** Lo que respondió Google para la dirección que hay escrita ahora. */
  const [google, setGoogle] = useState<{ texto: string; punto: Point | null; direccion: string | null } | null>(null);
  const [buscandoEnGoogle, setBuscandoEnGoogle] = useState(false);
  useEffect(() => {
    const texto = direccion.trim();
    if (!open || punto || !conNomenclatura || texto.length < 8) {
      setBuscandoEnGoogle(false);
      return;
    }
    if (google?.texto === texto) {
      setBuscandoEnGoogle(false);
      return;
    }
    let vivo = true;
    setBuscandoEnGoogle(true);
    // Se espera a que deje de escribir: cada consulta nueva le cuesta a la empresa.
    const espera = window.setTimeout(() => {
      api
        .post<{ hallada: { point: Point; direccion: string } | null }>('/v1/admin/rides/ubicar', { text: texto })
        .then((r) => {
          if (vivo) setGoogle({ texto, punto: r.hallada?.point ?? null, direccion: r.hallada?.direccion ?? null });
        })
        .catch(() => {
          if (vivo) setGoogle({ texto, punto: null, direccion: null });
        })
        .finally(() => {
          if (vivo) setBuscandoEnGoogle(false);
        });
    }, 700);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, direccion, punto, conNomenclatura]);

  const deGoogle = google && google.texto === direccion.trim() ? google : null;
  // El mismo orden que usa la API: con nomenclatura manda Google; sin ella, el catálogo.
  const deducido: { punto: Point; origen: 'catalogo' | 'google' } | null = conNomenclatura
    ? deGoogle?.punto
      ? { punto: deGoogle.punto, origen: 'google' }
      : lugar
        ? { punto: lugar.lugar.point, origen: 'catalogo' }
        : null
    : lugar
      ? { punto: lugar.lugar.point, origen: 'catalogo' }
      : null;
  const puntoEnElMapa = punto ?? deducido?.punto;

  /* Las sugerencias: primero lo que ese cliente ya pidió, luego el catálogo. */
  const [listaAbierta, setListaAbierta] = useState(false);
  const [marcada, setMarcada] = useState(-1);
  const sugerencias = useMemo<Sugerencia[]>(() => {
    const buscado = normalizarParaBuscar(direccion);
    const palabras = buscado.split(' ').filter(Boolean);
    const coincide = (texto: string) => {
      const t = normalizarParaBuscar(texto);
      return palabras.every((p) => t.includes(p));
    };
    const recientes: Sugerencia[] = (cliente?.recogidas ?? [])
      .filter((r) => palabras.length === 0 || coincide(r.texto))
      .map((r, i) => ({
        clase: 'reciente',
        clave: `r${i}`,
        texto: r.texto,
        detalle: [r.referencia, r.veces > 1 ? `${r.veces} veces` : 'Ya la pidió'].filter(Boolean).join(' · '),
        recogida: r,
      }));
    const delCatalogo: Sugerencia[] =
      palabras.length === 0 || buscado.length < 2
        ? []
        : lugares
            .filter((l) => coincide(l.name) || l.aliases.some(coincide))
            .sort((a, b) => b.uses - a.uses)
            .slice(0, 6)
            .map((l) => ({ clase: 'lugar', clave: l.id, texto: l.name, detalle: 'Lugar del catálogo', lugar: l }));
    return [...recientes, ...delCatalogo];
  }, [direccion, cliente, lugares]);

  const elegir = (s: Sugerencia) => {
    setDireccion(s.texto);
    if (s.clase === 'reciente') {
      if (s.recogida.referencia && !referencia.trim()) setReferencia(s.recogida.referencia);
      setPunto(s.recogida.punto ?? undefined);
    } else {
      setPunto(undefined);
    }
    setListaAbierta(false);
    setMarcada(-1);
  };

  const alEscribirDireccion = (valor: string) => {
    // Pegar un enlace de Google Maps o unas coordenadas pone el punto, no texto.
    const pegado = leerCoordenadas(valor);
    if (pegado) {
      setPunto(pegado);
      return;
    }
    setDireccion(valor);
    // Si cambia la dirección, el punto que venía con la anterior ya no vale.
    setPunto(undefined);
    setListaAbierta(true);
    setMarcada(-1);
  };

  /* ------------------------------------------------- los taxis del sector */

  const exigencias = { medioPago: pago, servicio: servicio === 'normal' ? null : servicio };
  const queExige = resumenDeExigencias(exigencias);

  const cercanos = useMemo(() => {
    if (!puntoEnElMapa) return [];
    // Solo los que podrían tomarla: con ese medio de pago y ese servicio.
    return drivers
      .filter((d) => d.status === 'AVAILABLE' && d.position && (d.positionAgeSeconds ?? 0) <= 60)
      .filter((d) => conductorPuede(d, exigencias))
      .map((d) => ({ driver: d, km: haversineKm(puntoEnElMapa, d.position!) }))
      .sort((a, b) => a.km - b.km);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, puntoEnElMapa, pago, servicio]);
  const aUnKm = cercanos.filter((c) => c.km <= 1).length;

  /* ------------------------------------------------------------- guardar */

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
    pagoElectronico: pago !== 'efectivo',
    medioPago: pago,
    servicio: servicio === 'normal' ? undefined : servicio,
    notes: notas.trim() || undefined,
  };
  const validacion = crearCarreraOficinaSchema.safeParse(pedido);
  const primerProblema = validacion.success ? null : (validacion.error.issues[0]?.message ?? 'Revisa los datos');

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
      nombreTocado.current = false;
      if (lista.length > 0) {
        // No se cierra: se queda mostrando quién la toma.
        setSeguidas({});
        creadaEn.current = Date.now();
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

  /* --------------------------------------------- el mapa tras crear --- */

  // La que ya tiene taxi manda en el mapa; si ninguna, la primera.
  const enElMapa = creadas
    ? (creadas.map((c) => seguidas[c.id]).find((r) => r?.driverId) ?? seguidas[creadas[0]!.id])
    : undefined;
  const puntoCreado =
    enElMapa?.pickup.point && enElMapa.pickupSource !== 'sin_ubicar' ? enElMapa.pickup.point : undefined;

  return (
    <Modal
      open={open}
      onClose={cerrar}
      width="xl"
      title={creadas ? (creadas.length > 1 ? `${creadas.length} carreras creadas` : 'Carrera creada') : 'Nueva carrera'}
      subtitle={
        creadas
          ? 'Dígale al cliente qué taxi va apenas un conductor acepte. Puede cerrar: la carrera sigue sola.'
          : 'Para un cliente que llamó o llegó a la oficina. Se despacha igual que las de WhatsApp.'
      }
      footer={
        creadas ? (
          <>
            <p className="mr-auto hidden text-base text-ink-muted sm:block">La encuentra después en «Carreras».</p>
            <Button size="lg" onClick={cerrar}>
              Cerrar
            </Button>
            <Button autoFocus variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={otraCarrera}>
              Otra carrera
            </Button>
          </>
        ) : (
          <>
            {falta ? (
              <p className="mr-auto flex items-center gap-2 text-base font-medium text-ink-secondary">
                <AlertTriangle className="size-4 shrink-0" />
                {falta}
              </p>
            ) : (
              <p className="mr-auto hidden text-base text-ink-muted sm:block">
                <kbd className="rounded border border-line px-1.5 font-mono text-caption">Enter</kbd> crea la carrera ·{' '}
                <kbd className="rounded border border-line px-1.5 font-mono text-caption">Tab</kbd> pasa de campo ·{' '}
                <kbd className="rounded border border-line px-1.5 font-mono text-caption">Esc</kbd> cierra
              </p>
            )}
            <Button size="lg" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={<Plus className="size-5" />}
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        {creadas ? (
          <div className="space-y-3">
            {creadas.map((c, i) => (
              <SeguimientoDeCarrera
                key={c.id}
                id={c.id}
                code={c.code}
                titulo={creadas.length > 1 ? `Taxi ${i + 1} de ${creadas.length}` : undefined}
                onCambio={(ride) => setSeguidas((antes) => ({ ...antes, [ride.id]: ride }))}
              />
            ))}
          </div>
        ) : (
          <div
            className="space-y-4"
            onKeyDown={(e) => {
              // Enter crea la carrera desde cualquier campo de una línea; en las
              // notas hace salto de línea. Si otro control ya lo usó —elegir una
              // sugerencia—, no se crea nada.
              const objetivo = e.target as HTMLElement;
              if (e.key !== 'Enter' || e.shiftKey || e.defaultPrevented || objetivo.tagName !== 'INPUT') return;
              e.preventDefault();
              if (!guardando) void guardar();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[13rem_minmax(0,1fr)]">
              <Campo etiqueta="Celular" obligatorio>
                <Input
                  ref={campoTelefono}
                  autoFocus
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="300 123 4567"
                  className={cn(GRANDE, 'tnum')}
                />
              </Campo>
              <Campo etiqueta="Nombre" obligatorio>
                <Input
                  value={nombre}
                  autoComplete="off"
                  onChange={(e) => {
                    // Borrarlo entero deja que el siguiente cliente conocido lo rellene.
                    nombreTocado.current = e.target.value.trim() !== '';
                    nombrePuesto.current = null;
                    setNombre(e.target.value);
                  }}
                  placeholder="María Rodríguez"
                  className={GRANDE}
                />
              </Campo>
            </div>
            {cliente ? (
              <p className="-mt-1 flex items-center gap-2 text-base font-medium text-[var(--t-positive-ink)]">
                <UserCheck className="size-4 shrink-0" />
                Cliente conocido
                {cliente.recogidas.length > 0 ? ': abajo salen sus últimas direcciones.' : '.'}
              </p>
            ) : telefono.trim() && !telefonoCompleto ? (
              <p className="-mt-1 text-base text-ink-muted">Son 10 dígitos y empieza por 3.</p>
            ) : null}

            <Campo etiqueta="Dirección o lugar" obligatorio>
              <div className="relative">
                <Input
                  value={direccion}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={listaAbierta && sugerencias.length > 0}
                  aria-controls="sugerencias-de-direccion"
                  aria-autocomplete="list"
                  onChange={(e) => alEscribirDireccion(e.target.value)}
                  onFocus={() => setListaAbierta(true)}
                  // Con retraso: el clic en una sugerencia ocurre después de perder el foco.
                  onBlur={() => window.setTimeout(() => setListaAbierta(false), 150)}
                  onKeyDown={(e) => {
                    const hay = listaAbierta && sugerencias.length > 0;
                    if (e.key === 'ArrowDown' && sugerencias.length > 0) {
                      e.preventDefault();
                      setListaAbierta(true);
                      setMarcada((i) => (i + 1) % sugerencias.length);
                    } else if (e.key === 'ArrowUp' && hay) {
                      e.preventDefault();
                      setMarcada((i) => (i <= 0 ? sugerencias.length - 1 : i - 1));
                    } else if (e.key === 'Enter' && hay && marcada >= 0) {
                      // Este Enter elige; el de crear la carrera es el siguiente.
                      e.preventDefault();
                      elegir(sugerencias[marcada]!);
                    } else if (e.key === 'Escape' && hay) {
                      // Cierra la lista, no la ventana.
                      e.preventDefault();
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                      setListaAbierta(false);
                      setMarcada(-1);
                    }
                  }}
                  placeholder="Calle 11 # 10-45, o «la terminal»"
                  className={GRANDE}
                />
                {listaAbierta && sugerencias.length > 0 ? (
                  <ul
                    id="sugerencias-de-direccion"
                    role="listbox"
                    className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
                  >
                    {sugerencias.map((s, i) => (
                      <li
                        key={s.clave}
                        role="option"
                        aria-selected={i === marcada}
                        // `mousedown` y no `click`: se adelanta a la pérdida del foco.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          elegir(s);
                        }}
                        // `mousemove` y no `mouseenter`: con el ratón quieto donde se abre
                        // la lista, el Enter elegía la sugerencia de debajo en vez de lo escrito.
                        onMouseMove={() => {
                          if (marcada !== i) setMarcada(i);
                        }}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 px-4 py-2.5',
                          i === marcada ? 'bg-accent-soft' : 'hover:bg-surface-sunk',
                        )}
                      >
                        {s.clase === 'reciente' ? (
                          <History className="size-5 shrink-0 text-ink-muted" />
                        ) : (
                          <MapPin className="size-5 shrink-0 text-ink-muted" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-lg font-semibold text-ink">{s.texto}</span>
                          <span className="block truncate text-base text-ink-muted">{s.detalle}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Campo>
            <EstadoDeLaDireccion
              marcado={Boolean(punto)}
              onQuitar={() => setPunto(undefined)}
              lugar={deducido?.origen === 'catalogo' ? lugar?.lugar.name : undefined}
              google={deducido?.origen === 'google' ? deGoogle?.direccion : undefined}
              buscando={buscandoEnGoogle}
              sinUbicar={
                !punto && !deducido && !buscandoEnGoogle && direccion.trim().length >= 8 && (!conNomenclatura || Boolean(deGoogle))
              }
            />

            <Campo etiqueta="Referencia" ayuda="Lo que ayuda al conductor a encontrar al cliente.">
              <Entrada
                value={referencia}
                autoComplete="off"
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Portón verde, frente a la panadería"
              />
            </Campo>

            <div>
              <p className="mb-1.5 text-base font-semibold text-ink-secondary">¿Cómo paga?</p>
              <Opciones
                nombre="pago"
                valor={pago}
                onCambiar={setPago}
                opciones={MEDIOS_DE_PAGO.map((m) => ({
                  valor: m,
                  texto: MEDIO_DE_PAGO_LABEL[m],
                  icono: m === 'efectivo' ? <Banknote className="size-5" /> : <Smartphone className="size-5" />,
                }))}
              />
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-base font-semibold text-ink-secondary">Servicio</p>
                <Opciones
                  nombre="servicio"
                  valor={servicio}
                  onCambiar={setServicio}
                  opciones={[
                    { valor: 'normal', texto: 'Carrera' },
                    ...SERVICIOS.map((s) => ({ valor: s, texto: SERVICIO_CORTO[s] })),
                  ]}
                />
              </div>
              <div className="max-w-[18rem]">
                <p className="mb-1.5 text-base font-semibold text-ink-secondary">Taxis</p>
                <Opciones
                  nombre="taxis"
                  valor={cantidad}
                  onCambiar={setCantidad}
                  opciones={Array.from({ length: MAX_CARRERAS_ACTIVAS }, (_, i) => ({
                    valor: String(i + 1),
                    texto: String(i + 1),
                  }))}
                />
              </div>
            </div>
            {queExige ? (
              <p className="-mt-1 text-base text-ink-muted">Solo se ofrece a los conductores con {queExige}.</p>
            ) : null}

            <div className="rounded-md border border-line">
              <button
                type="button"
                onClick={() => setMasDatos((v) => !v)}
                aria-expanded={masDatos}
                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-base font-semibold text-ink-secondary hover:bg-surface-sunk"
              >
                <span>
                  Más datos
                  <span className="ml-2 font-normal text-ink-muted">
                    {pasajeros} {pasajeros === '1' ? 'pasajero' : 'pasajeros'} · {VEHICLE_TYPE_LABEL[tipo]}
                    {destino.trim() ? ' · con destino' : ''}
                    {notas.trim() ? ' · con notas' : ''}
                  </span>
                </span>
                <ChevronDown className={cn('size-5 shrink-0 transition-transform', masDatos && 'rotate-180')} />
              </button>
              {masDatos ? (
                <div className="space-y-3 border-t border-line p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo etiqueta="Pasajeros">
                      <Entrada type="number" min={1} max={8} value={pasajeros} onChange={(e) => setPasajeros(e.target.value)} />
                    </Campo>
                    <Campo etiqueta="Vehículo">
                      <Select value={tipo} onChange={(e) => setTipo(e.target.value as VehicleType)} className={MEDIANO}>
                        {VEHICLE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {VEHICLE_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  </div>
                  <Campo etiqueta="Destino" ayuda="Opcional. Si no se sabe, se toma de donde finalice el conductor.">
                    <Entrada value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Hospital Regional" />
                  </Campo>
                  <Campo etiqueta="Notas para el conductor">
                    <Textarea
                      rows={2}
                      maxLength={280}
                      value={notas}
                      onChange={(e) => setNotas(e.target.value)}
                      className="text-lg"
                    />
                  </Campo>
                </div>
              ) : null}
            </div>

            {error ? (
              <Banner tone="critical" icon={<AlertTriangle className="size-5" />}>
                <span className="text-lg">{error}</span>
              </Banner>
            ) : null}
          </div>
        )}

        <div className="flex min-h-[26rem] flex-col gap-3">
          <MapaDeCarrera
            punto={creadas ? puntoCreado : puntoEnElMapa}
            provisional={!creadas && !punto}
            onMarcar={creadas ? undefined : setPunto}
            zonas={zonas}
            drivers={drivers}
            resaltado={creadas ? (enElMapa?.driverId ?? null) : null}
            className="min-h-80 flex-1"
          />
          {creadas ? null : (
            <TaxisDelSector
              hayPunto={Boolean(puntoEnElMapa)}
              aUnKm={aUnKm}
              cercanos={cercanos.slice(0, 4)}
              queExige={queExige}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Qué pasó con la dirección: de dónde salió el punto, o que no se pudo ubicar. */
function EstadoDeLaDireccion({
  marcado,
  onQuitar,
  lugar,
  google,
  buscando,
  sinUbicar,
}: {
  marcado: boolean;
  onQuitar: () => void;
  lugar?: string;
  google?: string | null;
  buscando: boolean;
  sinUbicar: boolean;
}) {
  const base = '-mt-2 flex items-center gap-2 text-base font-medium';
  if (marcado) {
    return (
      <p className={cn(base, 'text-[var(--t-positive-ink)]')}>
        <MapPin className="size-4 shrink-0" />
        Punto fijado: el taxi va justo ahí.
        <button type="button" onClick={onQuitar} className="font-semibold underline underline-offset-2">
          Quitar
        </button>
      </p>
    );
  }
  if (buscando) {
    return (
      <p className={cn(base, 'text-ink-muted')}>
        <Loader2 className="size-4 shrink-0 animate-spin" />
        Buscando la dirección…
      </p>
    );
  }
  if (lugar) {
    return (
      <p className={cn(base, 'text-[var(--t-positive-ink)]')}>
        <CheckCircle2 className="size-4 shrink-0" />
        Es «{lugar}» del catálogo: el taxi va a ese punto.
      </p>
    );
  }
  if (google) {
    return (
      <p className={cn(base, 'text-[var(--t-positive-ink)]')}>
        <CheckCircle2 className="size-4 shrink-0" />
        <span className="truncate">Ubicada: {google}</span>
      </p>
    );
  }
  if (sinUbicar) {
    return (
      <p className={cn(base, 'text-[var(--t-warning-ink)]')}>
        <AlertTriangle className="size-4 shrink-0" />
        No se ubicó en el mapa. Puede marcar el punto con un clic, o crearla así: el conductor lee la dirección.
      </p>
    );
  }
  return null;
}

/** Bajo el mapa: cuántos taxis libres hay cerca y cuáles son. */
function TaxisDelSector({
  hayPunto,
  aUnKm,
  cercanos,
  queExige,
}: {
  hayPunto: boolean;
  aUnKm: number;
  cercanos: { driver: Driver; km: number }[];
  /** «Nequi · Lleva mascota»: lo que achica la lista de taxis que sirven. */
  queExige: string;
}) {
  const con = queExige ? ` con ${queExige}` : '';
  if (!hayPunto) {
    return (
      <p className="rounded-md bg-surface-sunk px-4 py-3 text-base text-ink-muted">
        Al escribir la dirección, el mapa va al sitio y muestra los taxis disponibles de ese sector. Un clic en el mapa
        fija el punto exacto.
      </p>
    );
  }
  if (cercanos.length === 0) {
    return (
      <p className="tone-warning rounded-md border border-[var(--tone-line)] bg-[var(--tone-bg)] px-4 py-3 text-lg font-semibold text-[var(--tone-ink)]">
        No hay taxis disponibles{con} con señal en este momento.
      </p>
    );
  }
  return (
    <div className="rounded-md bg-surface-sunk px-4 py-3">
      <p className="text-lg font-semibold text-ink">
        {aUnKm === 0
          ? `Ningún taxi disponible${con} a menos de 1 km`
          : `${aUnKm} ${aUnKm === 1 ? 'taxi disponible' : 'taxis disponibles'}${con} a menos de 1 km`}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {cercanos.map(({ driver, km }) => (
          <li
            key={driver.id}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-base"
          >
            <span className="size-2.5 rounded-full bg-[var(--t-positive-solid)]" />
            <span className="tnum font-semibold text-ink">{rotulo(driver)}</span>
            <span className="tnum text-ink-muted">{distancia(km)}</span>
          </li>
        ))}
      </ul>
    </div>
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
function SeguimientoDeCarrera({
  id,
  code,
  titulo,
  onCambio,
}: {
  id: string;
  code: string;
  titulo?: string;
  onCambio?: (ride: Ride) => void;
}) {
  const drivers = useLive((s) => s.drivers);
  const [ride, setRide] = useState<Ride | null>(null);
  const [desde] = useState(() => Date.now());
  const [ahora, setAhora] = useState(() => Date.now());
  const avisar = useRef(onCambio);
  avisar.current = onCambio;

  const estado = ride?.status;
  const buscando = !estado || BUSCANDO.includes(estado) || estado === 'UNASSIGNED';
  // Con taxi en camino se sigue mirando, más despacio: si el conductor la
  // suelta, la ventana no puede seguir mostrando su placa.
  const enCamino = estado === 'ASSIGNED' || estado === 'DRIVER_ARRIVED';
  const sigueViva = buscando || enCamino;

  useEffect(() => {
    let vivo = true;
    const leer = () =>
      api
        .get<ApiRideDetail>(`/v1/admin/rides/${id}`)
        .then((fila) => {
          if (!vivo) return;
          // La API responde con su forma plana; el panel trabaja con `Ride`.
          const datos = toRideDetail(fila);
          setRide(datos);
          avisar.current?.(datos);
        })
        .catch(() => undefined);
    void leer();
    if (!sigueViva) return () => { vivo = false; };
    const cada = window.setInterval(() => void leer(), buscando ? 2500 : 5000);
    const reloj = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => {
      vivo = false;
      window.clearInterval(cada);
      window.clearInterval(reloj);
    };
  }, [id, sigueViva, buscando]);

  const driver = ride?.driverId ? drivers.find((d) => d.id === ride.driverId) : undefined;
  const movil = driver ? movilDe(driver) : null;
  const segundos = Math.max(0, Math.round((ahora - desde) / 1000));
  const conAviso = ride?.offers?.filter((o) => o.response === 'pending').length ?? 0;
  const ronda = ride?.waveLog?.at(-1);

  const cabecera = (
    <p className="flex items-center justify-between gap-3 text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">
      <span>{titulo ?? 'Carrera'}</span>
      <span className="font-mono normal-case tracking-normal">{code}</span>
    </p>
  );

  if (estado && CON_TAXI.includes(estado)) {
    const llega = ride?.etaMinutes ? (ride.etaMinutes === 1 ? '1 min' : `unos ${ride.etaMinutes} min`) : null;
    return (
      <div className="tone-positive space-y-3 rounded-lg border-2 border-[var(--tone-line)] bg-[var(--tone-bg)] px-5 py-4">
        {cabecera}
        <p className="flex items-center gap-2 text-xl font-bold text-[var(--tone-ink)]">
          <CarFront className="size-6" />
          Taxi asignado
        </p>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          {movil ? (
            <div>
              <p className="text-base text-ink-muted">Móvil</p>
              <p className="tnum text-[3.25rem] font-bold leading-none text-ink">{movil}</p>
            </div>
          ) : null}
          <div>
            <p className="text-base text-ink-muted">Placa</p>
            <p className="tnum text-[3.25rem] font-bold leading-none tracking-wide text-ink">
              {driver?.vehicle.plate ?? '—'}
            </p>
          </div>
          {llega ? (
            <div>
              <p className="text-base text-ink-muted">Llega en</p>
              <p className="tnum text-[2rem] font-bold leading-none text-ink">{llega}</p>
            </div>
          ) : null}
        </div>
        <p className="text-xl font-semibold text-ink">
          {driver?.name ?? 'Cargando…'}
          {driver?.code ? <span className="ml-2 font-normal text-ink-muted">· código {driver.code}</span> : null}
        </p>
        <p className="rounded-md bg-surface px-4 py-3 text-lg text-ink-secondary">
          Para decirle al cliente: «Va el taxi de placa {driver?.vehicle.plate ?? '…'}
          {driver?.name ? `, conductor ${driver.name}` : ''}
          {ride?.etaMinutes ? (ride.etaMinutes === 1 ? ', llega en un minuto' : `, llega en unos ${ride.etaMinutes} minutos`) : ''}».
        </p>
      </div>
    );
  }

  if (estado === 'CANCELLED') {
    return (
      <div className="space-y-1 rounded-lg border border-line px-5 py-4">
        {cabecera}
        <p className="text-xl text-ink">La carrera se canceló.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-sunk px-5 py-4">
      {cabecera}
      <p className="flex items-center gap-2 text-xl font-bold text-ink">
        <Radar className="size-6 animate-pulse" />
        Buscando taxi… <span className="tnum font-normal text-ink-muted">{segundos} s</span>
      </p>
      <p className="text-lg text-ink-secondary">
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
