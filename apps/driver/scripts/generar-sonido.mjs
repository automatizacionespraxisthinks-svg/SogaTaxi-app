// Genera el sonido de oferta de SogaTaxi: «pi-pi» de bocina de taxi y un
// remate de campanita ascendente (sol-do-mi-sol). Sintetizado aquí mismo,
// sin muestras de terceros: el sonido es propio de la marca.
//
//   node apps/driver/scripts/generar-sonido.mjs
//
// Escribe, a 44,1 kHz, 16 bits, mono:
//   - apps/driver/public/oferta.wav                       (una vez, 3 s; la PWA)
//   - apps/conductor-android/app/src/main/res/raw/oferta_sogataxi.wav  (Android, en bucle)
//   - apps/conductor-android/iosApp/iosApp/Recursos/oferta.wav         (iPhone: repetido
//     hasta 27 s, porque iOS solo deja sonidos de notificación de menos de 30 s)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FS = 44100;
// Segundos de una vuelta. Tres desde el 28/11/2026: la empresa pidió un segundo
// más que los dos de antes, y se llenan con un segundo «pi-pi», no con silencio.
const DURACION = 3;

const muestras = new Float32Array(Math.round(DURACION * FS));

/* ------------------------------------------------------------ la bocina */

/**
 * Bocina de carro: dos cornetas a la vez, separadas una tercera mayor (como
 * las bocinas dobles de verdad), en diente de sierra, saturadas y con un
 * filtro pasabajos para quitarles lo electrónico. Un leve temblor de tono
 * le da el carácter de membrana.
 */
function bocina(inicio, largo) {
  const tonos = [415, 523]; // sol# y do: «tercera mayor» de bocina doble
  const ataque = 0.012;
  const caida = 0.045;
  let filtrado = 0;
  const corte = 2600;
  const alfa = 1 - Math.exp((-2 * Math.PI * corte) / FS);
  const fases = tonos.map(() => 0);
  const desde = Math.round(inicio * FS);
  const total = Math.round((largo + caida) * FS);

  for (let n = 0; n < total; n++) {
    const t = n / FS;
    // Envolvente: entra rápido, se sostiene, cae corto.
    let env = Math.min(1, t / ataque);
    if (t > largo) env *= Math.max(0, 1 - (t - largo) / caida);
    // El tono baja un pelo al soltar, como al quitar la mano del timón.
    const caidaTono = t > largo ? 1 - 0.04 * ((t - largo) / caida) : 1;
    const temblor = 1 + 0.006 * Math.sin(2 * Math.PI * 28 * t);

    let s = 0;
    tonos.forEach((f, i) => {
      fases[i] += (f * caidaTono * temblor) / FS;
      fases[i] -= Math.floor(fases[i]);
      s += 2 * fases[i] - 1; // diente de sierra
    });
    s = Math.tanh(s * 1.8); // saturación de corneta
    filtrado += alfa * (s - filtrado);
    const i = desde + n;
    if (i < muestras.length) muestras[i] += 0.55 * env * filtrado;
  }
}

/* --------------------------------------------------------- la campanita */

/** Nota de campana: fundamental, octava y un parcial inarmónico que brilla y se apaga rápido. */
function campana(inicio, frecuencia, largo, volumen) {
  const desde = Math.round(inicio * FS);
  const total = Math.round(largo * FS);
  for (let n = 0; n < total; n++) {
    const t = n / FS;
    const ataque = Math.min(1, t / 0.004);
    const s =
      Math.sin(2 * Math.PI * frecuencia * t) * Math.exp(-t * 3.2) +
      0.45 * Math.sin(2 * Math.PI * frecuencia * 2 * t) * Math.exp(-t * 6) +
      0.25 * Math.sin(2 * Math.PI * frecuencia * 2.76 * t) * Math.exp(-t * 12);
    const i = desde + n;
    if (i < muestras.length) muestras[i] += volumen * ataque * s;
  }
}

/* ------------------------------------------------------------ partitura */

bocina(0.0, 0.16); // pi
bocina(0.26, 0.3); // piii
bocina(0.88, 0.16); // pi
bocina(1.14, 0.3); // piii

// Remate ascendente: sol5, do6, mi6 y un sol6 que queda sonando hasta el final.
const remate = [
  [1.66, 784, 0.5, 0.32],
  [1.78, 1047, 0.5, 0.32],
  [1.9, 1319, 0.5, 0.32],
  [2.02, 1568, 0.98, 0.4],
];
remate.forEach(([t, f, largo, vol]) => campana(t, f, largo, vol));

/* --------------------------------------------------------- normalizar */

let pico = 0;
for (const s of muestras) pico = Math.max(pico, Math.abs(s));
const ganancia = 0.89 / pico; // -1 dBFS
for (let i = 0; i < muestras.length; i++) muestras[i] *= ganancia;
// Sin chasquido al repetir: los últimos 20 ms bajan a cero.
const cola = Math.round(0.02 * FS);
for (let i = 0; i < cola; i++) muestras[muestras.length - 1 - i] *= i / cola;

/* ---------------------------------------------------------------- WAV */

function wav(datos) {
  const cuerpo = Buffer.alloc(44 + datos.length * 2);
  cuerpo.write('RIFF', 0);
  cuerpo.writeUInt32LE(36 + datos.length * 2, 4);
  cuerpo.write('WAVEfmt ', 8);
  cuerpo.writeUInt32LE(16, 16);
  cuerpo.writeUInt16LE(1, 20); // PCM
  cuerpo.writeUInt16LE(1, 22); // mono
  cuerpo.writeUInt32LE(FS, 24);
  cuerpo.writeUInt32LE(FS * 2, 28);
  cuerpo.writeUInt16LE(2, 32);
  cuerpo.writeUInt16LE(16, 34);
  cuerpo.write('data', 36);
  cuerpo.writeUInt32LE(datos.length * 2, 40);
  datos.forEach((s, i) => cuerpo.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return cuerpo;
}

function escribir(relativa, datos) {
  const ruta = resolve(RAIZ, relativa);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, wav(datos));
  console.log(`${relativa}  (${(datos.length / FS).toFixed(1)} s)`);
}

escribir('apps/driver/public/oferta.wav', muestras);
escribir('apps/conductor-android/app/src/main/res/raw/oferta_sogataxi.wav', muestras);

// iPhone: 9 vueltas = 27 s, por debajo del tope de 30 s de iOS.
const vueltas = 9;
const largoIos = new Float32Array(muestras.length * vueltas);
for (let v = 0; v < vueltas; v++) largoIos.set(muestras, v * muestras.length);
escribir('apps/conductor-android/iosApp/iosApp/Recursos/oferta.wav', largoIos);
