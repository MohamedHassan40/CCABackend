import type { CorsOptions } from 'cors';
import { getCorsOriginsList } from '../core/config';

/** Strip trailing slashes so `https://app.vercel.app/` matches the browser Origin header. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function originAllowed(requestOrigin: string, allowed: string[]): boolean {
  const normalized = normalizeOrigin(requestOrigin);
  return allowed.some((entry) => normalizeOrigin(entry) === normalized);
}

export function createCorsOptions(): CorsOptions {
  const allowed = getCorsOriginsList().map(normalizeOrigin);

  return {
    origin(origin, callback) {
      // Non-browser clients (curl, server-to-server) — no Origin header
      if (!origin) {
        callback(null, true);
        return;
      }
      if (originAllowed(origin, allowed)) {
        callback(null, true);
        return;
      }
      console.warn(`CORS blocked origin: ${origin} (allowed: ${allowed.join(', ') || 'none'})`);
      // false — do not throw; throwing becomes a 500 without CORS headers and confuses the browser
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  };
}
