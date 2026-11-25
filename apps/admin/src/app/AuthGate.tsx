import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, evaluatePassword } from '@tax/shared';
import { Banner, Button, Field, Input, transition } from '@tax/ui';
import logo from '../assets/logo-sogataxi.png';
import { ApiError, api } from '../api/client';
import { Medidor } from '../components/CambiarClave';

interface User {
  id: string;
  name: string;
  /** El usuario de acceso: un correo o un nombre de usuario. */
  email: string;
  /** Clave del rol: `administrador`, `operador` o uno creado en el panel. */
  role: string;
  roleName?: string;
  /** Ya no se usa en el panel: el segundo factor se retiró el 25/11/2026. */
  totpEnabled?: boolean;
  /** Entró con una contraseña temporal: primero tiene que cambiarla. */
  mustChangePassword: boolean;
}

/**
 * Acceso de la oficina (§8.1).
 *
 * El panel pregunta primero si ya hay sesión: la cookie es HttpOnly, así que
 * el navegador la tiene pero JavaScript no puede leerla. Un 401 significa
 * «muestra el acceso», y es la única señal fiable.
 *
 * Entre «sin sesión» y «dentro» hay un estado más: con una contraseña
 * temporal que hay que cambiar. El servidor responde
 * `PASSWORD_CHANGE_REQUIRED` a todo lo demás. El segundo factor se retiró
 * del panel el 25/11/2026: basta usuario y contraseña.
 */
export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  /*
   * La temporal que acaba de escribir, para no pedírsela otra vez dos
   * segundos después. Solo vive en memoria: si recarga la página, se le pide.
   */
  const [claveTemporal, setClaveTemporal] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    api
      .get<{ user: User }>('/v1/auth/me')
      .then((response) => {
        if (!cancelled) setUser(response.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <p className="animate-breathe text-base text-ink-muted">Comprobando la sesión…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={(entrado, password) => {
          if (entrado.mustChangePassword) setClaveTemporal(password);
          setUser(entrado);
        }}
      />
    );
  }

  if (user.mustChangePassword) {
    return (
      <CambioObligatorio
        user={user}
        claveTemporal={claveTemporal}
        onDone={() => {
          setClaveTemporal(undefined);
          setUser({ ...user, mustChangePassword: false });
        }}
      />
    );
  }

  return <>{children(user)}</>;
}

/**
 * Marco común de las pantallas previas al panel, con la marca de la empresa:
 * la franja amarilla, roja y verde arriba de la pantalla y de la tarjeta, como la
 * barra lateral y la PWA (HU-UI-01).
 */
function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="franja-marca flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition.panel}
        className={`franja-marca w-full ${wide ? 'max-w-md' : 'max-w-sm'} space-y-6 rounded-lg border border-line bg-surface p-6 pt-7 shadow-sm`}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** El logo oficial a 64 px sobre círculo blanco, igual que en el acceso de la PWA. */
function Logo() {
  return (
    <img
      src={logo}
      alt="Logo SogaTaxi S.A."
      width={64}
      height={64}
      className="mb-5 size-16 rounded-full bg-surface shadow-sm"
    />
  );
}

/* ----------------------------------------------------------- el acceso --- */

function LoginScreen({ onSuccess }: { onSuccess: (user: User, password: string) => void }) {
  // El de ejemplo solo en desarrollo: en producción, un correo inventado en
  // la casilla confunde a quien entra por primera vez.
  const [email, setEmail] = useState(import.meta.env.DEV ? 'operadora@sogataxi.local' : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);

    try {
      const response = await api.post<{ user: User }>('/v1/auth/session', {
        email,
        password,
      });
      onSuccess(response.user, password);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : undefined;

      if (code === 'TEMP_PASSWORD_EXPIRED') {
        setError('Tu contraseña temporal caducó. Pide otra a un administrador de la oficina.');
        return;
      }

      // El mensaje no distingue si el correo existe: enumerar usuarios es el
      // primer paso de cualquier ataque por fuerza bruta (§8.2).
      setError(
        code === 'NETWORK'
          ? 'No hay conexión con el servidor.'
          : 'Usuario o contraseña incorrectos.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <div>
        <Logo />
        <h1 className="text-title font-semibold text-ink">Panel de oficina</h1>
        <p className="mt-1 text-caption text-ink-muted">SogaTaxi S.A. · despacho de carreras</p>
      </div>

      <div className="space-y-4">
        <Field label="Usuario o correo" htmlFor="email" required>
          <Input
            id="email"
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Contraseña" htmlFor="password" required error={error}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void submit()}
          />
        </Field>

      </div>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={submitting}
        onClick={() => void submit()}
      >
        Entrar
      </Button>

      <p className="flex items-start gap-2 text-micro text-ink-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        La sesión caduca a las 12 horas y la cuenta se bloquea 15 minutos tras cinco intentos
        fallidos.
      </p>
    </Shell>
  );
}

/* --------------------------------------------- la contraseña temporal --- */

/**
 * Cambio obligatorio de una contraseña temporal, antes de nada más.
 *
 * La temporal la generó otra persona y la ha visto; puede haber viajado por
 * WhatsApp. Hasta cambiarla, el servidor no deja hacer otra cosa.
 */
function CambioObligatorio({
  user,
  claveTemporal,
  onDone,
}: {
  user: User;
  claveTemporal: string | undefined;
  onDone: () => void;
}) {
  const [actual, setActual] = useState(claveTemporal ?? '');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // La misma política que aplica el servidor, para que no rechace algo que
  // aquí parecía válido.
  const veredicto = evaluatePassword(nueva, { email: user.email, name: user.name });
  const coinciden = nueva.length > 0 && nueva === repetida;
  const puedeEnviar = actual.length > 0 && veredicto.ok && coinciden;

  const cambiar = async () => {
    if (!puedeEnviar) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.post('/v1/auth/password', { currentPassword: actual, newPassword: nueva });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.status === 401
            ? 'La contraseña temporal no es correcta.'
            : cause.message
          : 'No se pudo cambiar. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell wide>
      <div>
        <Logo />
        <h1 className="text-title font-semibold text-ink">Elige tu contraseña</h1>
        <p className="mt-1 text-base text-ink-secondary">
          Hola, {user.name.split(' ')[0]}. La que te dieron es temporal: la conoce quien creó tu
          cuenta. Cámbiala por una que solo sepas tú.
        </p>
      </div>

      <div className="space-y-4">
        {/* Si acaba de escribirla no se le pide otra vez; si recargó la
            página, sí, porque el panel no la guarda en ningún sitio. */}
        {claveTemporal ? null : (
          <Field label="Contraseña temporal" htmlFor="temporal" required>
            <Input
              id="temporal"
              type="password"
              autoComplete="current-password"
              value={actual}
              onChange={(event) => setActual(event.target.value)}
            />
          </Field>
        )}

        <Field
          label="Contraseña nueva"
          htmlFor="nueva"
          required
          hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres. Una frase que recuerdes vale más que algo corto con símbolos.`}
        >
          <Input
            id="nueva"
            type="password"
            autoComplete="new-password"
            value={nueva}
            onChange={(event) => setNueva(event.target.value)}
          />
        </Field>

        {nueva ? <Medidor fuerza={veredicto.fuerza} /> : null}

        {nueva && veredicto.problemas.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-[var(--t-warning-line)] bg-[var(--t-warning-bg)] p-3 text-caption text-[var(--t-warning-ink)]">
            {veredicto.problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        <Field
          label="Repite la nueva"
          htmlFor="repetida"
          required
          error={repetida && !coinciden ? 'No coinciden.' : undefined}
        >
          <Input
            id="repetida"
            type="password"
            autoComplete="new-password"
            value={repetida}
            onChange={(event) => setRepetida(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void cambiar()}
          />
        </Field>

        {error ? <Banner tone="critical">{error}</Banner> : null}
      </div>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        icon={<LockKeyhole className="size-4" />}
        loading={submitting}
        disabled={!puedeEnviar}
        onClick={() => void cambiar()}
      >
        Guardar y entrar
      </Button>
    </Shell>
  );
}
