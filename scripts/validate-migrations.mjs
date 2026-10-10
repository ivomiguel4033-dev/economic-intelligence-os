import { readdir } from "node:fs/promises";

const dir = new URL("../db/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
const seenNumbers = new Set();
const seenNames = new Set();
let previous = 0;
for (const file of files) {
  const match = /^(\d{3})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/.exec(file);
  if (!match) {
    throw new Error(`Migration filename must match NNN_snake_case.sql: ${file}`);
  }
  const number = Number(match[1]);
  const name = match[2];
  if (number === 0) throw new Error(`Migration numbering must start at 001: ${file}`);
  if (seenNumbers.has(number)) throw new Error(`Duplicate migration number: ${number}`);
  if (seenNames.has(name)) throw new Error(`Duplicate migration name: ${name}`);
  const expected = previous + 1;
  if (number !== expected) {
    throw new Error(`Migration sequence must be contiguous: expected ${String(expected).padStart(3, "0")}, found ${match[1]} at ${file}`);
  }
  seenNumbers.add(number);
  seenNames.add(name);
  previous = number;
}
console.log(`Validated ${files.length} canonical contiguous migrations.`);
