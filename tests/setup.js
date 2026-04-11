// Stub de variables de entorno para tests (sin BD real)
process.env.NODE_ENV     = 'test';
process.env.JWT_SECRET   = 'test_secret_key_min_32_chars_long!!';
process.env.JWT_EXPIRES_IN = '1h';
process.env.PORT         = '0';

// R2 stubs (no se llama a AWS en tests unitarios)
process.env.R2_ACCOUNT_ID       = 'test';
process.env.R2_ACCESS_KEY_ID    = 'test';
process.env.R2_SECRET_ACCESS_KEY = 'test';
process.env.R2_BUCKET_NAME      = 'test';
process.env.R2_PUBLIC_URL       = 'https://files.test.local';
