// Loads seed/guides/*.json into the database. With no DATABASE_URL the app seeds its embedded DB on first start.
import { loadSeeds, upsertGuide } from '../lib/repo';

const seeds = loadSeeds();
for (const g of seeds) {
  await upsertGuide(g);
  console.log(`seeded ${g.slug} (difficulty ${g.verdict.difficulty})`);
}
console.log(`${seeds.length} guides loaded`);
process.exit(0);
