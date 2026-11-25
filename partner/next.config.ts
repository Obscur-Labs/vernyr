import path from 'node:path';
import type { NextConfig } from 'next';

const mode = process.env.NEXT_PUBLIC_MODE === 'live' ? 'live' : 'local';
const key = mode === 'live' ? 'NEXT_PUBLIC_LIVE_API_ORIGIN' : 'NEXT_PUBLIC_LOCAL_API_ORIGIN';
if (!process.env[key]) {
  throw new Error(`NEXT_PUBLIC_MODE is "${mode}" but ${key} is not set. Check partner/.env`);
}

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd(), '..'),
};

export default config;
