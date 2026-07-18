/**
 * Crea el usuario admin_sig inicial.
 * Uso: node scripts/create-admin.js
 */
import 'dotenv/config';

if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: No ejecutar scripts de seed en producción.');
  process.exit(1);
}

import bcrypt from 'bcryptjs';
import { query, connectDB } from '../src/config/database.js';
import logger from '../src/utils/logger.js';

const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('ERROR: Define ADMIN_SEED_PASSWORD en el entorno antes de ejecutar este script.');
  process.exit(1);
}

const ADMIN = {
  nombre:    'Administrador VIGI-IIAP',
  email:     process.env.ADMIN_SEED_EMAIL || 'admin@iiap.gov.co',
  password:  ADMIN_PASSWORD,
  rol:       'admin_sig',
  institucion: 'Instituto de Investigaciones Ambientales del Pacífico',
};

async function createAdmin() {
  await connectDB();

  const { rows: existing } = await query(
    'SELECT id FROM usuarios WHERE email = $1',
    [ADMIN.email],
  );

  if (existing.length) {
    logger.info(`Admin ya existe: ${ADMIN.email}`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(ADMIN.password, 12);

  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, institucion, activo)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, nombre, email, rol`,
    [ADMIN.nombre, ADMIN.email, hash, ADMIN.rol, ADMIN.institucion],
  );

  logger.info('✓ Admin creado correctamente');
  logger.info(`  ID:    ${rows[0].id}`);
  logger.info(`  Email: ${rows[0].email}`);
  logger.info(`  Rol:   ${rows[0].rol}`);
  logger.info('');
  logger.info('  CAMBIA LA CONTRASEÑA después del primer login:');
  logger.info(`  Email:    ${ADMIN.email}`);
  logger.info('  Password: [ver variable ADMIN_SEED_PASSWORD]');

  process.exit(0);
}

createAdmin().catch((err) => {
  logger.error('Error creando admin:', err.message);
  process.exit(1);
});
