import test from 'node:test';
import assert from 'node:assert/strict';
import { personaById } from '../src/knowledge.js';
import {
  currentServices,
  opportunities,
  analyzeIncome,
  analyzeNewJob,
  analyzeEmploymentEnd,
  laborDispute,
  evaluateIntent,
  evaluateSpecificServices
} from '../src/rules.js';

const khalid = personaById.khalid;
const reem = personaById.reem;
const salman = personaById.salman;
const noura = personaById.noura;
const saleh = personaById.saleh;

function titles(result) {
  return (result.results || result).map(item => item.title).join(' | ');
}

function serviceIds(result) {
  return (result.results || result).map(item => item.serviceId).filter(Boolean);
}

test('Khalid current profile is linked to social security and employment contracts', () => {
  const ids = serviceIds(currentServices(khalid));
  assert.ok(ids.includes('social_security'));
  assert.ok(ids.includes('employment_contracts'));
});

test('Khalid opportunities include domestic worker contract documentation', () => {
  const ids = serviceIds(opportunities(khalid));
  assert.ok(ids.includes('domestic_worker_contract_documentation'));
});

test('Income decrease for Khalid does not frame the change as loss of eligibility', () => {
  const result = analyzeIncome(khalid, 4000, 'future');
  const text = titles(result) + JSON.stringify(result.results);
  assert.match(text, /مبلغ المعاش/);
  assert.doesNotMatch(text, /فقدان الأهلية|تفقد الأهلية/);
});

test('Income increase for Khalid warns that pension amount or entitlement can be affected', () => {
  const result = analyzeIncome(khalid, 7000, 'future');
  const text = titles(result);
  assert.match(text, /مبلغ المعاش|الاستحقاق/);
});

test('Actual income change for a current social security beneficiary includes reporting notice', () => {
  const result = analyzeIncome(khalid, 7000, 'current');
  assert.ok(result.results.some(item => item.type === 'action' && /15/.test(item.body)));
});

test('Income decrease for Reem does not invent social security eligibility from salary alone', () => {
  const result = analyzeIncome(reem, 4000, 'future');
  const text = JSON.stringify(result.results);
  assert.match(text, /لا يكفي وحده|ما نحول/);
  assert.doesNotMatch(text, /مؤهل|مستحقة/);
});

test('New job for Khalid asks whether it replaces the current job when current contract is active', () => {
  const result = analyzeNewJob(khalid, {
    jobStage: 'accepted',
    salary: 6500,
    replacesCurrentJob: null
  });
  assert.equal(result.needsClarification, true);
  assert.match(result.question, /بديلة|الحالي/);
});

test('Accepted job offer for Khalid is future impact and not treated as started income', () => {
  const result = analyzeNewJob(khalid, {
    jobStage: 'accepted',
    salary: 6500,
    replacesCurrentJob: true
  });
  const text = JSON.stringify(result.results);
  assert.match(text, /لم يبدأ|عند بدء|إذا بدأ/);
  assert.doesNotMatch(text, /بدأ الدخل الجديد بقيمة/);
});

test('Started job for Salman changes employment state only after starting', () => {
  const result = analyzeNewJob(salman, {
    jobStage: 'started',
    salary: 4500,
    replacesCurrentJob: null
  });
  assert.match(JSON.stringify(result.results), /الحالة الوظيفية تغيرت/);
});

test('Employment end journey stops early for Salman when there is no active contract', () => {
  const result = analyzeEmploymentEnd(salman, {
    endStage: 'planned',
    endReason: 'fixed_expiry'
  });
  assert.equal(result.needsClarification, false);
  assert.match(titles(result), /لا يوجد عقد فعال/);
});

test('Resignation excludes SANED path', () => {
  const result = analyzeEmploymentEnd(khalid, {
    endStage: 'ended',
    endReason: 'resignation'
  });
  const text = JSON.stringify(result.results);
  assert.match(text, /لا نظهر ساند/);
});

test('Fixed term expiry can surface SANED only as a path worth checking', () => {
  const result = analyzeEmploymentEnd(khalid, {
    endStage: 'ended',
    endReason: 'fixed_expiry'
  });
  const saned = result.results.find(item => /ساند/.test(item.title));
  assert.ok(saned);
  assert.match(saned.tag, /يستحق التحقق/);
  assert.doesNotMatch(saned.title + saned.body, /مؤهل|مستحق مؤكدا/);
});

test('Noura opportunities include disability aid and traffic facilities', () => {
  const ids = serviceIds(opportunities(noura));
  assert.ok(ids.includes('disability_financial_aid'));
  assert.ok(ids.includes('traffic_facilities_certificate'));
});

test('Saleh gets the senior privilege card from age and nationality data', () => {
  const ids = serviceIds(opportunities(saleh));
  assert.ok(ids.includes('senior_privilege_card'));
});

test('Reem does not get social security automatically from current profile', () => {
  const ids = serviceIds(opportunities(reem));
  assert.equal(ids.includes('social_security'), false);
});

test('Labor dispute routes to friendly settlement service', () => {
  const result = laborDispute(khalid, 'ما عطوني مستحقاتي');
  assert.ok(serviceIds(result).includes('labor_settlement'));
});

test('Current services intent returns current services plus relevant opportunities', () => {
  const result = evaluateIntent(khalid, 'current_services', {});
  const ids = serviceIds(result);
  assert.ok(ids.includes('social_security'));
  assert.ok(ids.includes('employment_contracts'));
  assert.ok(ids.includes('domestic_worker_contract_documentation'));
});

test('Salman gets job seeker programs as opportunities without being declared officially eligible', () => {
  const items = opportunities(salman);
  const ids = serviceIds(items);
  assert.ok(ids.includes('job_search_subsidy'));
  assert.ok(ids.includes('tamheer'));
  assert.ok(ids.includes('doroob'));
  assert.ok(ids.includes('career_guidance_sobol'));
  const text = JSON.stringify(items);
  assert.doesNotMatch(text, /مؤهل نهائيا|مستحق نهائيا/);
});

test('Saleh senior privilege result does not claim that the card was issued when issuance state is unknown', () => {
  const item = opportunities(saleh).find(result => result.serviceId === 'senior_privilege_card');
  assert.ok(item);
  assert.match(item.body, /لا يحتوي تأكيدا|لم.*تأكيدا|لا.*تأكيدا/);
  assert.ok(item.unknowns?.some(value => /إصدار/.test(value)));
});

test('Reem income drop can unlock Qura and Wusool in the hypothetical scenario', () => {
  const result = analyzeIncome(reem, 4000, 'future');
  const ids = serviceIds(result);
  assert.ok(ids.includes('qurra'));
  assert.ok(ids.includes('wusool'));
  const qura = result.results.find(item => item.serviceId === 'qurra');
  assert.match(qura.tag, /بسبب هذا التغيير/);
});


test('Reem can ask about social security even when she is not a current beneficiary', () => {
  const [item] = evaluateSpecificServices(reem, ['social_security'], {});
  const text = JSON.stringify(item);
  assert.match(text, /عدم استفادتك الحالية لا يمنع|التقديم عليه/);
  assert.doesNotMatch(text, /لا يمكن التسجيل|غير متاح للتسجيل/);
  assert.equal(item.relationship.current, 'not_current_beneficiary');
  assert.equal(item.relationship.eligibility, 'not_assessed');
});

test('Reem planned employment end makes social security a future relevance check, not a current entitlement', () => {
  const [item] = evaluateSpecificServices(reem, ['social_security'], { endStage: 'planned' });
  assert.equal(item.relationship.relevance, 'potential_future');
  assert.equal(item.relationship.eligibility, 'not_assessed');
  assert.match(item.title + item.body, /إذا تغير دخلك فعليا|انتهاء العلاقة الوظيفية/);
  assert.doesNotMatch(item.title + item.body, /مؤهل|مستحقة/);
});

test('Non enrollment never becomes automatic service unavailability for direct assessments', () => {
  const ids = ['social_security', 'tamheer', 'qurra', 'wusool', 'career_guidance_sobol'];
  const items = evaluateSpecificServices(reem, ids, {});
  for (const item of items) {
    assert.doesNotMatch(JSON.stringify(item), /غير مسجل.*لذا لا يمكن|لا توجد خدمة.*لذا لا يمكن التسجيل/);
  }
});

test('Reem current wage explains why Wusool is not a preliminary match without blaming enrollment', () => {
  const [item] = evaluateSpecificServices(reem, ['wusool'], {});
  assert.match(item.body, /8500|يتجاوز الحد المنشور 8000/);
  assert.equal(item.relationship.eligibility, 'known_rule_not_met_currently');
});

test('A younger persona gets a known current condition mismatch for senior privilege card', () => {
  const [item] = evaluateSpecificServices(reem, ['senior_privilege_card'], {});
  assert.equal(item.relationship.eligibility, 'known_rule_not_met_currently');
  assert.match(item.body, /27/);
});
