import dotenv from 'dotenv';

// Loaded here, not in index.ts: ES imports are hoisted, so any module reading
// process.env at load time would otherwise see an empty environment.
dotenv.config();

const mode = process.env.MODE === 'live' ? 'live' : 'local';
const strict = mode === 'live' || process.env.NODE_ENV === 'production';

/** MODE picks the LOCAL_/LIVE_ variant; the bare name is the fallback. */
function read(name: string): string | undefined {
  return process.env[`${mode.toUpperCase()}_${name}`] || process.env[name];
}

function required(name: string, devFallback: string): string {
  const value = read(name);
  if (value) return value;
  if (strict) {
    throw new Error(`Missing required environment variable ${mode.toUpperCase()}_${name} (or ${name}).`);
  }
  console.warn(`⚠  ${name} is not set — falling back to a development-only default`);
  return devFallback;
}

/** Each variable may hold a comma-separated list, and trailing slashes are tolerated. */
function allowedOrigins(): string[] {
  const list = [read('CLIENT_CRM_URL'), read('CLIENT_STUDENT_URL')]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (strict && list.length === 0) {
    throw new Error('CLIENT_CRM_URL and CLIENT_STUDENT_URL are both unset — every browser request would be blocked by CORS.');
  }
  return [...new Set(list)];
}

export const env = {
  mode,
  port: Number(process.env.PORT) || 5000,
  mongoUri: required('MONGODB_URI', 'mongodb://localhost:27017/studycrm'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  allowedOrigins: allowedOrigins(),
};
