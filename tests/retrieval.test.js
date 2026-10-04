import test from 'node:test';
import assert from 'node:assert/strict';
import { personaById } from '../src/knowledge.js';
import { retrieveRelevantServices, strongCandidateIds } from '../src/retrieval.js';
import { fallbackRoute, shouldUseLocalRoute } from '../src/ai.js';

test('service retrieval returns at most five candidates', () => {
  const items = retrieveRelevantServices({
    message: 'عندي مشكلة في الوظيفة والراتب والعقد والتدريب والدعم',
    profile: personaById.khalid,
    priorityIds: ['social_security', 'employment_contracts', 'doroob', 'career_guidance_sobol', 'job_search_subsidy']
  });
  assert.ok(items.length <= 5);
});

test('childcare wording retrieves Qurra strongly', () => {
  const items = retrieveRelevantServices({
    message: 'ابي مساعدة في الحضانة لطفلي',
    profile: personaById.reem
  });
  assert.equal(items[0]?.id, 'qurra');
  assert.ok(strongCandidateIds(items).includes('qurra'));
});

test('labor dues wording retrieves labor settlement strongly', () => {
  const items = retrieveRelevantServices({
    message: 'الشركة ما عطتني مستحقاتي',
    profile: personaById.khalid
  });
  assert.equal(items[0]?.id, 'labor_settlement');
  assert.ok(strongCandidateIds(items).includes('labor_settlement'));
});

test('generic service discovery is handled locally without an AI call', () => {
  const route = fallbackRoute('وش الخدمات اللي اقدر استفيد منها؟', {});
  assert.equal(route.intent, 'eligible_services');
  assert.equal(shouldUseLocalRoute(route, {}), true);
});

test('clear numeric job offer can be handled locally', () => {
  const route = fallbackRoute('جاني عرض بـ6500 ووافقت بس ما باشرت', {});
  assert.equal(route.intent, 'new_job');
  assert.equal(route.salary, 6500);
  assert.equal(route.jobStage, 'accepted');
  assert.equal(shouldUseLocalRoute(route, {}), true);
});

test('Saudi colloquial half-thousand job salary is extracted locally', () => {
  const route = fallbackRoute('جاني شغل بستة ونص وقلت لهم اوكي بس للحين ما داومت', {});
  assert.equal(route.intent, 'new_job');
  assert.equal(route.jobStage, 'accepted');
  assert.equal(route.salary, 6500);
  assert.equal(route.pendingConfirmation, null);
  assert.equal(shouldUseLocalRoute(route, {}), true);
});

test('short integer salary is not silently assumed without confirmation', () => {
  const route = fallbackRoute('راتبي بيصير 7', {});
  assert.equal(route.intent, 'income_change');
  assert.equal(route.income, 7000);
  assert.equal(route.pendingConfirmation?.value, 7000);
  assert.match(route.pendingConfirmation?.question || '', /7,000/);
  assert.equal(shouldUseLocalRoute(route, {}), true);
});
