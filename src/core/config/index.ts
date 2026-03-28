function parseCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
  return raw.includes(',') ? raw.split(',').map((o) => o.trim()).filter(Boolean) : raw;
}

export const config = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/cloud_org',
  nodeEnv: process.env.NODE_ENV || 'development',
  // CORS: allow frontend origin(s); comma-separated list supported (same env chain as parseCorsOrigin)
  corsOrigin: parseCorsOrigin(),
  frontendUrl: process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:3001',
};

/** Origins allowed for CORS and CSRF origin checks (always an array). */
export function getCorsOriginsList(): string[] {
  const o = config.corsOrigin;
  return Array.isArray(o) ? o : [o];
}



