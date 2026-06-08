import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

const dbName = 'cloud_org_test';
const dbUser = 'postgres';

let container = 'cloud_org_db';
let dbPort = '5433';

const running = runCapture('docker ps --format "{{.Names}}"');
if (!running.split(/\r?\n/).includes('cloud_org_db')) {
  console.log('cloud_org_db not running — starting cca_postgres_test on port 5434...');
  run('docker compose -f docker-compose.test.yml up -d --wait');
  container = 'cca_postgres_test';
  dbPort = '5434';
} else {
  console.log('Using existing container: cloud_org_db (port 5433)');
}

const exists = runCapture(
  `docker exec ${container} psql -U ${dbUser} -tc "SELECT 1 FROM pg_database WHERE datname = '${dbName}'"`
);
if (!exists.includes('1')) {
  console.log(`Creating database ${dbName}...`);
  run(`docker exec ${container} psql -U ${dbUser} -c "CREATE DATABASE ${dbName};"`);
} else {
  console.log(`Database ${dbName} already exists.`);
}

console.log('Syncing schema with prisma db push...');
run('npx dotenv -e .env.test -- prisma db push --accept-data-loss --skip-generate');

console.log(`\nTest database ready: postgresql://${dbUser}:***@localhost:${dbPort}/${dbName}`);
