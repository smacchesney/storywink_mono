#!/usr/bin/env npx tsx
/**
 * Translation Key Parity Checker
 *
 * Validates that all locale JSON files under apps/web/messages/ have
 * identical key structures. Reports missing and extra keys per locale
 * relative to the reference locale (en.json).
 *
 * Usage:
 *   npx tsx scripts/check-translations.ts
 *   npm run i18n:check
 */

import * as fs from 'fs';
import * as path from 'path';

const MESSAGES_DIR = path.resolve(__dirname, '../apps/web/messages');
const REFERENCE_LOCALE = 'en';

type NestedRecord = { [key: string]: string | NestedRecord };

function collectKeys(obj: NestedRecord, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      for (const nested of collectKeys(value as NestedRecord, fullKey)) {
        keys.add(nested);
      }
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

function loadLocale(locale: string): NestedRecord {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// Discover all locale files
const localeFiles = fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('.json'));
const locales = localeFiles.map(f => f.replace('.json', ''));

if (!locales.includes(REFERENCE_LOCALE)) {
  console.error(`Reference locale "${REFERENCE_LOCALE}.json" not found in ${MESSAGES_DIR}`);
  process.exit(1);
}

const referenceKeys = collectKeys(loadLocale(REFERENCE_LOCALE));
let hasErrors = false;

console.log(`Reference locale: ${REFERENCE_LOCALE} (${referenceKeys.size} keys)\n`);

for (const locale of locales) {
  if (locale === REFERENCE_LOCALE) continue;

  const localeKeys = collectKeys(loadLocale(locale));

  const missing = [...referenceKeys].filter(k => !localeKeys.has(k));
  const extra = [...localeKeys].filter(k => !referenceKeys.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${locale}.json — all ${localeKeys.size} keys match`);
  } else {
    hasErrors = true;
    console.log(`✗ ${locale}.json — ${missing.length} missing, ${extra.length} extra`);
    if (missing.length > 0) {
      console.log(`  Missing keys:`);
      for (const k of missing) console.log(`    - ${k}`);
    }
    if (extra.length > 0) {
      console.log(`  Extra keys:`);
      for (const k of extra) console.log(`    + ${k}`);
    }
  }
  console.log();
}

if (hasErrors) {
  console.log('Translation key parity check FAILED.');
  process.exit(1);
} else {
  console.log('All translation files are in parity.');
  process.exit(0);
}
