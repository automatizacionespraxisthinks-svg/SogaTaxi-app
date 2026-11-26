/**
 * Sonido de oferta (17/11/2026).
 *
 * La pantalla de espera dice «te avisamos con sonido y vibración», y con la
 * aplicación abierta no sonaba nada: solo vibraba, y en iPhone ni eso. Este
 * es el sonido de SogaTaxi («pi-pi» de bocina y una campanita,
 * `public/oferta.wav`, hecho con `scripts/generar-sonido.mjs`), el mismo
 * de la app de Android. Va precacheado por el service worker; si todavía no
 * cargó, suenan tres tonos sintéticos.
 *
 * Los navegadores no dejan sonar nada hasta que la persona toca la página una
 * vez. Por eso el contexto de audio se prepara con el primer toque (entrar,
 * iniciar turno) y la oferta, que llega sin toque, ya lo encuentra abierto.
 */

let contexto: AudioContext | undefined;
let sonido: AudioBuffer | undefined;
let cargando: Promise<void> | undefined;

/** Descarga y decodifica `oferta.wav` una sola vez. */
function cargar(ctx: AudioContext): Promise<void> {
  cargando ??= fetch('/oferta.wav')
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((datos) => ctx.decodeAudioData(datos))
    .then((buffer) => {
      sonido = buffer;
    })
    .catch(() => {
      // Se reintenta en la próxima oferta.
      cargando = undefined;
    });
  return cargando;
}

function abrir(): AudioContext | undefined {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume();
    return contexto;
  } catch {
    return undefined;
  }
}

/** Deja el audio listo con el primer toque en cualquier parte de la página. */
export function prepararSonido(): () => void {
  const alTocar = () => {
    const ctx = abrir();
    if (ctx) void cargar(ctx);
    window.removeEventListener('pointerdown', alTocar);
  };
  window.addEventListener('pointerdown', alTocar);
  return () => window.removeEventListener('pointerdown', alTocar);
}

/**
 * Cuánto suena cada oferta (26/11/2026): dos segundos y se calla. Antes daba
 * tres vueltas (unos 7 s) y, con tantas carreras llegando, cansaba.
 */
const SEGUNDOS_DE_SONIDO = 2;

/**
 * Suena la oferta y devuelve con qué callarla (al aceptar, rechazar o
 * vencer). Se llama al montar la pantalla de la oferta.
 */
export function sonarOferta(): () => void {
  const ctx = abrir();
  if (!ctx || ctx.state !== 'running') return () => {};
  if (!sonido) {
    void cargar(ctx);
    tonosDeRespaldo(ctx);
    return () => {};
  }
  const fuente = ctx.createBufferSource();
  fuente.buffer = sonido;
  // Baja el volumen en el último cuarto de segundo: cortado en seco suena a falla.
  const volumen = ctx.createGain();
  fuente.connect(volumen).connect(ctx.destination);
  const inicio = ctx.currentTime + 0.02;
  const fin = inicio + Math.min(SEGUNDOS_DE_SONIDO, sonido.duration);
  volumen.gain.setValueAtTime(1, Math.max(inicio, fin - 0.25));
  volumen.gain.linearRampToValueAtTime(0.0001, fin);
  fuente.start(inicio);
  fuente.stop(fin);
  return () => {
    try {
      fuente.stop();
    } catch {
      // Ya había terminado.
    }
  };
}

/** Tres tonos ascendentes, por si `oferta.wav` todavía no cargó. */
function tonosDeRespaldo(ctx: AudioContext): void {
  const inicio = ctx.currentTime + 0.02;
  [880, 1175, 1480].forEach((frecuencia, i) => {
    const oscilador = ctx.createOscillator();
    const volumen = ctx.createGain();
    oscilador.type = 'square';
    oscilador.frequency.value = frecuencia;
    const t = inicio + i * 0.18;
    volumen.gain.setValueAtTime(0.0001, t);
    volumen.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    oscilador.connect(volumen).connect(ctx.destination);
    oscilador.start(t);
    oscilador.stop(t + 0.17);
  });
}
