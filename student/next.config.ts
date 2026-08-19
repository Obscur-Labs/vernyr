import path from 'node:path';
import type { NextConfig } from 'next';

const mode = process.env.NEXT_PUBLIC_MODE === 'live' ? 'live' : 'local';
const required =
  mode === 'live' ? ['NEXT_PUBLIC_LIVE_API_ORIGIN'] : ['NEXT_PUBLIC_LOCAL_API_ORIGIN'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`NEXT_PUBLIC_MODE is "${mode}" but ${missing.join(' and ')} is not set. Check student/.env`);
}

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd(), '..'),
};

export default config;
