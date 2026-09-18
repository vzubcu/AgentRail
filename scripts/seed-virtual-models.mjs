#!/usr/bin/env node
// Seeds built-in virtual models (agentrail/auto, agentrail/files)
// Usage: node scripts/seed-virtual-models.mjs
// Requires AGENTRAIL_SECRETS_DATABASE_URL environment variable

import knex from 'knex';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const config = require('../knexfile.cjs');

const TABLE = 'agentrail_virtual_models';

const BUILT_IN_MODELS = [
  {
    id: 'agentrail/auto',
    name: 'Auto Router',
    description:
      'Routes to the healthiest available provider based on latency and availability',
    routing_strategy: 'round-robin',
    capabilities: ['chat', 'vision', 'file_input'],
    selected_models: [],
    auto_aliases: [
      'gpt-4o',
      'gpt-4',
      'o3-mini',
      'claude-3-opus',
      'claude-3-sonnet',
      'gemini-2.0-flash',
      'gemini-2.5-pro',
      'command-r',
      'command-r-plus',
      'mistral-large',
      'llama-3.1-70b',
    ],
    is_builtin: true,
  },
  {
    id: 'agentrail/files',
    name: 'File Router',
    description:
      'Routes to providers with native file_input capability',
    routing_strategy: 'priority',
    capabilities: ['chat', 'file_input'],
    selected_models: [],
    auto_aliases: [],
    is_builtin: true,
  },
];

const dbUrl = process.env.AGENTRAIL_SECRETS_DATABASE_URL;
if (!dbUrl) {
  console.error(
    '[Seed] SKIP: AGENTRAIL_SECRETS_DATABASE_URL environment variable is not set',
  );
  process.exit(1);
}

const db = knex(config);

try {
  for (const model of BUILT_IN_MODELS) {
    const existing = await db(TABLE).where({ id: model.id }).first();

    if (existing) {
      console.log(`[Seed] Virtual model "${model.id}" already exists, skipping`);
      continue;
    }

    await db(TABLE).insert(model);
    console.log(`[Seed] Virtual model "${model.id}" created`);
  }

  console.log('[Seed] Virtual models seeded successfully');
  await db.destroy();
  process.exit(0);
} catch (err) {
  console.error(`[Seed] Failed: ${err.message}`);
  await db.destroy();
  process.exit(1);
}
