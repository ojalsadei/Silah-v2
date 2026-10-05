import test from 'node:test';
import assert from 'node:assert/strict';
import netlifyApi from '../netlify/functions/api.mjs';

test('Netlify API adapter serves bootstrap data including services', async () => {
  const response = await netlifyApi(new Request('https://silah.example/api/bootstrap?profile=khalid'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profile.id, 'khalid');
  assert.equal(body.services.length, 18);
  assert.ok(Array.isArray(body.benchmarks));
});

test('Netlify API adapter serves deterministic chat without requiring AI', async () => {
  const response = await netlifyApi(new Request('https://silah.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: 'khalid',
      message: 'وش الخدمات اللي تخصني؟',
      history: [],
      scenarioState: {}
    })
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.reply, 'string');
  assert.ok(body.reply.length > 0);
  assert.ok(Array.isArray(body.results));
});
