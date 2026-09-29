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

function ejecutar(comando, args) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, args);
    let stderr = '';
    proceso.stderr.on('data', (chunk) => { stderr += chunk; });
    // ENOENT si el binario no está instalado -- distinto de un código de salida no-cero.
    proceso.on('error', (err) => reject(Object.assign(err, { comando })));
    proceso.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${comando} salió con código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Recodifica a H.264/AAC, acota el lado más largo a 1080px preservando
 * aspect ratio (force_original_aspect_ratio=decrease), dimensiones pares
 * obligatorias para libx264 (force_divisible_by=2), y +faststart para que
 * el navegador pueda reproducir antes de descargar el archivo completo.
 */
export async function transcodificarVideo(inputPath, outputPath) {
  await ejecutar('ffmpeg', [
    '-y', '-i', inputPath,
    '-vf', `scale='min(1920,iw)':'min(${RESOLUCION_MAXIMA},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-crf', String(CRF), '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

/** Extrae un frame como poster de respaldo, solo cuando el cliente no mandó uno propio. */
export async function extraerPosterFrame(videoPath, outputImagePath) {
  await ejecutar('ffmpeg', [
    '-y', '-ss', String(SEGUNDO_DEL_POSTER), '-i', videoPath,
    '-frames:v', '1', '-update', '1', outputImagePath,
  ]);
}

/** Ancho/alto/duración del video final, vía ffprobe -- para persistir en fichas_punto_medios. */
export function obtenerMetadatosVideo(path) {
  return new Promise((resolve, reject) => {
    const proceso = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path]);
    let stdout = '';
    let stderr = '';
    proceso.stdout.on('data', (chunk) => { stdout += chunk; });
    proceso.stderr.on('data', (chunk) => { stderr += chunk; });
    proceso.on('error', (err) => reject(Object.assign(err, { comando: 'ffprobe' })));
    proceso.on('close', (code) => {
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
