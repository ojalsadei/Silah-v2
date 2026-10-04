import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMoney, detectJobStage, extractDeterministicFacts } from '../src/nlu.js';
import { fallbackRoute } from '../src/ai.js';

const highConfidenceCases = [
  ['جاني عرض بستة ونص', 6500],
  ['جاني عرض بـ٦ ونص', 6500],
  ['جاني عرض ب6.5', 6500],
  ['جاني عرض بثمانية ونص', 8500],
  ['راتب الوظيفة 12 ألف', 12000],
  ['راتب العرض 6500', 6500]
];

for (const [text, expected] of highConfidenceCases) {
  test(`extracts salary from: ${text}`, () => {
    const result = extractMoney(text, { assumeThousands: true });
    assert.equal(result?.value, expected);
    assert.equal(result?.needsConfirmation, false);
  });
}

test('negated start beats started wording', () => {
  assert.equal(detectJobStage('وافقت بس للحين ما باشرت'), 'accepted');
  assert.equal(detectJobStage('باشرت اليوم'), 'started');
});

test('deterministic facts keep accepted-not-started state with colloquial salary', () => {
  const facts = extractDeterministicFacts('جاني شغل بستة ونص ووافقت بس للحين ما باشرت', {});
  assert.equal(facts.intent, 'new_job');
  assert.equal(facts.jobStage, 'accepted');
  assert.equal(facts.money?.value, 6500);
  assert.equal(facts.money?.needsConfirmation, false);
});

test('pending amount confirmation is resolved by a yes reply without losing intent', () => {
  const first = fallbackRoute('راتبي بيصير 7', {});
  const state = {
    intent: 'income_change',
    mode: 'what_if',
    pendingConfirmation: first.pendingConfirmation
  };
  const second = fallbackRoute('ايه', state);
  assert.equal(second.intent, 'income_change');
  assert.equal(second.income, 7000);
  assert.equal(second.clearPendingConfirmation, true);
});

test('named social security question can carry a planned employment end scenario', () => {
  const route = fallbackRoute('بنفصل من وظيفتي، هل الضمان ممكن يناسبني؟', {});
  assert.equal(route.intent, 'multi_intent');
  assert.ok(route.targetServiceIds.includes('social_security'));
  assert.ok(route.targetServiceIds.includes('employment_end'));
  assert.equal(route.endStage, 'planned');
});
