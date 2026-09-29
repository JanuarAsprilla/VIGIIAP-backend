/**
 * Tests unitarios de video.transcode.js con child_process.spawn mockeado --
 * los comandos exactos (argumentos de ffmpeg/ffprobe) se probaron por
 * separado a mano contra binarios reales durante el desarrollo de este
 * módulo; aquí se verifica que el wrapper invoque el binario correcto, con
 * los argumentos correctos, y maneje éxito/fallo/binario-ausente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { transcodificarVideo, extraerPosterFrame, obtenerMetadatosVideo } from '../src/modules/fichas/video.transcode.js';

function procesoFalso() {
  const proceso = new EventEmitter();
  proceso.stdout = new EventEmitter();
  proceso.stderr = new EventEmitter();
  return proceso;
}

beforeEach(() => {
  vi.mocked(spawn).mockReset();
});

describe('transcodificarVideo()', () => {
  it('invoca ffmpeg con los argumentos correctos y resuelve en código 0', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = transcodificarVideo('entrada.mp4', 'salida.mp4');
    proceso.emit('close', 0);
    await expect(promesa).resolves.toBeUndefined();

    const [comando, args] = spawn.mock.calls[0];
    expect(comando).toBe('ffmpeg');
    expect(args).toContain('entrada.mp4');
    expect(args).toContain('salida.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('aac');
  });

  it('rechaza con el stderr cuando ffmpeg sale con código distinto de 0', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = transcodificarVideo('entrada.mp4', 'salida.mp4');
    proceso.stderr.emit('data', 'Invalid data found when processing input');
    proceso.emit('close', 1);

    await expect(promesa).rejects.toThrow(/código 1/);
  });

  it('rechaza si el binario ffmpeg no está instalado (ENOENT)', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = transcodificarVideo('entrada.mp4', 'salida.mp4');
    proceso.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }));

    await expect(promesa).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('extraerPosterFrame()', () => {
  it('invoca ffmpeg con -frames:v 1 y -update 1', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = extraerPosterFrame('video.mp4', 'poster.jpg');
    proceso.emit('close', 0);
    await promesa;

    const [, args] = spawn.mock.calls[0];
    expect(args).toContain('-frames:v');
    expect(args).toContain('-update');
    expect(args).toContain('poster.jpg');
  });
});

describe('obtenerMetadatosVideo()', () => {
  it('parsea ancho/alto/duración del JSON de ffprobe', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = obtenerMetadatosVideo('video.mp4');
    proceso.stdout.emit('data', JSON.stringify({
      streams: [{ codec_type: 'audio' }, { codec_type: 'video', width: 1920, height: 1080 }],
      format: { duration: '12.5' },
    }));
    proceso.emit('close', 0);

    await expect(promesa).resolves.toEqual({ ancho: 1920, alto: 1080, duracionS: 12.5 });
  });

  it('devuelve null en los campos si no hay stream de video', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = obtenerMetadatosVideo('audio-solo.mp4');
    proceso.stdout.emit('data', JSON.stringify({ streams: [{ codec_type: 'audio' }], format: {} }));
    proceso.emit('close', 0);

    await expect(promesa).resolves.toEqual({ ancho: null, alto: null, duracionS: null });
  });

  it('rechaza si ffprobe sale con código distinto de 0', async () => {
    const proceso = procesoFalso();
    spawn.mockReturnValueOnce(proceso);

    const promesa = obtenerMetadatosVideo('corrupto.mp4');
    proceso.stderr.emit('data', 'Invalid data found');
    proceso.emit('close', 1);

    await expect(promesa).rejects.toThrow(/código 1/);
  });
});
