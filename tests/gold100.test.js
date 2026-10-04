import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fallbackRoute } from '../src/ai.js';

const cases = JSON.parse(fs.readFileSync(new URL('./gold100.json', import.meta.url), 'utf8'));
function actualValue(route, key) {
  if (key === 'targetServiceId') return route.targetServiceIds?.[0];
  if (key === 'targetServiceIds') return route.targetServiceIds || [];
  if (key === 'needsConfirmation') return Boolean(route.pendingConfirmation);
  if (key === 'started') return route.started ?? (route.jobStage === 'started' ? true : route.jobStage !== 'unknown' ? false : null);
  if (key === 'accepted') return route.accepted ?? (route.jobStage === 'accepted' ? true : ['reviewing','rejected'].includes(route.jobStage) ? false : null);
  if (key === 'ended') return route.ended ?? (route.intent === 'employment_end_negated' ? false : route.endStage === 'ended' ? true : null);
  return route[key];
}
function includesEq(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every(item => actual.includes(item));
  return actual === expected;
}

for (const c of cases) {
  test(`#${c.id} ${c.message}`, () => {
    const route = fallbackRoute(c.message, c.previousState || {});
    const failures = [];
    for (const [key, expected] of Object.entries(c.expected)) {
      if (['requiresClarification','expectedEligibility','forbidConclusion','incomeSource'].includes(key)) {
        if (key === 'requiresClarification' && route.requiresClarification !== expected) failures.push(`${key}: ${route.requiresClarification} != ${expected}`);
        if (key === 'incomeSource' && route.incomeSource !== expected) failures.push(`${key}: ${route.incomeSource} != ${expected}`);
        continue;
      }
      const actual = actualValue(route, key);
      if (!includesEq(actual, expected)) failures.push(`${key}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }
    assert.deepEqual(failures, []);
  });
}
