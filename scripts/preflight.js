import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'coverage']);
const ignoredFiles = new Set(['.env']);
const textExtensions = new Set(['.js', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml', '.example', '.gitignore', '.cmd']);
const problems = [];

function isTextFile(file) {
  const name = path.basename(file);
  return textExtensions.has(path.extname(file).toLowerCase()) || ['package.json', '.gitignore', '.env.example'].includes(name);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!ignoredFiles.has(entry.name) && isTextFile(full)) inspect(full);
  }
}

function inspect(file) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');

  if (text.includes('\u2014')) problems.push(`${relative}: contains banned long dash U+2014`);
  if (text.includes('\u2013')) problems.push(`${relative}: contains banned en dash U+2013`);

  const groqKeys = text.match(/gsk_[A-Za-z0-9_-]{20,}/g) || [];
  for (const key of groqKeys) {
    if (!/ضع|YOUR|your|example/i.test(key)) problems.push(`${relative}: possible Groq key leak starting with ${key.slice(0, 9)}...`);
  }

  const openAiKeys = text.match(/sk-[A-Za-z0-9_-]{20,}/g) || [];
  for (const key of openAiKeys) problems.push(`${relative}: possible secret key leak starting with ${key.slice(0, 7)}...`);
}

walk(root);

const gitignorePath = path.join(root, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  problems.push('.gitignore is missing');
} else {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.split(/\r?\n/).some(line => line.trim() === '.env')) problems.push('.gitignore does not ignore .env');
}

const envExamplePath = path.join(root, '.env.example');
if (!fs.existsSync(envExamplePath)) problems.push('.env.example is missing');

if (problems.length) {
  console.error('\nPreflight failed:\n');
  problems.forEach(problem => console.error(`  - ${problem}`));
  process.exit(1);
}

console.log('Preflight passed: no committed .env target, no obvious API key leak, and no banned dash characters found.');

const textExtensions = new Set([
  '.js',
  '.ts',
  '.json',
  '.html',
  '.css',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.example',
  '.gitignore',
  '.cmd'
]);