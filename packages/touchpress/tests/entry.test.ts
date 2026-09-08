import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vite-plus/test';

const root = fileURLToPath(new URL('../src/', import.meta.url));

const STATEMENT = /\b(import|export)\s+(type\s+)?(\*|\{[^}]*\}|[\w$]+)?\s*from\s+'([^']+)'/g;

/**
 * The relative modules whose types can land in an entry's declaration file:
 * anything reached through `import type`, an inline `type` specifier, or a
 * re-export. A value-only import is left alone, because the declaration
 * bundler drops what no exported type refers to.
 */
function typeReachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    const source = readFileSync(path, 'utf8');
    seen.set(path, source);
    for (const [, keyword, typeOnly, clause, specifier] of source.matchAll(STATEMENT)) {
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      const carriesType =
        typeOnly !== undefined || keyword === 'export' || (clause ?? '').includes('type ');
      if (carriesType) visit(resolve(dirname(path), specifier));
    }
  };
  visit(entry);
  return seen;
}

test("the main entry's types reach no module that imports from ai", () => {
  const importers = [...typeReachable(resolve(root, 'index.ts'))]
    .filter(([, source]) => /from 'ai'/.test(source))
    .map(([path]) => relative(root, path));
  expect(importers).toEqual([]);
});
