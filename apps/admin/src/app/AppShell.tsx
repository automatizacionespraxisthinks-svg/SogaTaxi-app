import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  Ban,
  BarChart3,
  BellRing,
  CircleDot,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Route as RouteIcon,
  ServerCog,
  Smartphone,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { WAHA_STATUS_LABEL, WAHA_STATUS_TONE, formatTime, type Permiso, type StatusTone } from '@tax/shared';
import { Banner, LiveDot, StatusPill, cn, spring, transition } from '@tax/ui';
import { actions, useLive, type AlertaRecibida } from '../live/store';
import { api } from '../api/client';
import { useAvisosDeFlota, usePuede, useSesion } from '../api/queries';
import { CambiarClave } from '../components/CambiarClave';
import { NuevaCarrera } from '../components/NuevaCarrera';
import { GeocodificadorCaido, IndicadorDeDirecciones } from '../components/Geocodificador';
import logo from '../assets/logo-sogataxi.png';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Se enseña si el rol tiene alguno de estos. Sin lista, todos lo ven. */
  permisos?: Permiso[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Operación', icon: LayoutGrid, end: true },
  { to: '/carreras', label: 'Carreras', icon: RouteIcon },
  { to: '/flota', label: 'Flota', icon: Users },
  { to: '/zonas', label: 'Zonas', icon: Map },
  { to: '/avisos', label: 'Avisos', icon: BellRing },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, permisos: ['reportes.ver'] },
  {
    to: '/sistema',
    label: 'Sistema',
    icon: ServerCog,
    permisos: ['usuarios.gestionar', 'roles.gestionar', 'auditoria.ver'],
  },
];

const TITLES: Record<string, string> = {
  '/': 'Operación',
  '/carreras': 'Carreras',
  '/flota': 'Flota',
  '/zonas': 'Zonas',
  '/avisos': 'Avisos de la flota',
  '/reportes': 'Reportes',
  '/sistema': 'Sistema',
};

export function AppShell({ children, userName }: { children: ReactNode; userName: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const connected = useLive((s) => s.connected);
  const unassigned = useLive((s) => s.rides.filter((r) => r.status === 'UNASSIGNED').length);
  const pending = useLive((s) => s.rides.filter((r) => r.status === 'PENDING' || r.status === 'NOTIFIED').length);

  /*
   * Los avisos rojos se pueden quitar (26/11/2026): tapaban la pantalla
   * mientras la operadora atendía otra cosa. Quitarlos no los apaga para
   * siempre: vuelven si la situación empeora o se repite.
   *  - «Sin conexión»: vuelve en la siguiente caída.
   *  - «Sin asignar»: vuelve cuando hay más carreras sin asignar que las que
   *    había al quitarlo.
   */
  const [sinConexionOculto, setSinConexionOculto] = useState(false);
  useEffect(() => {
    if (connected) setSinConexionOculto(false);
  }, [connected]);
  const [sinAsignarVistas, setSinAsignarVistas] = useState(0);
  useEffect(() => {
    // Si bajan, el listón baja con ellas: la próxima que quede sin asignar avisa.
    if (unassigned < sinAsignarVistas) setSinAsignarVistas(unassigned);
  }, [unassigned, sinAsignarVistas]);

  const title = TITLES[`/${location.pathname.split('/')[1] ?? ''}`] ?? TITLES[location.pathname] ?? 'Operación';

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        pending={pending}
        userName={userName}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />

        <AnimatePresence>
          {!connected && !sinConexionOculto ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition.base}
              className="overflow-hidden px-5"
            >
              <Banner
                tone="critical"
                icon={<WifiOff className="size-4" />}
                className="mt-3"
                action={<QuitarAviso onClick={() => setSinConexionOculto(true)} />}
              >
                Sin conexión con el servidor. Las acciones quedan en espera y se reintentan al volver.
              </Banner>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {unassigned > sinAsignarVistas ? (
          <div className="px-5 pt-3">
            <Banner
              tone="critical"
              icon={<CircleDot className="size-4" />}
              action={
                <span className="flex items-center gap-1">
                  <NavLink
                    to="/carreras"
                    className="text-caption font-medium underline underline-offset-2"
                  >
                    Ver carreras
                  </NavLink>
                  <QuitarAviso onClick={() => setSinAsignarVistas(unassigned)} />
                </span>
              }
            >
              <span className="font-medium">
                {unassigned} {unassigned === 1 ? 'carrera sin asignar' : 'carreras sin asignar'}
              </span>{' '}
              tras agotar las oleadas.
            </Banner>
          </div>
        ) : null}

        <LineasCaidas />
        <GeocodificadorCaido />
        <AvisosSueltos />

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- avisos --- */

/** La X de un aviso: lo quita de la pantalla hasta que la situación cambie. */
function QuitarAviso({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Quitar este aviso"
      title="Quitar este aviso"
      className="grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-150 hover:bg-black/15 focus-visible:outline-2 focus-visible:outline-current"
    >
      <X className="size-4" />
    </button>
  );
}

/**
 * Una o más líneas de WhatsApp que no atienden. Es un estado, no un aviso:
 * se queda mientras dure y se va sola cuando el monitor la ve volver. La
 * caída en sí suena una vez (`sonarAlarma`), pero lo que hay que resolver
 * tiene que seguir a la vista aunque nadie estuviera mirando en ese momento.
 */
function LineasCaidas() {
  const sesiones = useLive((s) => s.wahaSessions);
  const caidas = sesiones.filter((sesion) => !sesion.connected);
  const huella = caidas.map((sesion) => sesion.id).sort().join('|');
  const [quitado, setQuitado] = useState('');
  if (caidas.length === 0 || quitado === huella) return null;

  const [primera] = caidas;
  return (
    <div className="px-5 pt-3">
      <Banner
        tone="critical"
        icon={<Smartphone className="size-4" />}
        action={
          <span className="flex items-center gap-1">
            <NavLink to="/sistema" className="text-caption font-medium underline underline-offset-2">
              Ver líneas
            </NavLink>
            <QuitarAviso onClick={() => setQuitado(huella)} />
          </span>
        }
      >
        <span className="font-medium">
          {caidas.length === 1
            ? `La línea ${primera!.label} no está atendiendo`
            : `${caidas.length} líneas de WhatsApp no están atendiendo`}
        </span>{' '}
        ({[...new Set(caidas.map((sesion) => WAHA_STATUS_LABEL[sesion.status]))].join(', ')}). Los
        clientes que escriban a {caidas.length === 1 ? 'ese número' : 'esos números'} no reciben
        respuesta.
      </Banner>
    </div>
  );
}

const TONO_AVISO: Record<AlertaRecibida['kind'], StatusTone> = {
  no_driver: 'critical',
  line_down: 'critical',
  line_up: 'positive',
  outbox_stuck: 'warning',
  driver_no_gps: 'warning',
  // El cliente se quedó sin taxi: alguien tiene que llamarlo o pedirle otro.
  driver_cancelled: 'critical',
};

/** Una línea que vuelve se anuncia y el aviso se cierra solo. */
const CIERRE_LINEA_RECUPERADA_MS = 15_000;

/**
 * Los avisos del servidor que no tienen ya su propio letrero. La caída de una
 * línea y la carrera sin conductor no salen aquí: suenan, y su estado ya lo
 * pintan «LineasCaidas» y el letrero de carreras sin asignar. Repetirlos
 * apilaría dos letreros rojos para lo mismo.
 */
function AvisosSueltos() {
  const alerts = useLive((s) => s.alerts);
  const visibles = alerts.filter((a) => a.kind !== 'line_down' && a.kind !== 'no_driver');

  useEffect(() => {
    const temporizadores = alerts
      .filter((a) => a.kind === 'line_up')
      .map((a) =>
        window.setTimeout(
          () => actions.dismissAlert(a.id),
          Math.max(0, CIERRE_LINEA_RECUPERADA_MS - (Date.now() - a.at)),
        ),
      );
    return () => temporizadores.forEach((t) => window.clearTimeout(t));
  }, [alerts]);

  if (visibles.length === 0) return null;
  return (
    <div className="space-y-2 px-5 pt-3">
      <AnimatePresence initial={false}>
        {visibles.map((alerta) => (
          <Banner
            key={alerta.id}
            tone={TONO_AVISO[alerta.kind]}
            icon={
              alerta.kind === 'line_up' ? (
                <Smartphone className="size-4" />
              ) : alerta.kind === 'driver_cancelled' ? (
                <Ban className="size-4" />
              ) : (
                <CircleDot className="size-4" />
              )
            }
            action={
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => actions.dismissAlert(alerta.id)}
                className="rounded p-0.5 opacity-70 hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            }
          >
            {alerta.message}{' '}
            <time className="tnum text-caption opacity-80">{formatTime(new Date(alerta.at))}</time>
          </Banner>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ----------------------------------------------------------- barra lateral --- */

function Sidebar({
  collapsed,
  onToggle,
  pending,
  userName,
}: {
  collapsed: boolean;
  onToggle: () => void;
  pending: number;
  userName: string;
}) {
  const puede = usePuede();
  const rol = useSesion().data?.user.roleName;
  // El número del menú: solo lo vencido, que es lo que no puede esperar.
  const avisosUrgentes = useAvisosDeFlota().data?.urgentes ?? 0;
  const initials = userName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <motion.aside
      animate={{ width: collapsed ? 60 : 228 }}
      transition={spring.gentle}
      className="flex shrink-0 flex-col border-r border-transparent bg-ink"
    >
      <div
        className={cn(
          'franja-marca flex h-14 items-center gap-2.5 px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <Logo />
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={transition.fast}
              className="min-w-0"
            >
              <p className="truncate text-base font-semibold tracking-[-0.01em] text-on-ink">
                SogaTaxi
              </p>
              <p className="truncate text-micro text-on-ink-muted">Panel de oficina</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV.filter((item) => !item.permisos || item.permisos.some(puede)).map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            collapsed={collapsed}
            badge={
              item.to === '/carreras' && pending > 0
                ? pending
                : item.to === '/avisos' && avisosUrgentes > 0
                  ? avisosUrgentes
                  : undefined
            }
          />
        ))}
      </nav>

      <div
        className={cn(
          'border-t border-on-ink-muted/25 p-2',
          collapsed && 'flex flex-col items-center',
        )}
      >
        <button
          onClick={onToggle}
          aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          title={collapsed ? 'Expandir menú' : 'Contraer menú'}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-caption text-on-ink-muted',
            'transition-colors duration-150 ease-[var(--ease-standard)] hover:bg-on-ink/10 hover:text-on-ink',
            collapsed && 'w-8 justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>Contraer</span> : null}
        </button>

        <div className={cn('mt-1 flex items-center gap-2 rounded-md px-2 py-1.5', collapsed && 'px-0')}>
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-micro font-semibold text-on-brand">
            {initials}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-caption font-medium text-on-ink" title={rol}>
                {userName}
                {rol ? <span className="font-normal text-on-ink-muted"> · {rol}</span> : null}
              </p>
              <div className="flex items-center gap-2">
                <CambiarClave />
              </div>
            </div>
          ) : null}
        </div>

        {/* Cerrar sesión aparte, a todo el ancho y en rojo: es la salida y se
            tiene que encontrar sin buscarla. Contraída, solo el icono. */}
        <button
          type="button"
          onClick={() => {
            void api.post('/v1/auth/logout').finally(() => window.location.reload());
          }}
          aria-label="Cerrar sesión"
          title={collapsed ? 'Cerrar sesión' : undefined}
          className={cn(
            'mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-danger-fill text-caption font-semibold text-on-accent',
            'transition-[filter] duration-150 ease-[var(--ease-standard)] hover:brightness-110 active:brightness-95',
            collapsed && 'w-8 px-0',
          )}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed ? <span>Cerrar Sesión</span> : null}
        </button>
      </div>
    </motion.aside>
  );
}

function SidebarLink({
  item,
  collapsed,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number;
}) {
  const Icon = item.icon;

  return (
    <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined}>
      {({ isActive }) => (
        <span
          className={cn(
            'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-base',
            'transition-colors duration-150 ease-[var(--ease-standard)]',
            isActive
              ? 'font-bold text-on-brand'
              : 'font-medium text-on-ink hover:bg-on-ink/10',
            collapsed && 'justify-center px-0',
          )}
        >
          {/* Un solo fondo que viaja entre secciones: el cambio se lee como
              movimiento, no como dos parpadeos. */}
          {isActive ? (
            <motion.span
              layoutId="nav-active"
              transition={spring.indicator}
              className="absolute inset-0 rounded-md bg-brand"
            />
          ) : null}
          <Icon
            className={cn('relative size-4 shrink-0', isActive ? 'text-on-brand' : 'text-on-ink-muted')}
          />
          {!collapsed ? <span className="relative truncate">{item.label}</span> : null}
          {!collapsed && badge ? (
            <span
              className={cn(
                'relative ml-auto tnum rounded-full px-1.5 text-micro font-semibold',
                isActive ? 'bg-ink text-brand' : 'bg-on-ink/15 text-on-ink',
              )}
            >
              {badge}
            </span>
          ) : null}
        </span>
      )}
    </NavLink>
  );
}

/**
 * El logo oficial a 38 px sobre un círculo blanco. El archivo mide 256 px
 * (es el mismo del acceso), así que sigue nítido en pantallas de densidad 3.
 */
function Logo() {
  return (
    <img
      src={logo}
      alt="Logo SogaTaxi S.A."
      width={38}
      height={38}
      className="size-[38px] shrink-0 rounded-full bg-surface"
    />
  );
}

/* ------------------------------------------------------------ barra superior --- */

function TopBar({ title }: { title: string }) {
  const [now, setNow] = useState(() => new Date());
  const connected = useLive((s) => s.connected);
  const wahaSessions = useLive((s) => s.wahaSessions);

  /*
   * «Nueva carrera» vive en la barra de arriba, no en una página (26/11/2026):
   * es lo que más usa la oficina —cada llamada es una carrera— y antes solo
   * estaba en Operación. Con F2 se abre desde cualquier parte sin soltar el
   * teclado, que es como se atiende el teléfono.
   */
  const puede = usePuede();
  const puedeCrear = puede('carreras.crear');
  const [creando, setCreando] = useState(false);
  useEffect(() => {
    if (!puedeCrear) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      setCreando(true);
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [puedeCrear]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-transparent bg-brand px-5">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-title font-semibold text-on-brand">{title}</h1>
        <span className="hidden text-caption text-on-brand-muted sm:inline">
          Sogamoso · <time className="tnum">{formatTime(now)}</time>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {puedeCrear ? (
          <>
            <button
              type="button"
              onClick={() => setCreando(true)}
              title="Registrar la carrera de un cliente que llamó (F2)"
              className="flex items-center gap-1.5 rounded-md bg-on-brand px-3 py-1.5 text-base font-semibold text-brand shadow-sm transition-transform duration-150 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-brand"
            >
              <Plus className="size-4" />
              Nueva carrera
              <kbd className="ml-1 rounded border border-current px-1 text-micro font-medium opacity-70">F2</kbd>
            </button>
            <NuevaCarrera open={creando} onClose={() => setCreando(false)} />
          </>
        ) : null}
        <div className="hidden items-center gap-1.5 lg:flex">
          {wahaSessions.map((session) => (
            <StatusPill
              key={session.id}
              tone={WAHA_STATUS_TONE[session.status]}
              live={session.status === 'working'}
              inverse
            >
              {session.label} · {WAHA_STATUS_LABEL[session.status]}
            </StatusPill>
          ))}
          <IndicadorDeDirecciones />
        </div>

        {/* Sobre el amarillo: borde y texto en tinta, y el punto en el verde
            de la franja. Si se cae, píldora blanca con rojo. */}
        {connected ? (
          <span className="flex items-center gap-1.5 rounded-md border border-on-brand px-2 py-1 text-micro font-semibold text-on-brand">
            <LiveDot live className="[--tone-solid:var(--success-fill)]" />
            En vivo
          </span>
        ) : (
          <span className="tone-critical flex items-center gap-1.5 rounded-md border border-transparent bg-surface px-2 py-1 text-micro text-[var(--tone-ink)]">
            <LiveDot tone="critical" />
            Reconectando
          </span>
        )}
      </div>
    </header>
  );
}
