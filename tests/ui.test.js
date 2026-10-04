import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { services, benchmarks } from '../src/knowledge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('Profile UI does not expose negative social security enrollment as a profile chip', () => {
  assert.doesNotMatch(app, /غير مسجل كمستفيد ضمان في النموذج/);
});

test('Expected impact section is present in the main navigation and page', () => {
  assert.match(html, /data-scroll="impact"/);
  assert.match(html, /id="impact"/);
  assert.match(html, /الأثر المتوقع/);
});

test('Service library is compact by default and supports on demand details', () => {
  assert.equal(services.length, 18);
  assert.match(html, /id="serviceModal"/);
  assert.match(html, /id="serviceExpand"/);
  assert.match(app, /slice\(0, 8\)/);
});

test('Benchmark includes five researched experiences and a capability matrix', () => {
  assert.equal(benchmarks.length, 5);
  assert.match(html, /id="benchmarkMatrix"/);
  assert.match(app, /خريطة القدرات/);
});


test('Chat keeps the reading position stable when new messages arrive', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(css, /overflow-anchor:none/);
  assert.doesNotMatch(app, /messages\.scrollTop\s*=\s*messages\.scrollHeight/);
  assert.doesNotMatch(app, /scrollMessages\(/);
  assert.match(app, /focus\(\{ preventScroll: true \}\)/);
});

test('Executive demo supports a clean conversation reset without changing persona', () => {
  assert.match(html, /id="resetChatButton"/);
  assert.match(app, /function startNewConversation\(\)/);
  assert.match(app, /state\.history = \[\]/);
  assert.match(app, /state\.scenarioState = \{\}/);
  assert.match(app, /resetChat\(state\.bootstrap\.profile\)/);
});

test('Digital Twin has an accessible on demand explanation', () => {
  const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
  assert.match(html, /aria-label="شرح توأم الحالة"/);
  assert.match(html, /وش يعني Digital Twin في صلة؟/);
  assert.match(css, /\.info-popover:hover \.info-panel/);
  assert.match(css, /\.info-popover:focus-within \.info-panel/);
});

test('Benchmark keeps deep research behind clickable cards', () => {
  assert.match(html, /id="benchmarkModal"/);
  assert.match(app, /data-benchmark-id/);
  assert.match(app, /المشكلة اللي كانوا يحلونها/);
  assert.match(app, /ليش بنوا الحل/);
  assert.match(app, /وش بنوا فعليا/);
  assert.match(app, /كيف تمشي الرحلة/);
  assert.match(app, /كيف اشتغل التكامل/);
  assert.match(app, /وش البيانات المستخدمة/);
  assert.match(app, /التحديات والقيود/);
  assert.match(app, /وش طبقناه فعليا في صلة/);
});

test('Impact model is explicit about assumptions and supports sensitivity rates', () => {
  assert.match(html, /سيناريو أثر، وليس Forecast/);
  assert.match(html, /data-impact-rate="0\.03"/);
  assert.match(html, /data-impact-rate="0\.05"/);
  assert.match(html, /data-impact-rate="0\.10"/);
  assert.match(app, /const quarterlyCalls = 526945/);
  assert.match(app, /const minutesPerCall = 6/);
});

test('Long evidence sections use progressive disclosure to reduce page length', () => {
  assert.match(html, /class="impact-method-details"/);
  assert.match(html, /class="benchmark-matrix-details"/);
  assert.match(html, /class="benchmark-insights-details"/);
});


test('Every benchmark has executive research layers and official sources', () => {
  for (const item of benchmarks) {
    for (const key of ['problem', 'whyBuilt', 'journey', 'design', 'integration', 'dataUsed', 'results', 'challenges', 'lessons', 'appliedToSilah']) {
      assert.ok(item[key], `${item.id} missing ${key}`);
      if (Array.isArray(item[key])) assert.ok(item[key].length > 0, `${item.id} empty ${key}`);
    }
    assert.ok(item.sources?.length > 0, `${item.id} missing sources`);
  }
});

test('Impact baseline is Q2 2026 and matches the documented call volume', () => {
  assert.match(html, /الربع الثاني 2026/);
  assert.match(html, /757,960/);
  assert.match(html, /526,945/);
  assert.match(html, /58,661/);
  assert.match(html, /172,354/);
});
