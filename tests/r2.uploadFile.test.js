import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(class { send = sendMock }),
  PutObjectCommand: vi.fn(function (input) { return input }),
  DeleteObjectCommand: vi.fn(function (input) { return input }),
  GetObjectCommand: vi.fn(function (input) { return input }),
}));

process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'vigiiap-files';
process.env.R2_PUBLIC_URL = 'https://private.r2.local';
process.env.R2_PUBLIC_BUCKET_NAME = 'vigiiap-files-public';
process.env.R2_PUBLIC_BUCKET_URL = 'https://public.r2.local';

const { uploadFile } = await import('../src/config/r2.js');
const { PutObjectCommand } = await import('@aws-sdk/client-s3');

describe('uploadFile — Cache-Control por tipo de bucket', () => {
  beforeEach(() => {
    sendMock.mockClear();
    PutObjectCommand.mockClear();
  });

  it('fija caché pública inmutable de un año en el bucket público (thumbnails/imágenes)', async () => {
    await uploadFile('mapas/abc-123.jpg', Buffer.from('img'), 'image/jpeg', true);
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'vigiiap-files-public',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  });

  it('no fija Cache-Control en el bucket privado -- streamPrivateFile ya controla ese header en la respuesta real', async () => {
    await uploadFile('documentos/abc-123.pdf', Buffer.from('pdf'), 'application/pdf', false);
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'vigiiap-files',
        CacheControl: undefined,
      })
    );
  });

  it('cada subida sigue usando su propia key, sin colisión de caché entre archivos distintos', async () => {
    await uploadFile('mapas/uno.jpg', Buffer.from('a'), 'image/jpeg', true);
    await uploadFile('mapas/dos.jpg', Buffer.from('b'), 'image/jpeg', true);
    const keys = PutObjectCommand.mock.calls.map((call) => call[0].Key);
    expect(keys).toEqual(['mapas/uno.jpg', 'mapas/dos.jpg']);
  });
});
