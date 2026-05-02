/**
 * Crea o promueve un usuario existente a super_admin.
 *
 * Uso:
 *   node scripts/create-superadmin.js
 *   node scripts/create-superadmin.js --email=otro@iiap.gob.pe
 *
 * Requiere que la migración 012_add_super_admin_role.sql ya esté aplicada.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, connectDB } from '../src/config/database.js';
import logger from '../src/utils/logger.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('='))
);

const SUPERADMIN = {
  nombre:     args.nombre     ?? 'Super Administrador VIGI-IIAP',
  email:      args.email      ?? 'superadmin@vigiiap.iiap.gob.pe',
  password:   args.password   ?? `SuperAdmin@IIAP${new Date().getFullYear()}!`,
  institucion: 'Instituto de Investigaciones de la Amazonía Peruana',
};

async function run() {
  await connectDB();

  const { rows: existing } = await query(
    'SELECT id, rol FROM usuarios WHERE email = $1',
    [SUPERADMIN.email]
  );

  if (existing.length) {
    // Promover usuario existente
    await query(
      'UPDATE usuarios SET rol = $1, activo = true, email_verified = true, actualizado_en = NOW() WHERE email = $2',
      ['super_admin', SUPERADMIN.email]
    );
    logger.info(`✓ Usuario ${SUPERADMIN.email} promovido a super_admin`);
    logger.info(`  Rol anterior: ${existing[0].rol}`);
  } else {
    // Crear nuevo super admin
    const hash = await bcrypt.hash(SUPERADMIN.password, 12);
    const { rows } = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, institucion, activo, email_verified)
       VALUES ($1, $2, $3, 'super_admin', $4, true, true)
       RETURNING id, nombre, email, rol`,
      [SUPERADMIN.nombre, SUPERADMIN.email, hash, SUPERADMIN.institucion]
    );
    logger.info('✓ Super Admin creado correctamente');
    logger.info(`  ID:    ${rows[0].id}`);
    logger.info(`  Email: ${rows[0].email}`);
    logger.info(`  Rol:   ${rows[0].rol}`);
    logger.info('');
    logger.warn('  ⚠️  CAMBIA LA CONTRASEÑA inmediatamente tras el primer login:');
    logger.warn(`  Email:    ${SUPERADMIN.email}`);
    logger.warn(`  Password: ${SUPERADMIN.password}`);
  }

  process.exit(0);
}

run().catch((err) => {
  logger.error('Error creando super admin:', err.message);
  process.exit(1);
});
