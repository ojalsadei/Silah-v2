import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackRoute } from '../src/ai.js';

test('Arabic لو is treated as a what if signal in fallback routing', () => {
  const route = fallbackRoute('لو نزل راتبي إلى 4000 وش يتغير؟', {});
  assert.equal(route.intent, 'income_change');
  assert.equal(route.mode, 'what_if');
  assert.equal(route.income, 4000);
});

test('Current job seeker service question can map Hafez wording to the current job search subsidy service', () => {
  const route = fallbackRoute('هل حافز يناسب حالتي؟', {});
  assert.equal(route.intent, 'service_question');
  assert.deepEqual(route.targetServiceIds, ['job_search_subsidy']);
});


test('Direct social security suitability question is routed to the social security service', () => {
  const route = fallbackRoute('هل الضمان ممكن يناسبني؟', {});
  assert.equal(route.intent, 'service_question');
  assert.deepEqual(route.targetServiceIds, ['social_security']);
});

test('Direct request to register in social security is not treated as current enrollment state', () => {
  const route = fallbackRoute('أبي أسجل في الضمان', {});
  assert.equal(route.intent, 'service_application_question');
  assert.deepEqual(route.targetServiceIds, ['social_security']);
});
