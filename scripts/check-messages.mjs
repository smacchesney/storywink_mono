#!/usr/bin/env node
// Message-catalog lint: en/ja key parity, no {error} interpolation,
// no raw system words in parent-facing copy, '…' instead of '...'.
import { readFileSync } from 'node:fs';

const load = (locale) =>
  JSON.parse(readFileSync(new URL(`../apps/web/messages/${locale}.json`, import.meta.url), 'utf8'));
const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );

const en = new Map(flatten(load('en')));
const ja = new Map(flatten(load('ja')));
const BANNED = /\b(error|failed|invalid|unauthorized)\b/i;
const problems = [];

for (const key of en.keys()) if (!ja.has(key)) problems.push(`ja.json is missing: ${key}`);
for (const key of ja.keys()) if (!en.has(key)) problems.push(`en.json is missing: ${key}`);

for (const [name, catalog] of [['en', en], ['ja', ja]]) {
  for (const [key, value] of catalog) {
    if (value.includes('{error}')) problems.push(`${name}: ${key} interpolates {error} — raw errors go to the log, not the parent`);
    if (value.includes('...')) problems.push(`${name}: ${key} uses '...' — use '…'`);
    if (BANNED.test(value)) problems.push(`${name}: ${key} uses a system word ("${value.match(BANNED)[0]}")`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-messages: ${en.size} keys, en/ja in parity, copy rules pass.`);
