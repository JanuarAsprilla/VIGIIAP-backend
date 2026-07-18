import 'dotenv/config';
import * as Sentry from '@sentry/node';

const SENSITIVE_FIELDS = new Set(['password', 'token', 'secret', 'code', 'totp_secret', 'backup_codes', 'password_hash']);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN && process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.1,
  integrations: [Sentry.httpIntegration()],
  // Redactar headers y campos de body sensibles antes de enviar a Sentry (tercero externo).
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }
    if (event.request?.data && typeof event.request.data === 'object') {
      for (const field of SENSITIVE_FIELDS) {
        if (field in event.request.data) event.request.data[field] = '[Redacted]';
      }
    }
    return event;
  },
});
