import dotenv from 'dotenv';
dotenv.config();

import { initDb } from '../db/database';
import { reconcileCriticalTables } from '../db/reconciliation';

async function main() {
  initDb();
  const threshold = Math.max(0, Number(process.env.CUTOVER_DIVERGENCE_THRESHOLD || 0));
  const result = await reconcileCriticalTables(threshold);
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[reconciliation-job] failed:', error);
  process.exit(1);
});

