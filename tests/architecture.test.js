import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('chat server uses one optional semantic AI pass and a deterministic rule response', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(server.includes('understandMessage'));
  assert.ok(server.includes("strategy: 'semantic-frame-state-resolve-rule'"));
  assert.ok(server.includes('fallbackReply'));
});

test('AI understanding receives no service catalog candidates', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const ai = fs.readFileSync(new URL('../src/ai.js', import.meta.url), 'utf8');
  assert.ok(server.includes('const aiCandidates = []'));
  assert.equal(ai.includes('candidateCatalog'), false);
  assert.equal(ai.includes('الخدمات المرشحة لهذا السؤال'), false);
});

test('Groq calls have an abort timeout and no retry loop', () => {
  const ai = fs.readFileSync(new URL('../src/ai.js', import.meta.url), 'utf8');
  assert.ok(ai.includes('AbortController'));
  assert.ok(ai.includes('GROQ_TIMEOUT_MS'));
  assert.equal(/for\s*\(let attempt/.test(ai), false);
});
