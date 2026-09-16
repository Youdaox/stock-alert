import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { loadConfig } from '../config.js';
import { createDb } from './client.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  // eslint-disable-next-line no-console
  console.log('migrations applied');
} finally {
  await pool.end();
}
