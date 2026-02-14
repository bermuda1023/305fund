/**
 * Database migration script.
 * Run: pnpm --filter @brickell/server db:migrate
 */

import dotenv from 'dotenv';
dotenv.config();

import { initDb, closeDb } from './database';

console.log('Running database migration...');
initDb();
closeDb();
console.log('Migration complete!');
