import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Load key=value pairs from a .env file into process.env (no external deps). */
function loadEnvFile(filePath: string, override: boolean): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const testEnvPath = resolve(__dirname, '../.env.test');
loadEnvFile(testEnvPath, true);

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!existsSync(testEnvPath) && process.env.DATABASE_URL?.includes('railway')) {
  console.warn(
    '\n[tests] Tip: copy .env.test.example → .env.test and run npm run db:test:setup\n' +
      '       so tests use a local DB instead of Railway.\n'
  );
}
