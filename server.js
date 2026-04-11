import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/database.js';
import logger from './src/utils/logger.js';

const PORT = process.env.PORT || 4000;

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`VIGIIAP API corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
  });
}

start().catch((err) => {
  logger.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
