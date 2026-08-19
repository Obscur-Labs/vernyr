import dotenv from 'dotenv';

/**
 * Single place where the environment is read and validated.
 *
 * `dotenv.config()` lives here rather than in index.ts because ES imports are
 * hoisted — any module that read process.env at load time would otherwise see
 * an empty environment. Importing this module first guarantees it is populated.
 *
 * Anything missing in production throws at boot, so a misconfigured deploy
 * fails loudly on the first log line instead of silently signing tokens with a
 * well-known secret.
 */
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function required(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(
      `Missing required environment variable ${name}. Set it on the service before starting.`,
    );
  }
  console.warn(`⚠  ${name} is not set — falling back to a development-only default`);
  return devFallback;
}

/**
 * Browser origins allowed through CORS and Socket.io. Each variable may hold a
 * comma-separated list, and trailing slashes are tolerated because that is how
 * a dashboard usually hands the URL back to you.
 */
function allowedOrigins(): string[] {
  const list = [process.env.CLIENT_CRM_URL, process.env.CLIENT_STUDENT_URL]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (isProduction && list.length === 0) {
    throw new Error(
      'CLIENT_CRM_URL and CLIENT_STUDENT_URL are both unset — every browser request would be blocked by CORS.',
    );
  }
  return [...new Set(list)];
}

export const env = {
  isProduction,
  port: Number(process.env.PORT) || 5000,
  mongoUri: required('MONGODB_URI', 'mongodb://localhost:27017/studycrm'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowedOrigins: allowedOrigins(),
};
