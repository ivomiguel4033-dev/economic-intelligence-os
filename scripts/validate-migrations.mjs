import { readdir } from "node:fs/promises";

const dir = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
const seen = new Set();
let previous = 0;
for (const file of files) {
  const match = /^(\d+)_/.exec(file);
  if (!match) throw new Error(`Migration must start with a numeric prefix: ${file}`);
  const number = Number(match[1]);
  if (seen.has(number)) throw new Error(`Duplicate migration number: ${number}`);
  const expected = previous + 1;
  if (number !== expected) {
    throw new Error(`Migration sequence must be contiguous: expected ${expected}, found ${number} at ${file}`);
  }
  seen.add(number);
  previous = number;
}
console.log(`Validated ${files.length} contiguous ordered migrations.`);
