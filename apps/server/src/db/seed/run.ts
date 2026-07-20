import 'dotenv/config';
import { pool } from '../client.js';
import { runSeed } from './seed.js';

runSeed()
  .then(async (result) => {
    console.log(`Seeded ${result.accountCount} accounts, ${result.transactionCount} transactions for user ${result.userId}`);
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
