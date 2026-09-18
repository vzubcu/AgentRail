import assert from 'node:assert/strict';

const module = await import('./vite-build.mjs');
assert.equal(typeof module.buildWebAssets, 'function');

await module.buildWebAssets();

console.log('web build regression passed');
