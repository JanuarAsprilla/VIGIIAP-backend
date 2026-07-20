import { defineConfig } from 'vitest/config';

/**
 * Configuración para tests de integración.
 * Requiere PostgreSQL real con DB_NAME que contenga "test".
 *
 * Ejecutar: npm run test:integration
 * Setup:    Copiar .env.example a .env.test y configurar DB de test aislada.
 */
export default defineConfig({
  test: {
    setupFiles: ['./tests/integration/setup.js'],
    include: ['tests/integration/**/*.test.js'],
    environment: 'node',
    globals: false,
    // Timeout alto por operaciones de BD real
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Secuencial — evita race conditions entre tests que comparten BD
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
