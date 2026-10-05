import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const rootCandidates = [
  path.resolve(here, '..'),
  process.cwd(),
  path.resolve(here, '..', '..')
];

const root =
  rootCandidates.find(candidate =>
    fs.existsSync(path.join(candidate, 'data', 'services.json'))
  ) || path.resolve(here, '..');

function readJson(relativePath) {
  const full = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

export const services = readJson('data/services.json');
export const personas = readJson('data/personas.json');
export const benchmarks = readJson('data/benchmarks.json');
export const languageGlossary = readJson('data/language_glossary.json');

export const serviceById = Object.fromEntries(
  services.map(service => [service.id, service])
);

export const personaById = Object.fromEntries(
  personas.map(persona => [persona.id, persona])
);

export function compactServiceCatalog() {
  return services.map(service => ({
    id: service.id,
    name: service.name,
    sector: service.sector,
    summary: service.summary,
    audience: service.audience,
    triggerSignals: service.triggerSignals,
    requiredData: service.requiredData,
    decisionPolicy: service.decisionPolicy
  }));
}