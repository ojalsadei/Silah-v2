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
  assert.match(app, /ليش بدأوا التجربة؟/);
  assert.match(app, /وش سووا فعليا؟/);
  assert.match(app, /وش كانت النتيجة؟/);
  assert.match(app, /وش طبقنا منها في صلة؟/);
});

test('Impact model is explicit about assumptions and supports sensitivity rates', () => {
  assert.match(html, /سيناريو أثر، وليس Forecast/);
  assert.match(html, /data-impact-rate="0\.03"/);
  assert.match(html, /data-impact-rate="0\.05"/);
  assert.match(html, /data-impact-rate="0\.10"/);
  assert.match(app, /const quarterlyCalls = 501805/);
  assert.match(app, /const minutesPerCall = 6/);
});

test('Long evidence sections use progressive disclosure to reduce page length', () => {
  assert.match(html, /class="impact-method-details"/);
  assert.match(html, /class="benchmark-matrix-details"/);
  assert.match(html, /class="benchmark-insights-details"/);
});
