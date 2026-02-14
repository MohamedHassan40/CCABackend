#!/bin/sh
# Pre-start script to resolve failed migrations BEFORE Railway runs migrate deploy
# This runs during the build/start phase

set +e
cd /app

echo "=========================================="
echo "PRE-START: Resolving failed migrations"
echo "=========================================="

# Resolve failed migrations using Prisma's official method
node -e "
const { Client } = require('pg');
const { execSync } = require('child_process');
const client = new Client({ connectionString: process.env.DATABASE_URL });

client.connect()
  .then(() => client.query('SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL'))
  .then(result => {
    if (result.rows.length > 0) {
      console.log('Found', result.rows.length, 'failed migration(s)');
      return Promise.all(result.rows.map(row => {
        try {
          console.log('Resolving:', row.migration_name);
          execSync(\`node node_modules/prisma/build/index.js migrate resolve --rolled-back \"\${row.migration_name}\"\`, { 
            stdio: 'inherit', 
            cwd: '/app',
            env: process.env
          });
          console.log('✅ Resolved:', row.migration_name);
        } catch (e) {
          console.log('⚠️  Could not resolve, deleting:', row.migration_name);
          return client.query('DELETE FROM \"_prisma_migrations\" WHERE migration_name = \$1', [row.migration_name])
            .then(() => console.log('✅ Deleted:', row.migration_name));
        }
      }));
    } else {
      console.log('No failed migrations found');
    }
    return client.end();
  })
  .then(() => process.exit(0))
  .catch(e => { 
    console.log('Note:', e.message); 
    client.end().catch(() => {}); 
    process.exit(0); 
  });
" 2>&1

echo "Pre-start script completed"

