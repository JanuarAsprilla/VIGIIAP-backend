import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../src/modules/auth/auth.schema.js';
import { createSolicitudSchema } from '../src/modules/solicitudes/solicitudes.schema.js';
import {
  createMapaSchema, updateMapaSchema, toggleMapaSchema,
} from '../src/modules/mapas/mapas.schema.js';
import {
  createDocumentoSchema, updateDocumentoSchema, toggleDocumentoSchema,
} from '../src/modules/documentos/documentos.schema.js';

const baseRegister = {
  nombre: 'Juan Pérez', email: 'juan@iiap.gob.co',
  password: 'Segura123!', tipoAcceso: 'externo',
};

describe('registerSchema — max lengths', () => {
  it('rechaza nombre > 150 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, nombre: 'a'.repeat(151) })).toThrow();
  });
  it('acepta nombre de exactamente 150 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, nombre: 'a'.repeat(150) })).not.toThrow();
  });
  it('rechaza institucion > 300 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, institucion: 'a'.repeat(301) })).toThrow();
  });
  it('acepta institucion de exactamente 300 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, institucion: 'a'.repeat(300) })).not.toThrow();
  });
  it('rechaza motivo > 500 chars', () => {
    expect(() => registerSchema.parse({ ...baseRegister, motivo: 'a'.repeat(501) })).toThrow();
  });
  it('rechaza email > 254 chars', () => {
    const longEmail = 'a'.repeat(249) + '@ab.co'; // 255 chars total
    expect(() => registerSchema.parse({ ...baseRegister, email: longEmail })).toThrow();
  });
});

describe('loginSchema — max password length', () => {
  it('rechaza password > 72 chars', () => {
    expect(() => loginSchema.parse({ email: 'a@b.co', password: 'A1!a'.repeat(19) })).toThrow();
  });
  it('acepta password de exactamente 72 chars', () => {
    const p = 'Aa1!' + 'x'.repeat(68);
    expect(() => loginSchema.parse({ email: 'a@b.co', password: p })).not.toThrow();
  });
});

describe('createSolicitudSchema — max lengths', () => {
  it('rechaza descripcion > 1000 chars', () => {
    expect(() => createSolicitudSchema.parse({ tipo: 'otro', descripcion: 'a'.repeat(1001) })).toThrow();
  });
  it('acepta descripcion de exactamente 1000 chars', () => {
    expect(() => createSolicitudSchema.parse({ tipo: 'otro', descripcion: 'a'.repeat(1000) })).not.toThrow();
  });
});

// R2_PUBLIC_URL ya viene fijado por tests/setup.js; R2_PUBLIC_BUCKET_URL se fija aquí
// una sola vez para todo el archivo (los refine de las URLs lo leen en tiempo de parse).
process.env.R2_PUBLIC_BUCKET_URL = 'https://bucket.test.local';

const baseMapa = { titulo: 'Mapa Bio', categoria: 'biodiversidad' };

describe('mapas.schema — trustedUrl (thumbnail/archivo_pdf/archivo_img)', () => {
  it('acepta una URL que empieza por R2_PUBLIC_URL', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, thumbnail_url: 'https://files.test.local/mapas/thumb.png',
    })).not.toThrow();
  });

  it('acepta una URL que empieza por R2_PUBLIC_BUCKET_URL', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, archivo_pdf_url: 'https://bucket.test.local/mapas/a.pdf',
    })).not.toThrow();
  });

  it('rechaza una URL de un dominio externo no confiable', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, archivo_img_url: 'https://evil.example.com/img.png',
    })).toThrow();
  });

  it('acepta string vacío (se transforma a null)', () => {
    const parsed = createMapaSchema.parse({ ...baseMapa, thumbnail_url: '' });
    expect(parsed.thumbnail_url).toBeNull();
  });

  it('geovisor_url permite dominios externos (allowExternal=true)', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, geovisor_url: 'https://geovisor-externo.arcgis.com/map',
    })).not.toThrow();
  });
});

describe('mapas.schema — bbox refinements', () => {
  it('rechaza cuando bbox_norte no es mayor que bbox_sur', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, bbox_norte: 5, bbox_sur: 10,
    })).toThrow();
  });

  it('acepta cuando bbox_norte es mayor que bbox_sur', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, bbox_norte: 10, bbox_sur: 5,
    })).not.toThrow();
  });

  it('rechaza cuando bbox_este no es mayor que bbox_oeste', () => {
    expect(() => createMapaSchema.parse({
      ...baseMapa, bbox_este: -80, bbox_oeste: -70,
    })).toThrow();
  });

  it('acepta cuando solo un bbox de un par está presente (refine no aplica)', () => {
    expect(() => createMapaSchema.parse({ ...baseMapa, bbox_norte: 10 })).not.toThrow();
  });
});

describe('updateMapaSchema — al menos un campo', () => {
  it('rechaza un objeto vacío', () => {
    expect(() => updateMapaSchema.parse({})).toThrow();
  });

  it('acepta con al menos un campo definido', () => {
    expect(() => updateMapaSchema.parse({ titulo: 'Nuevo título' })).not.toThrow();
  });
});

describe('toggleMapaSchema — coerción booleana', () => {
  it('coerciona "true" (string) a true', () => {
    expect(toggleMapaSchema.parse({ activo: 'true' }).activo).toBe(true);
  });
  it('coerciona false a false', () => {
    expect(toggleMapaSchema.parse({ activo: false }).activo).toBe(false);
  });
});

describe('documentos.schema — r2Url (archivo_url)', () => {
  it('acepta una URL que empieza por R2_PUBLIC_URL', () => {
    expect(() => createDocumentoSchema.parse({
      titulo: 'Doc', tipo: 'informe', archivo_url: 'https://files.test.local/docs/a.pdf',
    })).not.toThrow();
  });

  it('rechaza una URL de un dominio externo no confiable', () => {
    expect(() => createDocumentoSchema.parse({
      titulo: 'Doc', tipo: 'informe', archivo_url: 'https://evil.example.com/a.pdf',
    })).toThrow();
  });
});

describe('updateDocumentoSchema — al menos un campo', () => {
  it('rechaza un objeto vacío', () => {
    expect(() => updateDocumentoSchema.parse({})).toThrow();
  });
  it('acepta con al menos un campo definido', () => {
    expect(() => updateDocumentoSchema.parse({ titulo: 'Nuevo' })).not.toThrow();
  });
});

describe('toggleDocumentoSchema — coerción booleana', () => {
  it('coerciona 1 a true', () => {
    expect(toggleDocumentoSchema.parse({ activo: 1 }).activo).toBe(true);
  });
});
