import { connection as db } from '../lib/db.ts';
import { puzzles } from '../data/puzzles.ts';

async function main() {
  const beforeRow = db.prepare('SELECT COUNT(*) as count FROM puzzles').get() as { count: number } | undefined;
  const before = Number(beforeRow?.count ?? 0);

  const telemetry = await import('../lib/telemetry.ts');

  const afterRow = db.prepare('SELECT COUNT(*) as count FROM puzzles').get() as { count: number } | undefined;
  const after = Number(afterRow?.count ?? 0);
  const delta = after - before;

  const demoUser = telemetry.ensureUser('seed-runner');

  console.log(`[seedDb] Loaded ${puzzles.length} puzzle definitions into memory.`);
  console.log(`[seedDb] Puzzle rows before sync: ${before}, after sync: ${after}, delta: ${delta}.`);
  console.log(`[seedDb] Demo user ready (id=${demoUser.id}). Database seed complete.`);
}

main().catch((error) => {
  console.error('[seedDb] Failed to seed database', error);
  process.exit(1);
});
