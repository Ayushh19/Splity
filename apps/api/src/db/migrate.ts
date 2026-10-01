import { openDb } from './client';

const dataDir = process.env.DATABASE_DIR ?? './.data/pglite';
const { close } = await openDb(dataDir);
await close();
console.log(`Migrations applied to ${dataDir}`);
