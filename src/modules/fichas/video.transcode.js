/**
 * video.transcode — recodifica video subido a H.264/AAC (<=1080p) y extrae
 * metadatos/poster con ffmpeg/ffprobe. Requiere ambos binarios en el PATH del
 * servidor (instalados vía `apk add ffmpeg` en el Dockerfile) -- sin wrapper
 * npm de por medio, mismo criterio del proyecto de llamar directamente al
 * recurso externo (ver geoserver.connector.js con fetch crudo) en vez de
 * sumar una capa de abstracción.
 *
 * Los comandos exactos de este archivo se probaron a mano contra ffmpeg 9.0.2
 * real (no solo mockeado en tests) durante el desarrollo de este módulo.
 */
import { spawn } from 'node:child_process';

const RESOLUCION_MAXIMA = 1080; // lado más largo del video final
const CRF = 25; // calidad visual alta, peso mucho menor que el original de celular
const SEGUNDO_DEL_POSTER = 1;

// Los videos los sube un usuario y ffmpeg interpreta formatos complejos: se acota qué puede hacer.
//  - plazo: un archivo hostil (o muy pesado) no puede ocupar el proceso de la API indefinidamente;
//  - protocolos: solo archivo local y tubería, nunca red ni referencias externas dentro del contenedor MOV/HLS;
//  - hilos y cola: una sola transcodificación a la vez y con pocos hilos, para no dejar sin CPU a quien sirve la API.
const PLAZO_TRANSCODIFICAR_MS = Number(process.env.VIDEO_TRANSCODE_TIMEOUT_MS) || 5 * 60 * 1000;
const PLAZO_AUXILIAR_MS = 30 * 1000; // poster y ffprobe
const HILOS_FFMPEG = '2';
const PROTOCOLOS_PERMITIDOS = 'file,pipe';

function ejecutar(comando, args, plazoMs) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, args);
    let stderr = '';
    const temporizador = setTimeout(() => {
      proceso.kill?.('SIGKILL');
      reject(new Error(`${comando} superó el tiempo máximo de ${Math.round(plazoMs / 1000)} s y se detuvo`));
    }, plazoMs);
    temporizador.unref?.();
    proceso.stderr.on('data', (chunk) => { stderr += chunk; });
    // ENOENT si el binario no está instalado -- distinto de un código de salida no-cero.
    proceso.on('error', (err) => { clearTimeout(temporizador); reject(Object.assign(err, { comando })); });
    proceso.on('close', (code) => {
      clearTimeout(temporizador);
      if (code === 0) return resolve();
      reject(new Error(`${comando} salió con código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// Cola de un solo trabajo: si está libre arranca en el acto (síncrono); si no, espera su turno.
let ocupada = false;
const enEspera = [];
function enCola(tarea) {
  return new Promise((resolve, reject) => {
    const correr = () => {
      ocupada = true;
      tarea().then(resolve, reject).finally(() => {
        ocupada = false;
        enEspera.shift()?.();
      });
    };
    if (ocupada) enEspera.push(correr); else correr();
  });
}

/**
 * Recodifica a H.264/AAC, acota el lado más largo a 1080px preservando
 * aspect ratio (force_original_aspect_ratio=decrease), dimensiones pares
 * obligatorias para libx264 (force_divisible_by=2), y +faststart para que
 * el navegador pueda reproducir antes de descargar el archivo completo.
 */
export async function transcodificarVideo(inputPath, outputPath) {
  await enCola(() => ejecutar('ffmpeg', [
    '-nostdin', '-protocol_whitelist', PROTOCOLOS_PERMITIDOS, '-threads', HILOS_FFMPEG,
    '-y', '-i', inputPath,
    '-vf', `scale='min(1920,iw)':'min(${RESOLUCION_MAXIMA},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-crf', String(CRF), '-preset', 'veryfast',
    '-threads', HILOS_FFMPEG, // de salida: es el codificador, no el decodificador, el que más CPU consume
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ], PLAZO_TRANSCODIFICAR_MS));
}

/** Extrae un frame como poster de respaldo, solo cuando el cliente no mandó uno propio. */
export async function extraerPosterFrame(videoPath, outputImagePath) {
  await enCola(() => ejecutar('ffmpeg', [
    '-nostdin', '-protocol_whitelist', PROTOCOLOS_PERMITIDOS, '-threads', HILOS_FFMPEG,
    '-y', '-ss', String(SEGUNDO_DEL_POSTER), '-i', videoPath,
    '-frames:v', '1', '-update', '1', outputImagePath,
  ], PLAZO_AUXILIAR_MS));
}

/** Ancho/alto/duración del video final, vía ffprobe -- para persistir en fichas_punto_medios. */
export function obtenerMetadatosVideo(path) {
  return new Promise((resolve, reject) => {
    const proceso = spawn('ffprobe', ['-v', 'quiet', '-protocol_whitelist', PROTOCOLOS_PERMITIDOS, '-print_format', 'json', '-show_format', '-show_streams', path]);
    let stdout = '';
    let stderr = '';
    const temporizador = setTimeout(() => {
      proceso.kill?.('SIGKILL');
      reject(new Error(`ffprobe superó el tiempo máximo de ${PLAZO_AUXILIAR_MS / 1000} s y se detuvo`));
    }, PLAZO_AUXILIAR_MS);
    temporizador.unref?.();
    proceso.stdout.on('data', (chunk) => { stdout += chunk; });
    proceso.stderr.on('data', (chunk) => { stderr += chunk; });
    proceso.on('error', (err) => { clearTimeout(temporizador); reject(Object.assign(err, { comando: 'ffprobe' })); });
    proceso.on('close', (code) => {
      clearTimeout(temporizador);
      if (code !== 0) return reject(new Error(`ffprobe salió con código ${code}: ${stderr.slice(-500)}`));
      try {
        const data = JSON.parse(stdout);
        const streamVideo = data.streams?.find((s) => s.codec_type === 'video');
        resolve({
          ancho: streamVideo?.width ?? null,
          alto: streamVideo?.height ?? null,
          duracionS: data.format?.duration ? Number(data.format.duration) : null,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}
