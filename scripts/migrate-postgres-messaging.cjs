/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require('@next/env');
const { spawnSync } = require('node:child_process');

function main() {
  loadEnvConfig(process.cwd());
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL is required.');
  const url = new URL(rawUrl);
  const target = `${url.hostname}${url.pathname}`.toLowerCase();
  if (process.env.MESSAGING_POSTGRES_TARGET !== 'staging' || /prod|production|live/.test(target)) {
    throw new Error('Refusing migration: set MESSAGING_POSTGRES_TARGET=staging and use a non-production DATABASE_URL.');
  }
  const result = spawnSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'migrate', '--config=drizzle.postgres.config.ts'], { stdio: 'inherit', env: process.env });
  process.exitCode = result.status ?? 1;
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
