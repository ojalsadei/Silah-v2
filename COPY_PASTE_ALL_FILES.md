# صلة V7: كل الملفات للنسخ المباشر

هذا الملف مجمع للرجوع السريع. النسخة المضغوطة هي الأسهل للتشغيل والنشر.

تاريخ التجميع: 2026-10-05

النسخة الحالية مجهزة للتشغيل المحلي وللنشر على Vercel من نفس المستودع.

## `.env.example`

`````text
GROQ_API_KEY=ضع_المفتاح_هنا
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
PORT=3000
`````

## `.gitignore`

`````text
.env
.env.*
!.env.example
node_modules/
.DS_Store
*.log
coverage/
`````

## `package.json`

`````text
{
  "name": "silah-semantic-ai-poc",
  "version": "7.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test tests/*.test.js",
    "preflight": "node scripts/preflight.js",
    "check": "node scripts/preflight.js && node --test tests/*.test.js",
    "test:100:http": "node tests/run100_http.mjs"
  },
  "engines": {
    "node": "24.x"
  }
}
`````

## `server.ts`

`````text
// Vercel detects server.ts automatically as the Node.js application entrypoint.
// The existing server.js remains the single implementation used both locally and on Vercel.
import './server.js';
`````

## `server.js`

`````text
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarks, personaById, personas, services, serviceById } from './src/knowledge.js';
import { evaluateIntent, currentServices, opportunities, changesFor } from './src/rules.js';
import { fallbackReply, fallbackRoute, shouldUseLocalRoute, understandMessage } from './src/ai.js';
import { extractDeterministicFacts } from './src/nlu.js';
import { retrieveRelevantServices, strongCandidateIds } from './src/retrieval.js';

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(root, '.env'));
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(root, 'public');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function hasAiKey() {
  const key = process.env.GROQ_API_KEY || '';
  return Boolean(key && !key.includes('ضع_المفتاح'));
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(value)
  });
  res.end(value);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function publicService(service) {
  return {
    id: service.id,
    name: service.name,
    provider: service.provider || 'وزارة الموارد البشرية والتنمية الاجتماعية',
    sector: service.sector,
    summary: service.summary,
    channel: service.channel,
    duration: service.duration,
    sourceUrl: service.sourceUrl,
    regulationUrl: service.regulationUrl || null,
    checkedAt: service.checkedAt,
    ruleFacts: service.ruleFacts,
    requiredData: service.requiredData,
    triggerSignals: service.triggerSignals || [],
    audience: service.audience || [],
    decisionPolicy: service.decisionPolicy
  };
}

function publicProfile(profile) {
  return { ...profile };
}

function mergeScenario(previous = {}, route = {}) {
  const next = { ...previous };
  const unconfirmedField = route.pendingConfirmation?.field || null;

  const mergeValue = (key, value, emptyValues = [null, undefined, '', 'unknown']) => {
    if (!emptyValues.includes(value)) next[key] = value;
  };

  mergeValue('mode', route.mode, [null, undefined, '', 'knowledge']);
  if (unconfirmedField !== 'income') mergeValue('income', route.income);
  if (unconfirmedField !== 'salary') mergeValue('salary', route.salary);
  mergeValue('delta', route.delta);
  mergeValue('jobStage', route.jobStage);
  if (route.accepted !== null && route.accepted !== undefined) next.accepted = route.accepted;
  if (route.started !== null && route.started !== undefined) next.started = route.started;
  if (route.replacesCurrentJob !== null && route.replacesCurrentJob !== undefined) next.replacesCurrentJob = route.replacesCurrentJob;
  mergeValue('endStage', route.endStage);
  if (route.ended !== null && route.ended !== undefined) next.ended = route.ended;
  mergeValue('endReason', route.endReason);
  mergeValue('incomeSource', route.incomeSource);
  mergeValue('laborDisputeTopic', route.laborDisputeTopic);

  if (route.profileOverrides && typeof route.profileOverrides === 'object') {
    next.profileOverrides = { ...(previous.profileOverrides || {}), ...route.profileOverrides };
  }

  if (Array.isArray(route.targetServiceIds) && route.targetServiceIds.length) {
    next.targetServiceIds = [...new Set(route.targetServiceIds)];
  }

  if (route.pendingConfirmation) next.pendingConfirmation = route.pendingConfirmation;
  if (route.clearPendingConfirmation) delete next.pendingConfirmation;

  next.slotMeta = { ...(previous.slotMeta || {}) };
  if (route.refinement?.money && !route.pendingConfirmation) {
    const field = route.intent === 'new_job' ? 'salary' : ['income_change', 'service_question'].includes(route.intent) ? 'income' : null;
    if (field && route[field] != null) {
      next.slotMeta[field] = {
        source: 'user_message',
        confidence: route.refinement.money.confidence,
        interpretation: route.refinement.money.interpretation,
        raw: route.refinement.money.raw || ''
      };
    }
  }

  return next;
}

function normalizeIntent(route) {
  return route.intent || 'general';
}

function ensureScenario(route, previous = {}) {
  const scenario = mergeScenario(previous, route);
  scenario.mode = route.mode || scenario.mode || 'knowledge';
  scenario.targetServiceIds = scenario.targetServiceIds || route.targetServiceIds || [];

  if (scenario.income == null && route.salary != null && route.intent === 'income_change') scenario.income = route.salary;
  if (scenario.salary == null && route.income != null && route.intent === 'new_job') scenario.salary = route.income;
  if (scenario.replacesCurrentJob === undefined) scenario.replacesCurrentJob = null;
  if (!scenario.jobStage) scenario.jobStage = 'unknown';
  if (!scenario.endStage) scenario.endStage = 'unknown';
  if (!scenario.endReason) scenario.endReason = 'unknown';
  if (!scenario.profileOverrides) scenario.profileOverrides = {};
  if (scenario.delta === undefined) scenario.delta = null;
  if (scenario.accepted === undefined) scenario.accepted = null;
  if (scenario.started === undefined) scenario.started = null;
  if (scenario.ended === undefined) scenario.ended = null;

  return scenario;
}

function enrichRouteFromHint(route, body) {
  if (!body.intentHint) return route;
  return { ...route, intent: body.intentHint, mode: body.modeHint || route.mode };
}


function simulationView(profile, intent, scenario, evaluation) {
  if (!['income_change', 'new_job', 'employment_end'].includes(intent)) return null;

  const current = [];
  const hypothetical = [];
  let title = 'معاينة أثر السيناريو';
  let status = scenario.mode === 'reported' ? 'تغيير أبلغ عنه المستفيد' : 'نسخة افتراضية فقط';

  if (intent === 'income_change') {
    const nextIncome = Number(scenario.income);
    if (!Number.isFinite(nextIncome)) return null;
    title = 'توأم الحالة للدخل';
    current.push(`الدخل الحالي ${Number(profile.totalMonthlyIncome ?? profile.salary ?? 0)} ريال`);
    hypothetical.push(`الدخل في السيناريو ${nextIncome} ريال`);
  }

  if (intent === 'new_job') {
    const salary = Number(scenario.salary);
    title = 'توأم الحالة للوظيفة الجديدة';
    current.push(profile.activeContract ? 'عقد حالي فعال' : 'لا يوجد عقد حالي فعال');
    current.push(`الدخل الحالي ${Number(profile.totalMonthlyIncome ?? profile.salary ?? 0)} ريال`);
    if (Number.isFinite(salary)) hypothetical.push(`راتب الوظيفة الجديدة ${salary} ريال`);
    const stages = {
      reviewing: 'العرض تحت المراجعة',
      accepted: 'وافقت من جهتك ولم يبدأ الدخل',
      documented: 'العقد موثق في السيناريو ولم يبدأ الدخل',
      started: 'بدأ العمل والدخل في السيناريو',
      unknown: 'مرحلة الوظيفة تحتاج تحديد'
    };
    hypothetical.push(stages[scenario.jobStage || 'unknown']);
    if (scenario.replacesCurrentJob === true) hypothetical.push('الوظيفة الجديدة بديلة عن الحالية');
    if (scenario.replacesCurrentJob === false) hypothetical.push('العقد الحالي سيبقى قائما');
  }

  if (intent === 'employment_end') {
    title = 'توأم الحالة للعلاقة الوظيفية';
    current.push(profile.activeContract ? 'العقد الحالي فعال' : 'لا يوجد عقد فعال');
    hypothetical.push(scenario.endStage === 'ended' ? 'العلاقة انتهت في السيناريو' : 'العلاقة ستنتهي ولم تنته بعد');
    const reasons = {
      fixed_expiry: 'انتهاء مدة العقد',
      resignation: 'استقالة',
      employer_termination: 'إنهاء من صاحب العمل',
      business_closed: 'انتهاء نشاط المنشأة',
      mutual: 'اتفاق متبادل',
      other: 'سبب آخر',
      unknown: 'السبب يحتاج تحديد'
    };
    hypothetical.push(reasons[scenario.endReason || 'unknown']);
  }

  const affected = [...new Set((evaluation.results || [])
    .map(item => item.serviceId)
    .filter(Boolean)
    .map(id => serviceById[id]?.name)
    .filter(Boolean))];

  return {
    active: true,
    title,
    status,
    current,
    hypothetical,
    affected,
    note: 'هذه المعاينة منفصلة عن بيانات المستفيد الحالية ولا تحدث أي سجل رسمي.'
  };
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const message = String(body.message || '').trim();
  const profile = personaById[body.profileId] || personaById.khalid;
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const history = rawHistory.length && rawHistory[rawHistory.length - 1]?.role === 'user' && String(rawHistory[rawHistory.length - 1]?.text || '').trim() === message
    ? rawHistory.slice(0, -1)
    : rawHistory;
  const previousState = body.scenarioState && typeof body.scenarioState === 'object' ? body.scenarioState : {};

  if (!message) return json(res, 400, { error: 'اكتب رسالة أولا' });

  const deterministicFacts = extractDeterministicFacts(message, previousState);
  const localRoute = fallbackRoute(message, previousState);
  const profilePriorityIds = [...new Set([
    ...currentServices(profile),
    ...opportunities(profile)
  ].map(item => item.serviceId).filter(Boolean))];

  // الاسترجاع محلي ورخيص. نحتفظ بحد أعلى صغير، لكن لا نرسل المرشحات للـAI
  // في أحداث مثل وظيفة جديدة أو تغير دخل لأن النموذج يحتاج فهم اللغة فقط.
  const localCandidateLimit = localRoute.intent === 'general' ? 3 : 2;
  const candidates = retrieveRelevantServices({
    message,
    profile,
    previousState,
    priorityIds: profilePriorityIds,
    limit: localCandidateLimit
  });

  const aiCandidates = [];

  let route = localRoute;
  let aiMode = 'local';
  let aiAttempted = false;
  let aiSucceeded = false;

  if (hasAiKey() && !shouldUseLocalRoute(localRoute, previousState)) {
    aiAttempted = true;
    try {
      route = await understandMessage({
        message,
        profile,
        history,
        scenarioState: previousState,
        deterministicFacts
      });
      aiMode = 'ai';
      aiSucceeded = true;

    } catch (error) {
      console.error('[router]', error.code || error.message);
      route = localRoute;
      aiMode = error.code === 'GROQ_TIMEOUT'
        ? 'fallback_timeout'
        : error.code === 'GROQ_RATE_LIMIT'
          ? 'fallback_rate_limit'
          : 'fallback';
    }
  }

  if (!(route.targetServiceIds || []).length) {
    const serviceAware = new Set(['service_question', 'eligibility_confirmation', 'service_application_question', 'service_status_question', 'explain_result', 'explain_effect', 'benefit_amount_question', 'social_security_impact']);
    const strongIds = strongCandidateIds(candidates);
    if (strongIds.length && (route.intent === 'general' || serviceAware.has(route.intent))) {
      route = {
        ...route,
        intent: route.intent === 'general' ? 'service_question' : route.intent,
        mode: route.mode || 'knowledge',
        targetServiceIds: strongIds,
        confidence: Math.max(Number(route.confidence || 0), 0.78)
      };
      if (aiMode === 'ai') aiMode = 'ai_retrieval';
      else if (aiMode === 'local') aiMode = 'local_retrieval';
    }
  }

  route = enrichRouteFromHint(route, body);
  let intent = normalizeIntent(route);
  if (intent === 'general' && Array.isArray(route.targetServiceIds) && route.targetServiceIds.length) intent = 'service_question';
  const scenario = ensureScenario(route, previousState);
  scenario.intent = intent;

  const routingMeta = {
    aiCalls: aiAttempted ? 1 : 0,
    aiSucceeded,
    strategy: 'semantic-frame-state-resolve-rule',
    candidateServiceIds: candidates.map(item => item.id),
    candidateCount: candidates.length,
    aiCandidateServiceIds: aiCandidates.map(item => item.id),
    aiCandidateCount: aiCandidates.length,
    refinement: {
      intent: deterministicFacts.intent,
      jobStage: deterministicFacts.jobStage,
      money: deterministicFacts.money
        ? {
            value: deterministicFacts.money.value,
            confidence: deterministicFacts.money.confidence,
            needsConfirmation: deterministicFacts.money.needsConfirmation,
            interpretation: deterministicFacts.money.interpretation
          }
        : null
    }
  };

  const referentialIntents = new Set(['eligibility_confirmation', 'service_application_question', 'service_status_question', 'explain_result', 'explain_effect']);
  if (referentialIntents.has(intent) && !(route.targetServiceIds || []).length) {
    const previousServices = [...new Map((previousState.lastResults || []).filter(item => item?.serviceId).map(item => [item.serviceId, item])).values()];
    if (previousServices.length > 1) {
      return json(res, 200, {
        reply: 'تقصد أي خدمة من النتائج اللي قبل؟',
        quickReplies: previousServices.slice(0, 4).map(item => item.title || serviceById[item.serviceId]?.name || item.serviceId),
        results: [], changes: [], route: { ...route, intent }, scenarioState: scenario,
        aiMode, aiEnabled: hasAiKey(), routingMeta, simulation: null
      });
    }
  }

  if (route.requiresClarification === 'income_source') {
    return json(res, 200, {
      reply: 'هذا الدخل من راتب وظيفة، عمل حر، أو مصدر آخر؟',
      quickReplies: ['راتب من وظيفة', 'دخل من عمل حر', 'مصدر آخر'],
      results: [], changes: [], route: { ...route, intent }, scenarioState: scenario,
      aiMode, aiEnabled: hasAiKey(), routingMeta, simulation: null
    });
  }

  if (route.requiresClarification === 'current_offer_status') {
    return json(res, 200, {
      reply: 'بعد ما غيرت رأيك، وش وضع العرض الآن؟ ما زلت موافق، أو تراجعت عنه؟',
      quickReplies: ['ما زلت موافق', 'تراجعت عنه'],
      results: [], changes: [], route: { ...route, intent }, scenarioState: scenario,
      aiMode, aiEnabled: hasAiKey(), routingMeta, simulation: null
    });
  }

  if (route.pendingConfirmation) {
    return json(res, 200, {
      reply: route.pendingConfirmation.question,
      quickReplies: route.pendingConfirmation.quickReplies || [],
      results: [],
      changes: [],
      route: { ...route, intent },
      scenarioState: scenario,
      aiMode,
      aiEnabled: hasAiKey(),
      routingMeta,
      simulation: simulationView(profile, intent, scenario, { results: [] })
    });
  }

  if (route.confirmationRejected) {
    return json(res, 200, {
      reply: 'تمام. اكتب المبلغ كامل مثل 6500 عشان ما أفترض رقم من عندي.',
      quickReplies: [],
      results: [],
      changes: [],
      route: { ...route, intent },
      scenarioState: scenario,
      aiMode,
      aiEnabled: hasAiKey(),
      routingMeta,
      simulation: simulationView(profile, intent, scenario, { results: [] })
    });
  }

  let evaluation;
  if (['explain_result', 'explain_effect'].includes(intent) && Array.isArray(previousState.lastResults) && previousState.lastResults.length) {
    evaluation = { needsClarification: false, results: previousState.lastResults, changes: previousState.lastChanges || [] };
  } else {
    evaluation = evaluateIntent(profile, intent, scenario);
  }

  if (evaluation.needsClarification) {
    return json(res, 200, {
      reply: evaluation.question,
      quickReplies: evaluation.quickReplies || [],
      results: [],
      changes: [],
      route: { ...route, intent },
      scenarioState: scenario,
      aiMode,
      aiEnabled: hasAiKey(),
      routingMeta,
      simulation: simulationView(profile, intent, scenario, evaluation)
    });
  }

  if (intent === 'general' && !(route.targetServiceIds || []).length) {
    return json(res, 200, {
      reply: 'ما لقيت ارتباطا كافيا في قاعدة صلة الحالية عشان أعطيك جواب بثقة. اشرح الحالة بتفصيل بسيط أكثر، أو اذكر اسم الخدمة أو التغيير اللي تقصده.',
      quickReplies: ['وش الخدمات اللي تخصني؟', 'وش الخدمات اللي أقدر أستفيد منها؟', 'جاني عرض وظيفي وش بيتغير؟'],
      results: [],
      changes: [],
      route: { ...route, intent },
      scenarioState: scenario,
      aiMode,
      aiEnabled: hasAiKey(),
      routingMeta,
      simulation: null
    });
  }

  const reply = fallbackReply({ route: { ...route, intent }, evaluation, profile, previousState });

  scenario.lastResults = evaluation.results || [];
  scenario.lastChanges = evaluation.changes || [];
  const serviceResults = (evaluation.results || []).filter(item => item?.serviceId);
  const primaryResult = serviceResults[0] || null;
  const routedIds = (route.targetServiceIds || []).filter(id => serviceById[id]);
  if (routedIds.length === 1) scenario.lastServiceId = routedIds[0];
  else if (serviceResults.length === 1) scenario.lastServiceId = serviceResults[0].serviceId;
  else delete scenario.lastServiceId;
  if (primaryResult && serviceResults.length === 1) scenario.lastClaim = { serviceId: primaryResult.serviceId || null, title: primaryResult.title || '', body: primaryResult.body || '', why: primaryResult.why || '' };
  else if (serviceResults.length !== 1) delete scenario.lastClaim;

  const nextReplies = intent === 'current_services'
    ? ['وش الخدمات اللي أقدر أستفيد منها؟', 'وش تغير في بياناتي؟', 'لو راتبي تغير وش يصير؟']
    : intent === 'eligible_services'
      ? ['ليش ظهرت لي هذي الخدمات؟', 'وش الخدمات اللي تخصني حاليا؟', 'لو تغير دخلي وش بيتغير؟']
      : [];

  return json(res, 200, {
    reply,
    quickReplies: nextReplies,
    results: evaluation.results || [],
    changes: evaluation.changes || [],
    route: { ...route, intent },
    scenarioState: scenario,
    aiMode,
    aiEnabled: hasAiKey(),
    routingMeta,
    simulation: simulationView(profile, intent, scenario, evaluation)
  });
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  relative = decodeURIComponent(relative);
  const full = path.normalize(path.join(publicDir, relative));
  if (!full.startsWith(publicDir)) return text(res, 403, 'Forbidden');
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return text(res, 404, 'Not found');
  const content = fs.readFileSync(full);
  res.writeHead(200, { 'Content-Type': mime(full), 'Content-Length': content.length });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        aiEnabled: hasAiKey(),
        provider: 'Groq',
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        services: services.length,
        routing: 'semantic-frame-state-resolve-rule',
        groqTimeoutMs: Number(process.env.GROQ_TIMEOUT_MS || 8500)
      });
    }

    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      const profileId = url.searchParams.get('profile') || 'khalid';
      const profile = personaById[profileId] || personaById.khalid;
      return json(res, 200, {
        aiEnabled: hasAiKey(),
        provider: 'Groq',
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
        profiles: personas.map(publicProfile),
        profile: publicProfile(profile),
        currentServices: currentServices(profile),
        opportunities: opportunities(profile),
        changes: changesFor(profile),
        services: services.map(publicService),
        benchmarks
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/profile/')) {
      const id = pathname.split('/').pop();
      const profile = personaById[id];
      if (!profile) return json(res, 404, { error: 'PROFILE_NOT_FOUND' });
      return json(res, 200, {
        profile: publicProfile(profile),
        currentServices: currentServices(profile),
        opportunities: opportunities(profile),
        changes: changesFor(profile)
      });
    }

    if (req.method === 'GET' && pathname === '/api/services') {
      return json(res, 200, { services: services.map(publicService) });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/services/')) {
      const id = pathname.split('/').pop();
      const service = serviceById[id];
      if (!service) return json(res, 404, { error: 'SERVICE_NOT_FOUND' });
      return json(res, 200, { service: publicService(service) });
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      return await handleChat(req, res);
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    return text(res, 405, 'Method not allowed');
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'حدث خطأ غير متوقع في الخادم' });
  }
});

server.listen(port, () => {
  console.log(`Silah running on http://localhost:${port}`);
  console.log(`AI mode: ${hasAiKey() ? 'enabled' : 'fallback demo'}`);
});
`````

## `render.yaml`

`````text
services:
  - type: web
    name: silah-govtech-prototype
    runtime: node
    buildCommand: ""
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: GROQ_API_KEY
        sync: false
      - key: GROQ_MODEL
        value: openai/gpt-oss-120b
      - key: PORT
        value: 10000
`````

## `SETUP_AND_START.cmd`

`````text
@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ================================
echo       Silah local setup
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist .env (
  echo Paste your Groq API key below. It will be saved only in local .env.
  echo The .env file is ignored by Git and should not be uploaded to GitHub.
  echo.
  set /p GROQKEY=Groq API key: 
  if not defined GROQKEY (
    echo No key entered. Setup stopped.
    pause
    exit /b 1
  )
  > .env echo GROQ_API_KEY=!GROQKEY!
  >> .env echo GROQ_MODEL=openai/gpt-oss-20b
  >> .env echo GROQ_TIMEOUT_MS=8500
  >> .env echo PORT=3000
  echo.
  echo Local .env created.
) else (
  echo Existing local .env found. It will be used as is.
)

echo.
echo Running project checks...
call npm run check
if errorlevel 1 (
  echo.
  echo Checks failed. Review the messages above before starting.
  pause
  exit /b 1
)

echo.
echo Starting Silah...
echo Open http://localhost:3000 after the server starts.
echo Press Ctrl+C to stop the server.
echo.
call npm start
`````

## `RUN_TESTS.cmd`

`````text
@echo off
cd /d "%~dp0"
call npm run check
pause
`````

## `README.md`

`````text
# صلة

صلة نموذج GovTech تصوري يبدأ من بيانات المستفيد، يفهم كلامه باللغة الطبيعية، ثم يمرر الحالة إلى محرك قواعد واحد يعرض الخدمات والآثار المرتبطة بشكل قابل للتفسير.

هذه النسخة تركز على جودة المحادثة. الفكرة الأساسية أن النموذج اللغوي لا يحمل المنطق النظامي ولا يحتاج رؤية كتالوج الخدمات كامل في كل رسالة.

## أسرع تشغيل

على Windows اضغط مرتين على:

```text
SETUP_AND_START.cmd
```

الصق مفتاح Groq مرة واحدة. السكربت ينشئ `.env` محليا، يشغل فحص الأمان والاختبارات، ثم يبدأ الخادم.

افتح:

```text
http://localhost:3000
```

إذا كان المنفذ مستخدما، غير `PORT` داخل `.env` إلى 3001 مثلا.

## النشر المجاني على Vercel

النسخة الحالية جاهزة للنشر مباشرة من GitHub على Vercel.

- `server.ts` هو مدخل Vercel التلقائي ويعيد استخدام نفس `server.js` بدون نسخ منطق الخادم
- التشغيل المحلي يبقى كما هو عبر `npm start`
- إصدار Node مثبت على `24.x`
- لا ترفع `.env` إلى GitHub

بعد استيراد مستودع `Silah-v2` إلى Vercel، أضف متغيرات البيئة التالية من Project Settings:

```text
GROQ_API_KEY=مفتاحك
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
```

لا تحتاج لإضافة `PORT` في Vercel. المنصة تضبط المنفذ تلقائيا.

كل Push جديد إلى فرع `main` ينشئ Deployment جديدا تلقائيا إذا كان المشروع مربوطا بالمستودع.

## واجهة العرض V7

V7 لا تغير قواعد V6، بل تجعل العرض التنفيذي أقصر وأوضح بدون حذف المحتوى:

- Benchmark من خمس تجارب حكومية يظهر كبطاقات مختصرة، والتفاصيل الكاملة تفتح عند الضغط فقط
- كل تجربة تعرض المشكلة، سبب البناء، الرحلة، التصميم، التكامل، البيانات، النتائج، التحديات، الدروس، ما طبقناه في صلة، والمصادر الرسمية
- قسم الأثر يستخدم Baseline الربع الثاني 2026 من تقرير صوت المستفيد، ثم يفصله عن سيناريو أثر افتراضي قابل لتغيير النسبة ويصرح بأن الحسبة ليست توقعا تشغيليا
- تفاصيل مؤشرات القياس ومنهجية الـPoC مطوية افتراضيا لتقليل طول الصفحة
- زر `محادثة جديدة` يمسح تاريخ المحادثة والسيناريو فقط ويحتفظ بالشخصية المختارة
- شرح `Digital Twin` متاح من علامة المعلومات بجانب توأم الحالة، ويظهر عند المرور أو التركيز بلوحة المفاتيح
- مقارنة القدرات وقراءة الدروس في Benchmark تستخدم Progressive Disclosure حتى يبقى المحتوى موجودا بدون إطالة الصفحة


### Baseline الأثر في V7

الواجهة تستخدم أرقام الربع الثاني 2026 من تقرير صوت المستفيد كنقطة قياس: 757,960 إجمالي تفاعل، 526,945 مكالمة واردة، 58,661 شكوى، و172,354 تفاعلا عبر التواصل الاجتماعي. سيناريو 5% ينتج تقريبا 26,347 مكالمة أقل في الربع و2,635 ساعة عند افتراض 6 دقائق للمكالمة. هذه حسبة حساسية للـPoC وليست Forecast.

## محرك المحادثة V6

المسار الحالي:

```text
رسالة المستفيد
      ↓
Refine محلي للنص
      ↓
استخراج حقائق واضحة مثل المبلغ والمرحلة والنفي
      ↓
دمج Session Slots السابقة
      ↓
استرجاع معرفة محدود عند الحاجة فقط
      ↓
Groq مرة واحدة إذا بقي غموض لغوي
      ↓
Validation للحقائق
      ↓
Rules Engine
      ↓
رد مبني محليا من نتائج القواعد
```

أهم الفروقات:

- `جاني شغل بستة ونص` يفهم محليا على أنه عرض وظيفي بقيمة 6500 ريال
- `وافقت بس ما باشرت` تحفظ كمرحلة قبول بدون بدء العمل أو الدخل
- `راتبي بيصير 7` لا يحول إلى 7000 بصمت، بل يطلب تأكيدا
- المعلومة الموجودة في الرسالة أو سياق الجلسة لا يسأل عنها مرة ثانية
- أسئلة الأحداث مثل وظيفة جديدة أو تغير دخل لا ترسل كتالوج الخدمات إلى Groq أصلا
- أسئلة الخدمة الغامضة ترسل بحد أقصى 3 خدمات مرشحة فقط
- اسم خدمة واضح أو سؤال واضح يمكن أن يعمل بدون AI
- Groq يستخدم للفهم اللغوي فقط، ولا يحدد الأهلية ولا يكتب القرار النهائي
- الحقائق الحتمية المحلية تتغلب على أي تصنيف متعارض من النموذج
- إذا Groq تأخر أو تعطل، صلة يرجع للمسار المحلي ولا يترك الطلب Pending
- سجل المحادثة المرسل للنموذج يقتصر على آخر 3 أدوار فقط
- رد المساعد لا يحرك نافذة المحادثة تلقائيا، موضع القراءة يبقى ثابتا حتى ينزل المستخدم بنفسه

التفاصيل في `docs/CHAT_ENGINE.md`.

### ما تغير في V6

V6 يعامل رسالة المستفيد كإطار دلالي بدل البحث عن كلمات منفصلة. الإطار يفصل بين النية والحدث والنفي والزمن والمرحلة والمبلغ ونوع المبلغ والخدمة المرجعية، ثم يدمج هذه الحقائق مع حالة المحادثة قبل تشغيل القواعد.

أمثلة مهمة:

- `جاني عرض ب6500 بس ما وافقت عليه` يصبح عرضا تحت المراجعة مع `accepted=false`
- `راتبي انخفض 500 ريال` يصبح فرق دخل `-500` وليس راتبا نهائيا بقيمة 500
- `زاد راتبي 1000` يحسب الأثر على الراتب الحالي بدل استبداله بـ1000
- `ليش الضمان ممكن يتأثر؟` يشرح أثر آخر سيناريو على الضمان، وليس سبب ظهور خدمة الضمان
- `يعني أنا مؤهل أكيد؟` يرجع إلى آخر خدمة تمت مناقشتها ويجيب عن درجة الأهلية بدل إعادة قائمة الخدمات
- `طيب أقدر أقدم عليه؟` يحل مرجع `عليه` من سياق المحادثة
- `إذا انفصلت من الوظيفة هل الضمان يصير مناسب؟` يمثل حدث فقد الوظيفة وسؤال الضمان في نفس الإطار


## فهم اللهجة والأرقام

`src/nlu.js` مسؤول عن طبقة فهم حتمية قبل الذكاء الاصطناعي.

أمثلة مدعومة:

```text
جاني عرض بستة ونص       -> 6500
جاني عرض بـ٦ ونص        -> 6500
جاني عرض ب6.5           -> 6500
جاني عرض بثمانية ونص    -> 8500
راتب الوظيفة 12 ألف     -> 12000
راتب العرض 6500         -> 6500
```

الحالات المختصرة التي تحتمل أكثر من تفسير تستخدم Confirmation بدل الافتراض.

## قاموس لغة قابل للتوسعة

`data/language_glossary.json` يفصل لغة المستفيد عن المصطلحات الرسمية.

أمثلة:

```text
حافز -> إعانة البحث عن عمل
الضمان -> الضمان الاجتماعي المطور
ما باشرت -> الوظيفة لم تبدأ فعليا
بديلة عن وظيفتي -> الوظيفة الجديدة تستبدل الحالية
```

إضافة مرادف جديد لا تحتاج تعديل محرك القواعد.

## منطق الخدمة

قاعدة مهمة:

```text
غير مستفيد حاليا
لا تعني
لا يمكن التقديم
ولا تعني
غير مؤهل
```

صلة يتعامل مع أربع حالات منفصلة لكل خدمة:

```text
Current Enrollment
Application Availability
Eligibility Status
Context Relevance
```

ويراعي ثلاثة أنواع للحقيقة:

```text
Current
Reported
What If
```

راجع `docs/LOGIC_MODEL.md`.

## استرجاع الخدمات

لا يتم إرسال 18 خدمة إلى النموذج في كل رسالة.

- حدث وظيفي أو تغير دخل: صفر خدمات ترسل للـAI
- سؤال خدمة غامض: عادة 1 إلى 3 خدمات مرشحة
- اسم خدمة مباشر: غالبا يحسم محليا
- المحرك الكامل يظل متاحا بعد فهم السؤال لتقييم النتائج حسب قواعده

`src/retrieval.js` مسؤول عن الاسترجاع، وليس عن الأهلية.

## الخدمات الموجودة

قاعدة المعرفة الحالية تشمل 18 خدمة ومنتجا، منها:

- الضمان الاجتماعي المطور
- الاعتراض على إيقاف معاش الضمان
- إدارة العقود
- إنهاء العلاقة التعاقدية
- التسوية الودية للخلافات العمالية
- حاسبة مكافأة نهاية الخدمة
- تقييم الإعاقة
- الإعانة المالية للأشخاص ذوي الإعاقة
- التسهيلات المرورية
- توثيق عقود العمالة المنزلية
- بطاقة امتياز كبار السن
- إعانة البحث عن عمل
- تمهير
- دروب
- دعم الشهادات المهنية
- وصول
- قرة
- سبل

التفاصيل والقواعد والمصادر داخل `data/services.json`.

## حماية من التعليق

`src/ai.js` يستخدم `AbortController` مع مهلة زمنية صريحة.

كل رسالة تستخدم صفر أو طلب AI واحد فقط. لا يوجد طلب AI ثان لصياغة الرد.

في استجابة `/api/chat` يوجد `routingMeta` للمراجعة التقنية:

```json
{
  "aiCalls": 1,
  "aiSucceeded": true,
  "strategy": "refine-extract-retrieve-validate-rule",
  "candidateServiceIds": [],
  "aiCandidateServiceIds": [],
  "refinement": {
    "intent": "new_job",
    "jobStage": "accepted",
    "money": {
      "value": 6500,
      "needsConfirmation": false
    }
  }
}
```

إذا كان السؤال واضحا محليا، `aiCalls` يساوي 0.

## ثبات المحادثة أثناء القراءة

الواجهة لا تعمل Auto Scroll عند وصول الرد.

- نحفظ `scrollTop` قبل إضافة الرسالة
- نعيد نفس الموضع بعد تحديث DOM
- حقل الكتابة يستخدم `preventScroll`
- `overflow-anchor` معطل داخل منطقة الرسائل

بهذا المستخدم يقرر بنفسه متى ينزل لقراءة الرد.

## الأثر المتوقع

المنصة لا تدعي نسب نجاح غير مقاسة. قسم الأثر يحدد مؤشرات يمكن قياسها في PoC مثل:

- وقت الوصول للخدمة المناسبة
- الرحلات غير المناسبة قبل التقديم
- إعادة إدخال البيانات الموجودة مسبقا
- الخدمات التي اكتشفها المستفيد بدون معرفة اسمها
- نسبة الاستفسارات التي اكتملت ذاتيا
- وضوح أثر القرار قبل حدوثه

## Benchmark

`data/benchmarks.json` يحتوي مقارنة تفصيلية مع:

- LifeSG في سنغافورة
- الخدمات الحكومية الاستباقية في إستونيا
- Mes Droits Sociaux في فرنسا
- Tell Us Once في المملكة المتحدة
- myGov User Audit في أستراليا

## الاختبارات

شغل:

```powershell
npm test
```

أو:

```powershell
npm run check
```

النسخة الحالية تحتوي 154 اختبارا. منها Gold Set من 100 رسالة واقعية تغطي فهم النية، النفي، المراحل الزمنية، الأرقام العامية، فرق الدخل، الإحالة إلى آخر خدمة، أهلية الخدمة، الوظائف والعقود والضمان والخلافات العمالية. تم تشغيل المجموعة كاملة على مسار HTTP المحلي ونجحت 100 من 100 حالة.

## النشر على GitHub

المشروع جاهز للرفع بدون `.env`.

اقرأ:

```text
GITHUB_PUBLISH.md
```

`.env` متجاهل في `.gitignore` و`.env.example` فقط هو الذي يرفع.

GitHub Pages وحده لا يشغل `server.js`. النسخة الحية تحتاج استضافة Node.js مع `GROQ_API_KEY` كمتغير بيئة على الخادم.

## الملفات المهمة

- `START_HERE.md`: أقصر طريق للتشغيل
- `SETUP_AND_START.cmd`: إعداد المفتاح وتشغيل المشروع على Windows
- `server.js`: API والتنسيق بين الفهم والاسترجاع والقواعد
- `src/nlu.js`: الأرقام العامية والنفي والمراحل والحقائق الحتمية
- `src/retrieval.js`: اختيار الخدمات المرشحة بشكل محدود
- `src/ai.js`: فهم اللغة عبر Groq عند الحاجة فقط
- `src/rules.js`: محرك القواعد
- `src/knowledge.js`: تحميل قاعدة المعرفة والقاموس
- `data/language_glossary.json`: لغة المستخدم والمرادفات
- `data/services.json`: كتالوج الخدمات
- `docs/CHAT_ENGINE.md`: تصميم محرك المحادثة والمراجع
- `public/`: الواجهة
- `tests/`: اختبارات المنطق والمعمارية

## البيانات

كل الشخصيات والبيانات داخل النموذج افتراضية. القواعد المعروضة مبنية على مصادر رسمية منشورة داخل كتالوج الخدمات وملاحظات المصادر. النموذج لا يمثل قرار أهلية رسمي أو تفسيرا قانونيا رسميا.
`````

## `START_HERE.md`

`````text
# ابدأ من هنا

## أسرع تشغيل على Windows

1. فك ضغط المشروع
2. اضغط مرتين على `SETUP_AND_START.cmd`
3. الصق مفتاح Groq عندما يطلبه
4. انتظر نجاح الفحص وتشغيل الخادم
5. افتح `http://localhost:3000`

المفتاح يحفظ محليا في `.env`. الملف متجاهل في Git.

إذا كان المنفذ 3000 مستخدما، افتح `.env` وغير:

```env
PORT=3001
```

ثم افتح `http://localhost:3001`.

## التشغيل اليدوي

```powershell
Copy-Item .env.example .env
```

ثم داخل `.env`:

```env
GROQ_API_KEY=gsk_ضع_مفتاحك_هنا
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
PORT=3000
```

بعدها:

```powershell
npm run check
npm start
```

## النشر على Vercel

المشروع جاهز لـVercel بدون تحويله إلى مشروع Frontend منفصل.

1. اربط مستودع GitHub `ojalsadei/Silah-v2` في Vercel
2. اترك Root Directory على جذر المشروع
3. لا تحتاج Build Command مخصص
4. أضف متغيرات البيئة:

```text
GROQ_API_KEY=مفتاح Groq
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
```

5. اضغط Deploy
6. بعد النشر افتح `/api/health` على رابط Vercel وتأكد أن `ok` تساوي `true`

ملاحظات:

- `server.ts` موجود فقط ليكتشف Vercel تطبيق Node تلقائيا
- `server.js` يبقى المصدر الفعلي للخادم محليا وعلى Vercel
- لا تضف `PORT` في Vercel
- لا ترفع `.env` إلى GitHub


## وش الجديد في V7 للعرض التنفيذي

- زر `محادثة جديدة` يبدأ جلسة نظيفة مع بقاء الشخصية المختارة
- علامة المعلومات بجانب `توأم الحالة` تشرح Digital Twin عند المرور أو التركيز
- Benchmark مختصر في الصفحة، والتفاصيل التنفيذية الكاملة لكل تجربة تفتح عند الضغط: المشكلة، الرحلة، التصميم، التكامل، البيانات، النتائج، التحديات والدروس
- قسم الأثر يستخدم Baseline الربع الثاني 2026 وسيناريو حساسية 3% و5% و10%، مع توضيح أن الحسبة افتراضية وليست Forecast
- المقارنات ومنهجية القياس مطوية افتراضيا لتقليل طول الصفحة بدون حذف المحتوى

## اختبار الصحة

افتح:

```text
http://localhost:3000/api/health
```

المفروض يظهر:

```json
{
  "ok": true,
  "aiEnabled": true,
  "routing": "semantic-frame-state-resolve-rule"
}
```

## اختبارات سريعة للمحادثة

خالد:

```text
جاني شغل بستة ونص ووافقت بس للحين ما باشرت، وش بيتغير علي؟
```

المفروض يعرف 6500 ولا يسأل عن الراتب، ثم يسأل فقط عن وضع الوظيفة الحالية إذا كان ذلك ضروريا.

اختبار رقم مختصر:

```text
راتبي بيصير 7
```

المفروض يسأل:

```text
تقصد 7,000 ريال؟
```

ريم:

```text
بنفصل من وظيفتي، هل الضمان ممكن يناسبني؟
```

المفروض لا يعتبر عدم الاستفادة الحالية مانعا من التقديم أو دليلا على عدم الأهلية.

## قبل GitHub

اقرأ `GITHUB_PUBLISH.md` وشغل:

```powershell
npm run check
```

## اختبار الـ100 حالة

بعد تشغيل الخادم على المنفذ الموجود في `.env` شغل:

```powershell
npm run test:100:http
```

يمكنك تحديد عنوان مختلف:

```powershell
$env:SILAH_URL="http://localhost:3001"
npm run test:100:http
```

الـGold Set موجود في `tests/gold100.json`.
`````

## `GITHUB_PUBLISH.md`

`````text
# نشر صلة على GitHub بأمان

المشروع جاهز للرفع إلى GitHub بدون ملف `.env` وبدون مفتاح Groq.

## قبل أول رفع

شغل:

```powershell
npm run check
```

ثم تأكد أن `.env` متجاهل:

```powershell
git check-ignore -v .env
```

المفروض يظهر أن قاعدة `.env` في `.gitignore` هي التي تجاهلت الملف.

## أول رفع إلى مستودع جديد

من داخل مجلد المشروع:

```powershell
git init
git add .
git status
git commit -m "Initial Silah GovTech prototype"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

قبل `git commit` راجع `git status`. يجب ألا يظهر `.env` ضمن الملفات المضافة.

## إذا رفعت مفتاحا بالخطأ سابقا

حذف `.env` من آخر نسخة لا يكفي لأن المفتاح قد يبقى في Git history.

1. احذف المفتاح من Groq Console
2. أنشئ مفتاحا جديدا
3. تأكد أن `.env` داخل `.gitignore`
4. لا تستخدم المفتاح القديم مرة ثانية

## النشر الحي المجاني

GitHub Pages وحده لا يناسب صلة لأن المشروع يحتوي Backend وGroq API. النسخة الحالية مجهزة للنشر على Vercel مباشرة من نفس المستودع.

في Vercel:

1. استورد مستودع `Silah-v2`
2. استخدم فرع `main` للإنتاج
3. أضف `GROQ_API_KEY` في Environment Variables
4. أضف `GROQ_MODEL=openai/gpt-oss-20b`
5. أضف `GROQ_TIMEOUT_MS=8500`
6. لا تضف `.env` إلى GitHub ولا تضع المفتاح داخل أي ملف عام

`server.ts` هو مدخل Vercel، ويستورد نفس `server.js` المستخدم محليا. لا يوجد Backend منفصل ولا رابط API منفصل.

يبقى `render.yaml` داخل المشروع فقط للتوافق مع الاستضافة السابقة ويمكن حذفه لاحقا بعد التأكد من نجاح Vercel إذا لم تعد تحتاج Render.
`````

## `SECURITY.md`

`````text
# Security notes

- لا تضع `GROQ_API_KEY` داخل `public/` أو أي JavaScript يصل إلى المتصفح
- المفتاح المحلي يجب أن يبقى في `.env`
- `.env` متجاهل عبر `.gitignore`
- `.env.example` يحتوي أسماء المتغيرات فقط ولا يحتوي سرا حقيقيا
- في الاستضافة استخدم Environment Variables في لوحة مزود الاستضافة
- إذا ظهر مفتاح حقيقي في GitHub في أي وقت، ألغ المفتاح وأنشئ غيره
- بيانات الشخصيات في هذا النموذج افتراضية ولا يجب استبدالها ببيانات مستفيدين حقيقية في نسخة عامة
`````

## `SOURCE_NOTES.md`

`````text
# ملاحظات المصادر

تاريخ المراجعة: 2026-10-04

هذا الملف يوثق المصادر العامة المستخدمة لبناء قاعدة صلة وBenchmark. النتائج داخل النموذج لا تمثل قرار أهلية رسمي.

## وزارة الموارد البشرية والتنمية الاجتماعية

دليل الخدمات:
https://www.hrsd.gov.sa/ministry-services

صفحة تقارير صوت المستفيد الرسمية:
https://www.hrsd.gov.sa/ministry/e-participation/beneficiary-voice-reports

قسم الأثر يستخدم Baseline الربع الثاني 2026 كما هو موثق في تقرير صوت المستفيد: 757,960 إجمالي تفاعل، 526,945 مكالمة واردة، 58,661 شكوى، و172,354 تفاعلا عبر التواصل الاجتماعي. صفحة الوزارة الحالية تعرض تقرير Q2 2026 ضمن التقارير الرسمية.

سيناريو الأثر يطبق حساسية 3% و5% و10% على المكالمات الواردة. عند 5% تكون الحسبة 26,347 مكالمة أقل في الربع تقريبا، و2,635 ساعة عمل إذا افترضنا 6 دقائق للمكالمة، و105,388 مكالمة سنويا إذا تكرر نفس الحجم. هذه فرضية PoC وليست Forecast ولا وعدا تشغيليا.

أزلنا من واجهة الأثر أرقام الخدمات والمعاملات التي كانت تظهر سابقا من الصفحة الرئيسية لأن العرض الحالي للموقع يعتمد على قيم محملة ديناميكيا ولا نريد تثبيت رقم لا يمكن التحقق منه بثبات من الصفحة العامة.

### الضمان الاجتماعي المطور
https://www.hrsd.gov.sa/ministry-services/services/%D9%86%D8%B8%D8%A7%D9%85-%D8%A7%D9%84%D8%B6%D9%85%D8%A7%D9%86-%D8%A7%D9%84%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9%D9%8A-%D8%A7%D9%84%D9%85%D8%B7%D9%88%D8%B1

مرجع النظام واللائحة:
https://www.hrsd.gov.sa/knowledge-centre/decisions-and-regulations/regulation-and-procedures/841045

قاعدة تصميم صلة:
عدم كون الشخص مستفيدا حاليا لا يعني عدم إمكانية التقديم ولا يعني عدم الأهلية. الأهلية تعتمد على الدخل المحتسب وبقية الشروط والبيانات المطلوبة.

### خدمات أخرى من الوزارة

- اعتراض على إيقاف معاش الضمان
- إدارة العقود
- إنهاء العلاقة التعاقدية
- التسوية الودية للخلافات العمالية
- حاسبة مكافأة نهاية الخدمة
- تقييم الإعاقة
- الإعانة المالية للأشخاص ذوي الإعاقة
- الشهادات الرقمية للتسهيلات المرورية
- التوثيق الإلكتروني لعقود العمالة المنزلية
- بطاقة امتياز لكبار السن

كل رابط تفصيلي محفوظ داخل `data/services.json` مع تاريخ المراجعة والقواعد التي نمذجناها.

## صندوق تنمية الموارد البشرية

### إعانة البحث عن عمل
https://www.hrdf.org.sa/products-and-services/programs/individuals/other/job-search-subsidy/

ملاحظات نمذجت في صلة:

- سعودي
- مقيم بشكل دائم
- قادر وجاد في البحث عن عمل
- العمر 20 إلى 40 سنة
- غير موظف
- لا معاش تقاعدي
- لا تعويض ضد التعطل
- لا معاش ضمان اجتماعي
- ليس طالبا أو متدربا
- لا نشاط تجاري
- الدخل والثروة وسجل الاستفادة والتواريخ عناصر مطلوبة للتحقق

### تمهير
https://www.hrdf.org.sa/products-and-services/programs/individuals/training/graduate-development/

### دروب
https://www.hrdf.org.sa/products-and-services/programs/individuals/training/online-training-doroob-individuals/

### دعم الشهادات المهنية
https://www.hrdf.org.sa/products-and-services/programs/individuals/training/professional-certificates/

### وصول
https://www.hrdf.org.sa/products-and-services/programs/individuals/enable/wusool/

### قرة
https://www.hrdf.org.sa/products-and-services/programs/individuals/enable/childcare-support-for-working-women/

### سبل
https://www.hrdf.org.sa/products-and-services/programs/individuals/guidance/career-guidance-sobol/

## Benchmark

### سنغافورة: LifeSG

GovTech LifeSG:
https://www.tech.gov.sg/products-and-services/for-citizens/digital-services/lifesg/

A Decade of Impact:
https://www.tech.gov.sg/a-decade-of-impact/

Milestone Tracker:
https://www.life.gov.sg/preparing-our-nations-sons

المعلومات المستخدمة في الواجهة تشمل قرابة مليوني مستخدم وأكثر من 130 خدمة ومزية حسب GovTech في 2026، وتحسن زمن تسجيل الولادة من نحو ساعة إلى 15 دقيقة. صفحة LifeSG توضح كذلك عرض المزايا وحالة الطلبات والمواعيد وملفا شخصيا يجمع معلومات من جهات حكومية متعددة. GovTech يوضح أن Singpass يدعم النماذج المعبأة مسبقا ببيانات موثقة.

### إستونيا: Proactive Government Services

https://ria.ee/en/state-information-system/personal-services/proactive-government-services

استخدمنا مفهوم أحداث الحياة وService Owner وإخفاء تعقيد الجهات عن المستخدم. RIA تنشر أكثر من 478 ألف زيارة للخدمات الاستباقية في 2025، منها 179,362 لمسار التقاعد و88,687 لمسار الزواج.

### فرنسا: Mes Droits Sociaux

https://www.mesdroitssociaux.gouv.fr/votre-simulateur/

المحاكي الحالي يعلن تقدير 58 مساعدة في أقل من 15 دقيقة. وتوضح البوابة أن البيانات المعبأة مسبقا تأتي من المجالين الاجتماعي والضريبي، وأن ما يدخله المستخدم في المحاكاة لا يعد تصريح تغيير ولا يحدث بياناته لدى الجهات. النتائج إرشادية. في صلة استلهمنا هذا الفصل وطبقناه كـ Digital Twin مستقل. المصطلح نفسه قرار تصميمي في صلة وليس اسما تستخدمه البوابة الفرنسية.

### المملكة المتحدة: Tell Us Once

مسح 2013:
https://www.gov.uk/government/news/award-winning-government-service-achieves-98-satisfaction-rate-amongst-customers

تحليل المسح:
https://www.gov.uk/government/publications/tell-us-once-customer-service-survey-analysis

الخدمة الحالية على GOV.UK تتيح الإبلاغ عن الوفاة إلى معظم الجهات الحكومية دفعة واحدة. مؤشرات 98% و100% و95%+ و500 ألف مستخدم تعود لمسح 2013، لذلك هي موسومة داخل صلة كأرقام تاريخية وليست أداء حاليا.

### أستراليا: myGov User Audit

https://my.gov.au/content/dam/mygov/documents/audit/mygov-useraudit-jan2023-volume2.pdf

التجربة مستخدمة كدرس تحذيري. التدقيق يوثق أن 7 من 15 خدمة عضو استخدمت Tell Us Once في يونيو 2022، وأن 34% من تحديثات التفاصيل الشخصية قبلت مباشرة في يناير 2022، بينما 38% احتاجت تدخلا إضافيا من الموظفين. كما يوثق اختلاف التشريعات وجودة البيانات وعدم تطابق الحقول وضعف إبلاغ المستخدم بنتيجة التحديث. صفحة التدقيق الحالية توضح أن الحكومة وافقت أو وافقت من حيث المبدأ على 9 من 10 توصيات التقرير.
`````

## `data/benchmarks.json`

`````text
[
  {
    "id": "lifesg",
    "country": "سنغافورة",
    "name": "LifeSG",
    "headline": "الخدمات حول حياة الشخص، مو حول أسماء الجهات",
    "pattern": "تجميع الخدمات والتوصيات والمتابعة بحسب مرحلة حياة المستفيد واحتياجه",
    "why": "بدأت التجربة باسم Moments of Life في 2018 ضمن مبادرات Smart Nation. المشكلة التي وصفتها GovTech كانت أن الشخص الواحد يحمل أدوارا كثيرة، أب وموظف ومالك مركبة ومتطوع، وقد يضطر للتنقل بين عدة تطبيقات ومواقع حكومية. GovTech ذكرت أن سنغافورة كان لديها نحو 170 تطبيقا حكوميا مرتبطا بالجهات في 2019، لذلك كان الاتجاه هو الانتقال من تنظيم الخدمات حسب الجهة إلى تنظيمها حسب حاجة المواطن ومرحلة حياته.",
    "whatTheyBuilt": [
      "منصة موحدة للويب والتطبيق تجمع خدمات حكومية من جهات متعددة",
      "توصيات مخصصة بحسب الملف ومرحلة الحياة",
      "فحوص أهلية وحاسبات تساعد المستخدم يكتشف الدعم المناسب",
      "دمج عدة معاملات في رحلة واحدة، مثل تسجيل الولادة مع Baby Bonus وعضوية المكتبة",
      "Inbox شخصي للرسائل والمواعيد، مع متابعة بعض المراحل الحكومية من مكان واحد",
      "إعادة استخدام البيانات المعروفة لتقليل التكرار والتنقل بين الجهات"
    ],
    "results": [
      "في 2026 ذكرت GovTech أن LifeSG يخدم قرابة مليوني مستخدم",
      "يجمع أكثر من 130 خدمة حكومية من 21 جهة في تجربة واحدة",
      "تسجيل الولادة انخفض من نحو 60 دقيقة إلى 15 دقيقة، أي أسرع بنحو 75%",
      "بحلول 2022 كان 80% من الآباء المؤهلين للتسجيل إلكترونيا يختارون LifeSG لتسجيل الولادة"
    ],
    "metrics": [
      {
        "label": "مستخدمون",
        "value": "≈2M"
      },
      {
        "label": "خدمات حكومية",
        "value": "130+"
      },
      {
        "label": "جهات",
        "value": "21"
      },
      {
        "label": "زمن تسجيل الولادة",
        "value": "15 min"
      }
    ],
    "appliedToSilah": [
      "نبدأ من حالة المستفيد والتغيير اللي صار له، مو من اسم الجهة",
      "نقترح الخدمات المرتبطة بالملف بدل عرض كتالوج كامل",
      "نستخدم البيانات المعروفة مسبقا ونطلب فقط المعلومة الناقصة",
      "نصمم صلة كقدرة مشتركة يمكن أن تظهر في أكثر من قناة"
    ],
    "caution": "التخصيص الحقيقي يحتاج بنية بيانات ومشاركة بيانات موثوقة خلف الواجهة. التجربة الجيدة ليست مجرد تجميع روابط.",
    "capabilities": [
      "personalisation",
      "life_events",
      "eligibility_checks",
      "tracking",
      "notifications",
      "profile_reuse"
    ],
    "sources": [
      {
        "label": "GovTech: A Decade of Impact",
        "url": "https://www.tech.gov.sg/a-decade-of-impact/"
      },
      {
        "label": "GovTech: LifeSG",
        "url": "https://www.tech.gov.sg/products-and-services/for-citizens/digital-services/lifesg/"
      },
      {
        "label": "LifeSG: Birth registration",
        "url": "https://www.life.gov.sg/about-us/birth-registration"
      },
      {
        "label": "GovTech: LifeSG story",
        "url": "https://www.tech.gov.sg/technews/moments-of-life-is-now-lifesg-story-so-far/"
      }
    ],
    "sourceDate": "2026-10-04",
    "problem": "الخدمات الحكومية كانت موزعة حسب الجهة، بينما احتياج الشخص يظهر كحدث أو مرحلة حياة. هذا يرفع التنقل بين المواقع ويجعل المستفيد هو من يربط الخدمات ببعضها.",
    "whyBuilt": "بدأت Moments of Life في 2018 ثم تطورت إلى LifeSG لتجميع الخدمات والمعلومات الحكومية حول احتياجات الحياة اليومية بدلا من هيكل الجهات.",
    "journey": [
      "يدخل المستفيد إلى منصة واحدة ويشاهد خدمات ومزايا مرتبطة بمرحلة حياته",
      "في رحلة الولادة يمكن تسجيل الطفل والتقديم على Baby Bonus وعضوية المكتبة ضمن نفس المسار عند انطباق الشروط",
      "التطبيق يعرض مزايا حكومية وحالة بعض الطلبات والمواعيد والتنبيهات من مكان واحد"
    ],
    "design": [
      "تنظيم الخدمات حول مراحل الحياة والمهام بدل أسماء الجهات",
      "Personalisation ومحتوى مرتبط بالسياق مع إبقاء الكتالوج متاحا عند الحاجة",
      "Inbox ومواعيد وحالة طلبات لتقليل الانتقال بين القنوات"
    ],
    "integration": [
      "LifeSG يعمل كواجهة موحدة فوق خدمات جهات حكومية متعددة",
      "Singpass يوفر هوية رقمية موثوقة ويدعم النماذج المعبأة مسبقا ببيانات موثقة",
      "الملف الشخصي في LifeSG يعرض معلومات قادمة من أكثر من جهة حكومية"
    ],
    "dataUsed": [
      "بيانات الهوية عبر Singpass",
      "بيانات الملف الشخصي من جهات حكومية متعددة",
      "بيانات الأسرة والاستحقاقات المطلوبة في الرحلة",
      "حالة الطلبات والمواعيد والتنبيهات عندما تكون متاحة"
    ],
    "challenges": [
      "قيمة التخصيص تعتمد على جودة البيانات واتساقها بين الجهات",
      "تجميع الخدمات لا يكفي إذا بقيت الرحلات الخلفية منفصلة أو تطلب إدخالا مكررا",
      "المنصة تحتاج حدودا واضحة لما هو معلومة معروضة وما هو تنفيذ فعلي داخل النظام المصدر"
    ],
    "lessons": [
      "نبدأ من الحدث والسياق قبل اسم الخدمة",
      "نستخدم البيانات المعروفة لتقليل الأسئلة",
      "نجمع الاكتشاف والمتابعة في تجربة واحدة بدون الادعاء أن كل شيء ينفذ داخل صلة"
    ]
  },
  {
    "id": "estonia",
    "country": "إستونيا",
    "name": "Proactive Government Services",
    "headline": "حدث الحياة هو الرحلة، والجهات تبقى خلف الكواليس",
    "pattern": "تجميع الحقوق والالتزامات والخطوات المرتبطة بحدث واحد في خدمة استباقية مشتركة",
    "why": "هيئة نظم المعلومات الإستونية RIA تشرح أن أحداث الحياة مثل الزواج أو التقاعد تخلق حقوقا والتزامات موزعة بين جهات كثيرة، وأن هذا يجعل النظام معقدا على الشخص. لذلك صمموا الخدمات الاستباقية بحيث تجمع الأنشطة الحكومية المرتبطة بحدث واحد داخل قناة وطنية واحدة، بدلا من جعل المواطن يعرف كل جهة على حدة.",
    "whatTheyBuilt": [
      "خدمات تتمحور حول حدث حياة أو حدث عمل مثل التقاعد والزواج وولادة طفل",
      "رحلة واحدة تضم أنشطة من عدة مؤسسات حكومية",
      "عرض الخطوات المنجزة والخطوات المتبقية للمستخدم المسجل",
      "متابعة بعض الحالات الشخصية عبر eesti.ee بعد موافقة المستخدم عند الحاجة",
      "نموذج Service Owner واضح للتنسيق بين الجهات المشاركة",
      "إخفاء تعقيد التكامل المؤسسي عن المستفيد قدر الإمكان"
    ],
    "results": [
      "الخدمات الاستباقية سجلت أكثر من 478 ألف زيارة خلال 2025",
      "مسار التقاعد سجل 179,362 زيارة وكان الأعلى استخداما",
      "مسار الزواج سجل 88,687 زيارة",
      "RIA تعرض رضا عاما عن بوابة eesti.ee بلغ 85.9 وفق منهجية CSAT في بياناتها المنشورة"
    ],
    "metrics": [
      {
        "label": "زيارات 2025",
        "value": "478K+"
      },
      {
        "label": "التقاعد",
        "value": "179,362"
      },
      {
        "label": "الزواج",
        "value": "88,687"
      },
      {
        "label": "رضا بوابة eesti.ee",
        "value": "85.9"
      }
    ],
    "distribution": [
      {
        "label": "التقاعد",
        "value": 179362
      },
      {
        "label": "الزواج",
        "value": 88687
      },
      {
        "label": "الالتزام الدفاعي",
        "value": 32315
      },
      {
        "label": "الطلاق",
        "value": 26574
      },
      {
        "label": "الاستقرار في إستونيا",
        "value": 24730
      },
      {
        "label": "ولادة طفل",
        "value": 18352
      },
      {
        "label": "وفاة قريب",
        "value": 15066
      }
    ],
    "appliedToSilah": [
      "نعامل التغيير كحدث له خدمات وآثار مرتبطة، مو كسؤال منفصل",
      "نحتاج Event Catalog يحدد الأحداث عالية القيمة التي نبدأ بها",
      "كل رحلة مستقبلية تحتاج مالك واضح للقواعد والتكامل",
      "حالة التنفيذ والمراحل يجب أن تكون مرئية للمستفيد"
    ],
    "caution": "الاستباقية تحتاج Consent واضح عندما تتطلب متابعة بيانات شخصية بين أكثر من جهة.",
    "capabilities": [
      "life_events",
      "proactive",
      "multi_agency",
      "progress_tracking",
      "consent",
      "service_owner"
    ],
    "sources": [
      {
        "label": "RIA: Proactive Government Services",
        "url": "https://ria.ee/en/state-information-system/personal-services/proactive-government-services"
      },
      {
        "label": "RIA: State portal eesti.ee",
        "url": "https://www.ria.ee/en/state-information-system/personal-services/state-portal-eestiee"
      }
    ],
    "sourceDate": "2026-10-04",
    "problem": "حدث واحد مثل التقاعد أو الزواج يخلق حقوقا والتزامات موزعة بين مؤسسات كثيرة، وهذا يجعل الشخص يتعامل مع تعقيد الهيكل الحكومي بنفسه.",
    "whyBuilt": "RIA صممت Proactive Government Services لتجميع الأنشطة المرتبطة بحدث حياة أو عمل في خدمة واحدة عبر قناة وطنية واحدة، مع إبقاء التعاون بين الجهات خلف الكواليس.",
    "journey": [
      "يختار المستخدم أو يصل إلى حدث حياة في eesti.ee",
      "تظهر الأنشطة والحقوق والالتزامات المرتبطة بالحدث في تسلسل منطقي",
      "تتعاون المؤسسات المشاركة تحت تنسيق Service Owner واحد",
      "تظهر للمستخدم الخطوات المطلوبة وحالة ما تم إنجازه بحسب الخدمة"
    ],
    "design": [
      "Life-event first بدل agency first",
      "رحلة واحدة تحتوي أنشطة من جهات متعددة",
      "Service Owner مسؤول عن تنسيق الرحلة وقواعدها مع الجهات وRIA"
    ],
    "integration": [
      "eesti.ee يعمل كقناة وطنية تعرض الخدمات الاستباقية",
      "التنفيذ يعتمد على تعاون مؤسسات متعددة وبنية الدولة الرقمية القابلة للتشغيل البيني",
      "RIA توثق X-tee كطبقة تبادل بيانات ضمن منظومة الدولة الرقمية، لكن تفاصيل كل رحلة تختلف حسب الجهات المشاركة"
    ],
    "dataUsed": [
      "بيانات الحدث والحالة الموجودة لدى الجهات المشاركة",
      "بيانات الهوية والحساب في القناة الوطنية",
      "حالة الخطوات والحقوق أو الالتزامات المرتبطة بالحدث",
      "Consent عندما تتطلب الخدمة متابعة أو مشاركة بيانات شخصية"
    ],
    "challenges": [
      "تحتاج كل رحلة إلى مالك خدمة وصلاحيات واضحة بين الجهات",
      "الاستباقية لا تلغي متطلبات الخصوصية والموافقة",
      "نجاح الواجهة مرتبط بنضج التكامل وتعريف المسؤوليات خلفها"
    ],
    "lessons": [
      "Event Catalog أهم من قائمة خدمات مسطحة",
      "كل حدث عالي القيمة يحتاج Service Owner واضح",
      "حالة التنفيذ يجب أن تكون مرئية ولا تفترض النجاح لمجرد اكتشاف الخدمة"
    ]
  },
  {
    "id": "france",
    "country": "فرنسا",
    "name": "Mes Droits Sociaux",
    "headline": "افصل المحاكاة عن الحقيقة، وخلي النتيجة تقديرية وواضحة",
    "pattern": "محاكاة عدة حقوق اجتماعية في جلسة واحدة مع بيانات معروفة مسبقا وإمكانية تجربة تغيرات الحالة",
    "why": "بوابة Mes Droits Sociaux صممت لتجمع رؤية الحقوق الاجتماعية وتقلل حاجة المستخدم للبحث في كل برنامج على حدة. وفي مشروع تحسين UX الحكومي عام 2020 كان التحدي المعلن هو تبسيط التجربة بحسب حاجة المستخدم الفورية، استخدام لغة مفهومة، وتحسين إكمال المحاكاة حتى عندما لا تظهر أي مساعدة. وثائق حكومية أقدم تصف أيضا هدف إعادة استخدام البيانات المعروفة ومحاكاة تغيرات الحالة قبل اتخاذ الإجراء.",
    "whatTheyBuilt": [
      "محاكي واحد يقدّر عشرات المساعدات الوطنية والمحلية",
      "إعادة استخدام معلومات معروفة مسبقا للمستخدم المسجل عبر FranceConnect لتقليل الإدخال",
      "إمكانية إعادة تشغيل المحاكاة مع وضع مختلف لمقارنة أثر تغير الحالة على المساعدات المحتملة",
      "النتيجة تقديرية وتساعد المستخدم يعرف الحقوق التي تستحق التحقق قبل الانتقال للجهة المختصة",
      "عند ظهور حق محتمل يتم توجيه المستخدم للجهة المختصة لإكمال الطلب",
      "فصل تجربة استعراض الحقوق الحالية عن مسار محاكاة الحقوق المحتملة داخل البوابة"
    ],
    "results": [
      "المحاكي الحالي يعلن تقدير 58 مساعدة وطنية ومحلية",
      "الزمن المعلن لإكمال المحاكاة أقل من 15 دقيقة",
      "DesignGouv سجل للمهمة التي استهدفت تحسين المحاكي حجما يبلغ 503,533 طلبا سنويا وقت المشروع",
      "النسخ الحالية لبعض المحاكيات تسمح بتعبئة مسبقة للمعلومات عند تسجيل الدخول عبر FranceConnect"
    ],
    "metrics": [
      {
        "label": "مساعدات مقدرة",
        "value": "58"
      },
      {
        "label": "زمن المحاكاة",
        "value": "<15 min"
      },
      {
        "label": "طلبات سنوية وقت مشروع UX",
        "value": "503K+"
      },
      {
        "label": "تعبئة مسبقة عند الدخول",
        "value": "نعم"
      }
    ],
    "appliedToSilah": [
      "استلهمنا فصل مسار المحاكاة عن عرض الحالة الحالية وطبقناه في صلة كـ Digital Twin مستقل",
      "أي سيناريو افتراضي لا يكتب على ملف المستفيد الحقيقي داخل النموذج",
      "النتيجة الافتراضية توصف كأثر محتمل وليست قرار أهلية",
      "نستفيد من البيانات المعروفة ونطلب فقط المتغير الذي يحتاجه السيناريو"
    ],
    "caution": "المحاكاة يجب أن تشرح حدودها بوضوح لأن التقدير قد يختلف عن القرار الرسمي عندما تدخل بيانات أو قواعد إضافية. Digital Twin هو تطبيق تصميمي في صلة مستلهم من هذا النمط، وليس اسما تستخدمه البوابة الفرنسية.",
    "capabilities": [
      "simulation",
      "prefill",
      "multi_benefit",
      "state_isolation",
      "estimated_results"
    ],
    "sources": [
      {
        "label": "Mes Droits Sociaux: simulator",
        "url": "https://www.mesdroitssociaux.gouv.fr/votre-simulateur/accueil?lang=en"
      },
      {
        "label": "Mes Droits Sociaux: services",
        "url": "https://www.mesdroitssociaux.gouv.fr/services"
      },
      {
        "label": "DesignGouv: Simulateur de droits sociaux",
        "url": "https://design.numerique.gouv.fr/accompagnement/commando-ux/defi-droits-sociaux/"
      },
      {
        "label": "Ministère: portail Mes Droits Sociaux",
        "url": "https://solidarites.gouv.fr/portail-mes-droits-sociaux"
      }
    ],
    "sourceDate": "2026-10-04",
    "problem": "المستخدم قد لا يعرف أي مساعدة اجتماعية تنطبق عليه، كما أن تجربة تغير الدخل أو الأسرة لا يجب أن تعدل بياناته الرسمية أو تتحول إلى تصريح تغيير.",
    "whyBuilt": "Mes Droits Sociaux يوفر نقطة دخول موحدة لعرض الحقوق والموارد ومحاكاة المساعدات، بهدف تسهيل الوصول للحقوق وتقليل عدم الاستفادة بسبب صعوبة اكتشافها.",
    "journey": [
      "يمكن للمستخدم استعراض حقوقه وموارده الحالية كمسار مستقل",
      "يمكنه تشغيل محاكي للمساعدات وإدخال أو مراجعة بيانات الحالة",
      "عند تسجيل الدخول يمكن أن تظهر معلومات معبأة مسبقا من المجالين الاجتماعي والضريبي",
      "النتيجة تظهر كتقدير إرشادي ثم توجه المستخدم إلى الجهة المختصة عند وجود حق محتمل"
    ],
    "design": [
      "فصل واضح بين الحقوق الحالية وبين المحاكاة",
      "المحاكي متعدد المساعدات ويشرح الزمن والبيانات المطلوبة قبل البدء",
      "النتيجة تقديرية وليست قرارا رسميا نهائيا"
    ],
    "integration": [
      "FranceConnect يستخدم للدخول الموحد وإعادة استخدام معلومات معروفة",
      "البوابة تجمع معلومات من المجال الاجتماعي والضريبي وتربط المستخدم بالجهة التي تنفذ الطلب",
      "بعض المسارات تسمح بإعادة استخدام البيانات المعبأة عند الانتقال إلى طلب فعلي لدى جهة مشاركة"
    ],
    "dataUsed": [
      "معلومات اجتماعية وضريبية معروفة مسبقا",
      "بيانات صرح بها أصحاب العمل والجهات الاجتماعية",
      "مدخلات المستخدم داخل المحاكاة مثل الأسرة والدخل والثروة حسب نوع المساعدة",
      "المدخلات داخل المحاكاة لا تحفظ كتغيير رسمي ولا تحدث بيانات الجهات المصدرية"
    ],
    "challenges": [
      "النتيجة قد تختلف عن القرار الرسمي عند دخول بيانات أو قواعد إضافية",
      "كل مساعدة تحتاج بيانات مختلفة، لذلك لا يمكن اختزال الأهلية في متغير واحد",
      "يجب شرح الفرق بين التقدير وبين الطلب الرسمي بوضوح"
    ],
    "lessons": [
      "Current State منفصل عن What If State",
      "المحاكاة لا تكتب على السجل الحقيقي",
      "النتيجة المحتملة يجب أن تعرض حدودها وما الذي ما زال يحتاج تحقق"
    ]
  },
  {
    "id": "tell_us_once",
    "country": "المملكة المتحدة",
    "name": "Tell Us Once",
    "headline": "بلّغ عن الحدث مرة واحدة بدل ما تكون أنت حلقة الربط بين الجهات",
    "pattern": "استخدام حدث واضح لتحديث عدة جهات حكومية من نقطة واحدة وبموافقة صاحب العلاقة",
    "why": "الخدمة تعالج لحظة حساسة وهي الوفاة. الحكومة البريطانية تشرح أن الأسرة في وقت الفقد تكون أمام جهات كثيرة تحتاج الإبلاغ، لذلك صممت Tell Us Once لتقليل المكالمات والنماذج المتكررة وجعل الإبلاغ يتم مرة واحدة إلى معظم الجهات الحكومية ذات العلاقة.",
    "whatTheyBuilt": [
      "مرجع واحد بعد تسجيل الوفاة لاستخدام الخدمة إلكترونيا أو عبر القنوات المتاحة",
      "إرسال المعلومة إلى جهات مركزية ومحلية متعددة بدل التواصل معها منفردة",
      "تحديث سجلات مثل الضرائب والمزايا والجواز والرخص وخدمات المجلس المحلي",
      "طلب الصلاحيات اللازمة قبل تمرير بيانات الأقارب أو المستفيدين المشتركين",
      "فصل واضح بين الإبلاغ عن الحدث وبين التقديم على منفعة جديدة"
    ],
    "results": [
      "الخدمة ما زالت قائمة حاليا للإبلاغ عن الوفاة إلى معظم الجهات الحكومية في إنجلترا واسكتلندا وويلز",
      "في مسح 2013 التاريخي وصف 98% من مستخدمي مسار الوفاة التجربة بأنها جيدة",
      "100% من مستخدمي المسار الإلكتروني في ذلك المسح وجدوه سهلا",
      "أكثر من 95% أبدوا ثقة في التعامل مع بياناتهم وتنفيذ الإبلاغ",
      "وقت المسح كانت الخدمة قد استخدمت من أكثر من 500 ألف شخص منذ الإطلاق الوطني"
    ],
    "metrics": [
      {
        "label": "تجربة جيدة",
        "value": "98%"
      },
      {
        "label": "سهولة إلكترونية",
        "value": "100%"
      },
      {
        "label": "ثقة بالبيانات",
        "value": ">95%"
      },
      {
        "label": "مستخدمون وقت المسح",
        "value": "500K+"
      }
    ],
    "appliedToSilah": [
      "المستفيد يبلغ عن التغير مرة واحدة، وصلة يحدد الخدمات التي قد تتأثر",
      "نفرق بين اكتشاف الأثر وبين تنفيذ التحديث في النظام المصدر",
      "في المنتج الحقيقي نعرض حالة كل تحديث بدل افتراض أن جميع الأنظمة استقبلته",
      "الأحداث الحساسة تحتاج Consent وحوكمة مشاركة بيانات واضحة"
    ],
    "caution": "مؤشرات الرضا المذكورة تاريخية من مسح 2013، لذلك نستخدمها كدليل تصميم تاريخي وليس كقياس أداء حالي للخدمة.",
    "historical": true,
    "capabilities": [
      "tell_once",
      "life_events",
      "multi_agency",
      "data_sharing"
    ],
    "sources": [
      {
        "label": "GOV.UK: Tell Us Once current service",
        "url": "https://www.gov.uk/after-a-death/organisations-you-need-to-contact-and-tell-us-once"
      },
      {
        "label": "GOV.UK: survey 2013",
        "url": "https://www.gov.uk/government/news/award-winning-government-service-achieves-98-satisfaction-rate-amongst-customers"
      },
      {
        "label": "GOV.UK: survey analysis",
        "url": "https://www.gov.uk/government/publications/tell-us-once-customer-service-survey-analysis"
      }
    ],
    "sourceDate": "2026-10-04",
    "problem": "بعد الوفاة تحتاج الأسرة إلى إبلاغ جهات حكومية متعددة في وقت حساس، ما يكرر نفس المعلومة ويجعل الشخص حلقة الربط بين المؤسسات.",
    "whyBuilt": "Tell Us Once صممت لتسمح بالإبلاغ عن الوفاة إلى معظم الجهات الحكومية من نقطة واحدة بدل التواصل مع كل جهة بشكل مستقل.",
    "journey": [
      "بعد تسجيل الوفاة يشرح المسجل الخدمة ويعطي رقما مرجعيا عند الحاجة",
      "يستخدم الشخص الرقم لإكمال Tell Us Once عبر القنوات المتاحة",
      "الخدمة ترسل إشعار الحدث إلى الجهات الحكومية المشاركة ذات العلاقة",
      "بعض المعلومات الخاصة بأقارب أو مستفيدين آخرين تتطلب صلاحية أو موافقة قبل مشاركتها"
    ],
    "design": [
      "حدث واحد واضح يبدأ الرحلة",
      "نقطة إدخال واحدة للمعلومة ثم توزيعها إلى الجهات المشاركة",
      "فصل الإبلاغ عن الوفاة عن التقديم على منافع أو طلبات جديدة"
    ],
    "integration": [
      "الخدمة تربط جهات مركزية ومجالس محلية مشاركة",
      "التكامل مبني على توزيع إشعار موحد للجهات التي تحتاجه",
      "التغطية تعتمد على نوع الجهة والخدمة ومشاركة الجهة في Tell Us Once"
    ],
    "dataUsed": [
      "رقم Tell Us Once المرجعي",
      "بيانات الشخص المتوفى",
      "تفاصيل مرتبطة بالخدمات الحكومية التي تحتاج الإلغاء أو التحديث",
      "بيانات الأقارب أو المستفيدين المشتركين فقط عند توفر الصلاحية اللازمة"
    ],
    "challenges": [
      "ليس كل أثر يعني وجود طلب جديد قابل للتنفيذ تلقائيا",
      "التغطية تختلف حسب الجهة والسياق الجغرافي والخدمة",
      "مؤشرات الرضا القوية المتاحة تاريخية من 2013 ولا يجب عرضها كأداء حالي"
    ],
    "lessons": [
      "المستفيد لا يجب أن يكون Integration Layer",
      "حدث واحد قد يطلق آثارا على خدمات كثيرة",
      "نفرق بين اكتشاف الأثر وبين تأكيد أن التحديث تم في كل نظام مصدر"
    ]
  },
  {
    "id": "mygov",
    "country": "أستراليا",
    "name": "myGov User Audit",
    "headline": "الواجهة الموحدة ما تكفي إذا الحقول والأنظمة ما تتفق",
    "pattern": "تجربة تكشف أن Tell Us Once يحتاج تكامل بيانات وتشريعات وحالة تنفيذ واضحة، مو مجرد زر تحديث واحد",
    "why": "أستراليا بنت myGov كنقطة دخول موحدة للخدمات الحكومية، ومع الوقت أضافت Tell Us Once لتحديث بيانات الاتصال عبر أكثر من خدمة. لكن المراجعة المستقلة في 2022 و2023 ركزت على فجوة مهمة: الناس ما زالوا يكررون مشاركة معلوماتهم وإثبات هويتهم، بينما الجهات المختلفة لديها قواعد وحقول وتشريعات غير متطابقة.",
    "whatTheyBuilt": [
      "Tell Us Once لتحديث العنوان والبريد والهاتف عبر خدمات أعضاء مشاركة",
      "قدرات pre-fill وإعادة استخدام بعض البيانات لتقليل الإدخال المتكرر",
      "مراجعة مستقلة واسعة لتقييم الاعتمادية والوظائف وتجربة المستخدم",
      "خارطة طريق لاحقة لمعالجة القضايا النظامية التي كشفها التدقيق"
    ],
    "results": [
      "في يونيو 2022 كانت 7 فقط من 15 خدمة عضو تستخدم Tell Us Once",
      "في يناير 2022 تم قبول 34% فقط من تحديثات التفاصيل الشخصية مباشرة لدى الخدمات الأعضاء",
      "38% من التحديثات احتاجت تدخلا إضافيا من الموظفين",
      "التدقيق حدد اختلاف التشريعات وجودة البيانات وعدم تطابق حقول الهاتف والعنوان وضعف إبلاغ المستخدم بنتيجة التحديث كعقبات رئيسية",
      "الحكومة الأسترالية وافقت أو وافقت من حيث المبدأ على 9 من 10 توصيات التدقيق في ردها المنشور"
    ],
    "metrics": [
      {
        "label": "خدمات تستخدم Tell Us Once",
        "value": "7/15"
      },
      {
        "label": "قُبلت مباشرة",
        "value": "34%"
      },
      {
        "label": "احتاجت تدخل موظف",
        "value": "38%"
      },
      {
        "label": "توصيات وافقت عليها الحكومة",
        "value": "9/10"
      }
    ],
    "appliedToSilah": [
      "Data Mapping قبل توسيع الواجهة أو AI",
      "تعريف Source of Truth لكل معلومة وحقل",
      "عرض الفرق بين تم اكتشاف الأثر وتم تنفيذ التحديث فعليا",
      "توحيد تعريفات الحقول وقواعد القبول بين الأنظمة قبل Tell Once الحقيقي",
      "قياس تجربة المستخدم بالنتائج وليس بعدد الميزات فقط"
    ],
    "caution": "هذه أهم تجربة تحذيرية لصلة: النجاح التشغيلي يعتمد على التكامل والحوكمة وجودة البيانات أكثر من جودة واجهة المحادثة.",
    "capabilities": [
      "tell_once",
      "prefill",
      "life_events",
      "interoperability",
      "consent",
      "status_feedback"
    ],
    "sources": [
      {
        "label": "myGov: User Audit",
        "url": "https://my.gov.au/en/audit"
      },
      {
        "label": "myGov User Audit Volume 2",
        "url": "https://my.gov.au/content/dam/mygov/documents/audit/mygov-useraudit-jan2023-volume2.pdf"
      }
    ],
    "sourceDate": "2026-10-04",
    "cautionCard": true,
    "problem": "الرؤية كانت Tell Us Once وإعادة استخدام البيانات، لكن اختلاف التشريعات والحقول وجودة البيانات بين الجهات جعل التحديث الموحد غير موثوق بالكامل للمستخدم.",
    "whyBuilt": "myGov يهدف إلى جعل التعامل مع الحكومة أبسط ومتصلا وأكثر تخصيصا، وتحديث التفاصيل مرة واحدة أحد القدرات التي يفترض أن تقلل التكرار بين الخدمات الأعضاء.",
    "journey": [
      "يغير المستخدم بيانات مثل العنوان أو الهاتف من myGov",
      "يرسل myGov التحديث إلى الخدمات الأعضاء التي تستخدم Tell Us Once",
      "كل خدمة عضو تقرر قبول التحديث بحسب بياناتها وقواعدها",
      "في الحالة التي وثقها التدقيق لم يكن المستخدم يحصل دائما على نتيجة واضحة لكل جهة بعد الإرسال"
    ],
    "design": [
      "نقطة موحدة لتحديث بعض البيانات عبر خدمات متعددة",
      "Prefill وإعادة استخدام البيانات كقدرة مشتركة",
      "التدقيق أوصى بتجربة أكثر تخصيصا وتنظيما حول أحداث الحياة"
    ],
    "integration": [
      "Tell Us Once كان قدرة اختيارية للخدمات الأعضاء",
      "التدقيق وثق اختلاف تشريعات الاستخدام وصيغ الحقول بين الجهات",
      "التواصل كان في بعض الحالات باتجاه واحد، والتغييرات من الجهة العضو لا تعود إلى myGov"
    ],
    "dataUsed": [
      "العنوان السكني والبريدي",
      "البريد الإلكتروني وأرقام الهاتف",
      "بيانات محدودة مخزنة في myGov مع اعتماد كبير على أنظمة الخدمات الأعضاء",
      "بيانات الجهات المصدرية التي تستخدم في prefill عندما يكون التكامل متاحا"
    ],
    "challenges": [
      "في يونيو 2022 استخدمت 7 فقط من 15 خدمة عضو Tell Us Once",
      "في يناير 2022 قبلت 34% فقط من تحديثات التفاصيل مباشرة",
      "38% من التحديثات احتاجت تدخلا إضافيا من الموظفين",
      "اختلاف الحقول وجودة البيانات والتشريعات وضعف feedback للمستخدم كانت عوائق أساسية"
    ],
    "lessons": [
      "Data Mapping قبل الواجهة الذكية",
      "Source of Truth وتعريف الحقول لازم يكونان صريحين",
      "نحتاج status feedback لكل نظام مصدر",
      "قياس نجاح Tell Once يكون بنسبة التحديثات المنفذة فعليا لا بعدد الجهات المرتبطة"
    ]
  }
]
`````

## `data/language_glossary.json`

`````text
{
  "version": "2026-10-03",
  "notes": "قاموس محلي لتوحيد الألفاظ الشائعة واللهجة داخل نموذج صلة. لا يمثل قاعدة أهلية.",
  "serviceAliases": {
    "social_security": ["الضمان", "الضمان الاجتماعي", "الضمان المطور", "معاش الضمان"],
    "social_security_objection": ["اعتراض الضمان", "الاعتراض على الضمان", "اعترض على الضمان"],
    "job_search_subsidy": ["حافز", "اعانة البحث عن عمل", "إعانة البحث عن عمل", "دعم الباحثين عن عمل"],
    "tamheer": ["تمهير", "تطوير الخريجين", "تدريب على راس العمل", "تدريب على رأس العمل"],
    "doroob": ["دروب", "تدريب الكتروني", "تدريب إلكتروني"],
    "wusool": ["وصول", "دعم النقل"],
    "qurra": ["قرة", "قره", "ضيافة اطفال", "ضيافة أطفال", "حضانة"],
    "professional_certificates": ["دعم الشهادات المهنية", "شهادة مهنية", "شهادة احترافية", "رخصة مهنية"],
    "career_guidance_sobol": ["سبل", "ارشاد مهني", "إرشاد مهني", "مسار مهني"],
    "senior_privilege_card": ["بطاقة امتياز", "امتياز كبار السن", "كبار السن"],
    "labor_settlement": ["التسوية الودية", "تسوية ودية", "خلاف عمالي"],
    "disability_evaluation": ["تقييم الاعاقة", "تقييم الإعاقة"],
    "disability_financial_aid": ["اعانة ذوي الاعاقة", "إعانة ذوي الإعاقة", "اعانة مالية للاعاقة"],
    "traffic_facilities_certificate": ["التسهيلات المرورية", "مواقف ذوي الاعاقة", "مواقف ذوي الإعاقة"],
    "domestic_worker_contract_documentation": ["توثيق العمالة المنزلية", "عقد عاملة منزلية", "عقد عامل منزلي", "مساند"]
  },
  "jobStageAliases": {
    "reviewing": ["وصلني العرض", "جاني عرض", "جاني شغل", "اراجع العرض", "أراجع العرض"],
    "accepted": ["وافقت", "قبلت العرض", "وقعت", "قلت لهم اوكي", "قلت لهم أوكي", "قلت لهم موافق"],
    "documented": ["تم التوثيق", "موثق", "توثق العقد"],
    "started": ["باشرت", "داومت", "بديت العمل", "بدأت العمل", "بدأت الدوام"]
  },
  "notStartedAliases": ["ما باشرت", "لسه ما باشرت", "للحين ما باشرت", "ما داومت", "لسه ما داومت", "للحين ما داومت", "ما بديت", "ما بدأت", "لم أبدأ"],
  "replacementAliases": {
    "replace": ["بديلة", "بديل", "بطلع من وظيفتي", "بترك وظيفتي", "بانتقل", "انتقل لها", "مكان وظيفتي"],
    "keep": ["باقي على وظيفتي", "وظيفتي الحالية مستمرة", "العقد الحالي باقي", "بجمع بين", "بستمر في وظيفتي"]
  }
}
`````

## `data/personas.json`

`````text
[
  {
    "id": "khalid",
    "name": "خالد",
    "age": 41,
    "nationality": "saudi",
    "permanentResident": true,
    "employment": "employed",
    "salary": 4500,
    "familySize": 4,
    "activeContract": true,
    "qiwaTerminationRequestPending": false,
    "socialSecurityBeneficiary": true,
    "socialSecurityStoppedForIneligibility": false,
    "hasLaborDispute": false,
    "hasDisability": false,
    "disabilityEvaluationActive": false,
    "disabilityClassAidEligible": false,
    "trafficFacilityEligible": false,
    "institutionalCare": false,
    "domesticWorkers": 1,
    "domesticWorkerHasActiveMusanedContract": false,
    "lastChanges": [
      {
        "date": "2026-09-28",
        "field": "salary",
        "label": "تم تحديث الدخل الوظيفي",
        "from": 5000,
        "to": 4500,
        "source": "بيانات تجريبية"
      },
      {
        "date": "2026-09-12",
        "field": "contract",
        "label": "حالة العقد ما زالت فعالة",
        "source": "بيانات تجريبية"
      }
    ],
    "totalMonthlyIncome": 4500,
    "socialSecurityPreScreenSignal": false,
    "incomeType": "salary",
    "gender": "male",
    "privateSectorEmployee": true,
    "gosiRegistered": true,
    "gosiMonthsLast5Years": 60,
    "childrenUnder6": 0,
    "educationLevel": null,
    "previousWorkExperienceMonths": null,
    "registeredHrdf": true,
    "ableToWork": true,
    "seriousJobSearch": false,
    "receivesPension": false,
    "receivesUnemploymentCompensation": false,
    "isStudentOrTrainee": false,
    "hasBusinessActivity": false,
    "monthsSinceGraduation": null,
    "monthsSinceLastEmployment": null,
    "previousJobSearchSubsidyMonths": 0,
    "tamheerUsedMonths": 0,
    "tamheerExcluded": false,
    "seniorPrivilegeCardIssued": null,
    "familyMonthlyIncomeForJsa": null,
    "jobSearchHouseholdSize": null
  },
  {
    "id": "reem",
    "name": "ريم",
    "age": 27,
    "nationality": "saudi",
    "permanentResident": true,
    "employment": "employed",
    "salary": 8500,
    "familySize": 3,
    "activeContract": true,
    "qiwaTerminationRequestPending": false,
    "socialSecurityBeneficiary": false,
    "socialSecurityStoppedForIneligibility": false,
    "hasLaborDispute": false,
    "hasDisability": false,
    "disabilityEvaluationActive": false,
    "disabilityClassAidEligible": false,
    "trafficFacilityEligible": false,
    "institutionalCare": false,
    "domesticWorkers": 0,
    "domesticWorkerHasActiveMusanedContract": false,
    "lastChanges": [
      {
        "date": "2026-09-30",
        "field": "contract",
        "label": "تم تحديث بيانات العقد",
        "source": "بيانات تجريبية"
      }
    ],
    "totalMonthlyIncome": 8500,
    "socialSecurityPreScreenSignal": false,
    "incomeType": "salary",
    "gender": "female",
    "privateSectorEmployee": true,
    "gosiRegistered": true,
    "gosiMonthsLast5Years": 24,
    "childrenUnder6": 1,
    "educationLevel": null,
    "previousWorkExperienceMonths": null,
    "registeredHrdf": true,
    "ableToWork": true,
    "seriousJobSearch": false,
    "receivesPension": false,
    "receivesUnemploymentCompensation": false,
    "isStudentOrTrainee": false,
    "hasBusinessActivity": false,
    "monthsSinceGraduation": null,
    "monthsSinceLastEmployment": null,
    "previousJobSearchSubsidyMonths": 0,
    "tamheerUsedMonths": 0,
    "tamheerExcluded": false,
    "seniorPrivilegeCardIssued": null,
    "familyMonthlyIncomeForJsa": null,
    "jobSearchHouseholdSize": null
  },
  {
    "id": "salman",
    "name": "سلمان",
    "age": 24,
    "nationality": "saudi",
    "permanentResident": true,
    "employment": "job_seeker",
    "salary": 0,
    "familySize": 1,
    "activeContract": false,
    "qiwaTerminationRequestPending": false,
    "socialSecurityBeneficiary": false,
    "socialSecurityStoppedForIneligibility": false,
    "hasLaborDispute": false,
    "hasDisability": false,
    "disabilityEvaluationActive": false,
    "disabilityClassAidEligible": false,
    "trafficFacilityEligible": false,
    "institutionalCare": false,
    "domesticWorkers": 0,
    "domesticWorkerHasActiveMusanedContract": false,
    "lastChanges": [
      {
        "date": "2026-09-26",
        "field": "employment",
        "label": "لا يوجد عقد وظيفي فعال",
        "source": "بيانات تجريبية"
      }
    ],
    "totalMonthlyIncome": 0,
    "socialSecurityPreScreenSignal": true,
    "incomeType": "none",
    "gender": "male",
    "privateSectorEmployee": false,
    "gosiRegistered": false,
    "gosiMonthsLast5Years": null,
    "childrenUnder6": 0,
    "educationLevel": "bachelor",
    "previousWorkExperienceMonths": 4,
    "registeredHrdf": true,
    "ableToWork": true,
    "seriousJobSearch": true,
    "receivesPension": false,
    "receivesUnemploymentCompensation": false,
    "isStudentOrTrainee": false,
    "hasBusinessActivity": false,
    "monthsSinceGraduation": 8,
    "monthsSinceLastEmployment": null,
    "previousJobSearchSubsidyMonths": 0,
    "tamheerUsedMonths": 0,
    "tamheerExcluded": false,
    "seniorPrivilegeCardIssued": null,
    "familyMonthlyIncomeForJsa": 5500,
    "jobSearchHouseholdSize": 3
  },
  {
    "id": "noura",
    "name": "نورة",
    "age": 33,
    "nationality": "saudi",
    "permanentResident": true,
    "employment": "not_employed",
    "salary": 0,
    "familySize": 1,
    "activeContract": false,
    "qiwaTerminationRequestPending": false,
    "socialSecurityBeneficiary": false,
    "socialSecurityStoppedForIneligibility": false,
    "hasLaborDispute": false,
    "hasDisability": true,
    "disabilityEvaluationActive": true,
    "disabilityClassAidEligible": true,
    "trafficFacilityEligible": true,
    "disabilityAgeAtOnset": 29,
    "monthsInStateFundedFacilityThisYear": 0,
    "institutionalCare": false,
    "domesticWorkers": 0,
    "domesticWorkerHasActiveMusanedContract": false,
    "lastChanges": [
      {
        "date": "2026-09-20",
        "field": "disabilityEvaluation",
        "label": "تقييم الإعاقة ساري",
        "source": "بيانات تجريبية"
      },
      {
        "date": "2026-09-18",
        "field": "salary",
        "label": "تم تحديث الدخل",
        "from": 3500,
        "to": 3200,
        "source": "بيانات تجريبية"
      }
    ],
    "totalMonthlyIncome": 3200,
    "socialSecurityPreScreenSignal": false,
    "incomeType": "other",
    "gender": "female",
    "privateSectorEmployee": false,
    "gosiRegistered": false,
    "gosiMonthsLast5Years": null,
    "childrenUnder6": 0,
    "educationLevel": null,
    "previousWorkExperienceMonths": null,
    "registeredHrdf": true,
    "ableToWork": true,
    "seriousJobSearch": false,
    "receivesPension": false,
    "receivesUnemploymentCompensation": false,
    "isStudentOrTrainee": false,
    "hasBusinessActivity": false,
    "monthsSinceGraduation": null,
    "monthsSinceLastEmployment": null,
    "previousJobSearchSubsidyMonths": 0,
    "tamheerUsedMonths": 0,
    "tamheerExcluded": false,
    "seniorPrivilegeCardIssued": null,
    "familyMonthlyIncomeForJsa": null,
    "jobSearchHouseholdSize": null
  },
  {
    "id": "saleh",
    "name": "صالح",
    "age": 67,
    "nationality": "saudi",
    "permanentResident": true,
    "employment": "retired",
    "salary": 0,
    "totalMonthlyIncome": 7200,
    "incomeType": "retirement",
    "familySize": 2,
    "activeContract": false,
    "qiwaTerminationRequestPending": false,
    "socialSecurityBeneficiary": false,
    "socialSecurityStoppedForIneligibility": false,
    "socialSecurityPreScreenSignal": false,
    "hasLaborDispute": false,
    "hasDisability": false,
    "disabilityEvaluationActive": false,
    "disabilityClassAidEligible": false,
    "trafficFacilityEligible": false,
    "institutionalCare": false,
    "domesticWorkers": 0,
    "domesticWorkerHasActiveMusanedContract": false,
    "lastChanges": [
      {
        "date": "2026-09-15",
        "field": "ageEligibility",
        "label": "العمر ضمن فئة كبار السن",
        "source": "بيانات تجريبية"
      }
    ],
    "gender": "male",
    "privateSectorEmployee": false,
    "gosiRegistered": false,
    "gosiMonthsLast5Years": null,
    "childrenUnder6": 0,
    "educationLevel": null,
    "previousWorkExperienceMonths": null,
    "registeredHrdf": true,
    "ableToWork": false,
    "seriousJobSearch": false,
    "receivesPension": true,
    "receivesUnemploymentCompensation": false,
    "isStudentOrTrainee": false,
    "hasBusinessActivity": false,
    "monthsSinceGraduation": null,
    "monthsSinceLastEmployment": null,
    "previousJobSearchSubsidyMonths": 0,
    "tamheerUsedMonths": 0,
    "tamheerExcluded": false,
    "seniorPrivilegeCardIssued": null,
    "familyMonthlyIncomeForJsa": null,
    "jobSearchHouseholdSize": null
  }
]
`````

## `data/services.json`

`````text
[
  {
    "id": "social_security",
    "name": "نظام الضمان الاجتماعي المطور",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "أفراد",
      "مستحقو الدعم",
      "مستفيدو الضمان"
    ],
    "summary": "معاش شهري للفئات التي تستوفي شروط النظام، ويعتمد الاستحقاق على الدخل المحتسب ومعايير أخرى تشمل الثروة والالتزامات النظامية.",
    "channel": "منصة الدعم والحماية الاجتماعية",
    "duration": "بحسب دراسة الطلب",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D9%86%D8%B8%D8%A7%D9%85-%D8%A7%D9%84%D8%B6%D9%85%D8%A7%D9%86-%D8%A7%D9%84%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9%D9%8A-%D8%A7%D9%84%D9%85%D8%B7%D9%88%D8%B1",
    "regulationUrl": "https://www.hrsd.gov.sa/knowledge-centre/decisions-and-regulations/regulation-and-procedures/841045",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يجب أن يقل الدخل المحتسب للمستقل أو الأسرة عن الحد الأدنى المحتسب للمعاش مع تحقق بقية الشروط",
      "الدخل المحتسب يتأثر بالدخل المكتسب وغير المكتسب وفق اللائحة",
      "على المستفيد إبلاغ الوزارة خلال 15 يوما عن أي تغيير يؤثر على الاستحقاق أو مقدار المعاش",
      "قيمة المعاش قد تتغير بحسب الدخل المحتسب وعدد أفراد الأسرة والثروة وبقية البيانات"
    ],
    "requiredData": [
      "الجنسية أو حالة الاستثناء",
      "الإقامة",
      "دخل الأسرة",
      "حجم الأسرة",
      "الثروة",
      "حالة الضمان الحالية"
    ],
    "triggerSignals": [
      "انخفاض الدخل",
      "توقف الدخل",
      "سؤال عن الدعم",
      "تغير الأسرة"
    ],
    "decisionPolicy": "لا يصدر صلة قرار أهلية نهائي من الراتب وحده",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "social_security_objection",
    "name": "اعتراض على إيقاف معاش الضمان",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "مستفيدو الضمان"
    ],
    "summary": "خدمة تمكّن مستفيد الضمان من الاعتراض على إيقاف الصرف بسبب عدم الأهلية.",
    "channel": "منصة الدعم والحماية الاجتماعية",
    "duration": "وفق معالجة الاعتراض",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A7%D8%B9%D8%AA%D8%B1%D8%A7%D8%B6-%D8%B9%D9%84%D9%89-%D8%A5%D9%8A%D9%82%D8%A7%D9%81-%D9%85%D8%B9%D8%A7%D8%B4-%D8%A7%D9%84%D8%B6%D9%85%D8%A7%D9%86",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "ترتبط الخدمة بحالة إيقاف المعاش بسبب عدم الأهلية",
      "تتطلب الدخول إلى منصة الدعم والحماية الاجتماعية واستكمال الملف الموحد ثم تقديم الاعتراض"
    ],
    "requiredData": [
      "حالة الضمان",
      "سبب الإيقاف أو عدم الأهلية"
    ],
    "triggerSignals": [
      "وقف الضمان",
      "عدم الأهلية",
      "أبي أعترض"
    ],
    "decisionPolicy": "تظهر عندما تكون حالة الإيقاف أو عدم الأهلية معروفة أو يذكرها المستفيد",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "employment_contracts",
    "name": "إدارة العقود",
    "sector": "العمل",
    "audience": [
      "أصحاب عمل",
      "موظفون عبر قوى أفراد"
    ],
    "summary": "تتيح إنشاء وتوثيق عقود الموظفين، ويمكن للموظف مراجعة العقد والموافقة عليه أو رفضه أو طلب تعديله.",
    "channel": "منصة قوى",
    "duration": "فوري بحسب الإجراء",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D8%B9%D9%82%D9%88%D8%AF",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "الموظف يستطيع الموافقة أو الرفض أو طلب تعديل العقد",
      "يعتبر العقد موثقا عند موافقة الطرفين",
      "صفحة الخدمة تذكر ضمن شروط إنشاء العقد ألا يكون لدى الموظف عقد ساري على قوى"
    ],
    "requiredData": [
      "حالة العقد",
      "مرحلة العرض أو العقد",
      "وجود عقد ساري"
    ],
    "triggerSignals": [
      "جاني عقد",
      "وافقت",
      "طلبت تعديل",
      "عقد جديد",
      "عقدي الحالي"
    ],
    "decisionPolicy": "الموافقة من طرف الموظف لا تعني أن الدخل الجديد بدأ فعليا",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "contract_termination",
    "name": "إنهاء العلاقة التعاقدية",
    "sector": "العمل",
    "audience": [
      "موظفون"
    ],
    "summary": "خدمة إلكترونية تسمح للموظف بإنهاء العقد الوظيفي الإلكتروني عند انطباق الشروط.",
    "channel": "منصة قوى",
    "duration": "فوري بحسب مسار الطلب",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A7%D9%86%D9%87%D8%A7%D8%A1-%D8%A7%D9%84%D8%B9%D9%84%D8%A7%D9%82%D8%A9-%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%82%D8%AF%D9%8A%D8%A9",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يشترط وجود عقد ساري المفعول على قوى",
      "يشترط ألا يكون هناك طلب إنهاء آخر على العقد نفسه جار اعتماده",
      "يختار الموظف سبب الإنهاء وتاريخه ثم يرسل الطلب"
    ],
    "requiredData": [
      "عقد ساري",
      "وجود طلب إنهاء قائم",
      "سبب الإنهاء",
      "مرحلة الإنهاء"
    ],
    "triggerSignals": [
      "أبي أنهي عقدي",
      "استقالة",
      "العقد بينتهي",
      "إنهاء العلاقة"
    ],
    "decisionPolicy": "لا تظهر كخطوة تنفيذية لمن انتهت علاقته فعليا بالفعل",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "labor_settlement",
    "name": "التسوية الودية للخلافات العمالية",
    "sector": "العمل",
    "audience": [
      "عمالة",
      "أصحاب عمل"
    ],
    "summary": "المرحلة الأولى للنظر في دعاوى الخلافات العمالية ومحاولة الوصول إلى حل ودي قبل الإحالة للمحكمة العمالية عند تعذر التسوية.",
    "channel": "بوابة الخدمات الإلكترونية للعمل",
    "duration": "حتى 21 يوم عمل بحسب صفحة الخدمة",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/269970",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "ترتبط الخدمة بوجود خلاف عمالي بين العامل وصاحب العمل",
      "يلزم وجود عقد عمل أو ما يثبت العلاقة التعاقدية",
      "المستندات تختلف بحسب موضوع الدعوى"
    ],
    "requiredData": [
      "وجود علاقة عمل أو إثباتها",
      "موضوع الخلاف",
      "المستندات الداعمة"
    ],
    "triggerSignals": [
      "ما عطوني مستحقاتي",
      "خلاف مع الشركة",
      "راتبي متأخر",
      "دعوى عمالية"
    ],
    "decisionPolicy": "تظهر عند وجود خلاف عمالي، لا لمجرد وجود عقد",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "end_of_service_calculator",
    "name": "حاسبة مكافأة نهاية الخدمة",
    "sector": "العمل",
    "audience": [
      "عمالة",
      "موظفون"
    ],
    "summary": "أداة تقديرية لحساب مكافأة نهاية الخدمة بناء على الأجر ونوع العقد وسبب انتهاء العلاقة ومدة الخدمة.",
    "channel": "موقع الوزارة ومنصة قوى",
    "duration": "فوري",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/end-service-benefit-calculator",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "تحتاج الأجر الفعلي ونوع العقد وسبب إنهاء العلاقة ومدة الخدمة",
      "النتيجة تقديرية والوزارة تنبه إلى أن الحاسبة تعمل آليا"
    ],
    "requiredData": [
      "الأجر الفعلي",
      "نوع العقد",
      "سبب الانتهاء",
      "مدة الخدمة"
    ],
    "triggerSignals": [
      "مكافأة نهاية الخدمة",
      "انتهى عقدي",
      "استقلت",
      "كم مستحقاتي"
    ],
    "decisionPolicy": "صلة يوجه للحاسبة ولا يخترع قيمة مكافأة بدون المدخلات الرسمية",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "disability_evaluation",
    "name": "تقييم الإعاقة",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "أشخاص ذوو إعاقة"
    ],
    "summary": "خدمة لتسجيل أو تحديث بيانات الإعاقة وإدراج المستفيد ضمن خدمات الوزارة ذات الصلة.",
    "channel": "البوابة الإلكترونية والتطبيق",
    "duration": "30 يوم بحسب صفحة الخدمة",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%AE%D8%AF%D9%85%D8%A9-%D8%AA%D9%82%D9%8A%D9%8A%D9%85-%D8%A7%D9%84%D8%A5%D8%B9%D8%A7%D9%82%D8%A9",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يمكن لغير المسجل تقديم طلب تسجيل بيانات الإعاقة وللمسجل تحديثها",
      "يتطلب تقريرا طبيا من مستشفى معتمد وألا تتجاوز مدة صلاحيته سنة وفق صفحة الخدمة"
    ],
    "requiredData": [
      "حالة التسجيل",
      "التقرير الطبي",
      "صلاحية التقرير",
      "بيانات الإعاقة"
    ],
    "triggerSignals": [
      "عندي إعاقة",
      "أبي أسجل الإعاقة",
      "أحدث التقييم",
      "التقييم منتهي"
    ],
    "decisionPolicy": "التقييم بوابة لعدد من خدمات الإعاقة الأخرى",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "disability_financial_aid",
    "name": "الإعانة المالية للأشخاص ذوي الإعاقة",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "أشخاص ذوو إعاقة"
    ],
    "summary": "إعانة مالية شهرية للأشخاص ذوي الإعاقة المسجلين والمقيّمة إعاقتهم عند استيفاء الشروط والضوابط.",
    "channel": "بوابة الخدمات الإلكترونية للتنمية الاجتماعية",
    "duration": "24 ساعة بحسب صفحة الخدمة",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A7%D9%84%D8%A5%D8%B9%D8%A7%D9%86%D8%A9-%D8%A7%D9%84%D9%85%D8%A7%D9%84%D9%8A%D8%A9-%D9%84%D9%84%D8%A3%D8%B4%D8%AE%D8%A7%D8%B5-%D8%B0%D9%88%D9%8A-%D8%A7%D9%84%D8%A5%D8%B9%D8%A7%D9%82%D8%A9",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يجب أن يكون المستفيد مسجلا لدى الوزارة وتم تقييم إعاقته",
      "يجب أن تكون الإعاقة مصنفة ضمن برنامج الإعانة",
      "ألا يتجاوز إجمالي الدخل الشهري 4000 ريال",
      "ألا تتجاوز الإقامة في مرافق صحية أو تأهيلية على نفقة الدولة 6 أشهر خلال العام",
      "ألا يكون من المستفيدين من خدمات الإيواء بمراكز الوزارة",
      "ألا يتجاوز عمر المستفيد وقت حدوث الإعاقة 60 سنة",
      "تشترط الصفحة الجنسية السعودية أو حالة القبائل النازحة بهوية سارية"
    ],
    "requiredData": [
      "تقييم إعاقة ساري",
      "تصنيف الإعاقة",
      "الدخل الشهري",
      "الإقامة في المرافق",
      "خدمات الإيواء",
      "العمر وقت حدوث الإعاقة",
      "الجنسية أو بطاقة التنقل"
    ],
    "triggerSignals": [
      "إعانة الإعاقة",
      "دخلي أقل من 4000",
      "عندي تقييم إعاقة"
    ],
    "decisionPolicy": "حتى مع تحقق البيانات المعروفة تعرض النتيجة كاستحقاق يستحق التحقق وليست قرارا رسميا",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "traffic_facilities_certificate",
    "name": "الشهادات الرقمية للتسهيلات المرورية",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "أشخاص ذوو إعاقة"
    ],
    "summary": "خدمة استباقية لإصدار شهادة رقمية للتسهيلات المرورية للأشخاص ذوي الإعاقة عند تحقق الشروط.",
    "channel": "البوابة الإلكترونية والتطبيق",
    "duration": "فوري",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A7%D9%84%D8%B4%D9%87%D8%A7%D8%AF%D8%A7%D8%AA-%D8%A7%D9%84%D8%B1%D9%82%D9%85%D9%8A%D8%A9-%D9%84%D9%84%D8%AA%D8%B3%D9%87%D9%8A%D9%84%D8%A7%D8%AA-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1%D9%8A%D8%A9",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يجب أن تكون الإعاقة مصنفة في نظام استحقاق الخدمة",
      "يجب أن يكون لدى المستفيد تقييم إعاقة ساري الصلاحية",
      "الخدمة تعرض أو تجدد الشهادة بحسب صلاحية البطاقة الإلكترونية"
    ],
    "requiredData": [
      "تقييم إعاقة ساري",
      "تصنيف الإعاقة للخدمة",
      "صلاحية البطاقة"
    ],
    "triggerSignals": [
      "مواقف ذوي الإعاقة",
      "تسهيلات مرورية",
      "بطاقة مواقف"
    ],
    "decisionPolicy": "يمكن أن تظهر استباقيا عندما تكون بيانات التصنيف والتقييم متاحة",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "domestic_worker_contract_documentation",
    "name": "التوثيق الإلكتروني لعقود العمالة المنزلية",
    "sector": "العمل",
    "audience": [
      "أصحاب عمل",
      "عمالة منزلية"
    ],
    "summary": "خدمة لتوثيق عقود العمالة المنزلية الموجودة داخل المملكة عبر منصة مساند.",
    "channel": "منصة مساند",
    "duration": "فوري بعد اكتمال الموافقة",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/833342",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يشترط عدم وجود عقد سار للعامل المنزلي داخل منصة مساند",
      "يرسل طلب التوثيق للعامل للموافقة خلال 5 أيام",
      "عند قبول العامل يصدر العقد الموثق وتتغير حالته إلى ساري"
    ],
    "requiredData": [
      "وجود عامل منزلي داخل المملكة",
      "وجود عقد ساري في مساند",
      "مرحلة الموافقة"
    ],
    "triggerSignals": [
      "عندي عاملة منزلية",
      "أوثق عقد العمالة المنزلية",
      "مساند"
    ],
    "decisionPolicy": "تظهر لصاحب العمل عندما توجد عمالة منزلية بلا عقد سار في مساند",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "senior_privilege_card",
    "name": "بطاقة امتياز لكبار السن",
    "sector": "التنمية الاجتماعية",
    "audience": [
      "كبار السن",
      "أفراد"
    ],
    "summary": "بطاقة تمنح كبار السن أولوية في الاستفادة من الخدمات الحكومية والتسهيلات المرتبطة بها، وتمنح تلقائيا عند استيفاء الشروط المنشورة.",
    "channel": "تطبيق وزارة الموارد البشرية والتنمية الاجتماعية",
    "duration": "فوري",
    "sourceUrl": "https://www.hrsd.gov.sa/ministry-services/services/%D8%A8%D8%B7%D8%A7%D9%82%D8%A9-%D8%A7%D9%85%D8%AA%D9%8A%D8%A7%D8%B2-%D9%84%D9%83%D8%A8%D8%A7%D8%B1-%D8%A7%D9%84%D8%B3%D9%86",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن يكون المستفيد سعودي الجنسية",
      "أن يكون عمر المستفيد 60 سنة فأكثر",
      "تمنح البطاقة تلقائيا للمستفيدين الذين استوفوا الشروط بحسب صفحة الخدمة"
    ],
    "requiredData": [
      "الجنسية",
      "العمر"
    ],
    "triggerSignals": [
      "عمري 60",
      "كبير سن",
      "بطاقة امتياز",
      "أولوية كبار السن"
    ],
    "decisionPolicy": "يمكن أن تظهر استباقيا من العمر والجنسية دون انتظار بحث المستفيد عنها",
    "provider": "وزارة الموارد البشرية والتنمية الاجتماعية"
  },
  {
    "id": "job_search_subsidy",
    "name": "إعانة البحث عن عمل",
    "sector": "التوظيف والتدريب",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "باحثون عن عمل"
    ],
    "summary": "برنامج يدعم الباحثين عن عمل بإعانة مالية متناقصة لمدة 15 شهرا، مع خدمات تدريب وتوظيف، عند استيفاء الشروط المنشورة.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "دراسة الطلب حتى 60 يوما بحسب صفحة البرنامج",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/other/job-search-subsidy/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن يكون المستفيد سعودي الجنسية ومقيما إقامة دائمة في المملكة",
      "أن يكون قادرا على العمل وجادا في البحث عنه",
      "العمر من 20 إلى 40 سنة ميلادية",
      "ألا يكون موظفا في القطاع العام أو الخاص",
      "ألا يصرف له معاش تقاعدي أو تعويض ضد التعطل عن العمل أو معاش من الضمان الاجتماعي",
      "ألا يكون طالبا أو متدربا في مرحلة تعليم أو تدريب",
      "ألا يكون لديه نشاط تجاري",
      "تدخل حدود دخل الأسرة والثروة ضمن التحقق من الأهلية",
      "لمن سبق له العمل تطبق مدة انتظار منشورة قبل التقديم، ولحديثي التخرج ترتبط الأهلية بتاريخ انتهاء التعليم أو التدريب"
    ],
    "requiredData": [
      "الجنسية",
      "الإقامة",
      "العمر",
      "حالة العمل",
      "القدرة والجدية في البحث",
      "المعاش التقاعدي",
      "تعويض التعطل",
      "الضمان الاجتماعي",
      "حالة التعليم أو التدريب",
      "النشاط التجاري",
      "دخل الأسرة والثروة",
      "تاريخ انتهاء التعليم أو العمل",
      "سجل الاستفادة السابق"
    ],
    "triggerSignals": [
      "حافز",
      "إعانة البحث عن عمل",
      "باحث عن عمل",
      "ما عندي وظيفة",
      "أدور وظيفة",
      "دعم الباحثين عن عمل"
    ],
    "decisionPolicy": "تظهر كتطابق أولي فقط إذا كانت البيانات المعروفة متوافقة، ولا تتحول إلى قرار أهلية قبل اكتمال التحقق من دخل الأسرة والثروة والتواريخ وسجل الاستفادة."
  },
  {
    "id": "tamheer",
    "name": "تطوير الخريجين (تمهير)",
    "sector": "التوظيف والتدريب",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "حديثو التخرج",
      "باحثون عن عمل"
    ],
    "summary": "منتج تدريب على رأس العمل لخريجي الدبلوم والبكالوريوس فأعلى بهدف اكتساب الخبرة العملية، مع مكافأة شهرية عند تحقق الشروط.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "مدة الفرصة من 3 إلى 6 أشهر",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/training/graduate-development/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن يكون المستفيد سعودي الجنسية",
      "أن يكون حاصلا على دبلوم مدته لا تقل عن سنة أو بكالوريوس فأعلى من جهة معتمدة",
      "ألا تتجاوز الخبرة العملية السابقة في القطاع العام أو الخاص سنة ميلادية",
      "ألا يتجاوز العمر 30 سنة ميلادية",
      "ألا يكون ملتحقا بعمل حاليا في القطاع العام أو الخاص",
      "للاستفادة رصيد تدريب لا يتجاوز فرصتين بمجموع 6 أشهر وفق الضوابط المنشورة",
      "المكافأة المنشورة 3000 ريال شهريا خلال مدة التدريب عند الاستحقاق"
    ],
    "requiredData": [
      "الجنسية",
      "العمر",
      "المؤهل",
      "الخبرة السابقة",
      "حالة العمل الحالية",
      "رصيد تمهير",
      "حالة الاستبعاد"
    ],
    "triggerSignals": [
      "تمهير",
      "حديث تخرج",
      "تدريب على رأس العمل",
      "أبي خبرة",
      "ما عندي خبرة"
    ],
    "decisionPolicy": "صلة يربط الخدمة بالبيانات التعليمية والوظيفية والعمر والخبرة، ويعرضها كتطابق أولي حتى يتم التحقق من رصيد التدريب وحالات الاستبعاد."
  },
  {
    "id": "doroob",
    "name": "التدريب الإلكتروني (دروب)",
    "sector": "التوظيف والتدريب",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "مواطنون",
      "باحثون عن عمل",
      "موظفو القطاع الخاص"
    ],
    "summary": "برنامج تدريب إلكتروني لتطوير المهارات وفق احتياجات سوق العمل، ويمكن لأي مواطن أو مواطنة التسجيل والالتحاق بالمحتوى التدريبي.",
    "channel": "منصة دروب وتطبيق الجوال",
    "duration": "بحسب البرنامج أو المسار التدريبي",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/training/online-training-doroob-individuals/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "يمكن لأي مواطن ومواطنة التسجيل في برنامج دروب",
      "البرنامج يوفر دورات ومسارات وجلسات تدريبية إلكترونية",
      "الدعم التدريبي الممول يستهدف فئات منها الباحثون عن عمل وموظفو القطاع الخاص وذوو الإعاقة وفق ضوابط كل منتج"
    ],
    "requiredData": [
      "الجنسية",
      "الاحتياج التدريبي عند تخصيص التوصية"
    ],
    "triggerSignals": [
      "دروب",
      "أبي أطور مهاراتي",
      "دورات",
      "تدريب إلكتروني",
      "أبي أتعلم"
    ],
    "decisionPolicy": "يمكن عرضه كفرصة تطوير للمواطن، بينما أي دعم مالي أو مسار متخصص يحتاج قواعده التفصيلية الخاصة."
  },
  {
    "id": "professional_certificates",
    "name": "دعم الشهادات المهنية الاحترافية",
    "sector": "التوظيف والتدريب",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "مواطنون",
      "باحثون عن عمل",
      "موظفون"
    ],
    "summary": "منتج لتعويض تكاليف شهادات أو رخص مهنية معتمدة عند استيفاء ضوابط الدعم المنشورة.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "تصل دراسة الأهلية والصرف إلى المدد المنشورة في صفحة المنتج",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/training/professional-certificates/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن يكون المستفيد سعودي الجنسية",
      "أن تكون الشهادة أو الرخصة ضمن القائمة المعتمدة من الصندوق",
      "ألا تكون جهة العمل قد دفعت تكاليف الشهادة",
      "لا يتجاوز الدعم شهادتين للفرد وفق الضوابط المنشورة",
      "يشترط أن تكون الشهادة سارية وألا يتجاوز تاريخها المدة المحددة في المنتج"
    ],
    "requiredData": [
      "الجنسية",
      "اسم الشهادة أو الرخصة",
      "اعتمادها لدى الصندوق",
      "تاريخ الحصول عليها",
      "جهة دفع التكاليف",
      "عدد مرات الاستفادة السابقة",
      "صلاحية الشهادة"
    ],
    "triggerSignals": [
      "شهادة احترافية",
      "شهادة مهنية",
      "رخصة مهنية",
      "تعويض شهادة",
      "دفعت قيمة اختبار"
    ],
    "decisionPolicy": "لا تظهر كتوصية تعويض لمجرد الرغبة في الشهادة. تحتاج وجود شهادة أو رخصة فعلية وبياناتها قبل فحص الدعم."
  },
  {
    "id": "wusool",
    "name": "دعم النقل (وصول)",
    "sector": "التمكين",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "المرأة العاملة",
      "العاملون من ذوي الإعاقة"
    ],
    "summary": "دعم لتخفيف تكلفة النقل من وإلى مقر العمل للعاملات السعوديات في القطاع الخاص وللعاملين من ذوي الإعاقة وفق الشروط المنشورة.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "حتى 24 شهرا من تاريخ أول رحلة عند استمرار الاستحقاق",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/enable/wusool/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن يكون المستفيد سعودي الجنسية وعمره من 18 إلى 65 سنة",
      "أن يكون مسجلا في التأمينات الاجتماعية",
      "ألا يتجاوز إجمالي الأجور الشهرية المسجلة 8000 ريال",
      "يستهدف المرأة العاملة في القطاع الخاص والعاملين من ذوي الإعاقة وفق تفاصيل المنتج",
      "الدعم يغطي 80% من تكلفة الرحلة ضمن الحدود الشهرية المنشورة"
    ],
    "requiredData": [
      "الجنسية",
      "العمر",
      "الجنس أو حالة الإعاقة",
      "العمل في القطاع الخاص",
      "التسجيل في التأمينات",
      "إجمالي الأجر المسجل",
      "مدة الاشتراك في التأمينات",
      "حالة تقييم الإعاقة عند الحاجة"
    ],
    "triggerSignals": [
      "وصول",
      "دعم النقل",
      "مشاوير الدوام",
      "أوبر كريم للدوام",
      "تكلفة النقل"
    ],
    "decisionPolicy": "صلة يربط وصول بالعمل الفعلي والأجر والتأمينات والفئة المستهدفة. لا يكفي انخفاض الراتب وحده إذا لم تتوفر بقية الشروط."
  },
  {
    "id": "qurra",
    "name": "دعم ضيافة الأطفال (قرة)",
    "sector": "التمكين",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "المرأة العاملة في القطاع الخاص"
    ],
    "summary": "منتج لدعم ضيافة أطفال المرأة السعودية العاملة في القطاع الخاص، بتغطية تصل إلى 50% من قيمة الحجز ضمن الحد المنشور لكل طفل.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "بحسب دورة الدعم والحجز",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/enable/childcare-support-for-working-women/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "أن تكون المستفيدة سعودية الجنسية",
      "أن تكون مسجلة في التأمينات الاجتماعية وتعمل في القطاع الخاص",
      "ألا يتجاوز الأجر المسجل في التأمينات 8000 ريال",
      "عمر الطفل من حديثي الولادة إلى 6 سنوات",
      "التغطية المنشورة تصل إلى 50% من قيمة الحجز وبحد أقصى 1600 ريال لكل طفل"
    ],
    "requiredData": [
      "الجنسية",
      "الجنس",
      "العمل في القطاع الخاص",
      "التسجيل في التأمينات",
      "الأجر المسجل",
      "وجود طفل وعمره"
    ],
    "triggerSignals": [
      "قرة",
      "حضانة",
      "ضيافة أطفال",
      "طفلي",
      "تكلفة الحضانة"
    ],
    "decisionPolicy": "تظهر عند توافر بيانات العمل والتأمينات والأجر ووجود طفل ضمن العمر المنشور. لا نستنتج وجود أطفال من حجم الأسرة فقط."
  },
  {
    "id": "career_guidance_sobol",
    "name": "التوجيه والإرشاد المهني (سبل)",
    "sector": "التوظيف والتدريب",
    "provider": "صندوق تنمية الموارد البشرية (هدف)",
    "audience": [
      "طلاب",
      "حديثو التخرج",
      "باحثون عن عمل",
      "موظفون"
    ],
    "summary": "منظومة إرشاد مهني تساعد المستفيد على استكشاف المهن والمهارات والفرص التعليمية والتدريبية وبناء مسار مهني مناسب.",
    "channel": "الخدمات الإلكترونية لصندوق تنمية الموارد البشرية",
    "duration": "بحسب الخدمة المختارة",
    "sourceUrl": "https://www.hrdf.org.sa/products-and-services/programs/individuals/guidance/career-guidance-sobol/",
    "checkedAt": "2026-10-02",
    "ruleFacts": [
      "تستهدف المبادرة شرائح واسعة تشمل الطلبة وحديثي التخرج والموظفين",
      "تشمل خدمات استكشاف مهني وفرص تعليمية وتدريبية وإرشادا مهنيا"
    ],
    "requiredData": [
      "المرحلة المهنية",
      "الهدف المهني عند تخصيص التوصية"
    ],
    "triggerSignals": [
      "سبل",
      "وش المسار المهني المناسب",
      "إرشاد مهني",
      "وش تخصصي المناسب",
      "أطور مساري"
    ],
    "decisionPolicy": "تظهر كخدمة إرشاد مناسبة عندما يكون السؤال عن المسار المهني أو التطوير، ولا تقدم كقرار توظيف أو أهلية مالية."
  }
]
`````

## `docs/CHAT_ENGINE.md`

`````text
# محرك المحادثة في صلة V6

هذه النسخة لا تعتمد على LLM كصندوق أسود. المحادثة تمر بمراحل مستقلة حتى نحافظ على الدقة ونقلل زمن الانتظار والهبد.


## V6: Semantic Frame

الفرق الأساسي في V6 أن مرحلة الفهم لا تتعامل مع الرسالة كـIntent واحد فقط. يتم استخراج حقائق مستقلة يمكن للقواعد الاعتماد عليها:

```json
{
  "intent": "new_job",
  "mode": "reported",
  "jobStage": "reviewing",
  "salary": 6500,
  "accepted": false,
  "started": false
}
```

كما يفصل المبلغ النهائي عن مقدار التغيير. لذلك `راتبي انخفض 500 ريال` يمثل `delta=-500`، بينما `راتبي صار 5000` يمثل قيمة نهائية.

حالة المحادثة تحتفظ بآخر خدمة ونتيجة وادعاء مهم. هذا يسمح لأسئلة المتابعة مثل `ليش؟` و`تنطبق علي؟` و`أقدر أقدم عليه؟` بالرجوع للمرجع الصحيح بدون إعادة تفسير الرحلة من الصفر.

Gold Set المرفق في `tests/gold100.json` يغطي 100 صياغة واقعية، ويعمل كاختبار Regression دائم لأي تعديل على المحرك.

## المسار

```text
رسالة المستفيد
  ↓
1. Query Refinement محلي
  ↓
2. استخراج الحقائق الواضحة
  ↓
3. فحص سياق الجلسة والـSlots السابقة
  ↓
4. استرجاع خدمات محدود عند الحاجة فقط
  ↓
5. Groq مرة واحدة فقط إذا بقي غموض لغوي
  ↓
6. دمج الحقائق الحتمية فوق نتيجة النموذج
  ↓
7. Slot Filling وسؤال معلومة واحدة مؤثرة إذا كانت ناقصة
  ↓
8. Rules Engine
  ↓
9. رد مبني من القواعد والمصادر
```

## 1. Query Refinement

قبل الاتصال بالـAI، صلة ينظف الرسالة ويفهم أشياء يمكن استخراجها بدون نموذج لغوي:

- الأرقام العربية والإنجليزية
- الصياغات العامية مثل `ستة ونص`
- مرحلة الوظيفة مثل `وافقت` أو `باشرت`
- النفي مثل `ما باشرت`
- هل الوظيفة بديلة عن الحالية
- بعض الأحداث الواضحة مثل الاستقالة أو انتهاء العقد
- أسماء الخدمات والمصطلحات الشائعة

هذه المرحلة تمنع فقد معلومة صريحة قالها المستفيد.

مثال:

```text
جاني شغل بستة ونص ووافقت بس للحين ما باشرت
```

تتحول محليا إلى:

```json
{
  "intent": "new_job",
  "salary": 6500,
  "jobStage": "accepted",
  "started": false
}
```

## 2. Confidence قبل الافتراض

صلة لا يحول كل رقم قصير إلى آلاف بدون تأكيد.

```text
راتبي بيصير 7
```

يستنتج احتمال 7000 لكنه يسأل:

```text
تقصد 7,000 ريال؟
```

أما:

```text
جاني شغل بستة ونص
```

فالسياق والصياغة يعطيان ثقة أعلى ويقرأها 6500 بدون إعادة سؤال الراتب.

## 3. Session Slots

صلة يحتفظ بالمتغيرات المهمة في السيناريو بدل محاولة استنتاج كل شيء من آخر رسالة فقط.

أمثلة Slots:

- salary
- income
- jobStage
- replacesCurrentJob
- endStage
- endReason
- targetServiceIds

المعلومة الموجودة في الجلسة لا يعاد سؤال المستفيد عنها.

## 4. قاموس اللغة

`data/language_glossary.json` يحتوي مرادفات ومصطلحات شائعة يمكن توسيعها بدون تغيير جوهر المحرك.

أمثلة:

```text
حافز -> إعانة البحث عن عمل
بستة ونص -> 6500 في سياق راتب
ما باشرت -> لا تعتبر الوظيفة started
```

القاموس ليس قاعدة أهلية. دوره توحيد لغة المستخدم مع لغة النظام.

## 5. Retrieval محدود

صلة لا يرسل 18 خدمة إلى النموذج.

- سؤال حدث مثل وظيفة جديدة أو تغير دخل: لا نرسل أي كتالوج خدمات للـAI
- سؤال خدمة غامض: الاسترجاع المحلي يختار عادة 1 إلى 3 خدمات مرشحة
- اسم خدمة مباشر: نتعامل معه محليا في أغلب الحالات

محرك القواعد وحده يقرر لاحقا أي خدمة مرتبطة بالنتيجة.

## 6. AI للفهم فقط

Groq لا يقرر الأهلية ولا يكتب القرار النهائي.

يستخدم فقط عندما تكون صياغة المستخدم غير واضحة بما يكفي للمنطق المحلي.

إذا كان لدينا حقيقة محلية عالية الثقة مثل `salary = 6500` أو `ما باشرت` فلا يسمح لنتيجة النموذج أن تناقضها.

## 7. Clarification بدلا من التخمين

إذا كانت معلومة مؤثرة ناقصة، نسأل سؤالا واحدا واضحا.

مثال خالد:

```text
جاني شغل بستة ونص ووافقت بس ما باشرت
```

نعرف الراتب والمرحلة. السؤال المتبقي الذي يغير النتيجة:

```text
هل الوظيفة الجديدة بديلة عن وظيفتك الحالية، أو أن عقدك الحالي سيبقى قائما؟
```

ولا نعيد سؤال الراتب.

## 8. Validation

بعد فهم الرسالة نطبق فحوص اتساق قبل القواعد.

مثال:

```text
وافقت بس ما باشرت
```

لا يمكن أن تنتهي داخليا كـ`started` حتى لو أخطأ النموذج في التصنيف.

## 9. الاستمرارية عند تعطل AI

- Timeout واضح لـGroq
- لا توجد Retry loops طويلة
- الأسئلة الواضحة تعمل بدون AI أصلا
- إذا تعطل Groq يرجع النظام للمسار المحلي بدل ترك `/api/chat` في Pending

## 10. سلوك الواجهة

المحادثة لا تنزل تلقائيا عند وصول الرد.

- موضع القراءة يبقى كما هو
- المستخدم ينزل بنفسه لقراءة الرد الجديد
- تركيز حقل الإدخال يستخدم `preventScroll`
- `overflow-anchor` معطل داخل مساحة الرسائل لمنع تحريك المتصفح للمحتوى تلقائيا

## أنماط التصميم التي أخذناها كمرجع

### Intercom Fin

الفكرة المستخدمة: تحسين السؤال قبل الإرسال، استرجاع المعرفة ذات الصلة فقط، طلب توضيح إذا انخفضت الثقة، ثم فحص جودة النتيجة قبل الرد.

مرجع:
https://www.intercom.com/help/en/articles/9929230-the-fin-ai-engine

### Microsoft Copilot Studio

الفكرة المستخدمة: Inputs واضحة لكل مهمة، تعبئة القيم من سياق المحادثة أو ملف المستخدم، والسؤال فقط عن المدخلات الناقصة مع validation للقيم.

مراجع:
https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration
https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-additional-settings-topic-action-inputs

### Google Dialogflow CX

الفكرة المستخدمة: Session parameters تحفظ القيم خلال الرحلة، والـwebhook يستقبل البيانات المنظمة لتطبيق منطق الأعمال بدل الاعتماد على النص الخام.

مراجع:
https://docs.cloud.google.com/dialogflow/cx/docs/concept/parameter
https://docs.cloud.google.com/dialogflow/cx/docs/concept/webhook

### Zendesk AI Agents

الفكرة المستخدمة: Knowledge Search Rules تحدد أي مصادر يبحث فيها الوكيل حسب حالة المحادثة، وتجنب توسيع المعرفة المرسلة بدون داع لأن كثرة المصادر قد تزيد latency وتخفض الدقة.

مراجع:
https://support.zendesk.com/hc/en-us/articles/9185497386394-Configuring-search-rules-for-knowledge-sources-for-AI-agents
https://support.zendesk.com/hc/en-us/articles/8357749301658-Connecting-knowledge-sources-to-power-generative-replies-in-advanced-AI-agents

### Ada

الفكرة المستخدمة: Glossary يربط لغة المستخدم والمصطلحات الشائعة بالمصطلحات الرسمية التي يستخدمها النظام في الفهم والبحث.

مرجع:
https://docs.ada.cx/2026-07-06-glossary-ga

### GOV.UK Chat

الفكرة المستخدمة: السؤال التوضيحي عند الغموض، إعطاء المستخدم طريقة للتحقق من المصدر، قياس الدقة والسرعة والثقة، وعدم الإجابة عندما لا توجد ثقة كافية.

مرجع:
https://insidegovuk.blog.gov.uk/2026/03/16/5-things-we-learned-testing-gov-uk-chat-an-ai-assistant-for-government/
`````

## `docs/LOGIC_MODEL.md`

`````text
# نموذج المنطق في صلة

## 1. حالة الخدمة ليست قيمة واحدة

لكل خدمة أربع زوايا مستقلة:

- `current`: هل المستفيد يستخدم الخدمة حاليا
- `availability`: هل التقديم أو استخدام الخدمة متاح من حيث المبدأ
- `eligibility`: هل نعرف نتيجة أهلية فعلية أم لا
- `relevance`: هل الخدمة مرتبطة بالحالة الحالية أو السؤال أو حدث مستقبلي

هذا يمنع الاستنتاج الخاطئ:

```text
غير مستفيد حاليا = لا يمكن التقديم
```

## 2. الحقيقة غير البلاغ غير الافتراض

صلة يميز بين:

- `current`: معلومة حالية من المصدر
- `reported`: تغيير يقول المستفيد إنه حدث فعلا لكنه قد لا يكون انعكس في المصدر
- `what_if`: سيناريو افتراضي لم يحدث

في الوظيفة الجديدة مثلا:

```text
وصلني العرض
وافقت من جهتي
تم توثيق العقد
بدأت العمل
```

كل مرحلة لها أثر مختلف.

## 3. Query Refinement قبل النموذج

قبل Groq، `src/nlu.js` يحاول استخراج الحقائق التي لا تحتاج تخمينا:

- أرقام مكتوبة بالعربية أو الإنجليزية
- تعبيرات راتب عامية مثل `ستة ونص`
- مرحلة العقد أو الوظيفة
- النفي مثل `ما باشرت`
- هل الوظيفة بديلة عن الحالية
- مرحلة انتهاء العلاقة وسببها إن كان صريحا
- أسماء خدمات ومرادفات شائعة

الحقيقة المحلية عالية الثقة لا يسمح للنموذج أن يناقضها.

## 4. Session Slots

صلة يحتفظ بالمتغيرات المؤثرة خلال المحادثة، مثل:

```text
salary
income
jobStage
replacesCurrentJob
endStage
endReason
targetServiceIds
```

إذا كانت المعلومة موجودة في الرسالة السابقة أو ملف المستفيد فلا يعيد السؤال عنها.

## 5. الذكاء الاصطناعي يفهم اللغة فقط

إذا كان السؤال واضحا من القواعد المحلية، لا يتم استدعاء Groq.

إذا احتاج السؤال فهما لغويا أوسع:

1. ننقح الرسالة ونستخرج الحقائق الحتمية
2. `src/retrieval.js` يبحث محليا في كتالوج الخدمات عند الحاجة
3. أحداث مثل وظيفة جديدة أو تغير دخل ترسل صفر خدمات للـAI
4. أسئلة الخدمة الغامضة ترسل عادة 1 إلى 3 خدمات فقط
5. Groq يعيد Intent وEntities وMode
6. نعيد تطبيق الحقائق المحلية فوق النتيجة
7. `src/rules.js` يصدر النتيجة
8. الرد النهائي يبنى محليا من حقائق النتيجة

لا يوجد طلب AI ثان لصياغة الرد.

## 6. الاسترجاع ليس قرار أهلية

ترشيح خدمة لطبقة الفهم لا يعني أن المستفيد مؤهل لها.

الاسترجاع يعتمد على:

- اسم الخدمة أو المرادف
- Trigger Signals
- كلمات السؤال
- المجال
- سياق المحادثة
- ارتباط أولي ببيانات المستفيد

ثم يظل محرك القواعد هو صاحب قرار الارتباط والتقييم الأولي.

## 7. Clarification بدل التخمين

إذا بقيت معلومة واحدة مؤثرة غير محسومة، نسأل عنها فقط.

مثال:

```text
جاني شغل بستة ونص ووافقت بس ما باشرت
```

نعرف:

```text
salary = 6500
jobStage = accepted
started = false
```

إذا كان وضع الوظيفة الحالية هو المتغير الوحيد الذي يغير النتيجة، نسأل عنه ولا نعيد سؤال الراتب.

أما:

```text
راتبي بيصير 7
```

فنطلب تأكيد 7000 لأن التعبير المختصر يحتمل اللبس.

## 8. قاموس لغة مستقل

`data/language_glossary.json` يربط ما يقوله المستفيد بالمصطلح الرسمي.

هذا يسمح بدعم تعبيرات مثل:

```text
حافز
الضمان
ستة ونص
ما باشرت
بديلة عن وظيفتي
```

بدون تلويث قواعد الأهلية أو كتابة فرع محادثة يدوي لكل جملة.

## 9. Validation

بعد فهم الرسالة نطبق فحوص اتساق قبل القواعد.

مثال:

```text
وافقت بس ما باشرت
```

لا يمكن أن تنتهي داخليا كـ`started` حتى لو أخطأ النموذج في التصنيف.

## 10. لا تعليق عند تعطل مزود اللغة

كل طلب Groq لديه Timeout صريح.

إذا حصل Timeout أو Rate Limit أو خطأ شبكة:

- لا نعيد المحاولة عدة مرات
- نرجع إلى المسار المحلي
- إذا وجد الاسترجاع تطابقا قويا ومباشرا يمكن ربط السؤال بالخدمة بأمان
- وإلا صلة يطلب توضيحا بدل التخمين

## 11. سؤال الخدمة المباشر

إذا سأل المستخدم عن خدمة بالاسم، صلة يفحص الخدمة حتى لو لم يكن مشتركا فيها حاليا.

مثال:

```text
هل الضمان ممكن يناسبني؟
```

لا نحول عدم الاستفادة الحالية إلى رفض.

## 12. توأم الحالة

`What If` لا يعدل الملف الحالي. صلة ينشئ حالة افتراضية ويشغل عليها نفس القواعد ثم يعرض الفرق.
`````

## `public/app.js`

`````text
const state = {
  bootstrap: null,
  profileId: 'khalid',
  history: [],
  scenarioState: {},
  sending: false,
  serviceFilter: 'الكل',
  servicesExpanded: false
};

const el = id => document.getElementById(id);
const profileSelect = el('profileSelect');
const aiStatus = el('aiStatus');
const profileHeadline = el('profileHeadline');
const profileFacts = el('profileFacts');
const suggestions = el('suggestions');
const starterArea = el('starterArea');
const messages = el('messages');
const typing = el('typing');
const chatForm = el('chatForm');
const messageInput = el('messageInput');
const sendButton = el('sendButton');
const miniDashboard = el('miniDashboard');
const serviceGrid = el('serviceGrid');
const serviceFilters = el('serviceFilters');
const serviceCount = el('serviceCount');
const serviceExpand = el('serviceExpand');
const benchmarkMatrix = el('benchmarkMatrix');
const benchmarkGrid = el('benchmarkGrid');
const benchmarkLessons = el('benchmarkLessons');
const benchmarkModal = el('benchmarkModal');
const benchmarkModalContent = el('benchmarkModalContent');
const resetChatButton = el('resetChatButton');
const impactCallsQuarter = el('impactCallsQuarter');
const impactHoursQuarter = el('impactHoursQuarter');
const impactCallsYear = el('impactCallsYear');
const serviceModal = el('serviceModal');
const serviceModalContent = el('serviceModalContent');
const principlesGrid = el('principlesGrid');
const serviceRadar = el('serviceRadar');
const simulationDock = el('simulationDock');
const simulationContent = el('simulationContent');
const twinStatus = el('twinStatus');

const formatNumber = new Intl.NumberFormat('en-US');

const principles = [
  {
    title: 'نفصل الحقيقة عن الافتراض',
    body: 'كل معلومة عند صلة لها حالة واضحة: بيانات حالية، شيء أبلغ عنه المستفيد، أو سيناريو افتراضي. ما نخلط بينهم.'
  },
  {
    title: 'الذكاء الاصطناعي يفهم ولا يحكم',
    body: 'النموذج اللغوي يستخرج المقصود والمتغيرات ويطلب الناقص. قرار الارتباط بالخدمة يمر على قواعد محددة.'
  },
  {
    title: 'محرك واحد لكل القنوات',
    body: 'الشات والواجهة والأحداث التلقائية تستخدم نفس Rules Engine حتى ما تعطي القنوات نتائج متعارضة.'
  },
  {
    title: 'نسأل فقط عن المعلومة الناقصة',
    body: 'إذا الدخل والعقد وحجم الأسرة معروفين، ما نطلبهم من المستفيد مرة ثانية. السؤال يظهر فقط إذا غيّر النتيجة.'
  },
  {
    title: 'كل نتيجة قابلة للتفسير',
    body: 'النتيجة تعرض ليش ظهرت، وش البيانات اللي أثرت عليها، ورابط المصدر الرسمي المرتبط بها.'
  },
  {
    title: 'الخدمة لها مالك ومصدر وإصدار',
    body: 'كتالوج الخدمات ما يكون نصوص مبعثرة. كل قاعدة تحتاج مصدر رسمي وتاريخ مراجعة ومالك واضح في المنتج الحقيقي.'
  },
  {
    title: 'نفهم السؤال قبل ما نبحث',
    body: 'صلة يلتقط محليا الأرقام والمراحل والنفي مثل ستة ونص وما باشرت، ثم يستخدم AI فقط إذا بقي معنى لغوي يحتاج تفسير.'
  },
  {
    title: 'استرجاع صغير ومحدد',
    body: 'الأحداث مثل وظيفة جديدة أو تغير دخل ما ترسل أي كتالوج خدمات للنموذج. وإذا كان السؤال عن خدمة غامضة نرسل بحد أقصى ثلاث خدمات مرشحة فقط.'
  },
  {
    title: 'قاموس لغة المستفيد',
    body: 'المصطلحات الشائعة والقديمة واللهجة مثل حافز أو بستة ونص تنفهم عبر قاموس محلي قابل للتحديث بدل الاعتماد على صياغة واحدة.'
  },
  {
    title: 'الاختبارات جزء من التصميم',
    body: 'الحالات الحساسة مثل ارتفاع الدخل والاستقالة والعقد الجديد لها اختبارات منطق ثابتة قبل أي تغيير في الواجهة.'
  },
  {
    title: 'الرد النهائي ما يعتمد على توليد حر',
    body: 'الذكاء الاصطناعي يفهم الرسالة مرة واحدة، ثم محرك القواعد يبني النتيجة والرد من حقائق محددة. هذا يقلل الهلوسة ويحافظ على ثبات المنطق.'
  },
  {
    title: 'توأم الحالة منفصل عن الحقيقة',
    body: 'أي ماذا لو يعيش في نسخة افتراضية من الملف. نقدر نكمل السيناريو عبر المحادثة بدون تعديل البيانات الحالية.'
  }
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function linkSafe(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch {
    return '#';
  }
}

function employmentLabel(value) {
  return {
    employed: 'موظف',
    job_seeker: 'باحث عن عمل',
    not_employed: 'غير موظف',
    retired: 'متقاعد'
  }[value] || 'حالة أخرى';
}

function incomeLabel(profile) {
  const income = Number(profile.totalMonthlyIncome ?? profile.salary ?? 0);
  if (profile.incomeType === 'salary') return `راتب ${formatNumber.format(income)} ريال`;
  if (profile.incomeType === 'retirement') return `دخل تقاعدي ${formatNumber.format(income)} ريال`;
  if (income > 0) return `دخل معروف ${formatNumber.format(income)} ريال`;
  return 'لا يوجد دخل مسجل في النموذج';
}

function profileSuggestions(profile) {
  const common = [
    'وش الخدمات اللي تخصني؟',
    'وش الخدمات اللي أقدر أستفيد منها؟',
    'وش تغير في بياناتي؟'
  ];

  if (profile.id === 'khalid') {
    return [
      ...common,
      'جاني شغل بستة ونص ووافقت بس ما باشرت، وش يتغير علي؟',
      'لو راتبي صار 7000 وش يصير؟',
      'لو انتهى عقدي وش الأشياء اللي تحتاج انتباه؟'
    ];
  }
  if (profile.id === 'reem') {
    return [
      ...common,
      'لو نزل راتبي من 8500 إلى 4000 وش يتغير؟',
      'جاني عقد جديد وأنا على رأس العمل، وش تحتاج تعرف؟',
      'الشركة ما عطتني مستحقاتي، وش المسار المناسب؟'
    ];
  }
  if (profile.id === 'salman') {
    return [
      ...common,
      'هل إعانة البحث عن عمل تناسب حالتي؟',
      'هل تمهير قريب من وضعي؟',
      'وش برامج التدريب والتطوير اللي تناسبني؟',
      'جاني عرض بـ4500 ولسه أراجعه، وش يعني لو وافقت؟'
    ];
  }
  if (profile.id === 'noura') {
    return [
      ...common,
      'وش الخدمات المرتبطة بتقييم الإعاقة عندي؟',
      'هل فيه إعانة مالية تستحق التحقق لحالتي؟',
      'هل التسهيلات المرورية مرتبطة ببياناتي؟'
    ];
  }
  return [
    ...common,
    'هل فيه خدمات تظهر لي بسبب العمر؟',
    'ليش ظهرت لي بطاقة امتياز وهل صدرت فعليا؟'
  ];
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _ignored, ...fetchOptions } = options;

  try {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(fetchOptions.headers || {}) },
      ...fetchOptions,
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('انتهت مهلة الطلب بدون رد');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function boot(profileId = state.profileId) {
  const data = await api(`/api/bootstrap?profile=${encodeURIComponent(profileId)}`);
  state.bootstrap = data;
  state.profileId = data.profile.id;
  state.history = [];
  state.scenarioState = {};
  renderProfileSelector(data.profiles);
  renderAiStatus(data);
  renderProfileContext(data.profile);
  renderSuggestions(data.profile);
  renderDashboard(data);
  renderRadar(data);
  resetSimulation();
  renderServiceFilters(data.services);
  renderServices(data.services);
  renderBenchmarks(data.benchmarks);
  renderPrinciples();
  updateImpactScenario(0.05);
  resetChat(data.profile);
}

function renderProfileSelector(profiles) {
  profileSelect.innerHTML = profiles.map(profile => `
    <option value="${escapeHtml(profile.id)}" ${profile.id === state.profileId ? 'selected' : ''}>
      ${escapeHtml(profile.name)}
    </option>
  `).join('');
}

function renderAiStatus(data) {
  aiStatus.className = `status-pill ${data.aiEnabled ? 'connected' : 'demo'}`;
  aiStatus.textContent = data.aiEnabled ? 'Groq متصل' : 'وضع العرض';
  aiStatus.title = data.aiEnabled
    ? `متصل عبر ${data.provider || 'Groq'} باستخدام ${data.model}`
    : 'أضف GROQ_API_KEY في ملف .env لتفعيل فهم اللغة الطبيعي الكامل';
}

function renderProfileContext(profile) {
  profileHeadline.textContent = `${profile.name}، ${profile.age} سنة`;
  const facts = [
    employmentLabel(profile.employment),
    incomeLabel(profile),
    `الأسرة ${profile.familySize}`,
    profile.activeContract ? 'عقد وظيفي فعّال' : 'لا يوجد عقد وظيفي فعّال'
  ];
  if (profile.socialSecurityBeneficiary) facts.push('مستفيد من الضمان');
  if (profile.hasDisability) facts.push(profile.disabilityEvaluationActive ? 'تقييم إعاقة ساري' : 'تقييم إعاقة يحتاج تحديث');
  if (Number(profile.domesticWorkers || 0) > 0) facts.push(`${profile.domesticWorkers} عمالة منزلية`);
  profileFacts.innerHTML = facts.map(fact => `<span class="fact-chip">${escapeHtml(fact)}</span>`).join('');
}

function renderSuggestions(profile) {
  suggestions.innerHTML = profileSuggestions(profile).map(text => `
    <button class="suggestion" type="button" data-question="${escapeHtml(text)}">${escapeHtml(text)}</button>
  `).join('');
}

function renderDashboard(data) {
  const cards = [
    { label: 'مرتبطة بحالتك الحالية', title: 'خدمات معروفة الآن', value: data.currentServices.length },
    { label: 'بناء على البيانات المتاحة', title: 'خدمات تستحق التحقق', value: data.opportunities.length },
    { label: 'من آخر بيانات النموذج', title: 'تغيرات مرصودة', value: data.changes.length }
  ];
  miniDashboard.innerHTML = cards.map(card => `
    <article class="mini-card">
      <div><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.title)}</strong></div>
      <b>${card.value}</b>
    </article>
  `).join('');
}

function renderRadar(data) {
  const lanes = [
    {
      title: 'مرتبطة بك الآن',
      hint: 'من الحالة الحالية',
      items: data.currentServices || []
    },
    {
      title: 'تستحق التحقق',
      hint: 'من البيانات المتاحة',
      items: data.opportunities || []
    }
  ];

  serviceRadar.innerHTML = lanes.map(lane => `
    <div class="radar-lane">
      <div class="radar-lane-head">
        <div><strong>${escapeHtml(lane.title)}</strong><span>${escapeHtml(lane.hint)}</span></div>
        <b>${lane.items.length}</b>
      </div>
      <div class="radar-items">
        ${lane.items.length
          ? lane.items.slice(0, 6).map(item => `<span>${escapeHtml(item.title)}</span>`).join('')
          : '<span class="radar-empty">ما ظهر شيء في هذه الفئة الآن</span>'}
      </div>
    </div>
  `).join('');
}

function resetSimulation() {
  simulationDock.classList.add('idle');
  twinStatus.textContent = 'جاهز للمحاكاة';
  simulationContent.className = 'twin-empty';
  simulationContent.innerHTML = 'اكتب مثلا: لو نزل راتبي إلى 4000، أو جاني عرض جديد ووافقت بس ما باشرت';
}

function renderSimulation(simulation) {
  if (!simulation?.active) {
    resetSimulation();
    return;
  }

  simulationDock.classList.remove('idle');
  twinStatus.textContent = simulation.status || 'محاكاة';
  simulationContent.className = 'twin-content';
  simulationContent.innerHTML = `
    <div class="twin-title-row">
      <strong>${escapeHtml(simulation.title || 'معاينة الأثر')}</strong>
      <span>${escapeHtml(simulation.note || '')}</span>
    </div>
    <div class="twin-columns">
      <div class="twin-side current">
        <small>الحالة الحالية</small>
        ${(simulation.current || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
      <div class="twin-side hypothetical">
        <small>السيناريو</small>
        ${(simulation.hypothetical || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    </div>
    <div class="twin-affected">
      <b>الخدمات المرتبطة بالنتيجة</b>
      ${(simulation.affected || []).length
        ? simulation.affected.map(item => `<span>${escapeHtml(item)}</span>`).join('')
        : '<span>ما ظهرت خدمة محددة بعد، وقد نحتاج معلومة إضافية</span>'}
    </div>
  `;
}

function resetChat(profile) {
  messages.innerHTML = `
    <div class="chat-empty">
      <strong>ابدأ من أي سؤال</strong>
      <span>أول رسالة تكتبها تروح مباشرة إلى فهم اللغة ومحرك القواعد</span>
    </div>
  `;
  starterArea.classList.remove('hidden');
  messageInput.placeholder = `اكتب بطريقتك يا ${profile.name}... مثال: وش الخدمات اللي تخصني؟`;
}

function addUserMessage(text) {
  const article = document.createElement('article');
  article.className = 'message user';
  article.innerHTML = `<div class="message-body">${escapeHtml(text)}</div>`;
  const previousTop = messages.scrollTop;
  messages.appendChild(article);
  requestAnimationFrame(() => { messages.scrollTop = previousTop; });
}

function paragraphs(text) {
  return escapeHtml(text).replaceAll('\n', '<br>');
}

function resultCard(item) {
  const source = item.sourceUrl
    ? `<a class="result-source" href="${linkSafe(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceName || 'المصدر الرسمي')} ↗</a>`
    : '';
  const usedData = item.usedData?.length
    ? `<div class="evidence-row"><b>اعتمدنا على</b>${item.usedData.map(value => `<span>${escapeHtml(value)}</span>`).join('')}</div>`
    : '';
  const unknowns = item.unknowns?.length
    ? `<div class="unknown-row"><b>ما زال غير معروف</b><span>${escapeHtml(item.unknowns.join('، '))}</span></div>`
    : '';
  return `
    <article class="result-card ${escapeHtml(item.type || 'info')}">
      <span class="result-tag">${escapeHtml(item.tag || 'نتيجة')}</span>
      <h4>${escapeHtml(item.title || '')}</h4>
      <p>${escapeHtml(item.body || '')}</p>
      ${item.why ? `<div class="result-why"><b>ليش ظهر؟</b> ${escapeHtml(item.why)}</div>` : ''}
      ${usedData}
      ${unknowns}
      ${source}
    </article>
  `;
}

function changeCard(change) {
  const date = change.date ? new Date(`${change.date}T00:00:00`).toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' }) : '';
  const transition = change.from !== undefined && change.to !== undefined
    ? `<p>${escapeHtml(String(change.from))} ← ${escapeHtml(String(change.to))}</p>`
    : '';
  return `
    <article class="change-card">
      <small>${escapeHtml(date)} ${change.source ? `• ${escapeHtml(change.source)}` : ''}</small>
      <strong>${escapeHtml(change.label || 'تحديث في البيانات')}</strong>
      ${transition}
      <p>${escapeHtml(change.interpretation || '')}</p>
    </article>
  `;
}

function addAssistantMessage(text, results = [], changes = [], quickReplies = []) {
  const article = document.createElement('article');
  article.className = 'message assistant';
  const cards = results.length ? `<div class="result-stack">${results.map(resultCard).join('')}</div>` : '';
  const changeCards = changes.length ? `<div class="change-stack">${changes.map(changeCard).join('')}</div>` : '';
  const replies = quickReplies.length ? `
    <div class="quick-replies">
      ${quickReplies.map(reply => `<button type="button" class="quick-reply" data-question="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`).join('')}
    </div>
  ` : '';
  article.innerHTML = `
    <div class="message-body">
      <div class="assistant-copy">${paragraphs(text)}</div>
      ${cards}
      ${changeCards}
      ${replies}
    </div>
  `;
  const previousTop = messages.scrollTop;
  messages.appendChild(article);
  requestAnimationFrame(() => { messages.scrollTop = previousTop; });
}

async function sendMessage(text) {
  const clean = String(text || '').trim();
  if (!clean || state.sending) return;

  const historyBefore = state.history.slice(-12);
  state.sending = true;
  sendButton.disabled = true;
  messageInput.disabled = true;
  messages.querySelector('.chat-empty')?.remove();
  addUserMessage(clean);
  state.history.push({ role: 'user', text: clean });
  typing.classList.remove('hidden');

  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: clean,
        profileId: state.profileId,
        history: historyBefore,
        scenarioState: state.scenarioState
      })
    });
    state.scenarioState = data.scenarioState || {};
    state.history.push({ role: 'assistant', text: data.reply });
    addAssistantMessage(data.reply, data.results || [], data.changes || [], data.quickReplies || []);
    renderSimulation(data.simulation);
  } catch (error) {
    addAssistantMessage(`صار خطأ في الاتصال بالخادم: ${error.message}. تأكد أن السيرفر شغال وأن إعدادات الربط صحيحة.`);
  } finally {
    typing.classList.add('hidden');
    state.sending = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.value = '';
    resizeTextarea();
    messageInput.focus({ preventScroll: true });
  }
}

function renderServiceFilters(services) {
  const sectors = ['الكل', ...new Set(services.map(service => service.sector))];
  serviceFilters.innerHTML = sectors.map(sector => `
    <button type="button" class="filter-chip ${sector === state.serviceFilter ? 'active' : ''}" data-sector="${escapeHtml(sector)}">${escapeHtml(sector)}</button>
  `).join('');
}

function renderServices(services) {
  serviceCount.textContent = services.length;
  const filtered = state.serviceFilter === 'الكل'
    ? services
    : services.filter(service => service.sector === state.serviceFilter);
  const shouldCollapse = state.serviceFilter === 'الكل' && !state.servicesExpanded && filtered.length > 8;
  const visible = shouldCollapse ? filtered.slice(0, 8) : filtered;

  if (serviceExpand) {
    serviceExpand.classList.toggle('hidden', state.serviceFilter !== 'الكل' || filtered.length <= 8);
    serviceExpand.textContent = state.servicesExpanded ? 'عرض مختصر' : `عرض كل ${filtered.length} خدمة`;
  }

  serviceGrid.innerHTML = visible.map(service => `
    <button class="service-compact-card" type="button" data-service-id="${escapeHtml(service.id)}">
      <div class="service-compact-top">
        <span class="service-sector">${escapeHtml(service.sector)}</span>
        <span class="service-compact-provider">${escapeHtml(service.provider || '')}</span>
      </div>
      <strong>${escapeHtml(service.name)}</strong>
      <p>${escapeHtml(service.summary)}</p>
      <span class="service-open-label">التفاصيل والقواعد ←</span>
    </button>
  `).join('');
}

function openServiceModal(serviceId) {
  const service = state.bootstrap?.services?.find(item => item.id === serviceId);
  if (!service || !serviceModal || !serviceModalContent) return;

  const facts = (service.ruleFacts || []).map(fact => `<li>${escapeHtml(fact)}</li>`).join('');
  const data = (service.requiredData || []).map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const signals = (service.triggerSignals || []).map(item => `<span>${escapeHtml(item)}</span>`).join('');
  const audience = (service.audience || []).map(item => `<span>${escapeHtml(item)}</span>`).join('');

  serviceModalContent.innerHTML = `
    <div class="service-modal-eyebrows">
      <span class="service-sector">${escapeHtml(service.sector)}</span>
      <span class="service-provider">${escapeHtml(service.provider || '')}</span>
    </div>
    <h3 id="serviceModalTitle">${escapeHtml(service.name)}</h3>
    <p class="service-modal-summary">${escapeHtml(service.summary)}</p>

    <div class="service-modal-meta">
      <div><small>القناة</small><b>${escapeHtml(service.channel || 'بحسب الخدمة')}</b></div>
      <div><small>المدة المنشورة</small><b>${escapeHtml(service.duration || 'غير محددة')}</b></div>
      <div><small>آخر مراجعة في النموذج</small><b>${escapeHtml(service.checkedAt || '')}</b></div>
    </div>

    ${audience ? `<div class="modal-block"><b>الفئات المرتبطة</b><div class="modal-pills">${audience}</div></div>` : ''}
    <div class="modal-block"><b>متى يفكر صلة في هذه الخدمة</b><div class="modal-pills">${signals || '<span>بحسب السؤال والحالة</span>'}</div></div>
    <div class="modal-block"><b>القواعد المنشورة التي نمذجناها</b><ul>${facts}</ul></div>
    <div class="modal-block"><b>البيانات المطلوبة للتقييم</b><ul>${data}</ul></div>
    <div class="service-policy"><b>سياسة القرار في صلة</b><p>${escapeHtml(service.decisionPolicy || '')}</p></div>

    <div class="service-modal-actions">
      <a href="${linkSafe(service.sourceUrl)}" target="_blank" rel="noopener">المصدر الرسمي ↗</a>
      ${service.regulationUrl ? `<a class="secondary-link" href="${linkSafe(service.regulationUrl)}" target="_blank" rel="noopener">اللائحة أو المرجع ↗</a>` : ''}
    </div>
  `;

  serviceModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  serviceModal.querySelector('.service-modal-close')?.focus();
}

function closeServiceModal() {
  serviceModal?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function benchmarkSpecial(item) {
  if (item.id === 'lifesg') {
    return `
      <div class="benchmark-special before-after-visual">
        <div><small>قبل</small><strong>نحو 60 دقيقة</strong><span class="visual-bar full"></span></div>
        <div><small>بعد</small><strong>15 دقيقة</strong><span class="visual-bar quarter"></span></div>
        <b>تسجيل الولادة أسرع بنحو 75%</b>
      </div>
    `;
  }

  if (item.id === 'estonia' && item.distribution?.length) {
    const max = Math.max(...item.distribution.map(entry => Number(entry.value) || 0));
    return `
      <div class="benchmark-special distribution-visual">
        ${item.distribution.slice(0, 7).map(entry => {
          const width = max ? Math.max(5, Math.round((Number(entry.value) / max) * 100)) : 0;
          return `<div class="distribution-row"><span>${escapeHtml(entry.label)}</span><i><b style="width:${width}%"></b></i><strong>${formatNumber.format(entry.value)}</strong></div>`;
        }).join('')}
      </div>
    `;
  }

  if (item.id === 'france') {
    return `
      <div class="benchmark-special state-isolation-visual">
        <div><small>الحالة الحالية</small><b>تبقى كما هي</b></div>
        <span>نسخة محاكاة</span>
        <div><small>What If</small><b>نتيجة تقديرية فقط</b></div>
      </div>
    `;
  }

  if (item.id === 'tell_us_once') {
    return `
      <div class="benchmark-special trust-visual">
        <div><strong>98%</strong><span>تجربة جيدة في مسح 2013</span></div>
        <div><strong>100%</strong><span>سهولة الاستخدام الإلكتروني</span></div>
        <div><strong>&gt;95%</strong><span>ثقة في البيانات والتنفيذ</span></div>
      </div>
    `;
  }

  if (item.id === 'mygov') {
    return `
      <div class="benchmark-special caution-visual">
        <div><strong>34%</strong><span>قُبلت مباشرة</span></div>
        <div><strong>38%</strong><span>احتاجت تدخل موظف</span></div>
        <div><strong>7/15</strong><span>خدمة عضو استخدمت Tell Us Once</span></div>
      </div>
    `;
  }
  return '';
}

function benchmarkById(id) {
  return state.bootstrap?.benchmarks?.find(item => item.id === id) || null;
}

function benchmarkList(values = []) {
  return values.length
    ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    : '<p>لا توجد تفاصيل منشورة كافية في المصادر المستخدمة.</p>';
}

function benchmarkDetailCard(title, values = []) {
  return `
    <article class="benchmark-detail-card">
      <b>${escapeHtml(title)}</b>
      ${benchmarkList(values)}
    </article>
  `;
}

function openBenchmarkModal(id) {
  const item = benchmarkById(id);
  if (!item || !benchmarkModal || !benchmarkModalContent) return;

  const metrics = (item.metrics || []).map(metric => `
    <div><small>${escapeHtml(metric.label)}</small><strong>${escapeHtml(metric.value)}</strong></div>
  `).join('');
  const results = benchmarkList(item.results || []);
  const challenges = benchmarkList(item.challenges || []);
  const lessons = benchmarkList(item.lessons || []);
  const applied = benchmarkList(item.appliedToSilah || []);
  const sources = (item.sources || []).map(source => `
    <a href="${linkSafe(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.label)} ↗</a>
  `).join('');

  benchmarkModalContent.innerHTML = `
    <div class="benchmark-modal-eyebrows">
      <span>${escapeHtml(item.country)}</span>
      ${item.historical ? '<span class="historical-note">الأرقام التاريخية موضحة بوضوح</span>' : ''}
      ${item.cautionCard ? '<span class="caution-note">تجربة تحذيرية للتكامل</span>' : ''}
      <span class="review-note">مراجعة ${escapeHtml(item.sourceDate || '')}</span>
    </div>
    <h3 id="benchmarkModalTitle">${escapeHtml(item.name)}</h3>
    <p class="benchmark-modal-headline">${escapeHtml(item.headline)}</p>
    <p class="benchmark-modal-pattern">${escapeHtml(item.pattern)}</p>

    <div class="benchmark-modal-metrics">${metrics}</div>
    ${benchmarkSpecial(item)}

    <div class="benchmark-story-block">
      <span>01</span>
      <div><b>المشكلة اللي كانوا يحلونها</b><p>${escapeHtml(item.problem || item.why || '')}</p></div>
    </div>
    <div class="benchmark-story-block">
      <span>02</span>
      <div><b>ليش بنوا الحل</b><p>${escapeHtml(item.whyBuilt || item.why || '')}</p></div>
    </div>

    <div class="benchmark-detail-grid">
      ${benchmarkDetailCard('وش بنوا فعليا', item.whatTheyBuilt || [])}
      ${benchmarkDetailCard('كيف تمشي الرحلة', item.journey || [])}
      ${benchmarkDetailCard('كيف صمموا التجربة', item.design || [])}
      ${benchmarkDetailCard('كيف اشتغل التكامل', item.integration || [])}
      ${benchmarkDetailCard('وش البيانات المستخدمة', item.dataUsed || [])}
    </div>

    <div class="benchmark-story-block">
      <span>03</span>
      <div><b>النتائج والأرقام المنشورة</b>${results}</div>
    </div>
    <div class="benchmark-story-block benchmark-challenges-block">
      <span>04</span>
      <div><b>التحديات والقيود</b>${challenges}</div>
    </div>

    <div class="benchmark-learning-grid">
      <article class="benchmark-learning-card">
        <span class="micro-label">الدروس لصلة</span>
        <h4>وش نتعلم من التجربة</h4>
        ${lessons}
      </article>
      <article class="benchmark-learning-card applied">
        <span class="micro-label">مطبق في النموذج</span>
        <h4>وش طبقناه فعليا في صلة</h4>
        ${applied}
      </article>
    </div>

    <div class="benchmark-caution-box">
      <b>وش ما نبي نكرر أو نفترض</b>
      <p>${escapeHtml(item.caution || '')}</p>
    </div>
    <div class="benchmark-source-block">
      <b>المصادر الرسمية</b>
      <div>${sources}</div>
    </div>
  `;

  benchmarkModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  benchmarkModal.querySelector('.service-modal-close')?.focus();
}

function closeBenchmarkModal() {
  benchmarkModal?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function renderBenchmarks(items) {
  benchmarkGrid.innerHTML = items.map((item, index) => {
    const topMetrics = (item.metrics || []).slice(0, 2).map(metric => `
      <div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>
    `).join('');
    return `
      <button type="button" class="benchmark-compact-card ${item.cautionCard ? 'caution' : ''}" data-benchmark-id="${escapeHtml(item.id)}">
        <span class="benchmark-card-index">0${index + 1}</span>
        <div class="benchmark-card-copy">
          <small>${escapeHtml(item.country)}</small>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.headline)}</p>
        </div>
        <div class="benchmark-card-metrics">${topMetrics}</div>
        <span class="benchmark-open-label">اضغط للتفاصيل الكاملة <b>↗</b></span>
      </button>
    `;
  }).join('');

  const capabilityDefs = [
    ['personalisation', 'تخصيص'],
    ['life_events', 'أحداث الحياة'],
    ['proactive', 'استباقية'],
    ['simulation', 'محاكاة'],
    ['tell_once', 'Tell Once'],
    ['profile_reuse', 'إعادة استخدام البيانات'],
    ['tracking', 'متابعة الحالة'],
    ['consent', 'Consent'],
    ['interoperability', 'تكامل الأنظمة']
  ];

  benchmarkMatrix.innerHTML = `
    <div class="matrix-heading">
      <div><span class="micro-label">خريطة القدرات</span><h3>كل تجربة حلت جزءا مختلفا من المشكلة</h3></div>
      <p>هذه المقارنة توضح كيف جمعنا الأنماط داخل صلة بدل نسخ منتج حكومي واحد</p>
    </div>
    <div class="matrix-scroll">
      <table class="capability-table">
        <thead><tr><th>التجربة</th>${capabilityDefs.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${items.map(item => {
            const caps = new Set(item.capabilities || []);
            const aliases = new Set(caps);
            if (caps.has('prefill')) aliases.add('profile_reuse');
            if (caps.has('progress_tracking')) aliases.add('tracking');
            if (caps.has('status_feedback')) aliases.add('tracking');
            return `<tr><td><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.country)}</small></td>${capabilityDefs.map(([id]) => `<td><span class="matrix-dot ${aliases.has(id) ? 'on' : ''}">${aliases.has(id) ? '✓' : ''}</span></td>`).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  benchmarkLessons.innerHTML = `
    <article class="benchmark-lesson-card adopt">
      <span>نأخذ</span>
      <h3>السياق والحدث قبل اسم الخدمة</h3>
      <p>LifeSG وإستونيا يثبتان أن تنظيم الرحلة حول حياة الشخص أقرب لطريقة تفكير المستفيد من تنظيمها حول الهيكل الحكومي.</p>
    </article>
    <article class="benchmark-lesson-card protect">
      <span>نحافظ</span>
      <h3>المحاكاة ما تغير الحقيقة</h3>
      <p>من فرنسا استلهمنا منطق المحاكاة المنفصلة عن عرض الحقوق الحالية، وطبقناه في صلة كـ Digital Twin لا يغير ملف المستفيد.</p>
    </article>
    <article class="benchmark-lesson-card avoid">
      <span>نتجنب</span>
      <h3>واجهة ذكية فوق تكامل غير واضح</h3>
      <p>myGov يوضح ليش Data Mapping وحالة التنفيذ وSource of Truth تسبق التوسع في تجربة Tell Once.</p>
    </article>
  `;
}

function updateImpactScenario(rate = 0.05) {
  const quarterlyCalls = 526945;
  const minutesPerCall = 6;
  const callsQuarter = Math.round(quarterlyCalls * rate);
  const hoursQuarter = Math.round((callsQuarter * minutesPerCall) / 60);
  const callsYear = callsQuarter * 4;

  if (impactCallsQuarter) impactCallsQuarter.textContent = formatNumber.format(callsQuarter);
  if (impactHoursQuarter) impactHoursQuarter.textContent = formatNumber.format(hoursQuarter);
  if (impactCallsYear) impactCallsYear.textContent = formatNumber.format(callsYear);

  document.querySelectorAll('[data-impact-rate]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.impactRate) === rate);
  });
}

function startNewConversation() {
  if (!state.bootstrap || state.sending) return;
  state.history = [];
  state.scenarioState = {};
  resetChat(state.bootstrap.profile);
  resetSimulation();
  messageInput.value = '';
  resizeTextarea();
  messageInput.focus({ preventScroll: true });
}

function renderPrinciples() {
  principlesGrid.innerHTML = principles.map((item, index) => `
    <article class="principle-card">
      <span>${index + 1}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join('');
}

function resizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
}

chatForm.addEventListener('submit', event => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

messageInput.addEventListener('input', resizeTextarea);
messageInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

document.addEventListener('click', event => {
  const question = event.target.closest('[data-question]');
  if (question) {
    sendMessage(question.dataset.question);
    return;
  }

  const scrollButton = event.target.closest('[data-scroll]');
  if (scrollButton) {
    document.getElementById(scrollButton.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const serviceButton = event.target.closest('[data-service-id]');
  if (serviceButton) {
    openServiceModal(serviceButton.dataset.serviceId);
    return;
  }

  const benchmarkButton = event.target.closest('[data-benchmark-id]');
  if (benchmarkButton) {
    openBenchmarkModal(benchmarkButton.dataset.benchmarkId);
    return;
  }

  const impactRateButton = event.target.closest('[data-impact-rate]');
  if (impactRateButton) {
    updateImpactScenario(Number(impactRateButton.dataset.impactRate));
    return;
  }

  if (event.target.closest('#resetChatButton')) {
    startNewConversation();
    return;
  }

  const closeService = event.target.closest('[data-close-service]');
  if (closeService) {
    closeServiceModal();
    return;
  }

  const closeBenchmark = event.target.closest('[data-close-benchmark]');
  if (closeBenchmark) {
    closeBenchmarkModal();
    return;
  }

  if (event.target.closest('#serviceExpand') && state.bootstrap) {
    state.servicesExpanded = !state.servicesExpanded;
    renderServices(state.bootstrap.services);
    return;
  }

  const filter = event.target.closest('[data-sector]');
  if (filter && state.bootstrap) {
    state.serviceFilter = filter.dataset.sector;
    state.servicesExpanded = false;
    renderServiceFilters(state.bootstrap.services);
    renderServices(state.bootstrap.services);
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (serviceModal && !serviceModal.classList.contains('hidden')) closeServiceModal();
  if (benchmarkModal && !benchmarkModal.classList.contains('hidden')) closeBenchmarkModal();
});

profileSelect.addEventListener('change', async () => {
  try {
    await boot(profileSelect.value);
    document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error(error);
  }
});

const sectionObserver = new IntersectionObserver(entries => {
  const visible = entries
    .filter(entry => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.scroll === visible.target.id);
  });
}, { rootMargin: '-25% 0px -60% 0px', threshold: [0, .2, .5] });

document.querySelectorAll('.section-anchor').forEach(section => sectionObserver.observe(section));

boot().catch(error => {
  console.error(error);
  aiStatus.className = 'status-pill demo';
  aiStatus.textContent = 'تعذر الاتصال';
  messages.innerHTML = '';
  addAssistantMessage('تعذر تحميل بيانات صلة. شغّل الخادم من مجلد المشروع باستخدام npm start ثم افتح الرابط المحلي الذي يظهر في الطرفية.');
});
`````

## `public/index.html`

`````text
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0f6b43">
  <title>صلة | خدمات تفهم حالتك</title>
  <meta name="description" content="صلة نموذج تصوري يربط بيانات المستفيد بالقواعد والخدمات، ويفهم أسئلته باللغة الطبيعية دون تحويل الذكاء الاصطناعي إلى جهة قرار.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <div class="shell header-inner">
      <button class="brand" data-scroll="chat" aria-label="العودة إلى اسأل صلة">
        <strong>صلة</strong>
        <span>الخدمة تبدأ من حالتك</span>
      </button>

      <nav class="main-nav" aria-label="التنقل الرئيسي">
        <button class="nav-link active" data-scroll="chat">اسأل صلة</button>
        <button class="nav-link" data-scroll="impact">الأثر المتوقع</button>
        <button class="nav-link" data-scroll="services">قاعدة الخدمات</button>
        <button class="nav-link" data-scroll="benchmark">Benchmark</button>
        <button class="nav-link" data-scroll="design">كيف صممنا صلة</button>
      </nav>

      <div class="header-actions">
        <label class="profile-picker">
          <span>الحالة التجريبية</span>
          <select id="profileSelect" aria-label="اختيار الحالة التجريبية"></select>
        </label>
        <span id="aiStatus" class="status-pill loading">جار التحقق</span>
      </div>
    </div>
  </header>

  <main>
    <section id="chat" class="hero-section section-anchor">
      <div class="shell">
        <div class="hero-intro">
          <span class="eyebrow">نموذج تفاعلي تصوري</span>
          <h1>تكلم بطريقتك<br><span>وصلة يفهم وش يخص حالتك</span></h1>
          <p>
            صلة لا ينتظر منك تعرف اسم الخدمة. يبدأ من بياناتك الحالية، يفهم سؤالك أو السيناريو اللي تفكر فيه،
            ثم يمرر الحالة على قواعد موثقة ويعرض لك فقط النتائج المرتبطة بك.
          </p>
        </div>

        <div class="context-bar" aria-label="ملخص بيانات الحالة التجريبية">
          <div class="context-copy">
            <span class="micro-label">البيانات المعروفة الآن</span>
            <strong id="profileHeadline">جار تحميل الحالة</strong>
          </div>
          <div id="profileFacts" class="fact-row"></div>
        </div>

        <div class="chat-card">
          <div class="chat-topbar">
            <div>
              <span class="micro-label">اسأل صلة</span>
              <h2>ما تحتاج تبدأ من اسم الخدمة</h2>
              <p>اكتب سؤالك مثل ما تقوله لموظف يعرف ملفك</p>
            </div>
            <div class="chat-top-actions">
              <div class="chat-trust">
                <span class="trust-dot"></span>
                <span>النتائج النظامية من محرك قواعد واحد</span>
              </div>
              <button id="resetChatButton" class="reset-chat-button" type="button" title="بدء محادثة جديدة بدون تغيير الحالة التجريبية">
                <span aria-hidden="true">↻</span>
                محادثة جديدة
              </button>
            </div>
          </div>

          <div id="starterArea" class="starter-area">
            <div class="starter-copy">
              <strong>وش ودك تعرف؟</strong>
              <span>اختر سؤال أو اكتب بطريقتك</span>
            </div>
            <div id="suggestions" class="suggestions"></div>
          </div>

          <div id="messages" class="messages" aria-live="polite"></div>

          <div id="typing" class="typing hidden" aria-hidden="true">
            <span></span><span></span><span></span>
            <small>صلة يقرأ السياق ويشغل القواعد</small>
          </div>

          <form id="chatForm" class="composer">
            <textarea id="messageInput" rows="1" maxlength="1200" placeholder="اكتب بطريقتك... مثال: جاني شغل بستة ونص ووافقت بس ما باشرت، وش يتغير؟" aria-label="رسالتك إلى صلة"></textarea>
            <button id="sendButton" type="submit">إرسال</button>
          </form>

          <div class="composer-note">
            الشخصيات والبيانات في هذه التجربة افتراضية. القواعد والخدمات مبنية على مصادر رسمية منشورة ولا تمثل قرار أهلية رسمي.
          </div>
        </div>

        <div id="miniDashboard" class="mini-dashboard"></div>

        <div class="intelligence-grid">
          <section class="radar-card" aria-labelledby="radarTitle">
            <div class="card-heading-row">
              <div>
                <span class="micro-label">خريطة صلة</span>
                <h3 id="radarTitle">وش يعرف عنك النظام، وش اللي يستحق التحقق؟</h3>
              </div>
              <span class="quiet-pill">تتغير مع الحالة</span>
            </div>
            <div id="serviceRadar" class="service-radar"></div>
          </section>

          <section id="simulationDock" class="twin-card idle" aria-labelledby="twinTitle">
            <div class="card-heading-row">
              <div>
                <div class="micro-label-with-info">
                  <span class="micro-label">توأم الحالة</span>
                  <span class="info-popover">
                    <button type="button" class="info-trigger" aria-label="شرح توأم الحالة">i</button>
                    <span class="info-panel" role="tooltip">
                      <strong>وش يعني Digital Twin في صلة؟</strong>
                      <span>هو نسخة افتراضية ومؤقتة من حالة المستفيد. إذا قلت مثلا: لو نزل راتبي إلى 4000، صلة لا يغيّر بياناتك الحالية، بل ينسخ الحالة المعروفة ويطبق التغيير على النسخة فقط.</span>
                      <span>بعدها يشغل نفس محرك القواعد على الحالتين ويقارن الخدمات والآثار. السيناريو يبقى منفصلا عن السجل الحقيقي ولا يتحول إلى تحديث رسمي.</span>
                    </span>
                  </span>
                </div>
                <h3 id="twinTitle">جرّب قرارك على نسخة افتراضية من حالتك</h3>
              </div>
              <span id="twinStatus" class="quiet-pill">جاهز للمحاكاة</span>
            </div>
            <div id="simulationContent" class="twin-empty">
              اكتب مثلا: لو نزل راتبي إلى 4000، أو جاني عرض جديد ووافقت بس ما باشرت
            </div>
          </section>
        </div>
      </div>
    </section>


    <section id="impact" class="content-section impact-section section-anchor">
      <div class="shell">
        <div class="section-heading split-heading impact-heading">
          <div>
            <span class="eyebrow">الأثر المتوقع</span>
            <h2>صلة ما يضيف قناة جديدة فقط<br><span>يقلل الاحتكاك قبل ما يبدأ الطلب</span></h2>
            <p>
              الوزارة تعمل على نطاق رقمي كبير. لذلك قيمة صلة تقاس في تقليل البحث، والأسئلة المتكررة، والرحلات غير المناسبة، وإعادة إدخال البيانات.
              الأرقام تحت تفصل بين Baseline منشور وبين سيناريو أثر افتراضي للـPoC.
            </p>
          </div>
          <div class="impact-baseline">
            <div><strong>Q2 2026</strong><span>Baseline من تقرير صوت المستفيد</span></div>
            <div><strong>526,945</strong><span>مكالمة واردة كنقطة قياس للسيناريو</span></div>
            <a href="https://www.hrsd.gov.sa/ministry/e-participation/beneficiary-voice-reports" target="_blank" rel="noopener">المصدر الرسمي ↗</a>
          </div>
        </div>

        <div class="impact-voice-card">
          <div class="impact-voice-head">
            <div>
              <span class="micro-label">Baseline من صوت المستفيد</span>
              <h3>وين ممكن يظهر أثر صلة على القنوات الحالية؟</h3>
              <p>نستخدم أرقام الربع الثاني 2026 المنشورة في تقرير صوت المستفيد كنقطة بداية لسيناريو قياس، وليس كتوقع بأن كل التفاعلات قابلة للتخفيض.</p>
            </div>
            <a href="https://www.hrsd.gov.sa/ministry/e-participation/beneficiary-voice-reports" target="_blank" rel="noopener">تقارير صوت المستفيد ↗</a>
          </div>
          <div class="voice-metrics">
            <div><strong>757,960</strong><span>إجمالي التفاعلات في الربع</span></div>
            <div><strong>526,945</strong><span>مكالمات واردة</span></div>
            <div><strong>58,661</strong><span>شكاوى</span></div>
            <div><strong>172,354</strong><span>تفاعلات عبر التواصل الاجتماعي</span></div>
          </div>
        </div>

        <div class="impact-scenario-card">
          <div class="impact-scenario-copy">
            <span class="micro-label">سيناريو أثر، وليس Forecast</span>
            <h3>لو صلة منع نسبة بسيطة من الاستفسارات التي سببها البحث عن الخدمة</h3>
            <p>نفترض فقط لأغراض الـPoC أن جزءا من المكالمات الواردة يمكن حله ذاتيا إذا عرف المستفيد الخدمة والأثر من حالته، ونفترض متوسط 6 دقائق للمكالمة. غيّر النسبة وشوف حجم الفرصة.</p>
            <div id="impactRateButtons" class="impact-rate-buttons">
              <button type="button" data-impact-rate="0.03">3%</button>
              <button type="button" data-impact-rate="0.05" class="active">5%</button>
              <button type="button" data-impact-rate="0.10">10%</button>
            </div>
          </div>
          <div class="impact-scenario-results">
            <div><small>مكالمات أقل في الربع</small><strong id="impactCallsQuarter">26,347</strong></div>
            <div><small>ساعات عمل محتملة في الربع</small><strong id="impactHoursQuarter">2,635</strong></div>
            <div><small>مكالمات أقل سنويا إذا تكرر نفس الحجم</small><strong id="impactCallsYear">105,388</strong></div>
          </div>
          <div class="impact-assumption">الحسبة: 526,945 مكالمة ربع سنوية × النسبة المختارة. ساعات العمل تفترض 6 دقائق لكل مكالمة. هذا نموذج حساسية لقياس الفرصة فقط، وليس وعدا أو توقعا تشغيليا.</div>
        </div>

        <details class="impact-method-details">
          <summary>
            <span><b>كيف نثبت أثر صلة في PoC؟</b><small>مؤشرات القياس وخطوات المقارنة قبل وبعد</small></span>
          </summary>
          <div class="impact-method-body">
            <div class="impact-outcomes">
              <article><span>↓</span><b>وقت الوصول للخدمة المناسبة</b><p>من أول سؤال حتى معرفة الخدمة أو الإجراء المرتبط بالحالة</p></article>
              <article><span>↓</span><b>الرحلات غير المناسبة قبل التقديم</b><p>نكتشف عدم الارتباط أو نقص البيانات قبل دخول المستفيد في رحلة كاملة</p></article>
              <article><span>↓</span><b>إعادة إدخال بيانات موجودة</b><p>نستخدم الملف المعروف ونطلب فقط المعلومة التي تغير النتيجة</p></article>
              <article><span>↑</span><b>اكتشاف خدمات بدون معرفة اسمها</b><p>الخدمة تظهر بسبب الحالة أو الحدث، مو لأن المستفيد عرف المصطلح الحكومي</p></article>
              <article><span>↑</span><b>الحل الذاتي للاستفسار</b><p>المستفيد يفهم الخدمة والسبب والمعلومة الناقصة قبل التحويل لقناة دعم</p></article>
              <article><span>↑</span><b>وضوح أثر القرار قبل حدوثه</b><p>Digital Twin يسمح بمقارنة الحالة الحالية بالسيناريو بدون تغيير السجل الحقيقي</p></article>
            </div>

            <div class="impact-scorecard">
              <div class="scorecard-copy">
                <span class="micro-label">كيف نثبت الأثر في PoC</span>
                <h3>Baseline قبل صلة، ثم نفس الرحلات بعد صلة</h3>
                <p>بدل وضع نسبة نجاح من عندنا، نختار أحداثا عالية القيمة ونقيس الوقت والدقة وعدد الأسئلة والتحويلات قبل التجربة وبعدها.</p>
              </div>
              <div class="scorecard-steps">
                <div><b>1</b><span>اختر 3 أحداث عالية القيمة</span></div>
                <div><b>2</b><span>قِس الرحلة الحالية</span></div>
                <div><b>3</b><span>شغل نفس الحالات على صلة</span></div>
                <div><b>4</b><span>قارن النتائج بالقنوات الحالية</span></div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>

    <section id="services" class="content-section section-anchor">
      <div class="shell">
        <div class="section-heading split-heading">
          <div>
            <span class="eyebrow">قاعدة صلة</span>
            <h2>الخدمة ما هي بطاقة فقط<br><span>خلفها بيانات وشروط ومصدر</span></h2>
            <p>
              درسنا خدمات من الوزارة ومن منظومة الموارد البشرية مثل صندوق تنمية الموارد البشرية، وربطنا كل خدمة بالبيانات المطلوبة وإشارات الظهور والشروط المنشورة.
              القائمة هنا مختصرة حتى ما تتحول المنصة إلى كتالوج طويل. اضغط أي خدمة لفتح تفاصيلها وقواعدها ومصدرها.
            </p>
          </div>
          <div class="catalog-summary">
            <strong id="serviceCount">0</strong>
            <span>خدمة مدروسة في النموذج</span>
          </div>
        </div>

        <div id="serviceFilters" class="filter-row"></div>
        <div id="serviceGrid" class="service-grid service-grid-compact"></div>
        <div class="service-library-actions"><button id="serviceExpand" type="button" class="service-expand">عرض كل الخدمات</button></div>

        <div id="serviceModal" class="service-modal hidden" role="dialog" aria-modal="true" aria-labelledby="serviceModalTitle">
          <button class="service-modal-backdrop" type="button" data-close-service aria-label="إغلاق تفاصيل الخدمة"></button>
          <article class="service-modal-panel">
            <button class="service-modal-close" type="button" data-close-service aria-label="إغلاق">×</button>
            <div id="serviceModalContent"></div>
          </article>
        </div>
      </div>
    </section>

    <section id="benchmark" class="content-section benchmark-section section-anchor">
      <div class="shell">
        <div class="section-heading split-heading benchmark-heading">
          <div>
            <span class="eyebrow">Benchmark</span>
            <h2>درسنا التجربة، مو شكل الواجهة<br><span>وحوّلنا الدروس إلى قرارات في صلة</span></h2>
            <p>
              كل بطاقة تحت تمثل تجربة حكومية مختلفة. الصفحة تعرض الخلاصة فقط حتى تبقى خفيفة.
              اضغط على أي تجربة لفتح القصة كاملة: المشكلة، سبب البناء، الرحلة، التصميم، التكامل، البيانات، النتائج، التحديات، والدروس المطبقة في صلة.
            </p>
          </div>
          <div class="benchmark-summary-note">
            <strong>5</strong>
            <span>تجارب حكومية<br>بأنماط مختلفة</span>
          </div>
        </div>

        <div id="benchmarkGrid" class="benchmark-compact-grid"></div>

        <div class="applied-strip">
          <div class="applied-strip-head">
            <span class="micro-label">وش طبقناه فعليا في صلة</span>
            <p>خلاصة التصميم المستفاد من التجارب، بدون نسخ أي تجربة كما هي</p>
          </div>
          <div class="applied-patterns">
            <div><b>LifeSG</b><span>ابدأ من حالة المستفيد ومرحلة حياته</span></div>
            <div><b>Estonia</b><span>الحدث يجمع أكثر من خدمة في رحلة واحدة</span></div>
            <div><b>France</b><span>افصل المحاكاة عن البيانات الرسمية</span></div>
            <div><b>Tell Us Once</b><span>التغيير الواحد قد يؤثر على جهات متعددة</span></div>
            <div><b>myGov</b><span>Data Mapping وحالة التنفيذ قبل الواجهة الذكية</span></div>
          </div>
        </div>

        <details class="benchmark-matrix-details">
          <summary>عرض مقارنة القدرات بين التجارب</summary>
          <div id="benchmarkMatrix" class="benchmark-matrix"></div>
        </details>

        <details class="benchmark-insights-details">
          <summary>
            <span><b>قراءة التصميم</b><small>وش نأخذ، وش نحافظ عليه، وش نتجنب</small></span>
          </summary>
          <div id="benchmarkLessons" class="benchmark-lessons"></div>
        </details>

        <div id="benchmarkModal" class="service-modal benchmark-modal hidden" role="dialog" aria-modal="true" aria-labelledby="benchmarkModalTitle">
          <button class="service-modal-backdrop" type="button" data-close-benchmark aria-label="إغلاق تفاصيل التجربة"></button>
          <article class="service-modal-panel benchmark-modal-panel">
            <button class="service-modal-close" type="button" data-close-benchmark aria-label="إغلاق">×</button>
            <div id="benchmarkModalContent"></div>
          </article>
        </div>
      </div>
    </section>

    <section id="design" class="content-section design-section section-anchor">
      <div class="shell">
        <div class="section-heading">
          <span class="eyebrow">كيف صممنا صلة</span>
          <h2>الذكاء في صلة مو في الرد الطويل<br><span>الذكاء في فصل الأدوار صح</span></h2>
          <p>
            صلة مصمم كقدرة مشتركة يمكن وضعها في التطبيق أو الموقع أو أي قناة لاحقة. واجهة المحادثة مجرد مدخل،
            أما القرار التشغيلي فيمر على نفس البيانات ونفس القواعد في كل مرة.
          </p>
        </div>

        <div class="architecture-card">
          <div class="architecture-copy">
            <span class="micro-label">المسار التشغيلي</span>
            <h3>من كلام المستفيد إلى نتيجة قابلة للتفسير</h3>
            <p>
              طبقة فهم اللغة تستخرج المقصود والمتغيرات فقط. ملف المستفيد يكمل المعلومات المعروفة.
              محرك القواعد يقرر النتائج المرتبطة، ثم طبقة الصياغة تشرحها بلغة واضحة دون اختراع شروط جديدة.
            </p>
          </div>
          <div class="architecture-flow" aria-label="مخطط بنية صلة">
            <div class="flow-node"><small>1</small><b>كلام المستفيد</b><span>لغة طبيعية</span></div>
            <i>←</i>
            <div class="flow-node"><small>2</small><b>فهم المقصود</b><span>نية ومتغيرات</span></div>
            <i>←</i>
            <div class="flow-node"><small>3</small><b>سياق المستفيد</b><span>بيانات معروفة</span></div>
            <i>←</i>
            <div class="flow-node core"><small>4</small><b>محرك القواعد</b><span>مصدر القرار</span></div>
            <i>←</i>
            <div class="flow-node"><small>5</small><b>شرح النتيجة</b><span>واضح ومفسر</span></div>
          </div>
        </div>

        <div id="principlesGrid" class="principles-grid"></div>

        <div class="signature-card">
          <div>
            <span class="micro-label">فكرة صلة المميزة</span>
            <h3>توأم الحالة، محاكاة منفصلة عن الحقيقة</h3>
            <p>
              إذا كتب المستفيد سيناريو مستقبلي، صلة لا يغير ملفه الحقيقي. ينشئ نسخة افتراضية من الحالة،
              يشغل عليها نفس محرك القواعد، ثم يقارن وش بقي كما هو وش الخدمات التي قد تتأثر.
              نفس المحادثة تقدر تكمل السيناريو خطوة بخطوة بدون إعادة القصة من البداية.
            </p>
          </div>
          <div class="signature-flow">
            <span>حالتي الحالية</span>
            <i>←</i>
            <strong>نسخة افتراضية</strong>
            <i>←</i>
            <span>فرق الخدمات والآثار</span>
          </div>
        </div>

        <div class="build-next-card">
          <div>
            <span class="micro-label">لو تحولت من PoC إلى منتج</span>
            <h3>وش يحتاج الفريق الحقيقي؟</h3>
            <p>
              نفس الفكرة الحالية، لكن بدل البيانات التجريبية نربط مصادر الوزارة، وبدل ملفات JSON تصبح القواعد كتالوجًا محكومًا بمالكين وإصدارات ومراجعة مستمرة.
            </p>
          </div>
          <div class="next-grid">
            <article><b>Data Map</b><span>مصدر كل معلومة وحداثتها وصلاحية استخدامها</span></article>
            <article><b>Event Model</b><span>ما الذي تغيّر ومتى أصبح نافذًا</span></article>
            <article><b>Rules Catalog</b><span>قاعدة موثقة لكل خدمة مع مالك وتاريخ إصدار</span></article>
            <article><b>Integration API</b><span>محرك واحد يخدم التطبيق والموقع والشات</span></article>
            <article><b>AI Orchestration</b><span>فهم اللغة وطلب المعلومة الناقصة وشرح النتائج</span></article>
            <article><b>Governance & Evals</b><span>اختبارات منطق ومراقبة جودة وتدقيق للنتائج</span></article>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="shell footer-inner">
      <div>
        <strong>صلة</strong>
        <span>نموذج تصوري لخدمة تبدأ من حالة المستفيد</span>
      </div>
      <div class="footer-links">
        <span>المصادر داخل كل نتيجة وكل خدمة</span>
        <a href="https://ojalsadei.github.io/my-portfolio/" target="_blank" rel="noopener">Osama Alsadei · Portfolio</a>
      </div>
    </div>
  </footer>

  <template id="messageTemplate">
    <article class="message">
      <div class="message-body"></div>
    </article>
  </template>

  <script type="module" src="/app.js"></script>
</body>
</html>
`````

## `public/styles.css`

`````text
:root{
  --bg:#f4f7f3;
  --surface:#ffffff;
  --surface-2:#f8faf8;
  --surface-3:#eef6f1;
  --ink:#142c22;
  --ink-2:#40574d;
  --muted:#718078;
  --line:#dbe6df;
  --line-strong:#bfd2c5;
  --green:#137448;
  --green-dark:#0b5a36;
  --green-soft:#e8f5ed;
  --gold:#9e8440;
  --gold-soft:#f7f1e3;
  --warning:#8a6118;
  --warning-soft:#fff7e7;
  --danger:#8d3d36;
  --danger-soft:#fff0ed;
  --blue:#356b78;
  --blue-soft:#edf6f8;
  --shadow:0 24px 70px rgba(20,44,34,.08);
  --shadow-sm:0 10px 30px rgba(20,44,34,.055);
  --radius:24px;
  --shell:1240px;
}

*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:92px}
body{
  margin:0;
  min-height:100vh;
  font-family:"Tajawal",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  color:var(--ink);
  background:
    radial-gradient(circle at 8% 0%,rgba(19,116,72,.08),transparent 26%),
    radial-gradient(circle at 95% 12%,rgba(158,132,64,.08),transparent 22%),
    var(--bg);
}
button,input,textarea,select{font:inherit}
button{color:inherit}
a{color:inherit;text-decoration:none}
button:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid rgba(19,116,72,.2);outline-offset:2px}
.hidden{display:none!important}
.shell{width:min(var(--shell),calc(100% - 40px));margin-inline:auto}
.section-anchor{scroll-margin-top:92px}

.site-header{
  position:sticky;
  top:0;
  z-index:50;
  border-bottom:1px solid rgba(191,210,197,.72);
  background:rgba(247,249,246,.9);
  backdrop-filter:blur(16px);
}
.header-inner{min-height:78px;display:flex;align-items:center;gap:22px}
.brand{border:0;background:none;padding:0;text-align:right;cursor:pointer;min-width:155px}
.brand strong{display:block;color:var(--green-dark);font-size:29px;line-height:1}
.brand span{display:block;margin-top:5px;color:var(--muted);font-size:11px}
.main-nav{display:flex;align-items:center;gap:5px;margin-inline:auto}
.nav-link{border:0;background:transparent;padding:10px 13px;border-radius:999px;color:var(--ink-2);cursor:pointer;font-weight:600;font-size:13px}
.nav-link:hover,.nav-link.active{background:var(--surface);color:var(--green-dark);box-shadow:0 1px 0 rgba(19,116,72,.06)}
.header-actions{display:flex;align-items:center;gap:9px}
.profile-picker{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--line);background:var(--surface);border-radius:13px}
.profile-picker span{font-size:10px;color:var(--muted);white-space:nowrap}
.profile-picker select{border:0;background:transparent;color:var(--ink);font-weight:700;outline:none;cursor:pointer;min-width:76px}
.status-pill{display:inline-flex;align-items:center;gap:7px;padding:9px 11px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}
.status-pill:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgba(19,116,72,.09)}
.status-pill.connected{background:var(--green-soft);color:var(--green-dark)}
.status-pill.demo{background:var(--gold-soft);color:#705d24}
.status-pill.loading{background:#eef1ef;color:var(--muted)}

.hero-section{padding:54px 0 70px}
.hero-intro{max-width:920px;margin:0 auto 28px;text-align:center}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 13px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:12px;font-weight:800}
.eyebrow:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}
.hero-intro h1,.section-heading h2{margin:15px 0 10px;letter-spacing:-1.1px;line-height:1.2}
.hero-intro h1{font-size:clamp(41px,5.4vw,69px)}
.hero-intro h1 span,.section-heading h2 span{color:var(--green)}
.hero-intro p{max-width:790px;margin:0 auto;color:var(--ink-2);font-size:17px;line-height:1.95}

.context-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 18px;margin:0 auto 12px;max-width:1090px;border:1px solid var(--line-strong);background:rgba(255,255,255,.88);border-radius:18px;box-shadow:var(--shadow-sm)}
.context-copy{min-width:190px}
.micro-label{display:block;color:var(--green);font-size:10px;font-weight:800;letter-spacing:.1px}
.context-copy strong{display:block;margin-top:4px;font-size:16px}
.fact-row{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}
.fact-chip{padding:8px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2);color:var(--ink-2);font-size:11px;font-weight:700}
.fact-chip b{color:var(--ink);font-weight:800}

.chat-card{max-width:1090px;margin:auto;background:var(--surface);border:1px solid var(--line-strong);border-radius:28px;box-shadow:var(--shadow);overflow:hidden}
.chat-topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px 25px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#fff,#fbfdfb)}
.chat-topbar h2{margin:3px 0 2px;font-size:24px}
.chat-topbar p{margin:0;color:var(--muted);font-size:12px}
.chat-trust{display:flex;align-items:center;gap:8px;color:var(--ink-2);font-size:11px;font-weight:700;padding:8px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2)}
.trust-dot{width:8px;height:8px;border-radius:50%;background:var(--green)}
.starter-area{padding:22px 25px 6px}
.starter-copy{display:flex;align-items:baseline;gap:9px;margin-bottom:12px}
.starter-copy strong{font-size:15px}
.starter-copy span{font-size:11px;color:var(--muted)}
.suggestions{display:flex;flex-wrap:wrap;gap:8px}
.suggestion{border:1px solid var(--line);background:var(--surface-2);padding:10px 13px;border-radius:13px;cursor:pointer;color:var(--ink-2);font-size:12px;text-align:right;transition:.18s ease}
.suggestion:hover{background:var(--green-soft);border-color:rgba(19,116,72,.35);color:var(--green-dark);transform:translateY(-1px)}

.messages{min-height:330px;max-height:610px;overflow-y:auto;overflow-anchor:none;padding:20px 25px;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin;scrollbar-color:#bfd2c5 transparent}
.messages:empty{min-height:250px}
.message{display:flex;max-width:88%}
.message.user{align-self:flex-start;justify-content:flex-start}
.message.assistant{align-self:stretch;max-width:100%}
.message-body{border-radius:18px;padding:14px 16px;line-height:1.9;font-size:14px}
.message.user .message-body{background:var(--green-dark);color:#fff;border-bottom-left-radius:6px;max-width:740px}
.message.assistant .message-body{padding:0;background:transparent;width:100%}
.assistant-copy{max-width:820px;padding:14px 16px;border:1px solid var(--line);border-radius:18px;border-bottom-right-radius:6px;background:var(--surface-2);color:var(--ink);white-space:pre-line}
.result-stack{display:grid;gap:9px;margin-top:10px}
.result-card{position:relative;border:1px solid var(--line);border-radius:16px;background:#fff;padding:16px 17px;overflow:hidden}
.result-card:before{content:"";position:absolute;inset-block:0;right:0;width:4px;background:var(--line-strong)}
.result-card.current:before,.result-card.positive:before{background:var(--green)}
.result-card.potential:before{background:var(--gold)}
.result-card.warning:before,.result-card.action:before{background:#bd7b22}
.result-card.neutral:before,.result-card.info:before{background:#78928a}
.result-card .result-tag{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:9px;font-weight:800}
.result-card h4{margin:8px 0 5px;font-size:17px}
.result-card p{margin:0;color:var(--ink-2);font-size:12px;line-height:1.75}
.result-why{margin-top:11px;padding-top:10px;border-top:1px dashed var(--line);font-size:11px;color:var(--ink-2)}
.result-why b{color:var(--ink)}
.result-source{display:inline-flex;margin-top:9px;color:var(--green-dark);font-size:10px;font-weight:800}
.quick-replies{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.quick-reply{border:1px solid var(--line-strong);background:#fff;padding:8px 11px;border-radius:999px;color:var(--green-dark);font-size:11px;font-weight:700;cursor:pointer}
.quick-reply:hover{background:var(--green-soft)}
.change-stack{display:grid;gap:8px;margin-top:10px}
.change-card{padding:13px 14px;border:1px solid var(--line);border-radius:14px;background:#fff}
.change-card small{color:var(--muted);font-size:9px;font-weight:700}
.change-card strong{display:block;margin:4px 0 3px;font-size:14px}
.change-card p{margin:0;color:var(--ink-2);font-size:11px;line-height:1.65}
.typing{display:flex;align-items:center;gap:5px;padding:0 25px 12px;color:var(--muted)}
.typing span{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 1s infinite ease-in-out}
.typing span:nth-child(2){animation-delay:.15s}.typing span:nth-child(3){animation-delay:.3s}
.typing small{margin-right:6px;font-size:10px}
@keyframes pulse{0%,80%,100%{opacity:.28;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.composer{display:grid;grid-template-columns:1fr auto;gap:10px;padding:15px 20px;border-top:1px solid var(--line);background:#fbfdfb}
.composer textarea{resize:none;min-height:52px;max-height:160px;border:1px solid var(--line-strong);border-radius:15px;padding:14px 15px;line-height:1.6;color:var(--ink);background:#fff;outline:none}
.composer textarea:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(19,116,72,.08)}
.composer button{align-self:end;min-height:52px;padding:0 20px;border:0;border-radius:14px;background:var(--green);color:#fff;font-weight:800;cursor:pointer}
.composer button:hover{background:var(--green-dark)}
.composer button:disabled{opacity:.5;cursor:not-allowed}
.composer-note{padding:0 21px 15px;color:var(--muted);font-size:9.5px;line-height:1.6}

.mini-dashboard{max-width:1090px;margin:13px auto 0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.mini-card{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:17px 18px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.86)}
.mini-card div span{display:block;color:var(--muted);font-size:10px}
.mini-card div strong{display:block;margin-top:4px;font-size:14px}
.mini-card b{font-size:27px;color:var(--green-dark);font-variant-numeric:tabular-nums}

.content-section{padding:78px 0}
.section-heading{max-width:880px;margin-bottom:30px}
.section-heading h2{font-size:clamp(32px,4vw,49px)}
.section-heading p{margin:0;color:var(--ink-2);font-size:15px;line-height:1.9}
.split-heading{max-width:none;display:grid;grid-template-columns:1fr auto;align-items:end;gap:30px}
.split-heading>div:first-child{max-width:850px}
.catalog-summary{min-width:170px;padding:20px;border:1px solid var(--line-strong);border-radius:18px;background:#fff;text-align:center;box-shadow:var(--shadow-sm)}
.catalog-summary strong{display:block;color:var(--green-dark);font-size:43px;line-height:1}
.catalog-summary span{display:block;margin-top:7px;color:var(--muted);font-size:10px}
.filter-row{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:15px}
.filter-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 12px;color:var(--ink-2);font-size:11px;font-weight:700;cursor:pointer}
.filter-chip.active{background:var(--green-dark);border-color:var(--green-dark);color:#fff}
.service-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.service-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:var(--shadow-sm);overflow:hidden;min-height:310px}
.service-card-top{padding:20px 20px 15px;flex:1}
.service-sector{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:9px;font-weight:800}
.service-card h3{font-size:19px;margin:13px 0 7px;line-height:1.45}
.service-card .service-summary{margin:0;color:var(--ink-2);font-size:12px;line-height:1.75}
.service-meta{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:14px}
.service-meta div{padding:9px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2)}
.service-meta small{display:block;color:var(--muted);font-size:8px}
.service-meta b{display:block;margin-top:2px;font-size:10px}
.service-details{border-top:1px solid var(--line);padding:0 20px;background:#fcfdfc}
.service-details details{padding:13px 0}
.service-details summary{cursor:pointer;font-size:11px;font-weight:800;color:var(--green-dark)}
.service-details ul{margin:11px 0 0;padding:0 18px 0 0;color:var(--ink-2);font-size:10.5px;line-height:1.8}
.service-policy{margin:11px 0 0;padding:10px;border-radius:11px;background:var(--gold-soft);font-size:10px;line-height:1.7;color:#65552b}
.service-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 20px;border-top:1px solid var(--line);font-size:9px;color:var(--muted)}
.service-footer a{color:var(--green-dark);font-weight:800}

.benchmark-section{background:linear-gradient(180deg,rgba(232,245,237,.48),rgba(244,247,243,0))}
.benchmark-dashboard{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-bottom:16px}
.benchmark-metric{padding:17px;border:1px solid var(--line);background:#fff;border-radius:16px;box-shadow:var(--shadow-sm)}
.benchmark-metric small{display:block;color:var(--muted);font-size:9px;min-height:25px}
.benchmark-metric strong{display:block;margin:5px 0 2px;color:var(--green-dark);font-size:24px}
.benchmark-metric span{display:block;color:var(--ink-2);font-size:9.5px}
.benchmark-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.benchmark-card{position:relative;padding:22px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:var(--shadow-sm)}
.benchmark-card.caution{grid-column:1/-1;border-color:#e5d1a1;background:linear-gradient(180deg,#fff,#fffaf0)}
.benchmark-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}
.benchmark-card-header small{color:var(--muted);font-size:10px;font-weight:700}
.benchmark-card h3{margin:4px 0 3px;font-size:22px}
.benchmark-pattern{margin:0;color:var(--ink-2);font-size:11px}
.benchmark-tags{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.benchmark-tags span{padding:5px 8px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);font-size:9px;color:var(--ink-2);font-weight:700}
.benchmark-block{margin-top:16px;padding:13px 14px;border-radius:14px;background:var(--surface-2);border:1px solid var(--line)}
.benchmark-block.lesson{background:var(--green-soft);border-color:rgba(19,116,72,.18)}
.benchmark-block b{display:block;font-size:10px;color:var(--green-dark);margin-bottom:4px}
.benchmark-block p{margin:0;color:var(--ink-2);font-size:11px;line-height:1.75}
.benchmark-source{display:inline-flex;margin-top:13px;color:var(--green-dark);font-size:10px;font-weight:800}
.historical-note{display:inline-flex;margin-top:10px;padding:6px 8px;border-radius:9px;background:var(--gold-soft);color:#725f28;font-size:9px;font-weight:700}

.design-section{padding-bottom:95px}
.architecture-card{display:grid;grid-template-columns:.78fr 1.22fr;gap:25px;align-items:center;padding:26px;border:1px solid var(--line-strong);border-radius:24px;background:linear-gradient(135deg,#fff,var(--green-soft));box-shadow:var(--shadow-sm)}
.architecture-copy h3{margin:6px 0 7px;font-size:24px}
.architecture-copy p{margin:0;color:var(--ink-2);font-size:12px;line-height:1.8}
.architecture-flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr auto 1fr;align-items:center;gap:6px;direction:rtl}
.architecture-flow i{font-style:normal;color:var(--green);font-weight:800}
.flow-node{min-height:105px;padding:12px 9px;border:1px solid var(--line);background:#fff;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.flow-node small{width:23px;height:23px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--surface-3);color:var(--green-dark);font-size:9px;font-weight:800}
.flow-node b{display:block;margin-top:7px;font-size:11px}
.flow-node span{display:block;margin-top:3px;color:var(--muted);font-size:8.5px}
.flow-node.core{background:var(--green-dark);color:#fff;border-color:var(--green-dark)}
.flow-node.core small{background:rgba(255,255,255,.13);color:#fff}.flow-node.core span{color:rgba(255,255,255,.72)}
.principles-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.principle-card{padding:19px;border:1px solid var(--line);border-radius:18px;background:#fff;box-shadow:var(--shadow-sm)}
.principle-card span{display:flex;width:31px;height:31px;align-items:center;justify-content:center;border-radius:10px;background:var(--green-soft);color:var(--green-dark);font-size:11px;font-weight:800}
.principle-card h3{font-size:15px;margin:13px 0 5px}
.principle-card p{margin:0;color:var(--ink-2);font-size:10.5px;line-height:1.75}
.build-next-card{margin-top:14px;padding:27px;border:1px solid var(--line-strong);border-radius:22px;background:#fff;display:grid;grid-template-columns:.72fr 1.28fr;gap:28px;align-items:center}
.build-next-card h3{font-size:24px;margin:5px 0 7px}.build-next-card p{margin:0;color:var(--ink-2);font-size:12px;line-height:1.8}
.next-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.next-grid article{padding:13px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}
.next-grid b{display:block;color:var(--green-dark);font-size:11px}.next-grid span{display:block;margin-top:4px;color:var(--ink-2);font-size:9px;line-height:1.55}

footer{padding:24px 0 38px;border-top:1px solid var(--line)}
.footer-inner{display:flex;align-items:center;justify-content:space-between;gap:20px}
.footer-inner>div:first-child{display:flex;flex-direction:column}.footer-inner strong{font-size:18px}.footer-inner span{color:var(--muted);font-size:9.5px}
.footer-links{display:flex;align-items:center;gap:14px}.footer-links a{font-size:10px;color:var(--green-dark);font-weight:800}

@media(max-width:1060px){
  .main-nav{display:none}
  .service-grid{grid-template-columns:repeat(2,1fr)}
  .benchmark-dashboard{grid-template-columns:repeat(3,1fr)}
  .architecture-card,.build-next-card{grid-template-columns:1fr}
  .architecture-flow{grid-template-columns:1fr auto 1fr auto 1fr;grid-auto-rows:auto}
  .architecture-flow .flow-node:nth-of-type(4),.architecture-flow .flow-node:nth-of-type(5){margin-top:5px}
  .principles-grid{grid-template-columns:repeat(2,1fr)}
}

@media(max-width:760px){
  .shell{width:min(var(--shell),calc(100% - 24px))}
  .site-header{position:sticky}
  .header-inner{min-height:67px;gap:10px}
  .brand{min-width:auto}.brand strong{font-size:25px}.brand span{display:none}
  .header-actions{margin-right:auto}.profile-picker{padding:6px 8px}.profile-picker span{display:none}.status-pill{display:none}
  .hero-section{padding:32px 0 52px}.hero-intro{text-align:right;margin-bottom:20px}.hero-intro h1{font-size:39px;letter-spacing:-.8px}.hero-intro p{font-size:14px}
  .context-bar{align-items:flex-start;flex-direction:column;padding:14px}.fact-row{justify-content:flex-start}
  .chat-card{border-radius:22px}.chat-topbar{padding:18px;align-items:flex-start;flex-direction:column}.chat-topbar h2{font-size:20px}.chat-trust{font-size:9.5px}
  .starter-area{padding:18px 17px 3px}.starter-copy{align-items:flex-start;flex-direction:column;gap:2px}.suggestions{flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px}.suggestion{white-space:nowrap}
  .messages{padding:16px;min-height:340px;max-height:560px}.message{max-width:94%}.assistant-copy{font-size:13px}.message.user .message-body{font-size:13px}
  .composer{padding:12px;grid-template-columns:1fr auto}.composer textarea{min-height:48px;padding:12px;font-size:13px}.composer button{min-height:48px;padding:0 14px}.composer-note{padding:0 13px 12px}
  .mini-dashboard{grid-template-columns:1fr}.mini-card{padding:14px 15px}
  .content-section{padding:56px 0}.section-heading h2{font-size:31px}.section-heading p{font-size:13px}.split-heading{grid-template-columns:1fr}.catalog-summary{min-width:0;text-align:right;display:flex;align-items:center;gap:10px}.catalog-summary strong{font-size:33px}.catalog-summary span{margin:0}
  .service-grid,.benchmark-grid{grid-template-columns:1fr}.service-card{min-height:auto}
  .benchmark-dashboard{grid-template-columns:repeat(2,1fr)}.benchmark-metric strong{font-size:21px}
  .architecture-card{padding:19px}.architecture-flow{grid-template-columns:1fr}.architecture-flow i{transform:rotate(90deg);justify-self:center}.flow-node{min-height:80px}
  .principles-grid{grid-template-columns:1fr}.build-next-card{padding:19px}.next-grid{grid-template-columns:1fr 1fr}
  .footer-inner{align-items:flex-start;flex-direction:column}.footer-links{align-items:flex-start;flex-direction:column;gap:5px}
}

@media(max-width:430px){
  .profile-picker select{min-width:68px;font-size:12px}.hero-intro h1{font-size:35px}.benchmark-dashboard{grid-template-columns:1fr 1fr}.next-grid{grid-template-columns:1fr}
}

/* Intelligence layer */
.intelligence-grid{max-width:1090px;margin:13px auto 0;display:grid;grid-template-columns:1.05fr .95fr;gap:12px}
.radar-card,.twin-card,.signature-card{border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:var(--shadow-sm)}
.radar-card,.twin-card{padding:20px}
.card-heading-row{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}
.card-heading-row h3{margin:4px 0 0;font-size:17px;line-height:1.45}
.quiet-pill{display:inline-flex;padding:6px 9px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font-size:9px;font-weight:800;white-space:nowrap}
.service-radar{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.radar-lane{padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2)}
.radar-lane-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.radar-lane-head div strong{display:block;font-size:12px}.radar-lane-head div span{display:block;margin-top:2px;color:var(--muted);font-size:8.5px}
.radar-lane-head>b{display:flex;align-items:center;justify-content:center;width:29px;height:29px;border-radius:9px;background:#fff;border:1px solid var(--line);color:var(--green-dark);font-size:12px}
.radar-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.radar-items>span{padding:6px 8px;border-radius:9px;background:#fff;border:1px solid var(--line);font-size:9px;color:var(--ink-2)}
.radar-items .radar-empty{color:var(--muted);background:transparent;border-style:dashed}
.twin-card{background:linear-gradient(145deg,#fff,var(--green-soft));border-color:rgba(19,116,72,.2)}
.twin-card.idle{background:linear-gradient(145deg,#fff,#fafcfb)}
.twin-empty{min-height:120px;display:flex;align-items:center;justify-content:center;padding:18px;border:1px dashed var(--line-strong);border-radius:14px;color:var(--muted);font-size:11px;line-height:1.8;text-align:center}
.twin-content{display:grid;gap:10px}.twin-title-row{padding:11px 12px;border:1px solid rgba(19,116,72,.15);border-radius:13px;background:rgba(255,255,255,.72)}
.twin-title-row strong{display:block;font-size:13px}.twin-title-row span{display:block;margin-top:3px;color:var(--muted);font-size:9px;line-height:1.6}
.twin-columns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.twin-side{padding:12px;border-radius:13px;border:1px solid var(--line);background:#fff}
.twin-side.hypothetical{border-color:rgba(19,116,72,.24);background:var(--green-soft)}
.twin-side small{display:block;color:var(--muted);font-size:8.5px;font-weight:800;margin-bottom:7px}.twin-side span{display:block;font-size:10px;line-height:1.55;margin-top:4px}
.twin-affected{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:2px}.twin-affected b{font-size:9px;color:var(--green-dark)}.twin-affected span{padding:5px 7px;border-radius:8px;background:#fff;border:1px solid var(--line);font-size:8.5px;color:var(--ink-2)}
.chat-empty{min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--muted);gap:4px}.chat-empty strong{color:var(--ink);font-size:15px}.chat-empty span{font-size:10px}
.evidence-row,.unknown-row{margin-top:10px;padding:10px;border-radius:11px;font-size:9px;line-height:1.6}
.evidence-row{background:#f6faf7;border:1px solid var(--line)}.unknown-row{background:var(--warning-soft);border:1px solid #ecd8ab;color:#725419}
.evidence-row b,.unknown-row b{display:block;margin-bottom:5px;font-size:9px}.evidence-row span{display:inline-flex;margin:0 0 4px 4px;padding:4px 6px;border-radius:7px;background:#fff;border:1px solid var(--line);color:var(--ink-2)}
.unknown-row span{display:block}.service-eyebrows{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.service-provider{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font-size:8px;font-weight:700}
.signature-card{margin-top:14px;padding:25px;display:grid;grid-template-columns:.85fr 1.15fr;gap:24px;align-items:center;background:linear-gradient(135deg,#fff,#f5fbf7)}
.signature-card h3{margin:5px 0 7px;font-size:23px}.signature-card p{margin:0;color:var(--ink-2);font-size:12px;line-height:1.8}
.signature-flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:7px}.signature-flow span,.signature-flow strong{min-height:68px;display:flex;align-items:center;justify-content:center;padding:10px;border-radius:13px;border:1px solid var(--line);background:#fff;text-align:center;font-size:10px}
.signature-flow strong{background:var(--green-dark);border-color:var(--green-dark);color:#fff;font-size:12px}.signature-flow i{font-style:normal;color:var(--green);font-weight:800}

@media(max-width:1060px){
  .intelligence-grid,.signature-card{grid-template-columns:1fr}
}

@media(max-width:760px){
  .intelligence-grid{grid-template-columns:1fr}.service-radar{grid-template-columns:1fr}.twin-columns{grid-template-columns:1fr}.signature-card{padding:19px}.signature-flow{grid-template-columns:1fr}.signature-flow i{transform:rotate(90deg);justify-self:center}
}

/* Impact */
.impact-section{background:linear-gradient(180deg,rgba(255,255,255,.48),rgba(232,245,237,.28))}
.impact-heading{align-items:center}
.impact-baseline{min-width:360px;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:13px;border:1px solid var(--line-strong);border-radius:18px;background:#fff;box-shadow:var(--shadow-sm)}
.impact-baseline div{padding:10px;border-radius:12px;background:var(--surface-2)}
.impact-baseline strong{display:block;color:var(--green-dark);font-size:19px;font-variant-numeric:tabular-nums}
.impact-baseline span{display:block;margin-top:3px;color:var(--muted);font-size:8.5px;line-height:1.5}
.impact-baseline a{grid-column:1/-1;color:var(--green-dark);font-size:9px;font-weight:800;text-align:left;padding:2px 3px}
.impact-outcomes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.impact-outcomes article{position:relative;padding:18px 18px 17px 50px;border:1px solid var(--line);border-radius:17px;background:#fff;box-shadow:var(--shadow-sm);min-height:132px}
.impact-outcomes article>span{position:absolute;left:16px;top:17px;display:flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:9px;background:var(--green-soft);color:var(--green-dark);font-size:18px;font-weight:800}
.impact-outcomes b{display:block;font-size:14px;line-height:1.5}
.impact-outcomes p{margin:7px 0 0;color:var(--ink-2);font-size:10.5px;line-height:1.7}
.impact-scorecard{margin-top:12px;display:grid;grid-template-columns:.85fr 1.15fr;gap:20px;align-items:center;padding:23px;border:1px solid var(--line-strong);border-radius:20px;background:linear-gradient(135deg,#fff,var(--green-soft))}
.scorecard-copy h3{margin:6px 0 6px;font-size:21px}.scorecard-copy p{margin:0;color:var(--ink-2);font-size:11px;line-height:1.75}
.scorecard-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.scorecard-steps div{padding:12px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.82)}.scorecard-steps b{display:flex;width:25px;height:25px;align-items:center;justify-content:center;border-radius:8px;background:var(--green-dark);color:#fff;font-size:9px}.scorecard-steps span{display:block;margin-top:7px;font-size:9px;line-height:1.5;color:var(--ink-2)}

/* Compact service library */
.service-grid-compact{grid-template-columns:repeat(4,1fr);gap:9px}
.service-compact-card{min-height:132px;padding:14px;border:1px solid var(--line);border-radius:16px;background:#fff;text-align:right;cursor:pointer;box-shadow:0 5px 18px rgba(20,44,34,.035);transition:.18s ease;overflow:hidden}
.service-compact-card:hover{transform:translateY(-2px);border-color:rgba(19,116,72,.38);box-shadow:var(--shadow-sm)}
.service-compact-top{display:flex;align-items:center;justify-content:space-between;gap:7px;margin-bottom:9px}.service-compact-provider{max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:7.5px}
.service-compact-card>strong{display:block;font-size:13px;line-height:1.45}.service-compact-card>p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:5px 0 0;color:var(--ink-2);font-size:9.5px;line-height:1.65}.service-open-label{display:block;margin-top:10px;color:var(--green-dark);font-size:8.5px;font-weight:800}
body.modal-open{overflow:hidden}
.service-modal{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px}.service-modal-backdrop{position:absolute;inset:0;border:0;background:rgba(13,35,27,.46);backdrop-filter:blur(5px);cursor:default}.service-modal-panel{position:relative;z-index:1;width:min(720px,100%);max-height:min(84vh,820px);overflow:auto;padding:28px;border:1px solid var(--line-strong);border-radius:23px;background:#fff;box-shadow:0 35px 100px rgba(10,35,25,.25)}
.service-modal-close{position:absolute;left:17px;top:15px;width:36px;height:36px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);font-size:22px;line-height:1;cursor:pointer}.service-modal-eyebrows{display:flex;gap:7px;align-items:center;padding-left:46px}.service-modal-panel h3{margin:11px 0 6px;font-size:27px;line-height:1.35}.service-modal-summary{margin:0;color:var(--ink-2);font-size:13px;line-height:1.8}.service-modal-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:17px 0}.service-modal-meta div{padding:11px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.service-modal-meta small{display:block;color:var(--muted);font-size:8px}.service-modal-meta b{display:block;margin-top:3px;font-size:10px;line-height:1.5}
.modal-block{padding:14px 0;border-top:1px solid var(--line)}.modal-block>b{display:block;margin-bottom:8px;font-size:11px}.modal-block ul{margin:0;padding:0 20px 0 0;color:var(--ink-2);font-size:11px;line-height:1.9}.modal-pills{display:flex;flex-wrap:wrap;gap:6px}.modal-pills span{padding:6px 8px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);font-size:9px;color:var(--ink-2)}.service-modal-panel .service-policy{padding:13px;margin:0}.service-modal-panel .service-policy p{margin:4px 0 0;font-size:10.5px;line-height:1.75}.service-modal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.service-modal-actions a{padding:9px 12px;border-radius:10px;background:var(--green-dark);color:#fff;font-size:9px;font-weight:800}.service-modal-actions .secondary-link{background:var(--surface-2);border:1px solid var(--line);color:var(--green-dark)}

/* Benchmark intelligence dashboard */
.benchmark-metric.caution{background:var(--warning-soft);border-color:#ead7ad}
.benchmark-matrix{margin:0 0 14px;padding:20px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:var(--shadow-sm)}
.matrix-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:15px}.matrix-heading h3{margin:5px 0 0;font-size:19px}.matrix-heading p{max-width:440px;margin:0;color:var(--ink-2);font-size:10.5px;line-height:1.6}.matrix-scroll{overflow-x:auto;padding-bottom:3px}.capability-table{width:100%;min-width:900px;border-collapse:separate;border-spacing:0;font-size:9px}.capability-table th,.capability-table td{padding:9px 7px;text-align:center;border-bottom:1px solid var(--line)}.capability-table th{color:var(--muted);font-size:8px;font-weight:800;background:var(--surface-2)}.capability-table th:first-child,.capability-table td:first-child{text-align:right;position:sticky;right:0;background:#fff;z-index:1;min-width:155px}.capability-table th:first-child{background:var(--surface-2)}.capability-table td:first-child b{display:block;font-size:10px}.capability-table td:first-child small{display:block;color:var(--muted);margin-top:2px}.matrix-dot{display:inline-flex;width:23px;height:23px;align-items:center;justify-content:center;border-radius:8px;background:#f0f3f1;color:transparent;font-weight:900}.matrix-dot.on{background:var(--green-soft);color:var(--green-dark)}
.benchmark-grid-deep{grid-template-columns:1fr 1fr;gap:12px}.benchmark-deep-card{position:relative;padding:23px;border:1px solid var(--line);border-radius:21px;background:#fff;box-shadow:var(--shadow-sm);overflow:hidden}.benchmark-deep-card.caution{grid-column:1/-1;background:linear-gradient(180deg,#fff,#fffaf0);border-color:#e7d3a3}.benchmark-deep-index{position:absolute;left:18px;top:15px;color:#e4ece7;font-size:38px;font-weight:800;line-height:1}.benchmark-deep-head{display:flex;align-items:flex-start;gap:9px;flex-wrap:wrap;padding-left:56px}.benchmark-deep-head small{display:block;color:var(--muted);font-size:9px}.benchmark-deep-head h3{margin:3px 0 0;font-size:21px}.benchmark-deep-card>h4{margin:17px 0 5px;font-size:16px;line-height:1.5}.benchmark-deep-card .benchmark-pattern{font-size:10.5px;line-height:1.7}.caution-note{display:inline-flex;padding:6px 8px;border-radius:9px;background:var(--warning-soft);color:#725419;font-size:8.5px;font-weight:800}.benchmark-special{margin:15px 0;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-2)}
.before-after-visual{display:grid;grid-template-columns:1fr 1fr auto;gap:11px;align-items:end}.before-after-visual div small{display:block;color:var(--muted);font-size:8px}.before-after-visual div strong{display:block;margin:3px 0 6px;font-size:12px}.visual-bar{display:block;height:7px;border-radius:999px;background:var(--green)}.visual-bar.full{width:100%}.visual-bar.quarter{width:25%}.before-after-visual>b{align-self:center;color:var(--green-dark);font-size:9px}
.distribution-visual{display:grid;gap:6px}.distribution-row{display:grid;grid-template-columns:90px 1fr 62px;gap:7px;align-items:center}.distribution-row>span{font-size:8px;color:var(--ink-2)}.distribution-row>i{height:7px;border-radius:999px;background:#e6ece8;overflow:hidden}.distribution-row>i>b{display:block;height:100%;border-radius:inherit;background:var(--green)}.distribution-row>strong{font-size:8px;text-align:left;color:var(--green-dark)}
.state-isolation-visual{display:grid;grid-template-columns:1fr auto 1fr;gap:9px;align-items:center}.state-isolation-visual div{padding:11px;border-radius:11px;background:#fff;border:1px solid var(--line)}.state-isolation-visual small,.state-isolation-visual b{display:block}.state-isolation-visual small{font-size:8px;color:var(--muted)}.state-isolation-visual b{margin-top:3px;font-size:10px}.state-isolation-visual>span{padding:7px 8px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:8px;font-weight:800;text-align:center}
.trust-visual,.caution-visual{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.trust-visual div,.caution-visual div{padding:10px;border-radius:11px;background:#fff;border:1px solid var(--line)}.trust-visual strong,.caution-visual strong{display:block;color:var(--green-dark);font-size:16px}.caution-visual strong{color:var(--warning)}.trust-visual span,.caution-visual span{display:block;margin-top:3px;color:var(--muted);font-size:7.5px;line-height:1.4}
.benchmark-deep-columns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.benchmark-deep-card .benchmark-block{margin-top:0}.benchmark-deep-card .benchmark-block ul{margin:0;padding:0 16px 0 0;color:var(--ink-2);font-size:9.5px;line-height:1.75}.benchmark-deep-card>.benchmark-block.lesson{margin-top:8px}.benchmark-sources{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.benchmark-sources a{font-size:8.5px;color:var(--green-dark);font-weight:800}.benchmark-lessons{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.benchmark-lesson-card{padding:19px;border:1px solid var(--line);border-radius:17px;background:#fff}.benchmark-lesson-card>span{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:8px;font-weight:800}.benchmark-lesson-card.avoid>span{background:var(--warning-soft);color:var(--warning)}.benchmark-lesson-card h3{margin:10px 0 5px;font-size:15px}.benchmark-lesson-card p{margin:0;color:var(--ink-2);font-size:10px;line-height:1.7}

@media(max-width:1060px){
  .impact-outcomes{grid-template-columns:repeat(2,1fr)}
  .impact-scorecard{grid-template-columns:1fr}.scorecard-steps{grid-template-columns:repeat(4,1fr)}
  .service-grid-compact{grid-template-columns:repeat(3,1fr)}
}

@media(max-width:760px){
  .impact-baseline{min-width:0}.impact-outcomes{grid-template-columns:1fr}.scorecard-steps{grid-template-columns:1fr 1fr}
  .service-grid-compact{grid-template-columns:1fr 1fr}.service-compact-card{min-height:125px}
  .service-modal{padding:10px}.service-modal-panel{padding:22px 18px;max-height:91vh;border-radius:18px}.service-modal-panel h3{font-size:22px}.service-modal-meta{grid-template-columns:1fr}.service-modal-eyebrows{padding-left:40px}
  .matrix-heading{align-items:flex-start;flex-direction:column;gap:6px}.benchmark-grid-deep{grid-template-columns:1fr}.benchmark-deep-card.caution{grid-column:auto}.benchmark-deep-columns{grid-template-columns:1fr}.benchmark-lessons{grid-template-columns:1fr}.before-after-visual{grid-template-columns:1fr 1fr}.before-after-visual>b{grid-column:1/-1}.distribution-row{grid-template-columns:72px 1fr 56px}.state-isolation-visual{grid-template-columns:1fr}.trust-visual,.caution-visual{grid-template-columns:1fr 1fr 1fr}
}

@media(max-width:430px){
  .service-grid-compact{grid-template-columns:1fr}.scorecard-steps{grid-template-columns:1fr}.trust-visual,.caution-visual{grid-template-columns:1fr}.impact-baseline{grid-template-columns:1fr}.impact-baseline a{grid-column:auto}
}
.service-library-actions{display:flex;justify-content:center;margin-top:12px}.service-expand{border:1px solid var(--line-strong);background:#fff;color:var(--green-dark);border-radius:999px;padding:9px 15px;font-size:10px;font-weight:800;cursor:pointer}.service-expand:hover{background:var(--green-soft)}

/* Executive demo refinements */
.chat-top-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.reset-chat-button{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--green-dark);font-size:10px;font-weight:800;cursor:pointer;transition:.18s ease}
.reset-chat-button:hover{background:var(--green-soft);border-color:rgba(19,116,72,.3)}
.reset-chat-button span{font-size:15px;line-height:1}

.micro-label-with-info{display:flex;align-items:center;gap:7px}
.info-popover{position:relative;display:inline-flex;align-items:center;z-index:8}
.info-trigger{width:19px;height:19px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line-strong);border-radius:50%;background:#fff;color:var(--green-dark);font-family:Georgia,serif;font-size:11px;font-weight:700;cursor:help;padding:0}
.info-panel{position:absolute;right:0;top:27px;width:min(390px,78vw);padding:14px 15px;border:1px solid var(--line-strong);border-radius:14px;background:#fff;box-shadow:0 18px 55px rgba(20,44,34,.16);opacity:0;visibility:hidden;transform:translateY(-5px);transition:.16s ease;pointer-events:none;text-align:right}
.info-panel:before{content:"";position:absolute;right:7px;top:-6px;width:10px;height:10px;border-top:1px solid var(--line-strong);border-right:1px solid var(--line-strong);background:#fff;transform:rotate(-45deg)}
.info-panel strong{display:block;font-size:12px;margin-bottom:7px}
.info-panel span{display:block;color:var(--ink-2);font-size:10px;line-height:1.75;margin-top:5px}
.info-popover:hover .info-panel,.info-popover:focus-within .info-panel{opacity:1;visibility:visible;transform:translateY(0)}

.impact-voice-card{margin:0 0 12px;padding:20px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:var(--shadow-sm)}
.impact-voice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:14px}
.impact-voice-head h3{margin:5px 0 4px;font-size:19px}
.impact-voice-head p{margin:0;color:var(--ink-2);font-size:10.5px;line-height:1.7;max-width:720px}
.impact-voice-head>a{padding:8px 10px;border:1px solid var(--line);border-radius:10px;color:var(--green-dark);font-size:9px;font-weight:800;white-space:nowrap}
.voice-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.voice-metrics div{padding:13px;border-radius:13px;background:var(--surface-2);border:1px solid var(--line)}
.voice-metrics strong{display:block;color:var(--green-dark);font-size:20px;font-variant-numeric:tabular-nums}
.voice-metrics span{display:block;margin-top:4px;color:var(--muted);font-size:8.5px;line-height:1.45}

.impact-scenario-card{margin:0 0 14px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px;padding:22px;border:1px solid rgba(19,116,72,.22);border-radius:20px;background:linear-gradient(135deg,#fff,var(--green-soft));box-shadow:var(--shadow-sm)}
.impact-scenario-copy h3{margin:6px 0 6px;font-size:20px;line-height:1.45}
.impact-scenario-copy p{margin:0;color:var(--ink-2);font-size:10.5px;line-height:1.75}
.impact-rate-buttons{display:flex;gap:7px;margin-top:14px}
.impact-rate-buttons button{min-width:54px;padding:8px 10px;border:1px solid var(--line-strong);border-radius:999px;background:#fff;color:var(--green-dark);font-size:10px;font-weight:800;cursor:pointer}
.impact-rate-buttons button.active{background:var(--green-dark);border-color:var(--green-dark);color:#fff}
.impact-scenario-results{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start}
.impact-scenario-results div{padding:14px;border:1px solid rgba(19,116,72,.14);border-radius:13px;background:rgba(255,255,255,.85)}
.impact-scenario-results div:last-child{grid-column:1/-1}
.impact-scenario-results small{display:block;color:var(--muted);font-size:8.5px;line-height:1.4}
.impact-scenario-results strong{display:block;margin-top:5px;color:var(--green-dark);font-size:25px;font-variant-numeric:tabular-nums}
.impact-assumption{grid-column:1/-1;padding-top:10px;border-top:1px dashed rgba(19,116,72,.2);color:var(--muted);font-size:8.5px;line-height:1.6}

.benchmark-heading{align-items:center}
.benchmark-summary-note{min-width:150px;display:flex;align-items:center;justify-content:center;gap:11px;padding:17px;border:1px solid var(--line-strong);border-radius:17px;background:#fff;box-shadow:var(--shadow-sm)}
.benchmark-summary-note strong{color:var(--green-dark);font-size:34px;line-height:1}
.benchmark-summary-note span{color:var(--muted);font-size:9px;line-height:1.45}
.benchmark-compact-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:13px}
.benchmark-compact-card{position:relative;min-height:205px;display:flex;flex-direction:column;text-align:right;padding:18px 16px 15px;border:1px solid var(--line);border-radius:18px;background:#fff;box-shadow:var(--shadow-sm);cursor:pointer;overflow:hidden;transition:.18s ease}
.benchmark-compact-card:hover{transform:translateY(-2px);border-color:rgba(19,116,72,.32);box-shadow:0 15px 38px rgba(20,44,34,.08)}
.benchmark-compact-card.caution{background:linear-gradient(180deg,#fff,#fffaf0);border-color:#e7d3a3}
.benchmark-card-index{position:absolute;left:12px;top:9px;color:#e5ece8;font-size:30px;font-weight:800;line-height:1}
.benchmark-card-copy small{display:block;color:var(--muted);font-size:8.5px;font-weight:700}
.benchmark-card-copy h3{margin:5px 0 6px;font-size:16px;line-height:1.35}
.benchmark-card-copy p{margin:0;color:var(--ink-2);font-size:9.5px;line-height:1.65;min-height:47px}
.benchmark-card-metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px}
.benchmark-card-metrics div{padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2)}
.benchmark-card-metrics strong{display:block;color:var(--green-dark);font-size:13px}
.benchmark-card-metrics span{display:block;margin-top:2px;color:var(--muted);font-size:7.3px;line-height:1.35}
.benchmark-open-label{margin-top:auto;padding-top:10px;color:var(--green-dark);font-size:8.5px;font-weight:800}
.benchmark-open-label b{font-size:11px}

.applied-strip{display:grid;grid-template-columns:250px 1fr;gap:14px;align-items:center;margin:0 0 12px;padding:16px;border:1px solid rgba(19,116,72,.17);border-radius:18px;background:var(--green-soft)}
.applied-strip-head p{margin:5px 0 0;color:var(--ink-2);font-size:9.5px;line-height:1.55}
.applied-patterns{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.applied-patterns div{padding:9px 10px;border:1px solid rgba(19,116,72,.12);border-radius:10px;background:rgba(255,255,255,.78)}
.applied-patterns b{display:block;color:var(--green-dark);font-size:8.5px}
.applied-patterns span{display:block;margin-top:3px;color:var(--ink-2);font-size:8px;line-height:1.45}

.benchmark-matrix-details{margin:0 0 12px;border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden}
.benchmark-matrix-details>summary{padding:13px 16px;cursor:pointer;color:var(--green-dark);font-size:10px;font-weight:800;list-style:none}
.benchmark-matrix-details>summary::-webkit-details-marker{display:none}
.benchmark-matrix-details>summary:after{content:"+";float:left;font-size:16px;line-height:.8}
.benchmark-matrix-details[open]>summary:after{content:"−"}
.benchmark-matrix-details .benchmark-matrix{margin:0;border:0;border-top:1px solid var(--line);border-radius:0;box-shadow:none}

.benchmark-modal-panel{width:min(860px,100%);max-height:min(88vh,900px)}
.benchmark-modal-eyebrows{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding-left:44px}
.benchmark-modal-eyebrows>span:first-child{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--green-soft);color:var(--green-dark);font-size:9px;font-weight:800}
.benchmark-modal-headline{margin:7px 0 4px;color:var(--ink);font-size:15px;font-weight:700;line-height:1.6}
.benchmark-modal-pattern{margin:0;color:var(--ink-2);font-size:11px;line-height:1.7}
.benchmark-modal-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:16px 0}
.benchmark-modal-metrics div{padding:11px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2)}
.benchmark-modal-metrics small{display:block;color:var(--muted);font-size:7.5px;line-height:1.35}
.benchmark-modal-metrics strong{display:block;margin-top:4px;color:var(--green-dark);font-size:15px}
.benchmark-story-block{display:grid;grid-template-columns:36px 1fr;gap:11px;padding:15px 0;border-top:1px solid var(--line)}
.benchmark-story-block>span{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--surface-2);color:var(--green-dark);font-size:9px;font-weight:800}
.benchmark-story-block.applied>span{background:var(--green-soft)}
.benchmark-story-block b{display:block;font-size:11px;margin-bottom:6px}
.benchmark-story-block p{margin:0;color:var(--ink-2);font-size:10.5px;line-height:1.85}
.benchmark-story-block ul{margin:0;padding:0 17px 0 0;color:var(--ink-2);font-size:10.5px;line-height:1.85}
.benchmark-modal-eyebrows .review-note{background:var(--surface-2);color:var(--muted);border:1px solid var(--line)}
.benchmark-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:4px 0 15px}
.benchmark-detail-card{padding:14px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}
.benchmark-detail-card b{display:block;margin-bottom:7px;font-size:10.5px;color:var(--ink)}
.benchmark-detail-card ul,.benchmark-learning-card ul{margin:0;padding:0 17px 0 0;color:var(--ink-2);font-size:10px;line-height:1.8}
.benchmark-detail-card p{margin:0;color:var(--muted);font-size:10px;line-height:1.7}
.benchmark-challenges-block>span{background:#fff4e8;color:#8a4b08}
.benchmark-learning-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:4px 0 16px}
.benchmark-learning-card{padding:15px;border:1px solid var(--line);border-radius:13px;background:#fff}
.benchmark-learning-card.applied{background:var(--green-soft);border-color:rgba(19,116,72,.16)}
.benchmark-learning-card h4{margin:5px 0 8px;font-size:12px}

.benchmark-caution-box{padding:13px 14px;border:1px solid #ead7ad;border-radius:12px;background:var(--warning-soft)}
.benchmark-caution-box b{display:block;color:#725419;font-size:10px}
.benchmark-caution-box p{margin:5px 0 0;color:#6b5b36;font-size:9.5px;line-height:1.7}
.benchmark-source-block{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.benchmark-source-block>b{display:block;font-size:10px;margin-bottom:7px}
.benchmark-source-block>div{display:flex;gap:7px;flex-wrap:wrap}
.benchmark-source-block a{padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);color:var(--green-dark);font-size:8.5px;font-weight:800}

@media(max-width:1060px){
  .benchmark-compact-grid{grid-template-columns:repeat(3,1fr)}
  .applied-strip{grid-template-columns:1fr}.applied-patterns{grid-template-columns:repeat(3,1fr)}
  .voice-metrics{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:760px){
  .chat-topbar{align-items:flex-start}.chat-top-actions{justify-content:flex-start}
  .impact-voice-head{flex-direction:column}.impact-scenario-card{grid-template-columns:1fr}.impact-assumption{grid-column:auto}
  .benchmark-compact-grid{grid-template-columns:1fr 1fr}.applied-patterns{grid-template-columns:1fr 1fr}.benchmark-modal-metrics{grid-template-columns:1fr 1fr}.benchmark-detail-grid,.benchmark-learning-grid{grid-template-columns:1fr}
}
@media(max-width:500px){
  .benchmark-compact-grid,.applied-patterns,.voice-metrics{grid-template-columns:1fr}
  .impact-scenario-results{grid-template-columns:1fr}.impact-scenario-results div:last-child{grid-column:auto}
  .info-panel{right:-8px;width:min(330px,86vw)}
}

/* V7 progressive disclosure: keep the evidence, shorten the page */
.impact-method-details,.benchmark-insights-details{margin:0 0 12px;border:1px solid var(--line);border-radius:17px;background:#fff;overflow:hidden;box-shadow:var(--shadow-sm)}
.impact-method-details>summary,.benchmark-insights-details>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 17px;cursor:pointer;list-style:none;color:var(--green-dark)}
.impact-method-details>summary::-webkit-details-marker,.benchmark-insights-details>summary::-webkit-details-marker{display:none}
.impact-method-details>summary span,.benchmark-insights-details>summary span{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.impact-method-details>summary b,.benchmark-insights-details>summary b{font-size:11px}
.impact-method-details>summary small,.benchmark-insights-details>summary small{color:var(--muted);font-size:8.5px;font-weight:500}
.impact-method-details>summary:after,.benchmark-insights-details>summary:after{content:"+";font-size:19px;line-height:1;font-weight:500}
.impact-method-details[open]>summary:after,.benchmark-insights-details[open]>summary:after{content:"−"}
.impact-method-body{padding:0 15px 15px;border-top:1px solid var(--line)}
.impact-method-body .impact-outcomes{margin-top:15px}
.impact-method-body .impact-scorecard{margin-bottom:0}
.benchmark-insights-details .benchmark-lessons{margin:0;padding:14px;border-top:1px solid var(--line)}
`````

## `scripts/preflight.js`

`````text
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'coverage']);
const ignoredFiles = new Set(['.env']);
const textExtensions = new Set(['.js', '.ts', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml', '.example', '.gitignore', '.cmd']);
const problems = [];

function isTextFile(file) {
  const name = path.basename(file);
  return textExtensions.has(path.extname(file).toLowerCase()) || ['package.json', '.gitignore', '.env.example'].includes(name);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!ignoredFiles.has(entry.name) && isTextFile(full)) inspect(full);
  }
}

function inspect(file) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');

  if (text.includes('\u2014')) problems.push(`${relative}: contains banned long dash U+2014`);
  if (text.includes('\u2013')) problems.push(`${relative}: contains banned en dash U+2013`);

  const groqKeys = text.match(/gsk_[A-Za-z0-9_-]{20,}/g) || [];
  for (const key of groqKeys) {
    if (!/ضع|YOUR|your|example/i.test(key)) problems.push(`${relative}: possible Groq key leak starting with ${key.slice(0, 9)}...`);
  }

  const openAiKeys = text.match(/sk-[A-Za-z0-9_-]{20,}/g) || [];
  for (const key of openAiKeys) problems.push(`${relative}: possible secret key leak starting with ${key.slice(0, 7)}...`);
}

walk(root);

const gitignorePath = path.join(root, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  problems.push('.gitignore is missing');
} else {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.split(/\r?\n/).some(line => line.trim() === '.env')) problems.push('.gitignore does not ignore .env');
}

const envExamplePath = path.join(root, '.env.example');
if (!fs.existsSync(envExamplePath)) problems.push('.env.example is missing');

if (problems.length) {
  console.error('\nPreflight failed:\n');
  problems.forEach(problem => console.error(`  - ${problem}`));
  process.exit(1);
}

console.log('Preflight passed: no committed .env target, no obvious API key leak, and no banned dash characters found.');
`````

## `src/ai.js`

`````text
import { serviceById } from './knowledge.js';
import {
  applyDeterministicFacts,
  extractDeterministicFacts,
  isAffirmative,
  isNegative,
  normalizeArabic,
  referencedServiceId
} from './nlu.js';

const endpoint = 'https://api.groq.com/openai/v1/responses';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function outputText(data) {
  const chunks = [];
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function groqTimeoutMs() {
  const value = Number(env('GROQ_TIMEOUT_MS', '8500'));
  if (!Number.isFinite(value)) return 8500;
  return Math.max(3000, Math.min(value, 15000));
}

async function callGroq(payload) {
  const apiKey = env('GROQ_API_KEY');
  if (!apiKey || apiKey.includes('ضع_المفتاح')) {
    const error = new Error('GROQ_API_KEY_MISSING');
    error.code = 'GROQ_API_KEY_MISSING';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), groqTimeoutMs());
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ store: false, ...payload }),
      signal: controller.signal
    });
    if (response.ok) return response.json();
    const body = await response.text();
    const error = new Error(`GROQ_${response.status}: ${body.slice(0, 500)}`);
    error.status = response.status;
    error.code = response.status === 429 ? 'GROQ_RATE_LIMIT' : 'GROQ_HTTP_ERROR';
    throw error;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`GROQ_TIMEOUT_${groqTimeoutMs()}MS`);
      timeoutError.code = 'GROQ_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const nullableBoolean = { anyOf: [{ type: 'boolean' }, { type: 'null' }] };

const INTENTS = [
  'current_services', 'eligible_services', 'status_summary', 'attention_summary', 'what_changed',
  'eligibility_confirmation', 'explain_result', 'explain_effect', 'service_status_question',
  'service_application_question', 'service_question', 'benefit_amount_question', 'social_security_impact',
  'income_change', 'income_delta', 'new_job', 'employment_end', 'employment_end_negated',
  'multi_intent', 'labor_dispute', 'disability_support', 'domestic_worker', 'greeting', 'general'
];

const routeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: INTENTS },
    mode: { type: 'string', enum: ['current', 'what_if', 'reported', 'knowledge'] },
    serviceMention: { type: 'string' },
    income: nullableNumber,
    salary: nullableNumber,
    delta: nullableNumber,
    amountType: { type: 'string', enum: ['none', 'absolute_income', 'job_salary', 'increase_by', 'decrease_by'] },
    jobStage: { type: 'string', enum: ['unknown', 'reviewing', 'modification_requested', 'accepted', 'documented', 'started', 'rejected', 'ambiguous'] },
    accepted: nullableBoolean,
    started: nullableBoolean,
    replacesCurrentJob: nullableBoolean,
    endStage: { type: 'string', enum: ['unknown', 'planned', 'ended'] },
    ended: nullableBoolean,
    endReason: { type: 'string', enum: ['unknown', 'fixed_expiry', 'resignation', 'employer_termination', 'employer_termination_misconduct', 'business_closed', 'mutual', 'other'] },
    incomeSource: { type: 'string', enum: ['unknown', 'salary', 'self_employment', 'other'] },
    requiresClarification: { type: 'string' },
    normalizedQuestion: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  },
  required: ['intent', 'mode', 'serviceMention', 'income', 'salary', 'delta', 'amountType', 'jobStage', 'accepted', 'started', 'replacesCurrentJob', 'endStage', 'ended', 'endReason', 'incomeSource', 'requiresClarification', 'normalizedQuestion', 'confidence']
};

function compactState(state = {}) {
  const keys = ['intent', 'mode', 'income', 'salary', 'delta', 'jobStage', 'accepted', 'started', 'replacesCurrentJob', 'endStage', 'endReason', 'incomeSource', 'lastServiceId', 'lastClaim'];
  return Object.fromEntries(keys.filter(k => state[k] !== undefined).map(k => [k, state[k]]));
}

function profileContext(profile) {
  return {
    age: profile.age,
    nationality: profile.nationality,
    employment: profile.employment,
    salary: profile.salary,
    totalMonthlyIncome: profile.totalMonthlyIncome,
    familySize: profile.familySize,
    activeContract: profile.activeContract,
    socialSecurityBeneficiary: profile.socialSecurityBeneficiary,
    gosiRegistered: profile.gosiRegistered,
    educationLevel: profile.educationLevel,
    hasDisability: profile.hasDisability
  };
}

export async function understandMessage({ message, profile, history = [], scenarioState = {}, deterministicFacts = null }) {
  const facts = deterministicFacts || extractDeterministicFacts(message, scenarioState);
  const recentHistory = history.slice(-3).map(item => `${item.role}: ${String(item.text || '').slice(0, 180)}`).join('\n');

  const system = `
أنت طبقة فهم دلالي لخدمة حكومية تجريبية اسمها صلة.
مهمتك الوحيدة فهم رسالة المستفيد وإرجاع إطار دلالي منظم. لا تجب على المستفيد، لا تقرر أهلية، ولا تبحث عن خدمات.

ركز على سبعة أشياء:
1 نية السؤال
2 هل الكلام حقيقة حالية أو حدث تم الإبلاغ عنه أو افتراض مستقبلي
3 النفي بدقة: ما وافقت مختلف تماما عن وافقت، وما باشرت مختلف عن باشرت
4 مرحلة الحدث: عرض تحت المراجعة، طلب تعديل، رفض، موافقة، توثيق، مباشرة
5 معنى المبلغ: راتب نهائي أم زيادة بمقدار أم انخفاض بمقدار
6 الإحالة إلى الكلام السابق مثل عليه، هذي، ليش قلت كذا، مؤهل أكيد
7 إذا كان النص غير حاسم، اترك المعلومة unknown واطلب clarification محددا

قواعد مهمة:
- عبارة زاد راتبي 1000 تعني delta +1000 وليست راتبا جديدا 1000.
- عبارة راتبي انخفض 500 تعني delta -500 وليست راتبا جديدا 500.
- عبارة جاني عرض ب6500 بس ما وافقت عليه تعني reviewing وaccepted=false.
- عبارة رفضت العرض تعني rejected.
- عبارة طلبت تعديل العرض تعني modification_requested.
- عبارة وافقت وبعدها غيرت رأيي تعني ambiguous وتحتاج current_offer_status.
- الموافقة لا تعني المباشرة.
- التوثيق لا يعني بدء الدخل.
- لا تحول عدم الاشتراك بخدمة إلى عدم أهلية.
- لا تحاول اختيار service id. إذا ذكر المستخدم اسم خدمة أو وصفا لها، ضع النص في serviceMention فقط.

الحقائق المحلية أدناه عالية الثقة. لا تناقض أي حقيقة واضحة فيها، لكن يمكنك إكمال ما بقي غامضا.
`;

  const user = `
الحقائق المحلية:
${JSON.stringify({
  intent: facts.intent,
  mode: facts.mode,
  money: facts.money,
  delta: facts.delta,
  jobStage: facts.jobStage,
  accepted: facts.accepted,
  started: facts.started,
  replacesCurrentJob: facts.replacesCurrentJob,
  endStage: facts.endStage,
  endReason: facts.endReason,
  incomeSource: facts.incomeSource,
  requiresClarification: facts.requiresClarification
})}

حالة المحادثة:
${JSON.stringify(compactState(scenarioState))}

بيانات مختصرة للمستفيد:
${JSON.stringify(profileContext(profile))}

آخر المحادثة:
${recentHistory || 'لا يوجد'}

رسالة المستفيد:
${message}
`;

  const data = await callGroq({
    model: env('GROQ_MODEL', 'openai/gpt-oss-20b'),
    reasoning: { effort: 'low' },
    input: [{ role: 'system', content: system }, { role: 'user', content: user }],
    text: { format: { type: 'json_schema', name: 'silah_semantic_frame', strict: true, schema: routeSchema } }
  });

  const text = outputText(data);
  if (!text) throw new Error('EMPTY_AI_ROUTE');
  const parsed = JSON.parse(text);
  const route = baseRoute(parsed.intent, parsed.mode);
  Object.assign(route, parsed);
  route.incomeSource = parsed.incomeSource === 'unknown' ? null : parsed.incomeSource;
  if (parsed.requiresClarification) route.requiresClarification = parsed.requiresClarification;
  return applyDeterministicFacts(route, facts, {
    fieldHint: parsed.intent === 'new_job' ? 'salary' : ['income_change', 'income_delta'].includes(parsed.intent) ? 'income' : null
  });
}

export function shouldUseLocalRoute(route) {
  if (!route || route.intent === 'general') return false;
  if (route.pendingConfirmation || route.requiresClarification) return true;
  if (route.confidence >= 0.9) return true;
  return false;
}

function baseRoute(intent = 'general', mode = 'knowledge') {
  return {
    intent, mode, targetServiceIds: [], income: null, salary: null, delta: null,
    jobStage: 'unknown', accepted: null, started: null, replacesCurrentJob: null,
    endStage: 'unknown', ended: null, endReason: 'unknown', incomeSource: null,
    laborDisputeTopic: '', explanationTarget: '', normalizedQuestion: '', confidence: 0.35,
    pendingConfirmation: null, clearPendingConfirmation: false, confirmationRejected: false,
    requiresClarification: null, profileOverrides: {}, refinement: null
  };
}

function resolvePending(message, state) {
  const pending = state.pendingConfirmation;
  if (!pending) return null;
  const route = baseRoute(state.intent || 'general', state.mode || 'knowledge');
  route.clearPendingConfirmation = true;
  if (isAffirmative(message)) {
    if (pending.field === 'salary') route.salary = Number(pending.value);
    if (pending.field === 'income') route.income = Number(pending.value);
    route.confidence = 0.99;
    return route;
  }
  if (isNegative(message)) {
    route.confirmationRejected = true;
    return route;
  }
  return null;
}

export function fallbackRoute(message = '', scenarioState = {}) {
  const pending = resolvePending(message, scenarioState);
  if (pending) return pending;

  const facts = extractDeterministicFacts(message, scenarioState);
  let route = baseRoute(facts.intent, facts.mode);
  route = applyDeterministicFacts(route, facts, {
    fieldHint: facts.intent === 'new_job' ? 'salary' : ['income_change', 'income_delta'].includes(facts.intent) ? 'income' : null
  });

  if (facts.intent === 'income_delta') {
    route.income = null;
    route.delta = facts.delta;
  }

  if (facts.intent === 'service_question' && facts.money && /راتب|دخل/.test(facts.normalized)) {
    route.income = facts.money.value;
    if (facts.money.needsConfirmation) route.pendingConfirmation = { kind: 'amount', field: 'income', value: facts.money.value, raw: facts.money.raw, confidence: facts.money.confidence, question: `تقصد ${new Intl.NumberFormat('en-US').format(facts.money.value)} ريال؟`, quickReplies: [`نعم، ${new Intl.NumberFormat('en-US').format(facts.money.value)} ريال`, 'لا، بكتب المبلغ كامل'] };
  }

  if (facts.intent === 'multi_intent') {
    route.targetServiceIds = ['social_security', 'employment_end'];
  }

  if (facts.intent === 'labor_dispute') {
    route.laborDisputeTopic = String(message).trim();
    if (!route.targetServiceIds.length) route.targetServiceIds = ['labor_settlement'];
  }

  if (facts.intent === 'domestic_worker' && !route.targetServiceIds.length) {
    route.targetServiceIds = ['domestic_worker_contract_documentation'];
  }

  if (facts.intent === 'disability_support' && !route.targetServiceIds.length) {
    route.targetServiceIds = ['disability_evaluation', 'disability_financial_aid', 'traffic_facilities_certificate'];
  }

  if (facts.intent === 'service_question' && !route.targetServiceIds.length) {
    const text = normalizeArabic(message);
    if (/اقدر اقدم.*دخل ثاني|دخل ثاني.*اقدم/.test(text)) route.targetServiceIds = ['social_security'];
  }

  if (['eligibility_confirmation', 'service_application_question', 'service_status_question', 'explain_result', 'explain_effect', 'benefit_amount_question', 'social_security_impact'].includes(facts.intent) && !route.targetServiceIds.length) {
    const id = referencedServiceId(scenarioState);
    if (id) route.targetServiceIds = [id];
  }

  if (facts.intent === 'benefit_amount_question' && !route.targetServiceIds.length) route.targetServiceIds = ['social_security'];
  if (facts.intent === 'social_security_impact' && !route.targetServiceIds.length) route.targetServiceIds = ['social_security'];

  route.confidence = facts.intent === 'general' ? 0.35 : 0.96;
  return route;
}

function knownService(serviceId) {
  return serviceId ? serviceById[serviceId] : null;
}

function directAnswerForRelationship(item) {
  const eligibility = item?.relationship?.eligibility;
  if (['known_rule_not_met_currently', 'not_applicable_current_state'].includes(eligibility)) {
    return `حسب البيانات المعروفة حاليا، فيه شرط معروف ما ينطبق على حالتك: ${item.body}`;
  }
  if (['preliminary_match', 'known_conditions_match', 'known_basic_condition_match'].includes(eligibility)) {
    const unknown = item.unknowns?.length ? ` لكن ما زال نحتاج التحقق من ${item.unknowns.join('، ')}.` : '';
    return `عندك تطابق أولي مع الشروط المعروفة، لكن ما أقدر أؤكد الأهلية النهائية.${unknown ? ` ${unknown.trim().replace(/^لكن\s*/, '')}` : ''}`;
  }
  const unknown = item?.unknowns?.length ? ` ما زال نحتاج ${item.unknowns.join('، ')}.` : '';
  return `ما أقدر أؤكد الأهلية من البيانات الحالية.${unknown}`;
}

export function fallbackReply({ route, evaluation, profile, previousState = {} }) {
  const results = evaluation.results || [];
  const changes = evaluation.changes || [];
  const first = results[0];
  const targetId = route.targetServiceIds?.[0] || first?.serviceId || null;
  const service = knownService(targetId);

  if (route.intent === 'status_summary') {
    const job = profile.employment === 'employed' ? 'موظف' : profile.employment === 'job_seeker' ? 'باحث عن عمل' : profile.employment === 'retired' ? 'متقاعد' : 'غير موظف حاليا';
    const contract = profile.activeContract ? 'وعندك عقد وظيفي فعال' : 'وما عندك عقد وظيفي فعال';
    return `حسب بيانات النموذج الحالية: ${profile.name}، العمر ${profile.age} سنة، الحالة ${job}، الدخل المعروف ${Number(profile.totalMonthlyIncome ?? profile.salary ?? 0)} ريال، حجم الأسرة ${profile.familySize}، ${contract}.`;
  }

  if (route.intent === 'attention_summary') {
    const items = [...(evaluation.results || []), ...(evaluation.changes || [])];
    if (!items.length) return 'ما ظهر شيء يحتاج إجراء عاجل ضمن البيانات التي يغطيها النموذج حاليا.';
    return `لقيت ${items.length} شيء يستحق انتباهك بين خدمة مرتبطة بحالتك أو تحديث في بياناتك. عرضتها تحت مرتبة حسب علاقتها بوضعك الحالي.`;
  }

  if (changes.length && route.intent === 'what_changed') {
    return `لقيت ${changes.length} تحديث في بيانات ${profile.name}. كل تحديث موضح تحته وش ممكن يتأثر وليش.`;
  }

  if (route.intent === 'eligibility_confirmation') {
    if (!first) return `ما أقدر أؤكد الأهلية لـ${service?.name || 'الخدمة'} لأن البيانات الحالية ما تكفي لتطبيق الشروط بشكل كامل.`;
    return directAnswerForRelationship(first);
  }

  if (route.intent === 'service_application_question') {
    if (!first) return `التقديم على ${service?.name || 'الخدمة'} يحتاج أولا ربط السؤال بالخدمة وشروطها المنشورة.`;
    const eligibility = first.relationship?.eligibility;
    if (['known_rule_not_met_currently', 'not_applicable_current_state'].includes(eligibility)) {
      return `الخدمة موجودة من حيث المبدأ، لكن حسب البيانات الحالية فيه شرط معروف ما ينطبق الآن: ${first.body}`;
    }
    if (targetId === 'social_security') {
      return `عدم كونك مستفيدا حاليا لا يمنع التقديم على الضمان من حيث المبدأ. الأهلية نفسها تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط${first.unknowns?.length ? `، وما زال يلزم التحقق من ${first.unknowns.join('، ')}` : ''}.`;
    }
    return `التقديم على ${service?.name || 'الخدمة'} متاح من حيث المبدأ عند استيفاء الشروط. ${first.body}${first.unknowns?.length ? ` وما زال يلزم التحقق من ${first.unknowns.join('، ')}.` : ''}`;
  }

  if (route.intent === 'service_status_question') {
    if (targetId === 'senior_privilege_card') {
      if (profile.seniorPrivilegeCardIssued === true) return 'بيانات النموذج تشير إلى أن بطاقة امتياز كبار السن صادرة.';
      if (profile.seniorPrivilegeCardIssued === false) return 'بيانات النموذج تشير إلى أن البطاقة غير صادرة حاليا.';
      return 'العمر والجنسية يطابقان الشرطين المعروفين للبطاقة، لكن ما عندي في بيانات النموذج معلومة تؤكد هل صدرت فعليا في حسابك.';
    }
    return `ما عندي حالة إصدار مؤكدة لـ${service?.name || 'هذه الخدمة'} في بيانات النموذج الحالية.`;
  }

  if (route.intent === 'explain_effect') {
    const last = (previousState.lastResults || []).find(item => item.serviceId === targetId) || first;
    if (last) return `${last.why}${last.body ? ` ${last.body}` : ''}${last.unknowns?.length ? ` وما زال غير محسوم: ${last.unknowns.join('، ')}.` : ''}`;
    return `ما عندي أثر سابق مرتبط بـ${service?.name || 'الخدمة'} أقدر أشرحه في سياق المحادثة الحالية.`;
  }

  if (route.intent === 'explain_result') {
    const last = (previousState.lastResults || []).find(item => item.serviceId === targetId) || first;
    if (last) return `${last.title}: ${last.why}${last.unknowns?.length ? ` وما زال غير محسوم: ${last.unknowns.join('، ')}.` : ''}`;
    return `ما عندي نتيجة سابقة واضحة مرتبطة بـ${service?.name || 'الخدمة'} في سياق المحادثة الحالية.`;
  }

  if (route.intent === 'benefit_amount_question') {
    return 'ما أقدر أحدد مبلغ معاش الضمان بشكل موثوق من البيانات الموجودة في النموذج وحدها. حساب المبلغ يحتاج الدخل المحتسب الكامل للأسرة وبقية البيانات والقواعد الرسمية المطبقة على الحالة.';
  }

  if (route.intent === 'social_security_impact') {
    if (/نزل|انخفض/.test(normalizeArabic(route.normalizedQuestion || ''))) {
      return 'انخفاض الدخل لا يعني انقطاع الضمان من ناحية الدخل وحده. قد يتغير مبلغ المعاش بعد إعادة التقييم، وتبقى بقية بيانات الأسرة والثروة والشروط مؤثرة.';
    }
    return 'ارتفاع الدخل قد يغير مبلغ المعاش أو يؤثر على شرط الدخل، لكن ما أقدر أقول إن الضمان سيتوقف من الراتب وحده لأن بقية بيانات الأسرة والثروة والشروط تدخل في التقييم.';
  }

  if (route.intent === 'employment_end_negated') {
    return 'بما أن العقد ما انتهى، ما نعامل حالتك كإنهاء علاقة وظيفية ولا نشغل نتائج ما بعد الانتهاء.';
  }

  if (route.intent === 'current_services' && results.length) {
    return `حسب بيانات ${profile.name} الحالية، عندك ${results.length} نتيجة مرتبطة بوضعك الآن أو تستحق الانتباه. التفاصيل تحت تشرح سبب ظهور كل واحدة.`;
  }

  if (route.intent === 'eligible_services' && results.length) {
    return `بناء على بياناتك الحالية، لقيت ${results.length} خدمة أو برنامج ممكن يكون مرتبطا بحالتك. ظهورها هنا مو حكم أهلية نهائي، وكل بطاقة توضح المعروف والناقص.`;
  }

  if (['service_question', 'domestic_worker'].includes(route.intent) && results.length === 1) {
    const unknown = first.unknowns?.length ? ` وما زال يحتاج تحقق: ${first.unknowns.join('، ')}.` : '';
    return `${first.body}${unknown}`;
  }

  if (['income_change', 'income_delta', 'new_job', 'employment_end', 'multi_intent', 'labor_dispute'].includes(route.intent) && results.length) {
    const main = results.slice(0, 3).map(item => item.body).join(' ');
    const unknowns = [...new Set(results.flatMap(item => item.unknowns || []))];
    return `${main}${unknowns.length ? ` وللدقة أكثر ما زال نحتاج: ${unknowns.slice(0, 3).join('، ')}.` : ''}`.trim();
  }

  if (route.intent === 'greeting') return `هلا ${profile.name}. اسألني عن الخدمات المرتبطة بحالتك أو اشرح أي تغيير أو قرار تفكر فيه بطريقتك.`;
  if (results.length) return `لقيت ${results.length} نتيجة مرتبطة بسؤالك. التفاصيل تحت توضح سبب الارتباط وما الذي ما زال يحتاج تحقق.`;
  return 'ما قدرت أربط السؤال بقاعدة موثوقة داخل نطاق صلة الحالي. اشرح الحالة بشكل أبسط أو اذكر الخدمة أو التغيير المقصود.';
}
`````

## `src/knowledge.js`

`````text
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readJson(relativePath) {
  const full = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

export const services = readJson('data/services.json');
export const personas = readJson('data/personas.json');
export const benchmarks = readJson('data/benchmarks.json');
export const languageGlossary = readJson('data/language_glossary.json');

export const serviceById = Object.fromEntries(services.map(service => [service.id, service]));
export const personaById = Object.fromEntries(personas.map(persona => [persona.id, persona]));

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
`````

## `src/nlu.js`

`````text
import { languageGlossary } from './knowledge.js';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const NUMBER_WORDS = new Map([
  ['صفر', 0],
  ['واحد', 1], ['وحده', 1], ['وحدة', 1],
  ['اثنين', 2], ['اثنان', 2], ['اثنتين', 2], ['ثنين', 2],
  ['ثلاثه', 3], ['ثلاثة', 3], ['ثلاث', 3],
  ['اربعه', 4], ['اربعة', 4], ['اربع', 4],
  ['خمسه', 5], ['خمسة', 5], ['خمس', 5],
  ['سته', 6], ['ستة', 6], ['ست', 6],
  ['سبعه', 7], ['سبعة', 7], ['سبع', 7],
  ['ثمانيه', 8], ['ثمانية', 8], ['ثمان', 8], ['ثمنيه', 8],
  ['تسعه', 9], ['تسعة', 9], ['تسع', 9],
  ['عشره', 10], ['عشرة', 10], ['عشر', 10],
  ['احدعش', 11], ['احداشر', 11], ['احد عشر', 11],
  ['اثنعش', 12], ['اثناعش', 12], ['اثنا عشر', 12], ['اثني عشر', 12],
  ['ثلاثطعش', 13], ['ثلاثتعش', 13], ['ثلاثه عشر', 13], ['ثلاثة عشر', 13],
  ['اربعتعش', 14], ['اربعطعش', 14], ['اربعه عشر', 14], ['اربعة عشر', 14],
  ['خمستعش', 15], ['خمسطعش', 15], ['خمسه عشر', 15], ['خمسة عشر', 15],
  ['ستعش', 16], ['ستطعش', 16], ['سته عشر', 16], ['ستة عشر', 16],
  ['سبعتعش', 17], ['سبعطعش', 17], ['سبعه عشر', 17], ['سبعة عشر', 17],
  ['ثمنتعش', 18], ['ثمانطعش', 18], ['ثمانيه عشر', 18], ['ثمانية عشر', 18],
  ['تسعتعش', 19], ['تسعطعش', 19], ['تسعه عشر', 19], ['تسعة عشر', 19],
  ['عشرين', 20]
]);

const YES_RE = /^(?:ايه|ايوه|اي|نعم|صح|صحيح|تمام|يب|يبب|اوكي|أوكي|yes|yep)(?:\s|$)/i;
const NO_RE = /^(?:لا|مو|مب|غلط|لا مو|لا مب|no)(?:\s|$)/i;

export function normalizeDigits(value = '') {
  return String(value)
    .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

export function normalizeArabic(value = '') {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[؟?!،؛:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalWordToken(token = '') {
  const plain = normalizeArabic(token).replace(/[^\p{L}\d.]/gu, '');
  if (NUMBER_WORDS.has(plain)) return plain;
  if (plain.startsWith('ب') && NUMBER_WORDS.has(plain.slice(1))) return plain.slice(1);
  if (plain.startsWith('ل') && NUMBER_WORDS.has(plain.slice(1))) return plain.slice(1);
  return plain;
}

function wordNumberFromText(normalizedText) {
  const phrases = [...NUMBER_WORDS.keys()].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const p = normalizeArabic(phrase);
    const re = new RegExp(`(?:^|\\s)([بل]?${escapeRegExp(p)})(?=\\s|$)`, 'u');
    const match = normalizedText.match(re);
    if (!match) continue;
    const canonical = canonicalWordToken(match[1]);
    if (NUMBER_WORDS.has(canonical)) {
      return { value: NUMBER_WORDS.get(canonical), raw: match[1], index: match.index ?? -1 };
    }
  }
  return null;
}

function salaryContext(text) {
  return /راتب|دخل|عرض|وظيف|شغل|دوام|عقد|مرتب|اجر|يجيني|معاش/.test(text);
}

function amountAfter(text, re) {
  const match = text.match(re);
  return match ? match[1] : null;
}

function parseExplicitNumber(raw) {
  if (raw == null) return null;
  const value = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function extractMoney(message = '', { assumeThousands = false } = {}) {
  const text = normalizeArabic(message).replace(/,/g, '');
  const context = salaryContext(text) || assumeThousands;

  // ٧ آلاف ونص, 7 الاف ونصف
  let match = text.match(/(?:^|\s)(\d{1,2})\s*(?:الف|الاف)\s*(?:و\s*)?(?:نص|نصف)(?=\s|$)/);
  if (match) {
    return { value: Number(match[1]) * 1000 + 500, raw: match[0].trim(), confidence: 0.995, needsConfirmation: false, interpretation: 'explicit_thousands_half' };
  }

  // 7.5k, 12.5k
  match = text.match(/(?:^|[^\d])(\d{1,2}(?:\.\d+)?)\s*k\b/);
  if (match) {
    return { value: Math.round(Number(match[1]) * 1000), raw: match[1], confidence: 0.995, needsConfirmation: false, interpretation: 'k_thousands' };
  }

  // ٨ الاف, 12 ألف
  match = text.match(/(?:^|[^\d])(\d{1,2}(?:\.\d+)?)\s*(?:الف|الاف)(?=$|[^\p{L}\d])/u);
  if (match) {
    return { value: Math.round(Number(match[1]) * 1000), raw: match[0].trim(), confidence: 0.995, needsConfirmation: false, interpretation: 'explicit_thousands' };
  }

  // Explicit 3 to 6 digit amount
  match = text.match(/(?:^|[^\d])(\d{3,6})(?=$|[^\d])/);
  if (match) {
    return { value: Number(match[1]), raw: match[1], confidence: 0.995, needsConfirmation: false, interpretation: 'explicit_amount' };
  }

  // 6 ونص, 6.5 in salary context
  match = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:و\s*)?(?:نص|نصف)(?=$|\s)/);
  if (match && context) {
    return { value: Number(match[1]) * 1000 + 500, raw: match[0].trim(), confidence: 0.97, needsConfirmation: false, interpretation: 'numeric_half_thousands' };
  }

  match = text.match(/(?:^|[^\d])(\d{1,2}\.\d+)(?=$|[^\d])/);
  if (match && context) {
    return { value: Math.round(Number(match[1]) * 1000), raw: match[1], confidence: 0.96, needsConfirmation: false, interpretation: 'decimal_thousands' };
  }

  const word = wordNumberFromText(text);
  if (word && context) {
    const start = Math.max(0, word.index);
    const tail = text.slice(start, start + normalizeArabic(word.raw).length + 22);
    const half = /(?:و\s*)?(?:نص|نصف)/.test(tail);
    const explicitThousands = /الف|الاف/.test(tail);
    const value = Math.round((word.value + (half ? 0.5 : 0)) * 1000);
    return {
      value,
      raw: half ? `${word.raw} ونص` : word.raw,
      confidence: half || explicitThousands ? 0.97 : 0.74,
      needsConfirmation: !(half || explicitThousands),
      interpretation: half ? 'colloquial_half_thousands' : explicitThousands ? 'word_explicit_thousands' : 'word_salary_thousands'
    };
  }

  match = text.match(/(?:^|[^\d])(\d{1,2})(?=$|[^\d])/);
  if (match && context) {
    const value = Number(match[1]) * 1000;
    return { value, raw: match[1], confidence: 0.72, needsConfirmation: true, interpretation: 'salary_integer_thousands' };
  }

  return null;
}

export function detectIncomeDelta(message = '') {
  const text = normalizeArabic(message);
  const money = extractMoney(message, { assumeThousands: false });
  if (!money || money.value < 0) return null;

  const increased = /زاد راتبي|راتبي زاد|زاد دخلي|دخلي زاد|ارتفع راتبي بمقدار|ارتفع دخلي بمقدار/.test(text);
  const decreased = /انخفض راتبي|راتبي انخفض|نقص راتبي|راتبي نقص|انخفض دخلي|دخلي انخفض/.test(text);
  const hasFinalValueMarker = /صار|اصبح|بيصير|يصير|وصل/.test(text);
  if (hasFinalValueMarker) return null;
  if (increased) return { delta: money.value, raw: money.raw };
  if (decreased) return { delta: -money.value, raw: money.raw };
  return null;
}

export function detectJobStage(message = '') {
  const text = normalizeArabic(message);

  if (/وافقت.*غيرت رايي|قبلت.*غيرت رايي|وقعت.*غيرت رايي/.test(text)) return 'ambiguous';
  if (/رفضت|رفضته|قلت لهم لا|ما ناسبني العرض/.test(text)) return 'rejected';
  if (/طلبت.*تعديل|طلبت.*يعدلون|عدلوا العرض|تعديل الراتب|تعديل العرض/.test(text)) return 'modification_requested';

  const acceptanceNegated = /ما وافقت|موافقت|ما قبلت|مقبلت|ما وقعت|موقعت|ماني موافق|مو موافق|لم اوافق|لم اوقع/.test(text);
  const notStarted = /ما باشرت|ماباشرت|لسه ما باشرت|للحين ما باشرت|لم ابدا|ما بدات|ما بديت|ما داومت|للحين ما داومت|لسه ما داومت|مو مباشر|غير مباشر/.test(text);

  if (!notStarted && /باشرت|داومت|اول يوم|بديت العمل|بدات العمل|بدات الدوام|بدات الوظيفه/.test(text)) return 'started';
  if (/مو موثق|غير موثق|ما توثق|لم يوثق/.test(text)) return 'unknown';
  if (/موثق|توثق|تم التوثيق|توثق العقد/.test(text)) return 'documented';
  if (/العقد الجديد يبدأ الشهر الجاي|العقد الجديد يبدا الشهر الجاي/.test(text)) return 'documented';
  if (acceptanceNegated) return 'reviewing';
  if (/لو قبلت|اذا قبلت|وافقت|قبلت العرض|وقعت العرض|وقعت|قلت لهم اوكي|قلت لهم موافق|موافق على العرض/.test(text)) return 'accepted';
  if (/اراجع|وصلني|جاني عرض|جاني شغل|عرض وظيفي|عقد جديد|ما ادري اوافق/.test(text)) return 'reviewing';
  return 'unknown';
}

export function detectReplacement(message = '') {
  const text = normalizeArabic(message);
  if (/ما راح اترك وظيفتي|ما بترك وظيفتي|بكمل في وظيفتي الحاليه مع الجديده|بجمع بين|بستمر في وظيفتي|العقد الحالي باقي|وظيفتي الحاليه مستمره|باقي على وظيفتي/.test(text)) return false;
  if (/بديله|بديل|بطلع من|بترك وظيفتي|بسيب وظيفتي|بانتقل|انتقل لها|استبدل وظيفتي|مكان وظيفتي|اروح الجديده/.test(text)) return true;
  return null;
}

export function detectEmploymentEnd(message = '') {
  const text = normalizeArabic(message);

  if (/ما انتهي عقدي|ما انتهى عقدي|عقدي ما خلص|عقدي ما انتهي|عقدي ما انتهى/.test(text)) {
    return { stage: 'not_ended', reason: 'unknown', negated: true };
  }

  let stage = 'unknown';
  let reason = 'unknown';

  if (/بفكر استقيل|افكر استقيل|بستقيل/.test(text)) {
    stage = 'planned';
    reason = 'resignation';
  } else if (/استقلت/.test(text)) {
    stage = 'ended';
    reason = 'resignation';
  }

  if (/عقدي بينتهي|عقدي راح ينتهي|عقدي سينتهي|بينتهي الشهر الجاي/.test(text)) {
    stage = 'planned';
    reason = 'fixed_expiry';
  }

  if (/عقدي خلص|خلص عقدي|انتهي عقدي|انتهى عقدي|انتهاء مده العقد/.test(text)) {
    stage = 'ended';
    reason = 'fixed_expiry';
  }

  if (/جاني اشعار انهاء|اشعار انهاء/.test(text)) {
    stage = /للحين اداوم|ما زلت اداوم|ما زال العقد/.test(text) ? 'planned' : 'planned';
    reason = 'employer_termination';
  }

  if (/فصلوني بسبب مخالف|فصلتني.*مخالف|انهاء بسبب مخالف/.test(text)) {
    stage = 'ended';
    reason = 'employer_termination_misconduct';
  } else if (/فصلوني|الشركه فصلتني|الشركه انهت|انهاء من صاحب العمل/.test(text)) {
    stage = 'ended';
    reason = 'unknown';
  }

  if (/الشركه قفلت|الشركه سكرت|قفلوا الشركه|اغلاق المنشاه|انتهاء نشاط/.test(text)) {
    stage = 'ended';
    reason = 'business_closed';
  }

  if (/بالتراضي|اتفقنا ننهي/.test(text)) {
    stage = 'ended';
    reason = 'mutual';
  }

  if (/انتهت التجربه.*ما كملوا|انتهت فتره التجربه/.test(text)) {
    stage = 'ended';
    reason = 'unknown';
  }

  if (stage === 'unknown' && /بنفصل|ستنتهي|راح ينتهي|قريب ينتهي/.test(text)) stage = 'planned';
  if (stage === 'unknown' && /انتهت فعليا|انتهت|خلصت/.test(text)) stage = 'ended';

  return { stage, reason, negated: false };
}

export function detectMode(message = '') {
  const text = normalizeArabic(message);
  if (/(?:^|\s)لو(?:\s|$)|(?:^|\s)اذا(?:\s|$)|بيصير|راح يصير|ماذا لو|افكر|بفكر|ناوي|بنفصل|بينتهي|الشهر الجاي|يبدأ الشهر الجاي|يبدا الشهر الجاي|هل زياده راتبي|هل زيادة راتبي/.test(text)) return 'what_if';
  if (/صار|حصل|انتهت|فصلوني|فصلتني|استقلت|باشرت|داومت|بدات العمل|توقف راتبي|نزل راتبي|ارتفع راتبي|زاد راتبي|انخفض راتبي|جاني راتب|عقدي خلص|الشركه قفلت|الشركه سكرت/.test(text)) return 'reported';
  return 'knowledge';
}

export function matchServiceAliases(message = '') {
  const normalized = normalizeArabic(message);
  const matches = [];
  for (const [serviceId, aliases] of Object.entries(languageGlossary.serviceAliases || {})) {
    for (const alias of aliases || []) {
      const a = normalizeArabic(alias);
      if (a && normalized.includes(a)) {
        matches.push({ serviceId, alias, normalizedAlias: a });
        break;
      }
    }
  }

  if (/ضمان/.test(normalized)) matches.push({ serviceId: 'social_security', alias: 'ضمان', normalizedAlias: 'ضمان' });
  if (/اعانه بحث عن عمل|اعانه البحث عن عمل|حافز/.test(normalized)) matches.push({ serviceId: 'job_search_subsidy', alias: 'إعانة البحث عن عمل', normalizedAlias: 'اعانه بحث عن عمل' });
  // Common natural language references that are not service names.
  if (/دوره تطورني|دوره تدريبيه|ابي دوره/.test(normalized)) matches.push({ serviceId: 'doroob', alias: 'دورة', normalizedAlias: 'دوره' });
  if (/وش تخصص يناسبني|تخصص يناسبني|مساري المهني/.test(normalized)) matches.push({ serviceId: 'career_guidance_sobol', alias: 'تخصص يناسبني', normalizedAlias: 'تخصص يناسبني' });
  if (/عامله منزليه|عامل منزلي/.test(normalized) && /عقد|مو موثق|توثيق/.test(normalized)) matches.push({ serviceId: 'domestic_worker_contract_documentation', alias: 'عقد عاملة منزلية', normalizedAlias: 'عقد عامله منزليه' });
  if (/مستحقاتي|حقوقي/.test(normalized) && /الشركه|صاحب العمل|ما عطتني|ما عطوني/.test(normalized)) matches.push({ serviceId: 'labor_settlement', alias: 'خلاف مستحقات', normalizedAlias: 'خلاف مستحقات' });
  if (/غير مؤهل.*ضمان|الضمان توقف|توقف.*ضمان|كيف اعترض/.test(normalized)) matches.push({ serviceId: 'social_security_objection', alias: 'اعتراض الضمان', normalizedAlias: 'اعتراض الضمان' });

  if (/غير موهل.*ضمان|غير مؤهل.*ضمان|الضمان توقف عندي|توقف الضمان عندي|وقفوا.*ضمان|كيف اعترض/.test(normalized)) {
    return [{ serviceId: 'social_security_objection', alias: 'اعتراض الضمان', normalizedAlias: 'اعتراض الضمان' }];
  }

  const seen = new Set();
  return matches.filter(item => {
    if (seen.has(item.serviceId)) return false;
    seen.add(item.serviceId);
    return true;
  });
}

function lastServiceId(previousState = {}) {
  if (previousState.lastServiceId) return previousState.lastServiceId;
  if (previousState.targetServiceIds?.length === 1) return previousState.targetServiceIds[0];
  const ids = [...new Set((previousState.lastResults || []).map(item => item?.serviceId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

function serviceReferenceFromMessage(message = '', previousState = {}) {
  const matches = matchServiceAliases(message);
  if (matches.length) return matches.map(item => item.serviceId);
  const text = normalizeArabic(message);
  const deictic = /عليه|عليها|هذي|هذا|البطاقه|الاعانه|الخدمه|تنطبق علي|مؤهل اكيد|مؤهله اكيد|ليش قلت لي كذا|هل صدرت لي/.test(text);
  if (deictic) {
    const id = lastServiceId(previousState);
    return id ? [id] : [];
  }
  return [];
}

export function detectIntent(message = '', previousState = {}) {
  const text = normalizeArabic(message);
  const services = serviceReferenceFromMessage(message, previousState);
  const hasSocial = services.includes('social_security') || /الضمان|المعاش/.test(text);

  if (previousState.pendingConfirmation && (isAffirmative(message) || isNegative(message))) return previousState.intent || 'general';

  // Conversational follow ups come first.
  if (/ليش .*يتاثر|ليش .*يتأثر|ليش الضمان ممكن يتاثر/.test(text)) return 'explain_effect';
  if (/جاني غير موهل|طلع لي غير موهل|نتيجتي غير موهل|جاني غير مؤهل|طلع لي غير مؤهل/.test(text)) return 'service_question';
  if (/ليش قلت لي كذا|ليش قلت كذا|فسر كلامك/.test(text)) return 'explain_result';
  if (/ليش ظهر|ليش طلعت|ليش جتني|ليش عندي ظاهر|ليش الضمان عندي ظاهر/.test(text)) return 'explain_result';
  if (/مؤهل|مؤهله|موهل|موهله|تنطبق علي|تنطبق عليا/.test(text)) return 'eligibility_confirmation';
  if (/اقدر اقدم|اقدر اسجل|ابي اسجل|كيف اقدم|التقديم عليها|التسجيل فيها/.test(text)) return 'service_application_question';
  if (/صدرت لي|انصدرت لي|طلعت لي فعلا|حاله الاصدار/.test(text)) return 'service_status_question';
  if (/كم.*معاش|كم بيصير معاش|كم معاشي/.test(text)) return 'benefit_amount_question';
  if (hasSocial && /زياده راتب|زيادة راتب|راتبي.*توقف الضمان|راتبي.*ينقطع الضمان|نزل.*الضمان|ينقطع الضمان|توقف الضمان/.test(text) && !/اعترض/.test(text)) return 'social_security_impact';

  if (/وش وضعي الحالي|وش وضعي|ايش وضعي|وش تعرف عني|ايش تعرف عني/.test(text)) return 'status_summary';
  if (/هل فيه شي يحتاج انتباهي|هل فيه شيء يحتاج انتباهي|وش يحتاج انتباهي|وش لازم انتبه له/.test(text)) return 'attention_summary';
  if (/وش تغير|ايش تغير|اخر.*تغيير|اخر التحديثات|ورني.*تحديث/.test(text)) return 'what_changed';
  if (/وش عندي خدمات حاليا|وش خدماتي حاليا|الخدمات.*تخصني|وش.*يخصني|خدماتي/.test(text)) return 'current_services';
  if (/وش الخدمات اللي اقدر استفيد|وش ممكن يفيدني|وش الاشياء اللي ممكن تساعدني|وش يساعدني|عاطل.*ادور وظيفه|باحث عن عمل.*وش/.test(text)) return 'eligible_services';

  const employmentEnd = detectEmploymentEnd(message);
  if (employmentEnd.negated) return 'employment_end_negated';

  if (hasSocial && /بنفصل من وظيفتي|انفصلت من الوظيفه|انتهت وظيفتي|فقدت وظيفتي/.test(text) && /مناسب|يناسب/.test(text)) return 'multi_intent';

  if (/مستحقاتي|حقوقي|خلاف عمالي|راتبي متاخر|شكوي.*شركه/.test(text)) return 'labor_dispute';
  if (/عامله منزليه|عامل منزلي|عماله منزليه|مساند/.test(text) && /عقد|موثق|توثيق/.test(text)) return 'domestic_worker';
  if (/خدمات الاعاقه|خدمات الإعاقه|خدمات الإعاقة/.test(message)) return 'disability_support';

  const delta = detectIncomeDelta(message);
  if (delta) return 'income_delta';

  if (employmentEnd.stage !== 'unknown' || employmentEnd.reason !== 'unknown') return 'employment_end';

  const jobStage = detectJobStage(message);
  const replacement = detectReplacement(message);
  if (jobStage !== 'unknown' || replacement !== null || /عرض|عقد جديد|وظيفه جديده|جاني شغل|شغل جديد|دوام جديد|الوظيفه الجديده/.test(text)) return 'new_job';
  if (/جاني راتب.*من وظيفه|راتب.*من وظيفه/.test(text)) return 'new_job';

  if (services.length) return 'service_question';
  if (/راتب|دخل|مرتب|يجيني.*بالشهر/.test(text)) return 'income_change';

  if (/اعاقه|تسهيلات مروريه|مواقف/.test(text)) return 'disability_support';
  if (/هلا|السلام|مرحبا|اهلين/.test(text)) return 'greeting';

  // Follow the active event only when the message genuinely looks like a continuation.
  const previousIntent = previousState.intent || null;
  if (previousIntent === 'new_job' && (/وافقت|رفضت|وقعت|باشرت|داومت|بديله|بكمل|ما راح اترك|طلبت.*تعديل|غيرت رايي/.test(text))) return 'new_job';
  if (previousIntent === 'employment_end' && (/استقلت|انتهي|انتهى|خلص|فصل|تراضي|قفلت/.test(text))) return 'employment_end';
  if (previousIntent === 'income_change' && (/^ايه|^نعم|^لا|راتب|دخل/.test(text))) return 'income_change';

  return 'general';
}

export function isAffirmative(message = '') {
  return YES_RE.test(normalizeArabic(message));
}

export function isNegative(message = '') {
  return NO_RE.test(normalizeArabic(message));
}

function inferProfileOverrides(message = '') {
  const text = normalizeArabic(message);
  const overrides = {};
  if (/انا طالب جامعه|انا طالب|ادرس في الجامعه/.test(text)) overrides.isStudentOrTrainee = true;
  if (/انا موظف|انا موظفه/.test(text)) overrides.employment = 'employed';
  if (/مو مسجل.*تامينات|مو مسجله.*تامينات|غير مسجل.*تامينات|غير مسجله.*تامينات/.test(text)) overrides.gosiRegistered = false;
  if (/عندي طفل عمره\s*[0-6]|طفلي عمره\s*[0-6]/.test(text)) overrides.childrenUnder6 = 1;
  if (/الضمان توقف عندي|توقف الضمان عندي|جاني غير موهل.*ضمان|جاني غير مؤهل.*ضمان/.test(text)) overrides.socialSecurityStoppedForIneligibility = true;
  return overrides;
}

function inferIncomeSource(message = '') {
  const text = normalizeArabic(message);
  if (/شغل حر|عمل حر|فريلانس|مشروع خاص/.test(text)) return 'self_employment';
  if (/من وظيفه|راتب.*وظيفه|راتب من العمل/.test(text)) return 'salary';
  return null;
}

export function extractDeterministicFacts(message = '', previousState = {}) {
  const normalized = normalizeArabic(message);
  const intent = detectIntent(message, previousState);
  const mode = detectMode(message);
  const money = extractMoney(message, { assumeThousands: ['new_job', 'income_change', 'income_delta'].includes(intent) });
  const delta = detectIncomeDelta(message);
  const jobStage = detectJobStage(message);
  const replacesCurrentJob = detectReplacement(message);
  const employmentEnd = detectEmploymentEnd(message);
  const targetServiceIds = serviceReferenceFromMessage(message, previousState);
  const incomeSource = inferIncomeSource(message);
  const profileOverrides = inferProfileOverrides(message);
  const accepted = /ما وافقت|ما قبلت|ما وقعت|رفضت|رفضته/.test(normalized) ? false : jobStage === 'accepted' ? true : null;
  const started = /ما باشرت|ما داومت|لم ابدا|ما بدات|ما بديت/.test(normalized) ? false : jobStage === 'started' ? true : null;

  let requiresClarification = null;
  if (intent === 'income_change' && money && /صار يجيني|يجيني.*بالشهر/.test(normalized) && !incomeSource) requiresClarification = 'income_source';
  if (intent === 'new_job' && /جاني راتب.*من وظيفه/.test(normalized) && jobStage === 'unknown') requiresClarification = 'job_stage';
  if (jobStage === 'ambiguous') requiresClarification = 'current_offer_status';

  return {
    normalized,
    intent,
    mode,
    money,
    delta: delta?.delta ?? null,
    jobStage,
    accepted,
    started,
    replacesCurrentJob,
    endStage: employmentEnd.stage,
    endReason: employmentEnd.reason,
    ended: employmentEnd.negated ? false : employmentEnd.stage === 'ended' ? true : null,
    targetServiceIds,
    incomeSource,
    profileOverrides,
    requiresClarification,
    negativeStart: started === false,
    confidence: money?.confidence || (intent === 'general' ? 0.35 : 0.92)
  };
}

export function applyDeterministicFacts(route, facts, { fieldHint = null } = {}) {
  const next = { ...route };
  if (!facts) return next;

  if (facts.intent && facts.intent !== 'general') next.intent = facts.intent;
  if (facts.mode && facts.mode !== 'knowledge') next.mode = facts.mode;
  if (facts.jobStage && facts.jobStage !== 'unknown') next.jobStage = facts.jobStage;
  if (facts.accepted !== null) next.accepted = facts.accepted;
  if (facts.started !== null) next.started = facts.started;
  if (facts.replacesCurrentJob !== null) next.replacesCurrentJob = facts.replacesCurrentJob;
  if (facts.endStage && facts.endStage !== 'unknown' && facts.endStage !== 'not_ended') next.endStage = facts.endStage;
  if (facts.endReason && facts.endReason !== 'unknown') next.endReason = facts.endReason;
  if (facts.ended !== null) next.ended = facts.ended;
  if (facts.delta !== null) next.delta = facts.delta;
  if (facts.incomeSource) next.incomeSource = facts.incomeSource;
  if (facts.requiresClarification) next.requiresClarification = facts.requiresClarification;
  if (facts.profileOverrides && Object.keys(facts.profileOverrides).length) next.profileOverrides = facts.profileOverrides;
  if (facts.targetServiceIds?.length) next.targetServiceIds = [...new Set(facts.targetServiceIds)];

  if (facts.money) {
    const field = fieldHint || (next.intent === 'new_job' ? 'salary' : ['income_change', 'income_delta'].includes(next.intent) ? 'income' : null);
    if (field) next[field] = facts.money.value;
    if (facts.money.needsConfirmation && field) next.pendingConfirmation = pendingAmountConfirmation(facts, field);
  }

  next.normalizedQuestion = facts.normalized || next.normalizedQuestion || '';

  next.refinement = {
    money: facts.money || null,
    normalized: facts.normalized,
    deterministicIntent: facts.intent,
    deterministicJobStage: facts.jobStage,
    delta: facts.delta,
    targetServiceIds: facts.targetServiceIds,
    requiresClarification: facts.requiresClarification
  };
  next.confidence = Math.max(Number(next.confidence || 0), Number(facts.confidence || 0));
  return next;
}

export function pendingAmountConfirmation(facts, field) {
  if (!facts?.money?.needsConfirmation || !field) return null;
  const value = facts.money.value;
  return {
    kind: 'amount',
    field,
    value,
    raw: facts.money.raw,
    confidence: facts.money.confidence,
    question: `تقصد ${new Intl.NumberFormat('en-US').format(value)} ريال؟`,
    quickReplies: [`نعم، ${new Intl.NumberFormat('en-US').format(value)} ريال`, 'لا، بكتب المبلغ كامل']
  };
}

export function referencedServiceId(previousState = {}) {
  return lastServiceId(previousState);
}
`````

## `src/retrieval.js`

`````text
import { services, serviceById, languageGlossary } from './knowledge.js';

const MAX_CANDIDATES = 5;

const STOP_WORDS = new Set([
  'في', 'من', 'على', 'عن', 'الى', 'هل', 'وش', 'ايش', 'انا', 'عندي', 'لي', 'هذا', 'هذه', 'هذي',
  'اذا', 'لو', 'بعد', 'قبل', 'حاليا', 'ممكن', 'ابي', 'ابغي', 'ابغى', 'اقدر', 'شي', 'شيء',
  'اللي', 'او', 'و', 'مع', 'بس', 'وشي', 'وشيء', 'قاعد', 'قاعده', 'صار', 'يصير'
]);

const DOMAIN_HINTS = [
  {
    phrases: ['ضمان', 'معاش', 'استحقاق', 'اهليه', 'اهلية', 'دعم اجتماعي', 'دخل الاسره', 'دخل الأسرة'],
    ids: ['social_security', 'social_security_objection']
  },
  {
    phrases: ['عقد', 'شركه', 'شركة', 'صاحب العمل', 'راتب', 'مستحقات', 'استقال', 'فصل', 'انهاء', 'إنهاء', 'انتهى', 'انتهاء'],
    ids: ['employment_contracts', 'contract_termination', 'labor_settlement', 'end_of_service_calculator']
  },
  {
    phrases: ['باحث عن عمل', 'ادور وظيفه', 'أدور وظيفة', 'حافز', 'تمهير', 'تدريب', 'دوره', 'دورات', 'مهارات', 'شهاده', 'شهادة', 'مسار مهني', 'تخصص'],
    ids: ['job_search_subsidy', 'tamheer', 'doroob', 'professional_certificates', 'career_guidance_sobol']
  },
  {
    phrases: ['اعاقه', 'إعاقة', 'مواقف', 'تسهيلات مروريه', 'تسهيلات مرورية'],
    ids: ['disability_evaluation', 'disability_financial_aid', 'traffic_facilities_certificate']
  },
  {
    phrases: ['عماله منزليه', 'عمالة منزلية', 'عامله منزليه', 'عاملة منزلية', 'عامل منزلي', 'مساند'],
    ids: ['domestic_worker_contract_documentation']
  },
  {
    phrases: ['كبار السن', 'كبير سن', 'بطاقه امتياز', 'بطاقة امتياز'],
    ids: ['senior_privilege_card']
  },
  {
    phrases: ['حضان', 'ضيافه اطفال', 'ضيافة أطفال', 'طفلي', 'طفل'],
    ids: ['qurra']
  },
  {
    phrases: ['نقل', 'مشاوير الدوام', 'مواصلات', 'اوبر', 'أوبر', 'كريم'],
    ids: ['wusool']
  }
];

function normalizeArabic(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  return [...new Set(normalizeArabic(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token)))];
}

function includesPhrase(haystack, phrase) {
  const normalizedPhrase = normalizeArabic(phrase);
  return normalizedPhrase.length > 1 && haystack.includes(normalizedPhrase);
}

function addScore(scores, id, amount, reason, strong = false) {
  if (!serviceById[id] || !amount) return;
  const current = scores.get(id) || { id, score: 0, reasons: [], strong: false };
  current.score += amount;
  if (reason && !current.reasons.includes(reason)) current.reasons.push(reason);
  current.strong = current.strong || strong;
  scores.set(id, current);
}

function profileRelevantBoost(profile, id) {
  if (!profile) return 0;

  if (id === 'social_security' && profile.socialSecurityBeneficiary === true) return 2;
  if (['employment_contracts', 'contract_termination', 'end_of_service_calculator'].includes(id) && profile.activeContract === true) return 1.5;
  if (id === 'job_search_subsidy' && profile.employment === 'job_seeker') return 1.5;
  if (['tamheer', 'doroob', 'career_guidance_sobol'].includes(id) && profile.employment === 'job_seeker') return 1;
  if (['disability_evaluation', 'disability_financial_aid', 'traffic_facilities_certificate'].includes(id) && profile.hasDisability === true) return 2;
  if (id === 'domestic_worker_contract_documentation' && Number(profile.domesticWorkers || 0) > 0) return 2;
  if (id === 'senior_privilege_card' && Number(profile.age || 0) >= 60) return 2;
  if (id === 'qurra' && profile.gender === 'female' && Number(profile.childrenUnder6 || 0) > 0) return 1.5;
  if (id === 'wusool' && (profile.gender === 'female' || profile.hasDisability === true)) return 1;
  return 0;
}

export function retrieveRelevantServices({ message, profile, previousState = {}, priorityIds = [], limit = MAX_CANDIDATES }) {
  const normalizedMessage = normalizeArabic(message);
  const queryTokens = tokens(message);
  const scores = new Map();

  for (const [serviceId, aliases] of Object.entries(languageGlossary.serviceAliases || {})) {
    for (const alias of aliases || []) {
      if (includesPhrase(normalizedMessage, alias)) {
        addScore(scores, serviceId, 26, `تطابق مع قاموس اللغة: ${alias}`, true);
        break;
      }
    }
  }

  for (const service of services) {
    const name = normalizeArabic(service.name);
    if (name && normalizedMessage.includes(name)) {
      addScore(scores, service.id, 30, 'اسم الخدمة مذكور مباشرة', true);
    }

    for (const trigger of service.triggerSignals || []) {
      if (includesPhrase(normalizedMessage, trigger)) {
        addScore(scores, service.id, 18, `تطابق مباشر مع إشارة: ${trigger}`, true);
      }
    }

    const nameTokens = tokens(service.name);
    const triggerTokens = tokens((service.triggerSignals || []).join(' '));
    const summaryTokens = tokens(service.summary || '');
    const audienceTokens = tokens((service.audience || []).join(' '));
    const sectorTokens = tokens(service.sector || '');

    const overlap = (list, weight) => {
      const set = new Set(list);
      for (const token of queryTokens) {
        if (set.has(token)) addScore(scores, service.id, weight, `تطابق كلمة: ${token}`);
      }
    };

    overlap(nameTokens, 5);
    overlap(triggerTokens, 3);
    overlap(audienceTokens, 1.5);
    overlap(sectorTokens, 1.25);
    overlap(summaryTokens, 0.6);
  }

  if (includesPhrase(normalizedMessage, 'مواقف') || includesPhrase(normalizedMessage, 'تسهيلات مروريه')) {
    addScore(scores, 'traffic_facilities_certificate', 22, 'وصف مباشر للتسهيلات المرورية أو المواقف', true);
  }

  if ((includesPhrase(normalizedMessage, 'اعانه') || includesPhrase(normalizedMessage, 'دعم مالي')) && includesPhrase(normalizedMessage, 'اعاقه')) {
    addScore(scores, 'disability_financial_aid', 22, 'وصف مباشر لإعانة مرتبطة بالإعاقة', true);
  }

  if (includesPhrase(normalizedMessage, 'تقييم') && includesPhrase(normalizedMessage, 'اعاقه')) {
    addScore(scores, 'disability_evaluation', 22, 'وصف مباشر لتقييم الإعاقة', true);
  }

  const laborDuesSignal = (includesPhrase(normalizedMessage, 'مستحقاتي') || includesPhrase(normalizedMessage, 'حقوقي'))
    && (includesPhrase(normalizedMessage, 'شركة') || includesPhrase(normalizedMessage, 'صاحب العمل') || includesPhrase(normalizedMessage, 'ما عطتني') || includesPhrase(normalizedMessage, 'ما عطوني'));
  if (laborDuesSignal) addScore(scores, 'labor_settlement', 22, 'وصف مباشر لخلاف على مستحقات العمل', true);

  for (const group of DOMAIN_HINTS) {
    const matched = group.phrases.some(phrase => includesPhrase(normalizedMessage, phrase));
    if (!matched) continue;
    for (const id of group.ids) addScore(scores, id, 4, 'تطابق مع مجال السؤال');
  }

  for (const id of previousState.targetServiceIds || []) addScore(scores, id, 3, 'امتداد لسياق الخدمة السابقة');

  const hasQuestionMatches = scores.size > 0;
  for (const id of priorityIds || []) {
    if (hasQuestionMatches) {
      if (scores.has(id)) addScore(scores, id, 0.75, 'مرتبطة بملف المستفيد');
    } else {
      addScore(scores, id, 0.75, 'مرتبطة بملف المستفيد');
    }
  }

  for (const service of services) {
    const boost = profileRelevantBoost(profile, service.id);
    if (boost > 0 && scores.has(service.id)) addScore(scores, service.id, boost, 'تعزيز من بيانات المستفيد');
  }

  const ranked = [...scores.values()]
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (!ranked.length) return [];

  const top = ranked[0];
  const threshold = top.strong
    ? Math.max(4, top.score * 0.12)
    : Math.max(1.5, top.score * 0.12);

  return ranked
    .filter(item => item.score >= threshold)
    .slice(0, Math.max(1, Math.min(Number(limit) || MAX_CANDIDATES, MAX_CANDIDATES)))
    .map(item => ({
      ...item,
      service: serviceById[item.id]
    }));
}

export function candidateCatalog(candidates = []) {
  return candidates.map(({ service, score, reasons, strong }) => ({
    id: service.id,
    name: service.name,
    sector: service.sector,
    summary: service.summary,
    triggerSignals: service.triggerSignals || [],
    decisionPolicy: service.decisionPolicy,
    retrieval: {
      score: Math.round(score * 10) / 10,
      strong,
      reasons: reasons.slice(0, 3)
    }
  }));
}

export function strongCandidateIds(candidates = []) {
  if (!candidates.length || !candidates[0].strong) return [];
  const top = candidates[0].score;
  return candidates
    .filter(item => item.strong && item.score >= top * 0.72)
    .slice(0, 2)
    .map(item => item.id);
}

export const retrievalInternals = { normalizeArabic, tokens };
`````

## `src/rules.js`

`````text
import { serviceById } from './knowledge.js';

export const SANED_SOURCE = {
  name: 'نظام التأمين ضد التعطل عن العمل ساند',
  sourceUrl: 'https://beta.gosi.gov.sa/ar/saned'
};

function knownMonthlyIncome(profile) {
  const value = Number(profile.totalMonthlyIncome ?? profile.salary ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function card({serviceId = null, type = 'info', tag, title, body, why, sourceUrl, sourceName, confidence = 'rule', usedData = [], unknowns = [], nextAction = '', relationship = null}) {
  const service = serviceId ? serviceById[serviceId] : null;
  return {
    serviceId,
    type,
    tag,
    title,
    body,
    why,
    sourceUrl: sourceUrl || service?.sourceUrl || null,
    sourceName: sourceName || service?.name || null,
    confidence,
    usedData,
    unknowns,
    nextAction,
    relationship
  };
}

function socialSecurityIncomeEffect(profile, oldIncome, newIncome, timing = 'future') {
  if (Number(oldIncome) === Number(newIncome)) {
    return card({
      type: 'neutral',
      tag: 'لا يوجد تغير',
      title: 'الدخل الجديد يساوي الدخل الحالي',
      body: 'ما دام الرقم لم يتغير، ما نعرض أثر جديد أو خدمة جديدة.',
      why: 'المحرك يسمح بنتيجة لا شيء بدل اختلاق أثر.'
    });
  }

  if (newIncome < oldIncome) {
    return card({
      serviceId: 'social_security',
      type: timing === 'current' ? 'positive' : 'potential',
      tag: timing === 'current' ? 'خدمة حالية قد يتغير مبلغها' : 'أثر محتمل عند حدوث التغيير',
      title: timing === 'current' ? 'قد يتغير مبلغ المعاش بعد انخفاض الدخل' : 'إذا بدأ الدخل الأقل فقد يتغير مبلغ المعاش',
      body: timing === 'current'
        ? `انخفض الدخل من ${oldIncome} إلى ${newIncome} ريال. من ناحية الدخل وحده، الانخفاض لا يجعل شرط الدخل أسوأ. مقدار المعاش قد يتغير بعد إعادة التقييم.`
        : `إذا أصبح الدخل ${newIncome} ريال بدلا من ${oldIncome} ريال بشكل فعلي، فقد يتغير مقدار المعاش بعد إعادة التقييم.`,
      why: 'الضمان يعتمد على الدخل المحتسب وبقية بيانات الأسرة والثروة والشروط الأخرى.'
    });
  }

  return card({
    serviceId: 'social_security',
    type: 'warning',
    tag: timing === 'current' ? 'خدمة حالية تحتاج مراجعة' : 'أثر محتمل عند حدوث التغيير',
    title: timing === 'current' ? 'ارتفاع الدخل قد يغير مبلغ المعاش أو يؤثر على الاستحقاق' : 'إذا بدأ الدخل الأعلى فقد يتغير مبلغ المعاش أو يتأثر الاستحقاق',
    body: timing === 'current'
      ? `ارتفع الدخل من ${oldIncome} إلى ${newIncome} ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.`
      : `إذا أصبح الدخل ${newIncome} ريال بدلا من ${oldIncome} ريال بشكل فعلي، فقد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.`,
    why: 'لا نصدر حكم أهلية نهائي من الراتب وحده لأن بقية دخل الأسرة والثروة والشروط الأخرى تدخل في الدراسة.'
  });
}


function jsaIncomeThreshold(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 2) return null;
  if (n >= 15) return 22800;
  return 6000 + ((n - 2) * 1200);
}

function jobSearchSubsidySignal(profile) {
  const age = Number(profile.age || 0);
  const baseChecks = [
    profile.nationality === 'saudi',
    profile.permanentResident === true,
    profile.ableToWork === true,
    profile.seriousJobSearch === true,
    age >= 20 && age <= 40,
    ['job_seeker', 'not_employed'].includes(profile.employment),
    profile.receivesPension === false,
    profile.receivesUnemploymentCompensation === false,
    profile.socialSecurityBeneficiary === false,
    profile.isStudentOrTrainee === false,
    profile.hasBusinessActivity === false
  ];

  if (!baseChecks.every(Boolean)) return null;

  const householdSize = Number(profile.jobSearchHouseholdSize || 0);
  const householdIncome = Number(profile.familyMonthlyIncomeForJsa);
  const threshold = jsaIncomeThreshold(householdSize);
  const incomeKnown = Number.isFinite(householdIncome) && threshold !== null;
  const incomePass = incomeKnown ? householdIncome <= threshold : null;

  if (incomePass === false) return null;

  return card({
    serviceId: 'job_search_subsidy',
    type: 'potential',
    tag: 'تطابق أولي يستحق التحقق',
    title: 'إعانة البحث عن عمل تستحق الفحص',
    body: incomeKnown
      ? `البيانات المعروفة تتوافق مع عدد من الشروط المنشورة، ودخل الأسرة التجريبي ${householdIncome} ريال يقع ضمن الحد المنشور لحجم الأسرة المستخدم في النموذج.`
      : 'البيانات المعروفة تتوافق مع عدد من الشروط الأساسية، لكن بيانات دخل الأسرة والثروة غير مكتملة في النموذج.',
    why: 'البرنامج يعتمد على مجموعة شروط تشمل العمر والعمل والدخل والثروة والتواريخ وسجل الاستفادة، لذلك صلة لا يحول التطابق الأولي إلى قرار أهلية.',
    usedData: [
      `العمر ${age}`,
      'باحث عن عمل',
      'لا معاش تقاعدي مسجل',
      'لا معاش ضمان مسجل',
      'لا نشاط تجاري مسجل في النموذج'
    ],
    unknowns: ['الثروة', 'التحقق الرسمي من التواريخ وسجل الاستفادة السابق']
  });
}

function tamheerSignal(profile) {
  const level = profile.educationLevel;
  const age = Number(profile.age || 0);
  const experience = Number(profile.previousWorkExperienceMonths);
  const qualifiedEducation = ['diploma', 'bachelor', 'master', 'phd'].includes(level);
  const experienceKnown = Number.isFinite(experience);

  if (
    profile.nationality !== 'saudi' ||
    age > 30 ||
    !qualifiedEducation ||
    !experienceKnown ||
    experience > 12 ||
    !['job_seeker', 'not_employed'].includes(profile.employment) ||
    profile.tamheerExcluded === true ||
    Number(profile.tamheerUsedMonths || 0) >= 6
  ) return null;

  return card({
    serviceId: 'tamheer',
    type: 'potential',
    tag: 'فرصة تدريب تستحق التحقق',
    title: 'تطوير الخريجين (تمهير) قريب من حالتك',
    body: 'العمر والمؤهل وحالة العمل والخبرة السابقة في بيانات النموذج تتوافق مع الشروط الأساسية المنشورة للبرنامج.',
    why: 'يبقى التحقق الرسمي من رصيد التدريب وحالة الاستبعاد والبيانات التعليمية في الأنظمة المصدرية.',
    usedData: [`العمر ${age}`, `الخبرة السابقة ${experience} شهر`, 'غير ملتحق بعمل حاليا', 'مؤهل جامعي مسجل في النموذج'],
    unknowns: ['التحقق الرسمي من رصيد التدريب وقائمة الاستبعاد']
  });
}

function doroobSignal(profile) {
  if (profile.nationality !== 'saudi') return null;
  return card({
    serviceId: 'doroob',
    type: 'info',
    tag: 'فرصة تطوير متاحة',
    title: 'دروب خيار متاح لتطوير المهارات',
    body: 'صفحة البرنامج تنص على أن أي مواطن أو مواطنة يمكنه التسجيل والالتحاق بالمحتوى التدريبي.',
    why: 'هذه توصية تطوير وليست قرار أهلية مالية.',
    usedData: ['الجنسية السعودية']
  });
}

function careerGuidanceSignal(profile) {
  if (!['job_seeker', 'not_employed'].includes(profile.employment)) return null;
  return card({
    serviceId: 'career_guidance_sobol',
    type: 'info',
    tag: 'قد يفيدك في رحلتك',
    title: 'الإرشاد المهني (سبل) مناسب لمرحلتك',
    body: 'البرنامج يخدم حديثي التخرج والباحثين عن عمل ضمن الفئات المستهدفة للإرشاد والتوجيه المهني.',
    why: 'حالة الباحث عن عمل تجعل الإرشاد المهني أكثر ارتباطا من عرض خدمة عامة غير مرتبطة بالسياق.',
    usedData: ['حالة البحث عن عمل']
  });
}

function quraSignal(profile) {
  const income = knownMonthlyIncome(profile);
  if (
    profile.nationality !== 'saudi' ||
    profile.gender !== 'female' ||
    profile.privateSectorEmployee !== true ||
    profile.gosiRegistered !== true ||
    income > 8000 ||
    Number(profile.childrenUnder6 || 0) < 1
  ) return null;

  return card({
    serviceId: 'qurra',
    type: 'potential',
    tag: 'خدمة تمكين تستحق التحقق',
    title: 'دعم ضيافة الأطفال (قرة) مرتبط بحالتك',
    body: 'بيانات النموذج تشير إلى عمل في القطاع الخاص وتسجيل في التأمينات وأجر لا يتجاوز 8000 ريال ووجود طفل ضمن العمر المستهدف.',
    why: 'هذه هي الإشارات الأساسية المنشورة للبرنامج، مع بقاء التحقق الرسمي من البيانات في الأنظمة المصدرية.',
    usedData: [`الأجر ${income} ريال`, 'موظفة قطاع خاص', 'مسجلة في التأمينات', `${profile.childrenUnder6} طفل ضمن الفئة العمرية في النموذج`],
    unknowns: ['التحقق الرسمي من عمر الطفل والأجر المسجل وحالة التسجيل']
  });
}

function wusoolSignal(profile) {
  const income = knownMonthlyIncome(profile);
  const age = Number(profile.age || 0);
  const gosiMonths = Number(profile.gosiMonthsLast5Years);
  const womanPath = profile.gender === 'female' && profile.privateSectorEmployee === true;
  const disabilityPath = profile.hasDisability === true && profile.privateSectorEmployee === true;

  if (
    profile.nationality !== 'saudi' ||
    age < 18 || age > 65 ||
    profile.gosiRegistered !== true ||
    income > 8000 ||
    !(womanPath || disabilityPath)
  ) return null;

  if (womanPath && Number.isFinite(gosiMonths) && gosiMonths > 36) return null;

  return card({
    serviceId: 'wusool',
    type: 'potential',
    tag: 'خدمة تمكين تستحق التحقق',
    title: 'دعم النقل (وصول) أصبح مرتبطا بالحالة',
    body: 'الفئة الوظيفية والأجر والتسجيل في التأمينات ضمن البيانات المعروفة تتوافق مع إشارات أساسية منشورة للبرنامج.',
    why: 'البرنامج له ضوابط إضافية وتحقق رسمي، لذلك لا نعرض النتيجة كقبول نهائي.',
    usedData: [`العمر ${age}`, `الأجر ${income} ريال`, 'مسجل في التأمينات', womanPath ? 'امرأة عاملة في القطاع الخاص' : 'عامل من ذوي الإعاقة في القطاع الخاص'],
    unknowns: ['التحقق الرسمي من مدد الاشتراك وبقية ضوابط المنتج']
  });
}

function hypotheticalNewOpportunities(profile, overrides = {}) {
  const before = opportunities(profile);
  const hypothetical = { ...profile, ...overrides };
  const after = opportunities(hypothetical);
  const beforeIds = new Set(before.map(item => item.serviceId).filter(Boolean));
  return after
    .filter(item => item.serviceId && !beforeIds.has(item.serviceId))
    .map(item => ({
      ...item,
      type: 'potential',
      tag: 'قد تظهر بسبب هذا التغيير',
      body: `في هذا السيناريو فقط: ${item.body}`,
      why: `${item.why} هذه النتيجة افتراضية ولا تغير بياناتك الحالية.`
    }));
}

export function currentServices(profile) {
  const results = [];

  if (profile.socialSecurityBeneficiary) {
    results.push(card({
      serviceId: 'social_security',
      type: 'current',
      tag: 'مرتبطة بك الآن',
      title: 'الضمان الاجتماعي ضمن حالتك الحالية',
      body: 'بيانات النموذج تشير إلى أنك مستفيد حاليا، لذلك تظهر الخدمة بدون ما تبحث عنها بالاسم.',
      why: 'الحالة الحالية للمستفيد مرتبطة بالخدمة مباشرة.'
    }));
  }

  if (profile.socialSecurityStoppedForIneligibility) {
    results.push(card({
      serviceId: 'social_security_objection',
      type: 'action',
      tag: 'قد تحتاج إجراء',
      title: 'اعتراض على إيقاف معاش الضمان',
      body: 'هذه الخدمة ترتبط بحالة إيقاف المعاش أو ظهور نتيجة عدم أهلية، وتسمح بمتابعة مسار الاعتراض عبر القناة الرسمية.',
      why: 'الاعتراض يظهر بسبب حالة الإيقاف أو عدم الأهلية، وليس لمجرد كون الضمان موجودا في الملف.'
    }));
  }

  if (profile.activeContract) {
    results.push(card({
      serviceId: 'employment_contracts',
      type: 'current',
      tag: 'مرتبطة بك الآن',
      title: 'عقدك الوظيفي جزء من ملفك الحالي',
      body: 'وجود عقد فعال يجعل إدارة العقود من الخدمات المرتبطة بوضعك الوظيفي.',
      why: 'صلة بدأت من حالة العقد في البيانات الحالية.'
    }));
  }

  if (profile.hasDisability && profile.disabilityEvaluationActive) {
    results.push(card({
      serviceId: 'disability_evaluation',
      type: 'current',
      tag: 'بيان أساسي في ملفك',
      title: 'تقييم الإعاقة ساري في النموذج',
      body: 'وجود تقييم ساري يفتح الباب لفحص خدمات أخرى مرتبطة بالإعاقة بدل طلب إثبات الحالة من جديد.',
      why: 'التقييم الساري متطلب مشترك لعدد من الخدمات.'
    }));
  }

  return results;
}

export function opportunities(profile) {
  const results = [];

  if (!profile.socialSecurityBeneficiary && profile.socialSecurityPreScreenSignal === true) {
    results.push(card({
      serviceId: 'social_security',
      type: 'potential',
      tag: 'يستحق التحقق',
      title: 'الضمان الاجتماعي يستحق فحصا أوليا',
      body: 'البيانات الحالية تعطي إشارة لبدء الفحص، لكن صلة لا يحول هذه الإشارة إلى قرار أهلية. يلزم فحص دخل الأسرة والثروة وبقية الشروط الرسمية.',
      why: 'في الإنتاج يفضل أن تأتي إشارة الفحص من البيانات وقواعد الأهلية المعتمدة، لا من حد راتب مبسط داخل الواجهة.'
    }));
  }

  if (profile.hasDisability && profile.disabilityEvaluationActive && profile.disabilityClassAidEligible) {
    const knownConditions = [
      knownMonthlyIncome(profile) <= 4000,
      profile.permanentResident === true,
      profile.institutionalCare === false,
      Number(profile.disabilityAgeAtOnset ?? 999) <= 60,
      Number(profile.monthsInStateFundedFacilityThisYear ?? 999) <= 6,
      profile.nationality === 'saudi'
    ];

    if (knownConditions.every(Boolean)) {
      results.push(card({
        serviceId: 'disability_financial_aid',
        type: 'potential',
        tag: 'بياناتك تعطي تطابقا قويا',
        title: 'الإعانة المالية للأشخاص ذوي الإعاقة تستحق التحقق',
        body: 'البيانات التجريبية المعروفة تحقق عددا من الشروط المنشورة، بما فيها التقييم الساري والدخل وعدم الإيواء والعمر وقت حدوث الإعاقة.',
        why: 'ما زالت النتيجة دعم قرار وليست قرار استحقاق رسمي.'
      }));
    }
  }

  if (profile.hasDisability && profile.disabilityEvaluationActive && profile.trafficFacilityEligible) {
    results.push(card({
      serviceId: 'traffic_facilities_certificate',
      type: 'potential',
      tag: 'قد تكون متاحة لك',
      title: 'الشهادة الرقمية للتسهيلات المرورية',
      body: 'التقييم الساري وتصنيف الإعاقة في بيانات النموذج يجعلان الخدمة مرتبطة بالحالة.',
      why: 'صفحة الخدمة تشترط تقييما ساريا وتصنيفا مؤهلا للخدمة.'
    }));
  }

  if (Number(profile.domesticWorkers || 0) > 0 && profile.domesticWorkerHasActiveMusanedContract === false) {
    results.push(card({
      serviceId: 'domestic_worker_contract_documentation',
      type: 'potential',
      tag: 'قد تحتاجها',
      title: 'توثيق عقد العمالة المنزلية',
      body: 'لديك عامل منزلي في بيانات النموذج ولا يوجد عقد سار في مساند، وهي الحالة الأساسية التي ترتبط بها الخدمة.',
      why: 'الخدمة تشترط عدم وجود عقد سار للعامل المنزلي داخل مساند.'
    }));
  }

  if (profile.nationality === 'saudi' && Number(profile.age || 0) >= 60) {
    results.push(card({
      serviceId: 'senior_privilege_card',
      type: 'potential',
      tag: 'مرتبطة ببياناتك',
      title: 'بطاقة امتياز لكبار السن مرتبطة بحالتك',
      body: profile.seniorPrivilegeCardIssued === true
        ? 'بيانات النموذج تشير إلى أن البطاقة صادرة، والعمر والجنسية يطابقان الشرطين المنشورين للخدمة.'
        : 'العمر والجنسية يطابقان الشرطين المنشورين، وصفحة الخدمة توضح أن البطاقة تمنح تلقائيا عند استيفائهما. لكن النموذج لا يحتوي تأكيدا أن البطاقة صدرت فعليا في حسابك.',
      why: 'صلة يفرق بين انطباق شروط منشورة وبين حالة إصدار الخدمة في النظام المصدر.',
      usedData: [`العمر ${profile.age}`, 'الجنسية السعودية'],
      unknowns: profile.seniorPrivilegeCardIssued == null ? ['حالة إصدار البطاقة فعليا في النظام المصدر'] : []
    }));
  }

  const ecosystemSignals = [
    jobSearchSubsidySignal(profile),
    tamheerSignal(profile),
    doroobSignal(profile),
    careerGuidanceSignal(profile),
    quraSignal(profile),
    wusoolSignal(profile)
  ].filter(Boolean);

  results.push(...ecosystemSignals);
  return results;
}


function relation({ current = 'not_current', availability = 'unknown', eligibility = 'not_assessed', relevance = 'informational' } = {}) {
  return { current, availability, eligibility, relevance };
}

function knownExclusions(items = []) {
  return items.filter(Boolean);
}

function socialSecurityDirectAssessment(profile, scenario = {}) {
  if (profile.socialSecurityBeneficiary) {
    return card({
      serviceId: 'social_security',
      type: 'current',
      tag: 'خدمة حالية',
      title: 'أنت مستفيد من الضمان في البيانات الحالية',
      body: 'الخدمة مرتبطة بملفك الحالي. أي تغير مؤثر في الدخل أو الأسرة قد يستدعي إعادة تقييم مقدار المعاش أو الاستحقاق بحسب بقية البيانات.',
      why: 'حالة الاستفادة الحالية معروفة في بيانات النموذج.',
      relationship: relation({ current: 'current_beneficiary', availability: 'current_service', eligibility: 'current_beneficiary', relevance: 'current' })
    });
  }

  const employmentEnding = ['planned', 'ended'].includes(scenario.endStage);
  const reportedOrFuture = employmentEnding
    ? 'انتهاء العلاقة الوظيفية قد يغير دخل الأسرة الفعلي، لذلك يصبح فحص الضمان أكثر ارتباطا بالحالة.'
    : 'عدم كونك مستفيدا حاليا لا يعني أن التسجيل غير متاح. التسجيل متاح لمن تنطبق عليهم شروط الاستحقاق، لكن الأهلية تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط.';

  const unknowns = ['الدخل المحتسب الكامل للأسرة', 'الثروة والأصول المؤثرة', 'بقية شروط الاستحقاق'];
  if (employmentEnding) unknowns.unshift('الدخل الفعلي بعد انتهاء العلاقة الوظيفية');

  return card({
    serviceId: 'social_security',
    type: employmentEnding ? 'potential' : 'info',
    tag: employmentEnding ? 'قد يصبح أقرب للفحص' : 'متاح للفحص عند انطباق الشروط',
    title: employmentEnding ? 'الضمان يستحق فحصا أدق إذا تغير دخلك فعليا' : 'عدم استفادتك الحالية لا يمنع فحص الضمان أو التقديم عليه',
    body: reportedOrFuture,
    why: 'صلة يفصل بين حالة التسجيل الحالية، وإمكانية التقديم، ونتيجة الأهلية. عدم التسجيل الحالي ليس سببا لرفض الخدمة.',
    usedData: [profile.employment === 'employed' ? 'الحالة الحالية: موظف' : `الحالة الحالية: ${profile.employment}`, `حجم الأسرة ${profile.familySize}`],
    unknowns,
    relationship: relation({ current: 'not_current_beneficiary', availability: 'application_available_if_conditions_met', eligibility: 'not_assessed', relevance: employmentEnding ? 'potential_future' : 'available_to_assess' })
  });
}

function jobSearchSubsidyDirectAssessment(profile) {
  const signal = jobSearchSubsidySignal(profile);
  if (signal) return {
    ...signal,
    relationship: relation({ current: 'not_known_as_current', availability: 'application_available', eligibility: 'preliminary_match', relevance: 'worth_checking' })
  };

  const exclusions = knownExclusions([
    profile.nationality !== 'saudi' ? 'الجنسية الحالية لا تطابق شرط الجنسية المنشور' : '',
    Number(profile.age || 0) < 20 || Number(profile.age || 0) > 40 ? 'العمر خارج النطاق المنشور 20 إلى 40 سنة' : '',
    profile.employment === 'employed' ? 'البيانات الحالية تشير إلى أنك موظف' : '',
    profile.receivesPension === true ? 'يوجد معاش تقاعدي في البيانات الحالية' : '',
    profile.receivesUnemploymentCompensation === true ? 'يوجد تعويض ضد التعطل في البيانات الحالية' : '',
    profile.socialSecurityBeneficiary === true ? 'يوجد معاش ضمان اجتماعي حالي في البيانات الحالية' : '',
    profile.isStudentOrTrainee === true ? 'البيانات الحالية تشير إلى دراسة أو تدريب' : '',
    profile.hasBusinessActivity === true ? 'يوجد نشاط تجاري في البيانات الحالية' : ''
  ]);

  return card({
    serviceId: 'job_search_subsidy',
    type: exclusions.length ? 'neutral' : 'info',
    tag: exclusions.length ? 'شرط معروف لا ينطبق حاليا' : 'يحتاج بيانات أكثر',
    title: exclusions.length ? 'إعانة البحث عن عمل لا تطابق الحالة الحالية بالكامل' : 'نقدر نفحص إعانة البحث عن عمل ببيانات أكثر',
    body: exclusions.length ? exclusions.join('، ') : 'الأهلية تعتمد على شروط متعددة تشمل العمل والعمر والدخل والثروة والتواريخ وسجل الاستفادة.',
    why: 'صلة يشرح الشرط المعروف ولا يحول عدم الاشتراك الحالي إلى عدم إمكانية التقديم.',
    unknowns: exclusions.length ? [] : ['دخل الأسرة والثروة', 'التواريخ وسجل الاستفادة السابق'],
    relationship: relation({ current: 'not_current', availability: 'application_available', eligibility: exclusions.length ? 'known_rule_not_met_currently' : 'not_assessed', relevance: exclusions.length ? 'not_currently_matching' : 'available_to_assess' })
  });
}

function tamheerDirectAssessment(profile) {
  const signal = tamheerSignal(profile);
  if (signal) return { ...signal, relationship: relation({ availability: 'application_available', eligibility: 'preliminary_match', relevance: 'worth_checking' }) };
  const exclusions = knownExclusions([
    profile.nationality !== 'saudi' ? 'الجنسية الحالية لا تطابق الشرط المنشور' : '',
    Number(profile.age || 0) > 30 ? 'العمر يتجاوز الحد المنشور للبرنامج' : '',
    profile.employment === 'employed' ? 'البيانات الحالية تشير إلى أنك ملتحق بعمل' : '',
    !['diploma', 'bachelor', 'master', 'phd'].includes(profile.educationLevel) && profile.educationLevel != null ? 'المؤهل المسجل لا يطابق الفئات التعليمية المنشورة' : '',
    Number.isFinite(Number(profile.previousWorkExperienceMonths)) && Number(profile.previousWorkExperienceMonths) > 12 ? 'الخبرة السابقة تتجاوز سنة في البيانات الحالية' : ''
  ]);
  return card({
    serviceId: 'tamheer', type: 'info',
    tag: exclusions.length ? 'لا يطابق الحالة الحالية بالكامل' : 'يحتاج بيانات أكثر',
    title: 'تمهير يحتاج فحص شروط الحالة الحالية',
    body: exclusions.length ? exclusions.join('، ') : 'نحتاج المؤهل والخبرة وحالة العمل ورصيد التدريب حتى نعطي تطابقا أوليا أدق.',
    why: 'عدم استخدام تمهير سابقا لا يعني القبول أو الرفض. الحكم يتبع الشروط المنشورة.',
    unknowns: exclusions.length ? [] : ['المؤهل', 'الخبرة السابقة', 'رصيد التدريب وحالة الاستبعاد'],
    relationship: relation({ availability: 'application_available', eligibility: exclusions.length ? 'known_rule_not_met_currently' : 'not_assessed', relevance: 'available_to_assess' })
  });
}

function qurraDirectAssessment(profile) {
  const signal = quraSignal(profile);
  if (signal) return { ...signal, relationship: relation({ availability: 'application_available', eligibility: 'preliminary_match', relevance: 'worth_checking' }) };
  const income = knownMonthlyIncome(profile);
  const exclusions = knownExclusions([
    profile.nationality !== 'saudi' ? 'الجنسية الحالية لا تطابق الشرط المنشور' : '',
    profile.gender !== 'female' ? 'المنتج موجه للمرأة العاملة' : '',
    profile.privateSectorEmployee !== true ? 'لا تظهر في البيانات الحالية حالة عمل بالقطاع الخاص' : '',
    profile.gosiRegistered !== true ? 'لا يظهر تسجيل حالي في التأمينات ضمن بيانات النموذج' : '',
    income > 8000 ? `الأجر المعروف ${income} ريال ويتجاوز الحد المنشور 8000 ريال` : '',
    Number(profile.childrenUnder6 || 0) < 1 ? 'لا يظهر طفل ضمن الفئة العمرية المستهدفة في بيانات النموذج' : ''
  ]);
  return card({
    serviceId: 'qurra', type: 'info', tag: exclusions.length ? 'شرط معروف لا ينطبق حاليا' : 'يحتاج تحقق',
    title: 'قرة تعتمد على حالة العمل والأجر وبيانات الطفل',
    body: exclusions.length ? exclusions.join('، ') : 'لا توجد معلومات كافية لحسم التطابق الأولي حاليا.',
    why: 'صلة يفرق بين عدم استخدام الخدمة وبين تحقق شروطها الحالية.',
    relationship: relation({ availability: 'application_available', eligibility: exclusions.length ? 'known_rule_not_met_currently' : 'not_assessed', relevance: 'available_to_assess' })
  });
}

function wusoolDirectAssessment(profile) {
  const signal = wusoolSignal(profile);
  if (signal) return { ...signal, relationship: relation({ availability: 'application_available', eligibility: 'preliminary_match', relevance: 'worth_checking' }) };
  const income = knownMonthlyIncome(profile);
  const age = Number(profile.age || 0);
  const exclusions = knownExclusions([
    profile.nationality !== 'saudi' ? 'الجنسية الحالية لا تطابق الشرط المنشور' : '',
    age < 18 || age > 65 ? 'العمر خارج النطاق المنشور للمنتج' : '',
    profile.gosiRegistered !== true ? 'لا يظهر تسجيل حالي في التأمينات ضمن بيانات النموذج' : '',
    income > 8000 ? `الأجر المعروف ${income} ريال ويتجاوز الحد المنشور 8000 ريال` : '',
    !(profile.gender === 'female' || profile.hasDisability === true) ? 'الحالة الحالية لا تطابق الفئات المستهدفة التي نمذجناها في صلة' : ''
  ]);
  return card({
    serviceId: 'wusool', type: 'info', tag: exclusions.length ? 'شرط معروف لا ينطبق حاليا' : 'يحتاج تحقق',
    title: 'وصول يعتمد على الفئة الوظيفية والأجر والتأمينات',
    body: exclusions.length ? exclusions.join('، ') : 'نحتاج بيانات إضافية قبل إعطاء تطابق أولي.',
    why: 'عدم التسجيل في وصول ليس سببا للحكم على الأهلية.',
    relationship: relation({ availability: 'application_available', eligibility: exclusions.length ? 'known_rule_not_met_currently' : 'not_assessed', relevance: 'available_to_assess' })
  });
}

function genericDirectAssessment(profile, serviceId, scenario = {}) {
  const service = serviceById[serviceId];
  if (!service) return null;

  const current = currentServices(profile).find(item => item.serviceId === serviceId);
  if (current) return { ...current, relationship: current.relationship || relation({ current: 'current', availability: 'current_service', eligibility: 'not_assessed', relevance: 'current' }) };

  const opportunity = opportunities(profile).find(item => item.serviceId === serviceId);
  if (opportunity) return { ...opportunity, relationship: opportunity.relationship || relation({ availability: 'application_or_service_available', eligibility: 'preliminary_match', relevance: 'worth_checking' }) };

  if (serviceId === 'social_security') return socialSecurityDirectAssessment(profile, scenario);
  if (serviceId === 'job_search_subsidy') return jobSearchSubsidyDirectAssessment(profile);
  if (serviceId === 'tamheer') return tamheerDirectAssessment(profile);
  if (serviceId === 'qurra') return qurraDirectAssessment(profile);
  if (serviceId === 'wusool') return wusoolDirectAssessment(profile);

  if (serviceId === 'social_security_objection') {
    return card({ serviceId, type: 'info', tag: 'غير منطبقة على الحالة الحالية', title: 'الاعتراض يرتبط بإيقاف معاش بسبب عدم الأهلية', body: 'لا توجد في بيانات النموذج الحالية حالة إيقاف معاش بسبب عدم الأهلية. إذا ظهرت هذه الحالة لاحقا تصبح الخدمة مرتبطة مباشرة.', why: 'عدم وجود سبب الاعتراض الآن مختلف عن عدم إتاحة الخدمة من الأساس.', relationship: relation({ availability: 'conditional_service', eligibility: 'not_applicable_current_state', relevance: 'event_driven' }) });
  }

  if (serviceId === 'contract_termination') {
    const active = profile.activeContract === true;
    return card({ serviceId, type: active ? 'action' : 'info', tag: active ? 'قد تكون خطوة مرتبطة بالحالة' : 'غير منطبقة على الحالة الحالية', title: active ? 'يمكن فحص مسار إنهاء العلاقة التعاقدية' : 'لا يوجد عقد فعال نربط به الإنهاء حاليا', body: active ? 'وجود عقد ساري يجعل الخدمة قابلة للفحص إذا كان هدفك إنهاء العلاقة، مع مراعاة وجود طلب إنهاء قائم وسبب الإنهاء.' : 'الخدمة مرتبطة بعقد ساري. عدم وجود عقد فعال حاليا هو سبب عدم ارتباطها بهذه اللحظة، وليس لأن الخدمة غير متاحة بشكل عام.', why: 'صلة يحكم على ارتباط الخدمة بالحالة الحالية لا على وجودها في الكتالوج.', relationship: relation({ availability: 'conditional_service', eligibility: active ? 'not_assessed' : 'not_applicable_current_state', relevance: active ? 'available_to_assess' : 'not_currently_relevant' }) });
  }

  if (serviceId === 'labor_settlement') {
    return card({ serviceId, type: profile.hasLaborDispute ? 'action' : 'info', tag: profile.hasLaborDispute ? 'مسار مرتبط بخلاف حالي' : 'تظهر عند وجود خلاف عمالي', title: 'التسوية الودية مرتبطة بوجود خلاف عمالي', body: profile.hasLaborDispute ? 'بيانات النموذج تشير إلى وجود خلاف عمالي، لذلك الخدمة تستحق النظر.' : 'ما عندنا إشارة لخلاف عمالي حالي في الملف. إذا عندك خلاف فعلي مع صاحب العمل اشرح موضوعه حتى نربطه بالمسار المناسب.', why: 'الخدمة لا تظهر لمجرد وجود علاقة عمل.', relationship: relation({ availability: 'conditional_service', eligibility: 'not_assessed', relevance: profile.hasLaborDispute ? 'current_action' : 'event_driven' }) });
  }

  if (serviceId === 'disability_evaluation') {
    const hasDisability = profile.hasDisability === true;
    return card({ serviceId, type: hasDisability ? 'potential' : 'info', tag: hasDisability ? 'مرتبطة بالحالة' : 'لا توجد إشارة حالية', title: hasDisability ? 'تقييم الإعاقة هو بوابة خدمات الإعاقة' : 'لا توجد إشارة إعاقة في بيانات الحالة الحالية', body: hasDisability ? (profile.disabilityEvaluationActive ? 'التقييم ساري بالفعل في بيانات النموذج.' : 'يمكن فحص مسار تسجيل أو تحديث تقييم الإعاقة بحسب حالة التقرير والبيانات.') : 'الخدمة موجودة في الكتالوج، لكنها لا تظهر كتوصية شخصية بدون إشارة مرتبطة بالإعاقة.', why: 'صلة يربط الخدمة بالحدث أو البيان الذي يجعلها ذات صلة.', relationship: relation({ availability: 'conditional_service', eligibility: 'not_assessed', relevance: hasDisability ? 'current_or_action' : 'not_currently_relevant' }) });
  }

  if (serviceId === 'disability_financial_aid' || serviceId === 'traffic_facilities_certificate') {
    const hasDisability = profile.hasDisability === true;
    return card({ serviceId, type: 'info', tag: hasDisability ? 'يحتاج فحص الشروط' : 'غير مرتبط بالحالة الحالية', title: service.name, body: hasDisability ? 'الخدمة تحتاج تقييم إعاقة ساري وتصنيفا أو شروطا أخرى بحسب الخدمة قبل إعطاء تطابق أولي.' : 'لا توجد إشارة إعاقة في بيانات الحالة الحالية، لذلك لا نعرض الخدمة كتوصية شخصية الآن.', why: service.decisionPolicy, unknowns: hasDisability ? service.requiredData || [] : [], relationship: relation({ availability: 'conditional_service', eligibility: 'not_assessed', relevance: hasDisability ? 'available_to_assess' : 'not_currently_relevant' }) });
  }

  if (serviceId === 'domestic_worker_contract_documentation') {
    const workers = Number(profile.domesticWorkers || 0);
    return card({ serviceId, type: 'info', tag: workers > 0 ? 'يحتاج فحص حالة العقد' : 'غير مرتبط بالحالة الحالية', title: service.name, body: workers > 0 ? 'يوجد عامل منزلي في البيانات، ونحتاج حالة العقد في مساند لتحديد ارتباط الخدمة بدقة.' : 'لا توجد عمالة منزلية في بيانات الحالة الحالية، لذلك لا تظهر الخدمة كتوصية شخصية الآن.', why: service.decisionPolicy, relationship: relation({ availability: 'conditional_service', eligibility: 'not_assessed', relevance: workers > 0 ? 'available_to_assess' : 'not_currently_relevant' }) });
  }

  if (serviceId === 'senior_privilege_card') {
    const age = Number(profile.age || 0);
    const saudi = profile.nationality === 'saudi';
    const match = saudi && age >= 60;
    return card({ serviceId, type: match ? 'potential' : 'info', tag: match ? 'الشروط المنشورة المعروفة متحققة' : 'الشروط المعروفة لا تكتمل حاليا', title: service.name, body: match ? 'العمر والجنسية يطابقان الشرطين المنشورين، لكن حالة إصدار البطاقة تحتاج بيانات من النظام المصدر.' : `العمر الحالي ${age} سنة، والجنسية ${saudi ? 'سعودية' : 'غير سعودية'} في بيانات النموذج.`, why: service.decisionPolicy, unknowns: match && profile.seniorPrivilegeCardIssued == null ? ['حالة إصدار البطاقة في النظام المصدر'] : [], relationship: relation({ availability: 'automatic_when_conditions_met', eligibility: match ? 'known_conditions_match' : 'known_rule_not_met_currently', relevance: match ? 'worth_checking' : 'not_currently_matching' }) });
  }

  if (serviceId === 'doroob') {
    const saudi = profile.nationality === 'saudi';
    return card({ serviceId, type: saudi ? 'info' : 'neutral', tag: saudi ? 'فرصة تطوير متاحة' : 'شرط معروف لا ينطبق حاليا', title: service.name, body: saudi ? 'الجنسية السعودية في البيانات الحالية تكفي لعرض دروب كفرصة تطوير عامة، بينما المسارات أو التمويل المتخصص لها ضوابطها.' : 'الشرط المنشور الذي نمذجناه هنا هو أن التسجيل متاح للمواطنين والمواطنات.', why: service.decisionPolicy, relationship: relation({ availability: saudi ? 'available' : 'conditional_service', eligibility: saudi ? 'known_basic_condition_match' : 'known_rule_not_met_currently', relevance: saudi ? 'available' : 'not_currently_matching' }) });
  }

  if (serviceId === 'professional_certificates') {
    return card({ serviceId, type: 'info', tag: 'يحتاج تفاصيل عن الشهادة', title: service.name, body: 'نحتاج اسم الشهادة أو الرخصة، اعتمادها، تاريخ الحصول عليها، من دفع تكلفتها، وعدد مرات الاستفادة قبل فحص الدعم.', why: service.decisionPolicy, unknowns: service.requiredData || [], relationship: relation({ availability: 'application_available', eligibility: 'insufficient_data', relevance: 'available_to_assess' }) });
  }

  if (serviceId === 'career_guidance_sobol') {
    const relevant = ['job_seeker', 'not_employed'].includes(profile.employment);
    return card({ serviceId, type: 'info', tag: relevant ? 'مرتبط بمرحلتك' : 'خدمة إرشاد متاحة حسب الحاجة', title: service.name, body: relevant ? 'حالة البحث عن عمل تجعل الإرشاد المهني مرتبطا مباشرة بمرحلتك.' : 'الخدمة مرتبطة بالاستكشاف والتوجيه المهني، وتظهر عندما يكون السؤال عن المسار أو التطوير حتى لو لم تكن إعانة مالية.', why: service.decisionPolicy, relationship: relation({ availability: 'available', eligibility: 'not_financial_eligibility', relevance: relevant ? 'worth_checking' : 'on_demand' }) });
  }

  return card({
    serviceId, type: 'info', tag: 'فحص خدمة', title: service.name, body: service.summary, why: service.decisionPolicy, unknowns: service.requiredData || [],
    relationship: relation({ availability: 'conditional_or_available', eligibility: 'not_assessed', relevance: 'on_demand' })
  });
}

export function changesFor(profile) {
  return (profile.lastChanges || []).map(change => ({
    ...change,
    interpretation: change.field === 'salary'
      ? 'تغير الدخل قد يحتاج إعادة تقييم للخدمات المرتبطة بالدخل'
      : change.field === 'contract'
        ? 'تغير حالة العقد قد يغير الخدمات والإجراءات المرتبطة بالعمل'
        : change.field === 'disabilityEvaluation'
          ? 'صلاحية التقييم قد تفتح خدمات مرتبطة بالإعاقة'
          : change.field === 'ageEligibility'
            ? 'العمر قد يجعل خدمات كبار السن تظهر استباقيا'
            : 'تغير في بيانات الملف'
  }));
}

export function analyzeIncome(profile, newIncome, timing = 'future') {
  const value = Number(newIncome);
  if (!Number.isFinite(value) || value < 0) {
    return {
      needsClarification: true,
      question: 'كم الدخل الجديد تقريبا بالريال؟',
      results: []
    };
  }

  const results = [];

  if (profile.socialSecurityBeneficiary) {
    results.push(socialSecurityIncomeEffect(profile, Number(profile.salary || 0), value, timing));

    if (timing === 'current' && value !== Number(profile.salary || 0)) {
      results.push(card({
        serviceId: 'social_security',
        type: 'action',
        tag: 'إذا كان التغير مؤثرا',
        title: 'قد يلزم إبلاغ الوزارة عن التغير',
        body: 'النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.',
        why: 'هذا الإجراء مرتبط بتغير فعلي مؤثر، وليس بمحاكاة افتراضية.'
      }));
    }

    return { needsClarification: false, results };
  }

  if (value < Number(profile.salary || 0)) {
    results.push(card({
      type: 'neutral',
      tag: 'التغير وحده غير كاف',
      title: 'انخفاض الراتب لا يكفي وحده لربطك بالضمان',
      body: 'نقدر نبدأ فحص الضمان إذا كانت بيانات دخل الأسرة والثروة وبقية الشروط متاحة، لكن ما نحول انخفاض الراتب وحده إلى توصية أهلية.',
      why: 'الضمان يعتمد على الدخل المحتسب للأسرة ومعايير أخرى، لذلك نتجنب حد دخل مبسط داخل صلة.'
    }));
  } else if (value > Number(profile.salary || 0)) {
    results.push(card({
      type: 'neutral',
      tag: 'لا خدمة جديدة من هذا التغير وحده',
      title: 'ارتفاع الدخل وحده لم ينتج مسارا جديدا',
      body: 'صلة لا يملأ الشاشة بخدمات غير مرتبطة بمجرد تغير رقم.',
      why: 'الهدف هو الصلة بالحالة، وليس زيادة عدد النتائج.'
    }));
  } else {
    results.push(card({
      type: 'neutral',
      tag: 'لا يوجد تغير',
      title: 'الدخل الافتراضي يساوي الدخل الحالي',
      body: 'ما في أثر جديد نحسبه.',
      why: 'لا يوجد انتقال حالة.'
    }));
  }

  const newOpportunities = hypotheticalNewOpportunities(profile, { salary: value, totalMonthlyIncome: value });
  results.push(...newOpportunities);

  return { needsClarification: false, results };
}

export function analyzeNewJob(profile, scenario) {
  const stage = scenario.jobStage || 'unknown';
  const salary = Number(scenario.salary);
  const replacement = scenario.replacesCurrentJob;

  if (stage === 'ambiguous') {
    return {
      needsClarification: true,
      question: 'بعد ما غيرت رأيك، وش وضع العرض الآن؟ ما زال مقبولا من جهتك، أو تراجعت عنه؟',
      quickReplies: ['ما زال مقبولا', 'تراجعت عنه'],
      results: []
    };
  }

  if (stage === 'rejected') {
    return {
      needsClarification: false,
      results: [card({
        serviceId: 'employment_contracts',
        type: 'neutral',
        tag: 'لا تغير فعلي',
        title: 'رفض العرض لا يغير حالتك الحالية',
        body: 'بما أنك رفضت العرض، ما نعامل راتبه كدخل جديد ولا نشغل آثار وظيفة لم تبدأ.',
        why: 'العرض المرفوض لا ينتقل إلى حالة عقد أو دخل فعلي.'
      })]
    };
  }

  if (stage === 'modification_requested') {
    return {
      needsClarification: false,
      results: [card({
        serviceId: 'employment_contracts',
        type: 'neutral',
        tag: 'العرض ما زال قيد التعديل',
        title: 'طلب التعديل لا يعني قبول العرض',
        body: 'ما دام العرض قيد التعديل، ما نعتبر الراتب الجديد دخلا فعليا ولا نغير حالتك الوظيفية.',
        why: 'طلب التعديل مرحلة مستقلة عن الموافقة والتوثيق والمباشرة.'
      })]
    };
  }

  if (stage === 'reviewing') {
    return {
      needsClarification: false,
      results: [card({
        serviceId: 'employment_contracts',
        type: 'neutral',
        tag: 'لا تغير فعلي حتى الآن',
        title: 'العرض ما زال تحت المراجعة',
        body: Number.isFinite(salary) && salary > 0
          ? `العرض بقيمة ${salary} ريال، لكن ما دام ما تم قبوله أو بدء العمل، ما يتغير دخلك الحالي ولا حالة الضمان.`
          : 'وصول العرض وحده لا يغير دخلك الحالي ولا حالة الضمان.',
        why: 'مرحلة العرض مختلفة عن الموافقة والتوثيق والمباشرة.'
      })]
    };
  }

  if (stage === 'unknown') {
    return {
      needsClarification: true,
      question: 'وش مرحلة الوظيفة الجديدة الآن؟ وصلت لك للمراجعة، طلبت تعديلها، وافقت من جهتك، تم توثيقها، أو بدأت العمل فعليا؟',
      quickReplies: ['وصلتني وأراجعها', 'طلبت تعديلها', 'وافقت من جهتي', 'تم توثيقها', 'بدأت العمل'],
      results: []
    };
  }

  if (!Number.isFinite(salary) || salary <= 0) {
    return { needsClarification: true, question: 'كم الراتب في العرض أو الوظيفة الجديدة؟', results: [] };
  }

  if (profile.activeContract && replacement === null && ['accepted', 'documented', 'started'].includes(stage)) {
    return {
      needsClarification: true,
      question: 'هل الوظيفة الجديدة بديلة عن وظيفتك الحالية، أو أن عقدك الحالي سيبقى قائما؟',
      quickReplies: ['بديلة عن وظيفتي الحالية', 'عقدي الحالي سيبقى'],
      results: []
    };
  }

  const results = [];
  const started = stage === 'started';
  const acceptedOrLater = ['accepted', 'documented', 'started'].includes(stage);

  if (stage === 'accepted') {
    results.push(card({
      serviceId: 'employment_contracts',
      type: 'potential',
      tag: 'قرار اتخذته لكنه لم يصبح دخلا فعليا',
      title: 'وافقت من جهتك، لكن الراتب الجديد لم يبدأ بعد',
      body: 'الموافقة من الموظف ليست هي نفس بدء العمل أو بدء الدخل.',
      why: 'نفصل بين قبول العرض وبين بدء العلاقة والدخل فعليا.'
    }));
  }

  if (stage === 'documented') {
    results.push(card({
      serviceId: 'employment_contracts',
      type: 'potential',
      tag: 'العقد موثق في السيناريو',
      title: 'التوثيق لا يعني أن الراتب بدأ فعليا',
      body: 'يمكن عرض الآثار المستقبلية قبل المباشرة، لكن لا نكتب الراتب الجديد على الحالة الحالية حتى يبدأ العمل.',
      why: 'نفصل بين حالة العقد وحالة الدخل.'
    }));
  }

  if (started) {
    results.push(card({
      serviceId: 'employment_contracts',
      type: 'current',
      tag: 'تغير فعلي في السيناريو',
      title: `بدأ الدخل الجديد بقيمة ${salary} ريال`,
      body: 'هنا فقط نعامل الراتب الجديد كدخل فعلي داخل السيناريو.',
      why: 'المباشرة الفعلية هي لحظة تغير الحالة التشغيلية.'
    }));
  }

  if (profile.activeContract && replacement === false) {
    results.push(card({
      serviceId: 'employment_contracts',
      type: 'warning',
      tag: 'حالة مركبة تحتاج تحقق',
      title: 'العقد الحالي سيبقى قائما',
      body: 'ما نفترض أن الراتب الجديد استبدل القديم. نحتاج فهم وضع العقدين والدخل الفعلي قبل نتيجة أدق.',
      why: 'وجود أكثر من علاقة أو عقد محتمل يحتاج بيانات تشغيلية أدق قبل حساب الأثر.'
    }));
  }

  if (profile.socialSecurityBeneficiary && acceptedOrLater) {
    if (replacement === false) {
      results.push(card({
        serviceId: 'social_security',
        type: started ? 'warning' : 'potential',
        tag: started ? 'خدمة حالية تحتاج مراجعة' : 'أثر محتمل عند بدء الدخل',
        title: started ? 'الدخل الجديد مع استمرار الحالي قد يؤثر على الضمان' : 'إذا بدأ الدخل الجديد مع استمرار الحالي فقد يتأثر الضمان',
        body: 'نحتاج الدخل الإجمالي الفعلي وبقية بيانات الأسرة قبل تقدير أدق.',
        why: 'لا نفترض أن الراتب الجديد بديل عن القديم.'
      }));
    } else {
      results.push(socialSecurityIncomeEffect(profile, Number(profile.salary || 0), salary, started ? 'current' : 'future'));
    }
  }

  if (started && profile.employment === 'job_seeker') {
    results.push(card({
      type: 'current',
      tag: 'تغير في الحالة',
      title: 'الحالة الوظيفية تغيرت في هذا السيناريو',
      body: 'بعد بدء العمل فعليا لم يعد السيناريو يمثل باحثا عن عمل بلا وظيفة.',
      why: 'القرار أو العرض وحده لا يغير الحالة.'
    }));
  }

  return { needsClarification: false, results };
}

export function analyzeEmploymentEnd(profile, scenario) {
  const stage = scenario.endStage || 'unknown';
  const reason = scenario.endReason || 'unknown';

  if (!profile.activeContract && stage !== 'ended') {
    return {
      needsClarification: false,
      results: [card({
        type: 'neutral',
        tag: 'الرحلة غير منطبقة',
        title: 'لا يوجد عقد فعال في البيانات الحالية',
        body: 'صلة يوقف رحلة إنهاء عقد غير موجود بدل بناء نتائج على افتراض خاطئ.',
        why: 'أصل الحدث غير مناسب للحالة الحالية.'
      })]
    };
  }

  if (stage === 'unknown') {
    return {
      needsClarification: true,
      question: 'هل العلاقة ستنتهي ولم تنته بعد، أو انتهت فعليا؟',
      quickReplies: ['ستنتهي قريبا', 'انتهت فعليا'],
      results: []
    };
  }

  if (reason === 'unknown') {
    return {
      needsClarification: true,
      question: 'وش سبب انتهاء العلاقة؟',
      quickReplies: ['انتهاء مدة العقد', 'استقالة', 'إنهاء من صاحب العمل', 'انتهاء نشاط المنشأة', 'سبب آخر'],
      results: []
    };
  }

  const ended = stage === 'ended';
  const results = [];

  if (!ended && profile.activeContract) {
    results.push(card({
      serviceId: 'contract_termination',
      type: 'action',
      tag: 'مسار تنفيذي محتمل',
      title: 'إنهاء العلاقة التعاقدية قد يكون المسار الأقرب',
      body: 'الخدمة ترتبط بوجود عقد ساري، ثم يحدد سبب الإنهاء وتاريخه.',
      why: 'لا نعرضها كخطوة حالية بعد أن تكون العلاقة انتهت فعليا.'
    }));
  }

  results.push(card({
    serviceId: 'end_of_service_calculator',
    type: 'potential',
    tag: ended ? 'بعد انتهاء العلاقة' : 'عند انتهاء العلاقة',
    title: 'حاسبة مكافأة نهاية الخدمة قد تساعدك',
    body: 'الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة.',
    why: 'صلة يوجه للأداة الرسمية بدل اختراع مبلغ تقديري من بيانات ناقصة.'
  }));

  if (ended && ['fixed_expiry', 'business_closed', 'employer_termination'].includes(reason) && profile.nationality === 'saudi') {
    results.push(card({
      type: 'potential',
      tag: 'مسار خارجي يستحق التحقق',
      title: 'ساند قد يستحق التحقق',
      body: 'ساند مرتبط بفقدان العمل لسبب خارج عن إرادة العامل مع تحقق بقية الشروط النظامية.',
      why: 'لا نعرضه كأهلية مؤكدة لأن مدد الاشتراك والدخل من عمل آخر وبقية الشروط غير معروفة.',
      sourceUrl: SANED_SOURCE.sourceUrl,
      sourceName: SANED_SOURCE.name
    }));
  }

  if (reason === 'resignation') {
    results.push(card({
      type: 'neutral',
      tag: 'تم استبعاد مسار',
      title: 'لا نظهر ساند في سيناريو الاستقالة',
      body: 'ساند يشترط ألا يكون المشترك قد ترك العمل بمحض إرادته.',
      why: 'سبب الانتهاء هنا يستبعد هذا المسار.',
      sourceUrl: SANED_SOURCE.sourceUrl,
      sourceName: SANED_SOURCE.name
    }));
  }

  if (profile.socialSecurityBeneficiary) {
    results.push(card({
      serviceId: 'social_security',
      type: ended ? 'positive' : 'potential',
      tag: ended ? 'خدمة حالية قد يتغير مبلغها' : 'أثر محتمل بعد التوقف الفعلي للدخل',
      title: ended ? 'بعد توقف الراتب قد يتغير مبلغ المعاش' : 'إذا توقف الراتب فعليا فقد يتغير مبلغ المعاش',
      body: ended
        ? 'انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.'
        : 'الدخل ما زال قائما في هذه المرحلة، لذلك نعرض الأثر كمستقبل محتمل فقط.',
      why: 'صلة يفرق بين حدث مخطط له وتغير أصبح نافذا.'
    }));
  }

  return { needsClarification: false, results };
}

export function laborDispute(profile, topic = '') {
  return {
    needsClarification: false,
    results: [card({
      serviceId: 'labor_settlement',
      type: 'action',
      tag: 'مسار مرتبط بالخلاف العمالي',
      title: 'التسوية الودية تستحق النظر',
      body: topic
        ? `وصفت الخلاف بأنه: ${topic}. الخدمة هي المرحلة الأولى للنظر في دعاوى الخلافات العمالية ومحاولة الوصول إلى حل ودي.`
        : 'إذا كان لديك خلاف عمالي مع صاحب العمل، فالتسوية الودية هي المرحلة الأولى للنظر في الدعوى ومحاولة الوصول إلى حل ودي.',
      why: 'الخدمة تتطلب وجود علاقة عمل أو ما يثبتها، والمستندات تختلف بحسب موضوع الدعوى.'
    })]
  };
}

export function evaluateSpecificServices(profile, ids, scenario = {}) {
  const wanted = [...new Set(ids || [])].filter(id => Boolean(serviceById[id]));
  const effectiveProfile = {
    ...profile,
    ...(scenario.profileOverrides || {})
  };
  if (scenario.mode === 'what_if' && Number.isFinite(Number(scenario.income))) {
    effectiveProfile.salary = Number(scenario.income);
    effectiveProfile.totalMonthlyIncome = Number(scenario.income);
  }
  return wanted
    .map(id => genericDirectAssessment(effectiveProfile, id, scenario))
    .filter(Boolean);
}

export function evaluateIntent(profile, intent, scenario = {}) {
  switch (intent) {
    case 'current_services':
      return { needsClarification: false, results: [...currentServices(profile), ...opportunities(profile)] };
    case 'eligible_services':
      return { needsClarification: false, results: opportunities(profile) };
    case 'status_summary':
      return { needsClarification: false, results: [], changes: [] };
    case 'attention_summary':
      return { needsClarification: false, results: [...currentServices(profile), ...opportunities(profile)].slice(0, 5), changes: changesFor(profile).slice(0, 3) };
    case 'what_changed':
      return { needsClarification: false, changes: changesFor(profile), results: [] };
    case 'income_change':
      return analyzeIncome(profile, scenario.income, scenario.mode === 'reported' ? 'current' : 'future');
    case 'income_delta': {
      const base = Number(profile.totalMonthlyIncome ?? profile.salary ?? 0);
      const delta = Number(scenario.delta);
      if (!Number.isFinite(delta)) return { needsClarification: true, question: 'كم مقدار الزيادة أو الانخفاض بالريال؟', results: [] };
      return analyzeIncome(profile, Math.max(0, base + delta), scenario.mode === 'reported' ? 'current' : 'future');
    }
    case 'new_job':
      return analyzeNewJob(profile, scenario);
    case 'employment_end':
      return analyzeEmploymentEnd(profile, scenario);
    case 'employment_end_negated':
      return { needsClarification: false, results: [] };
    case 'labor_dispute':
      return laborDispute(profile, scenario.laborDisputeTopic || '');
    case 'service_question':
    case 'eligibility_confirmation':
    case 'service_application_question':
    case 'service_status_question':
    case 'explain_result':
    case 'explain_effect':
    case 'benefit_amount_question':
    case 'social_security_impact':
      return { needsClarification: false, results: evaluateSpecificServices(profile, scenario.targetServiceIds || [], scenario) };
    case 'multi_intent': {
      const endScenario = { ...scenario, endStage: scenario.endStage === 'unknown' ? 'planned' : scenario.endStage };
      const end = analyzeEmploymentEnd(profile, endScenario);
      const social = evaluateSpecificServices(profile, ['social_security'], endScenario);
      return { needsClarification: false, results: [...(end.results || []), ...social] };
    }
    case 'disability_support': {
      const ids = scenario.targetServiceIds?.length ? scenario.targetServiceIds : ['disability_evaluation', 'disability_financial_aid', 'traffic_facilities_certificate'];
      return { needsClarification: false, results: evaluateSpecificServices(profile, ids, scenario) };
    }
    case 'domestic_worker': {
      const ids = scenario.targetServiceIds?.length ? scenario.targetServiceIds : ['domestic_worker_contract_documentation'];
      return { needsClarification: false, results: evaluateSpecificServices(profile, ids, scenario) };
    }
    default:
      return { needsClarification: false, results: [] };
  }
}
`````

## `tests/ai.test.js`

`````text
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
`````

## `tests/architecture.test.js`

`````text
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
`````

## `tests/gold100.json`

`````text
[
  {
    "id": 1,
    "persona": "khalid",
    "category": "اكتشاف الخدمات",
    "message": "وش الخدمات اللي تخصني؟",
    "expected": {
      "intent": "current_services"
    }
  },
  {
    "id": 2,
    "persona": "salman",
    "category": "اكتشاف الخدمات",
    "message": "وش الخدمات اللي اقدر استفيد منها؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 3,
    "persona": "reem",
    "category": "ملخص الحالة",
    "message": "وش وضعي الحالي؟",
    "expected": {
      "intent": "status_summary"
    }
  },
  {
    "id": 4,
    "persona": "khalid",
    "category": "التغييرات",
    "message": "وش تغير في بياناتي؟",
    "expected": {
      "intent": "what_changed"
    }
  },
  {
    "id": 5,
    "persona": "noura",
    "category": "ملخص الحالة",
    "message": "وش تعرف عني؟",
    "expected": {
      "intent": "status_summary"
    }
  },
  {
    "id": 6,
    "persona": "saleh",
    "category": "اكتشاف الخدمات",
    "message": "وش ممكن يفيدني الحين؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 7,
    "persona": "salman",
    "category": "اكتشاف الخدمات",
    "message": "انا عاطل وادور وظيفة، وش الأشياء اللي ممكن تساعدني؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 8,
    "persona": "reem",
    "category": "الخدمات الحالية",
    "message": "وش عندي خدمات حاليا؟",
    "expected": {
      "intent": "current_services"
    }
  },
  {
    "id": 9,
    "persona": "khalid",
    "category": "التنبيهات",
    "message": "هل فيه شيء يحتاج انتباهي؟",
    "expected": {
      "intent": "attention_summary"
    }
  },
  {
    "id": 10,
    "persona": "saleh",
    "category": "التغييرات",
    "message": "ورني آخر التحديثات",
    "expected": {
      "intent": "what_changed"
    }
  },
  {
    "id": 11,
    "persona": "salman",
    "category": "تأكيد الأهلية",
    "message": "يعني انا مؤهل اكيد؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 12,
    "persona": "salman",
    "category": "تأكيد الأهلية",
    "message": "طيب تنطبق علي؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 13,
    "persona": "salman",
    "category": "شرح نتيجة",
    "message": "ليش ظهرت لي إعانة البحث عن عمل؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 14,
    "persona": "saleh",
    "category": "شرح نتيجة",
    "message": "ليش جتني بطاقة كبار السن؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "senior_privilege_card"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "senior_privilege_card",
          "title": "بطاقة امتياز لكبار السن",
          "why": "العمر والجنسية",
          "unknowns": [
            "حالة الإصدار الفعلية"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 15,
    "persona": "saleh",
    "category": "حالة خدمة",
    "message": "هل البطاقة صدرت لي فعلا؟",
    "expected": {
      "intent": "service_status_question",
      "targetServiceId": "senior_privilege_card"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "senior_privilege_card",
          "title": "بطاقة امتياز لكبار السن",
          "why": "العمر والجنسية",
          "unknowns": [
            "حالة الإصدار الفعلية"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 16,
    "persona": "reem",
    "category": "سؤال خدمة",
    "message": "هل وصول يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool"
    }
  },
  {
    "id": 17,
    "persona": "reem",
    "category": "التقديم على خدمة",
    "message": "طيب اقدر اقدم عليه؟",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "wusool"
    },
    "previousState": {
      "intent": "service_question",
      "targetServiceIds": [
        "wusool"
      ],
      "lastResults": [
        {
          "serviceId": "wusool",
          "title": "دعم النقل وصول",
          "why": "بيانات مرتبطة",
          "unknowns": []
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 18,
    "persona": "noura",
    "category": "تأكيد الأهلية",
    "message": "انا مؤهلة للاعانة أكيد؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "disability_financial_aid"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "disability_financial_aid",
          "title": "الإعانة المالية للأشخاص ذوي الإعاقة",
          "why": "تقييم الإعاقة والدخل",
          "unknowns": [
            "التحقق الرسمي"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 19,
    "persona": "khalid",
    "category": "شرح أثر",
    "message": "ليش الضمان ممكن يتأثر؟",
    "expected": {
      "intent": "explain_effect",
      "targetServiceId": "social_security"
    },
    "previousState": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true,
      "lastResults": [
        {
          "serviceId": "social_security",
          "title": "الضمان الاجتماعي",
          "why": "إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق",
          "unknowns": [
            "بقية بيانات الأسرة"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 20,
    "persona": "khalid",
    "category": "شرح نتيجة",
    "message": "ليش قلت لي كذا؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "social_security"
    },
    "previousState": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true,
      "lastResults": [
        {
          "serviceId": "social_security",
          "title": "الضمان الاجتماعي",
          "why": "إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق",
          "unknowns": [
            "بقية بيانات الأسرة"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 21,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير 7",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": true
    }
  },
  {
    "id": 22,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير سبعة",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": true
    }
  },
  {
    "id": 23,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير سبعة الاف",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": false
    }
  },
  {
    "id": 24,
    "persona": "khalid",
    "category": "أرقام عربية",
    "message": "راتبي صار ٦٥٠٠",
    "expected": {
      "intent": "income_change",
      "income": 6500,
      "mode": "reported"
    }
  },
  {
    "id": 25,
    "persona": "khalid",
    "category": "كسور عامية",
    "message": "راتبي نزل لأربعة ونص",
    "expected": {
      "intent": "income_change",
      "income": 4500,
      "needsConfirmation": false
    }
  },
  {
    "id": 26,
    "persona": "khalid",
    "category": "كسور رقمية",
    "message": "دخلي صار 4.5",
    "expected": {
      "intent": "income_change",
      "income": 4500,
      "needsConfirmation": false
    }
  },
  {
    "id": 27,
    "persona": "khalid",
    "category": "ألف صريح",
    "message": "راتبي زاد وصار 8 الاف",
    "expected": {
      "intent": "income_change",
      "income": 8000,
      "needsConfirmation": false
    }
  },
  {
    "id": 28,
    "persona": "khalid",
    "category": "فرق دخل",
    "message": "راتبي انخفض 500 ريال",
    "expected": {
      "intent": "income_delta",
      "delta": -500
    }
  },
  {
    "id": 29,
    "persona": "khalid",
    "category": "فرق دخل",
    "message": "زاد راتبي 1000",
    "expected": {
      "intent": "income_delta",
      "delta": 1000
    }
  },
  {
    "id": 30,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي ٧ آلاف ونص",
    "expected": {
      "intent": "income_change",
      "income": 7500,
      "needsConfirmation": false
    }
  },
  {
    "id": 31,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "صار دخلي اثنعش ونص",
    "expected": {
      "intent": "income_change",
      "income": 12500,
      "needsConfirmation": false
    }
  },
  {
    "id": 32,
    "persona": "khalid",
    "category": "صيغة مختصرة",
    "message": "راتبي صار 12.5k",
    "expected": {
      "intent": "income_change",
      "income": 12500,
      "needsConfirmation": false
    }
  },
  {
    "id": 33,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "صار يجيني 2500 بالشهر",
    "expected": {
      "intent": "income_change",
      "income": 2500,
      "requiresClarification": "income_source"
    }
  },
  {
    "id": 34,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "دخل علي 2500 من شغل حر",
    "expected": {
      "intent": "income_change",
      "income": 2500,
      "incomeSource": "self_employment"
    }
  },
  {
    "id": 35,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "جاني راتب 2500 من وظيفة",
    "expected": {
      "intent": "new_job",
      "salary": 2500,
      "requiresClarification": "job_stage"
    }
  },
  {
    "id": 36,
    "persona": "khalid",
    "category": "وظيفة جديدة",
    "message": "جاني شغل بستة ونص ووافقت بس للحين ما باشرت",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "started": false
    }
  },
  {
    "id": 37,
    "persona": "khalid",
    "category": "نفي الموافقة",
    "message": "جاني عرض ب6500 بس ما وافقت عليه",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "reviewing",
      "accepted": false
    }
  },
  {
    "id": 38,
    "persona": "khalid",
    "category": "رفض العرض",
    "message": "جاني عرض ب6500 ورفضته",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "rejected"
    }
  },
  {
    "id": 39,
    "persona": "khalid",
    "category": "طلب تعديل",
    "message": "طلبت منهم يعدلون العرض",
    "expected": {
      "intent": "new_job",
      "jobStage": "modification_requested"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "reviewing"
    }
  },
  {
    "id": 40,
    "persona": "khalid",
    "category": "الموافقة",
    "message": "وقعت العرض",
    "expected": {
      "intent": "new_job",
      "jobStage": "accepted"
    }
  },
  {
    "id": 41,
    "persona": "khalid",
    "category": "الموافقة",
    "message": "وافقت من جهتي",
    "expected": {
      "intent": "new_job",
      "jobStage": "accepted"
    }
  },
  {
    "id": 42,
    "persona": "khalid",
    "category": "التوثيق",
    "message": "توثق العقد بس ما باشرت",
    "expected": {
      "intent": "new_job",
      "jobStage": "documented",
      "started": false
    }
  },
  {
    "id": 43,
    "persona": "khalid",
    "category": "المباشرة",
    "message": "باشرت اليوم",
    "expected": {
      "intent": "new_job",
      "jobStage": "started"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true
    }
  },
  {
    "id": 44,
    "persona": "khalid",
    "category": "المباشرة",
    "message": "داومت أول يوم",
    "expected": {
      "intent": "new_job",
      "jobStage": "started"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true
    }
  },
  {
    "id": 45,
    "persona": "khalid",
    "category": "تاريخ مستقبلي",
    "message": "العقد الجديد يبدأ الشهر الجاي",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "jobStage": "documented"
    }
  },
  {
    "id": 46,
    "persona": "khalid",
    "category": "عرض تحت الدراسة",
    "message": "جاني عرض بس ما ادري اوافق",
    "expected": {
      "intent": "new_job",
      "jobStage": "reviewing"
    }
  },
  {
    "id": 47,
    "persona": "khalid",
    "category": "افتراض موافقة",
    "message": "لو قبلت عرض ب9000 وش بيتغير؟",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 9000,
      "jobStage": "accepted"
    }
  },
  {
    "id": 48,
    "persona": "khalid",
    "category": "افتراض مباشرة",
    "message": "إذا باشرت على 9000 وش يصير؟",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 9000,
      "jobStage": "started"
    }
  },
  {
    "id": 49,
    "persona": "khalid",
    "category": "استبدال وظيفة",
    "message": "الوظيفة الجديدة بديلة عن الحالية",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": true
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 50,
    "persona": "khalid",
    "category": "وظيفتان",
    "message": "بكمل في وظيفتي الحالية مع الجديدة",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": false
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 51,
    "persona": "khalid",
    "category": "استبدال وظيفة",
    "message": "بطلع من شركتي واروح الجديدة",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": true
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 52,
    "persona": "khalid",
    "category": "وظيفتان",
    "message": "ما راح اترك وظيفتي الحالية",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": false
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 53,
    "persona": "khalid",
    "category": "نفي توقيع",
    "message": "جاني عقد جديد بس ما وقعت",
    "expected": {
      "intent": "new_job",
      "jobStage": "reviewing",
      "accepted": false
    }
  },
  {
    "id": 54,
    "persona": "khalid",
    "category": "طلب تعديل",
    "message": "وصلني عقد وطلبت تعديل الراتب",
    "expected": {
      "intent": "new_job",
      "jobStage": "modification_requested"
    }
  },
  {
    "id": 55,
    "persona": "khalid",
    "category": "تراجع عن قرار",
    "message": "وافقت وبعدها غيرت رأيي",
    "expected": {
      "intent": "new_job",
      "jobStage": "ambiguous",
      "requiresClarification": "current_offer_status"
    }
  },
  {
    "id": 56,
    "persona": "khalid",
    "category": "استقالة مستقبلية",
    "message": "بفكر استقيل",
    "expected": {
      "intent": "employment_end",
      "mode": "what_if",
      "endStage": "planned",
      "endReason": "resignation"
    }
  },
  {
    "id": 57,
    "persona": "khalid",
    "category": "استقالة فعلية",
    "message": "استقلت اليوم",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "resignation"
    }
  },
  {
    "id": 58,
    "persona": "khalid",
    "category": "فصل",
    "message": "الشركة فصلتني",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "unknown"
    }
  },
  {
    "id": 59,
    "persona": "khalid",
    "category": "انتهاء مدة",
    "message": "عقدي خلص أمس",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "fixed_expiry"
    }
  },
  {
    "id": 60,
    "persona": "khalid",
    "category": "انتهاء مستقبلي",
    "message": "عقدي بينتهي الشهر الجاي",
    "expected": {
      "intent": "employment_end",
      "mode": "what_if",
      "endStage": "planned",
      "endReason": "fixed_expiry"
    }
  },
  {
    "id": 61,
    "persona": "khalid",
    "category": "إغلاق منشأة",
    "message": "الشركة قفلت",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "business_closed"
    }
  },
  {
    "id": 62,
    "persona": "khalid",
    "category": "تراضي",
    "message": "اتفقنا ننهي العقد بالتراضي",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "mutual"
    }
  },
  {
    "id": 63,
    "persona": "khalid",
    "category": "إشعار إنهاء",
    "message": "جاني إشعار إنهاء بس للحين أداوم",
    "expected": {
      "intent": "employment_end",
      "endStage": "planned",
      "endReason": "employer_termination"
    }
  },
  {
    "id": 64,
    "persona": "khalid",
    "category": "نفي الانتهاء",
    "message": "ما انتهى عقدي",
    "expected": {
      "intent": "employment_end_negated",
      "ended": false
    }
  },
  {
    "id": 65,
    "persona": "khalid",
    "category": "نفي الانتهاء",
    "message": "عقدي ما خلص",
    "expected": {
      "intent": "employment_end_negated",
      "ended": false
    }
  },
  {
    "id": 66,
    "persona": "khalid",
    "category": "فترة تجربة",
    "message": "انتهت التجربة وما كملوا معي",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "unknown"
    }
  },
  {
    "id": 67,
    "persona": "khalid",
    "category": "فصل بسبب مخالفة",
    "message": "فصلوني بسبب مخالفة",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "employer_termination_misconduct"
    }
  },
  {
    "id": 68,
    "persona": "reem",
    "category": "الضمان",
    "message": "هل الضمان ممكن يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 69,
    "persona": "reem",
    "category": "التقديم للضمان",
    "message": "ابي اسجل في الضمان",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 70,
    "persona": "reem",
    "category": "التقديم للضمان",
    "message": "انا مو مستفيد ضمان، اقدر اقدم؟",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 71,
    "persona": "reem",
    "category": "أهلية الضمان",
    "message": "هل انا مؤهل للضمان؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 72,
    "persona": "khalid",
    "category": "أثر الدخل على الضمان",
    "message": "هل زيادة راتبي توقف الضمان؟",
    "expected": {
      "intent": "social_security_impact",
      "mode": "what_if",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 73,
    "persona": "khalid",
    "category": "أثر انخفاض الدخل",
    "message": "راتبي نزل هل ينقطع الضمان؟",
    "expected": {
      "intent": "social_security_impact",
      "targetServiceId": "social_security",
      "forbidConclusion": "loss_due_to_decrease_alone"
    }
  },
  {
    "id": 74,
    "persona": "khalid",
    "category": "حساب المعاش",
    "message": "كم بيصير معاشي؟",
    "expected": {
      "intent": "benefit_amount_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 75,
    "persona": "khalid",
    "category": "شرح ظهور خدمة",
    "message": "ليش الضمان عندي ظاهر؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 76,
    "persona": "khalid",
    "category": "اعتراض ضمان",
    "message": "الضمان توقف عندي، كيف اعترض؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security_objection"
    }
  },
  {
    "id": 77,
    "persona": "reem",
    "category": "عدم أهلية ضمان",
    "message": "جاني غير مؤهل في الضمان",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security_objection"
    }
  },
  {
    "id": 78,
    "persona": "reem",
    "category": "دخل إضافي",
    "message": "هل اقدر اقدم اذا عندي دخل ثاني؟",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "social_security"
    },
    "previousState": {
      "intent": "service_question",
      "targetServiceIds": [
        "social_security"
      ],
      "lastResults": [
        {
          "serviceId": "social_security",
          "title": "الضمان الاجتماعي",
          "why": "فحص أولي",
          "unknowns": [
            "الدخل المحتسب الكامل للأسرة"
          ]
        }
      ]
    }
  },
  {
    "id": 79,
    "persona": "reem",
    "category": "ضمان بعد فقد وظيفة",
    "message": "اذا انفصلت من الوظيفة هل الضمان يصير مناسب؟",
    "expected": {
      "intent": "multi_intent",
      "mode": "what_if",
      "targetServiceIds": [
        "social_security",
        "employment_end"
      ]
    }
  },
  {
    "id": 80,
    "persona": "salman",
    "category": "باحث عن عمل",
    "message": "انا عاطل وادور وظيفة وش يساعدني؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 81,
    "persona": "salman",
    "category": "مصطلح حافز",
    "message": "وش هو حافز؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy"
    }
  },
  {
    "id": 82,
    "persona": "salman",
    "category": "مصطلح حافز",
    "message": "هل حافز ينفع لي؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy"
    }
  },
  {
    "id": 83,
    "persona": "salman",
    "category": "تمهير",
    "message": "ابي تمهير",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "tamheer"
    }
  },
  {
    "id": 84,
    "persona": "salman",
    "category": "أهلية تمهير",
    "message": "انا مؤهل لتمهير؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "tamheer"
    }
  },
  {
    "id": 85,
    "persona": "salman",
    "category": "تدريب",
    "message": "ابي دورة تطورني",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "doroob"
    }
  },
  {
    "id": 86,
    "persona": "salman",
    "category": "إرشاد مهني",
    "message": "ابي اعرف وش تخصص يناسبني",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "career_guidance_sobol"
    }
  },
  {
    "id": 87,
    "persona": "salman",
    "category": "شهادة احترافية",
    "message": "عندي شهادة احترافية اقدر استرجع قيمتها؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "professional_certificates"
    }
  },
  {
    "id": 88,
    "persona": "salman",
    "category": "استبعاد طالب",
    "message": "انا طالب جامعة اقدر اخذ اعانة بحث عن عمل؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy",
      "expectedEligibility": "not_applicable_if_current_student"
    }
  },
  {
    "id": 89,
    "persona": "khalid",
    "category": "استبعاد موظف",
    "message": "انا موظف اقدر اخذ اعانة بحث عن عمل؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy",
      "expectedEligibility": "not_applicable_if_employed"
    }
  },
  {
    "id": 90,
    "persona": "reem",
    "category": "قرة",
    "message": "عندي طفل عمره 3 سنوات هل قرة تناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "qurra"
    }
  },
  {
    "id": 91,
    "persona": "reem",
    "category": "قرة وحد الدخل",
    "message": "راتبي 8500 هل قرة تنفع؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "qurra"
    }
  },
  {
    "id": 92,
    "persona": "reem",
    "category": "قرة ماذا لو",
    "message": "لو نزل راتبي 7500 هل قرة ممكن تناسبني؟",
    "expected": {
      "intent": "service_question",
      "mode": "what_if",
      "targetServiceId": "qurra",
      "income": 7500
    }
  },
  {
    "id": 93,
    "persona": "reem",
    "category": "وصول",
    "message": "هل وصول يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool"
    }
  },
  {
    "id": 94,
    "persona": "reem",
    "category": "وصول ماذا لو",
    "message": "لو راتبي 7500 اقدر استفيد من وصول؟",
    "expected": {
      "intent": "service_question",
      "mode": "what_if",
      "targetServiceId": "wusool",
      "income": 7500
    }
  },
  {
    "id": 95,
    "persona": "reem",
    "category": "وصول والتأمينات",
    "message": "انا مو مسجلة بالتأمينات هل وصول ينفع؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool",
      "expectedEligibility": "not_applicable_without_gosi"
    }
  },
  {
    "id": 96,
    "persona": "noura",
    "category": "الإعاقة",
    "message": "وش خدمات الإعاقة اللي تخصني؟",
    "expected": {
      "intent": "disability_support"
    }
  },
  {
    "id": 97,
    "persona": "noura",
    "category": "شرح تسهيلات",
    "message": "ليش طلعت لي التسهيلات المرورية؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "traffic_facilities_certificate"
    }
  },
  {
    "id": 98,
    "persona": "saleh",
    "category": "كبار السن",
    "message": "هل بطاقة كبار السن تلقائية؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "senior_privilege_card"
    }
  },
  {
    "id": 99,
    "persona": "khalid",
    "category": "عمالة منزلية",
    "message": "عندي عاملة منزلية وعقدها مو موثق وش اسوي؟",
    "expected": {
      "intent": "domestic_worker",
      "targetServiceId": "domestic_worker_contract_documentation"
    }
  },
  {
    "id": 100,
    "persona": "khalid",
    "category": "خلاف عمالي",
    "message": "الشركة ما عطتني مستحقاتي بعد ما طلعت",
    "expected": {
      "intent": "labor_dispute",
      "targetServiceId": "labor_settlement"
    }
  }
]
`````

## `tests/gold100.test.js`

`````text
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
`````

## `tests/gold100_legacy.json`

`````text
[
  {
    "id": 1,
    "persona": "khalid",
    "category": "اكتشاف الخدمات",
    "message": "وش الخدمات اللي تخصني؟",
    "expected": {
      "intent": "current_services"
    }
  },
  {
    "id": 2,
    "persona": "salman",
    "category": "اكتشاف الخدمات",
    "message": "وش الخدمات اللي اقدر استفيد منها؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 3,
    "persona": "reem",
    "category": "ملخص الحالة",
    "message": "وش وضعي الحالي؟",
    "expected": {
      "intent": "status_summary"
    }
  },
  {
    "id": 4,
    "persona": "khalid",
    "category": "التغييرات",
    "message": "وش تغير في بياناتي؟",
    "expected": {
      "intent": "what_changed"
    }
  },
  {
    "id": 5,
    "persona": "noura",
    "category": "ملخص الحالة",
    "message": "وش تعرف عني؟",
    "expected": {
      "intent": "status_summary"
    }
  },
  {
    "id": 6,
    "persona": "saleh",
    "category": "اكتشاف الخدمات",
    "message": "وش ممكن يفيدني الحين؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 7,
    "persona": "salman",
    "category": "اكتشاف الخدمات",
    "message": "انا عاطل وادور وظيفة، وش الأشياء اللي ممكن تساعدني؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 8,
    "persona": "reem",
    "category": "الخدمات الحالية",
    "message": "وش عندي خدمات حاليا؟",
    "expected": {
      "intent": "current_services"
    }
  },
  {
    "id": 9,
    "persona": "khalid",
    "category": "التنبيهات",
    "message": "هل فيه شيء يحتاج انتباهي؟",
    "expected": {
      "intent": "attention_summary"
    }
  },
  {
    "id": 10,
    "persona": "saleh",
    "category": "التغييرات",
    "message": "ورني آخر التحديثات",
    "expected": {
      "intent": "what_changed"
    }
  },
  {
    "id": 11,
    "persona": "salman",
    "category": "تأكيد الأهلية",
    "message": "يعني انا مؤهل اكيد؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 12,
    "persona": "salman",
    "category": "تأكيد الأهلية",
    "message": "طيب تنطبق علي؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 13,
    "persona": "salman",
    "category": "شرح نتيجة",
    "message": "ليش ظهرت لي إعانة البحث عن عمل؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "job_search_subsidy"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "job_search_subsidy",
          "title": "إعانة البحث عن عمل",
          "why": "تطابق أولي",
          "unknowns": [
            "الثروة",
            "التواريخ وسجل الاستفادة السابق"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 14,
    "persona": "saleh",
    "category": "شرح نتيجة",
    "message": "ليش جتني بطاقة كبار السن؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "senior_privilege_card"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "senior_privilege_card",
          "title": "بطاقة امتياز لكبار السن",
          "why": "العمر والجنسية",
          "unknowns": [
            "حالة الإصدار الفعلية"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 15,
    "persona": "saleh",
    "category": "حالة خدمة",
    "message": "هل البطاقة صدرت لي فعلا؟",
    "expected": {
      "intent": "service_status_question",
      "targetServiceId": "senior_privilege_card"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "senior_privilege_card",
          "title": "بطاقة امتياز لكبار السن",
          "why": "العمر والجنسية",
          "unknowns": [
            "حالة الإصدار الفعلية"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 16,
    "persona": "reem",
    "category": "سؤال خدمة",
    "message": "هل وصول يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool"
    }
  },
  {
    "id": 17,
    "persona": "reem",
    "category": "التقديم على خدمة",
    "message": "طيب اقدر اقدم عليه؟",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "wusool"
    },
    "previousState": {
      "intent": "service_question",
      "targetServiceIds": [
        "wusool"
      ],
      "lastResults": [
        {
          "serviceId": "wusool",
          "title": "دعم النقل وصول",
          "why": "بيانات مرتبطة",
          "unknowns": []
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 18,
    "persona": "noura",
    "category": "تأكيد الأهلية",
    "message": "انا مؤهلة للاعانة أكيد؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "disability_financial_aid"
    },
    "previousState": {
      "intent": "eligible_services",
      "lastResults": [
        {
          "serviceId": "disability_financial_aid",
          "title": "الإعانة المالية للأشخاص ذوي الإعاقة",
          "why": "تقييم الإعاقة والدخل",
          "unknowns": [
            "التحقق الرسمي"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 19,
    "persona": "khalid",
    "category": "شرح أثر",
    "message": "ليش الضمان ممكن يتأثر؟",
    "expected": {
      "intent": "explain_effect",
      "targetServiceId": "social_security"
    },
    "previousState": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true,
      "lastResults": [
        {
          "serviceId": "social_security",
          "title": "الضمان الاجتماعي",
          "why": "إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق",
          "unknowns": [
            "بقية بيانات الأسرة"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 20,
    "persona": "khalid",
    "category": "شرح نتيجة",
    "message": "ليش قلت لي كذا؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "social_security"
    },
    "previousState": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true,
      "lastResults": [
        {
          "serviceId": "social_security",
          "title": "الضمان الاجتماعي",
          "why": "إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق",
          "unknowns": [
            "بقية بيانات الأسرة"
          ]
        }
      ],
      "lastChanges": []
    }
  },
  {
    "id": 21,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير 7",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": true
    }
  },
  {
    "id": 22,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير سبعة",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": true
    }
  },
  {
    "id": 23,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي بيصير سبعة الاف",
    "expected": {
      "intent": "income_change",
      "income": 7000,
      "needsConfirmation": false
    }
  },
  {
    "id": 24,
    "persona": "khalid",
    "category": "أرقام عربية",
    "message": "راتبي صار ٦٥٠٠",
    "expected": {
      "intent": "income_change",
      "income": 6500,
      "mode": "reported"
    }
  },
  {
    "id": 25,
    "persona": "khalid",
    "category": "كسور عامية",
    "message": "راتبي نزل لأربعة ونص",
    "expected": {
      "intent": "income_change",
      "income": 4500,
      "needsConfirmation": false
    }
  },
  {
    "id": 26,
    "persona": "khalid",
    "category": "كسور رقمية",
    "message": "دخلي صار 4.5",
    "expected": {
      "intent": "income_change",
      "income": 4500,
      "needsConfirmation": false
    }
  },
  {
    "id": 27,
    "persona": "khalid",
    "category": "ألف صريح",
    "message": "راتبي زاد وصار 8 الاف",
    "expected": {
      "intent": "income_change",
      "income": 8000,
      "needsConfirmation": false
    }
  },
  {
    "id": 28,
    "persona": "khalid",
    "category": "فرق دخل",
    "message": "راتبي انخفض 500 ريال",
    "expected": {
      "intent": "income_delta",
      "delta": -500
    }
  },
  {
    "id": 29,
    "persona": "khalid",
    "category": "فرق دخل",
    "message": "زاد راتبي 1000",
    "expected": {
      "intent": "income_delta",
      "delta": 1000
    }
  },
  {
    "id": 30,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "راتبي ٧ آلاف ونص",
    "expected": {
      "intent": "income_change",
      "income": 7500,
      "needsConfirmation": false
    }
  },
  {
    "id": 31,
    "persona": "khalid",
    "category": "أرقام عامية",
    "message": "صار دخلي اثنعش ونص",
    "expected": {
      "intent": "income_change",
      "income": 12500,
      "needsConfirmation": false
    }
  },
  {
    "id": 32,
    "persona": "khalid",
    "category": "صيغة مختصرة",
    "message": "راتبي صار 12.5k",
    "expected": {
      "intent": "income_change",
      "income": 12500,
      "needsConfirmation": false
    }
  },
  {
    "id": 33,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "صار يجيني 2500 بالشهر",
    "expected": {
      "intent": "income_change",
      "income": 2500,
      "requiresClarification": "income_source"
    }
  },
  {
    "id": 34,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "دخل علي 2500 من شغل حر",
    "expected": {
      "intent": "income_change",
      "income": 2500,
      "incomeSource": "self_employment"
    }
  },
  {
    "id": 35,
    "persona": "salman",
    "category": "مصدر دخل",
    "message": "جاني راتب 2500 من وظيفة",
    "expected": {
      "intent": "new_job",
      "salary": 2500,
      "requiresClarification": "job_stage"
    }
  },
  {
    "id": 36,
    "persona": "khalid",
    "category": "وظيفة جديدة",
    "message": "جاني شغل بستة ونص ووافقت بس للحين ما باشرت",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "started": false
    }
  },
  {
    "id": 37,
    "persona": "khalid",
    "category": "نفي الموافقة",
    "message": "جاني عرض ب6500 بس ما وافقت عليه",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "reviewing",
      "accepted": false
    }
  },
  {
    "id": 38,
    "persona": "khalid",
    "category": "رفض العرض",
    "message": "جاني عرض ب6500 ورفضته",
    "expected": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "rejected"
    }
  },
  {
    "id": 39,
    "persona": "khalid",
    "category": "طلب تعديل",
    "message": "طلبت منهم يعدلون العرض",
    "expected": {
      "intent": "new_job",
      "jobStage": "modification_requested"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "reviewing"
    }
  },
  {
    "id": 40,
    "persona": "khalid",
    "category": "الموافقة",
    "message": "وقعت العرض",
    "expected": {
      "intent": "new_job",
      "jobStage": "accepted"
    }
  },
  {
    "id": 41,
    "persona": "khalid",
    "category": "الموافقة",
    "message": "وافقت من جهتي",
    "expected": {
      "intent": "new_job",
      "jobStage": "accepted"
    }
  },
  {
    "id": 42,
    "persona": "khalid",
    "category": "التوثيق",
    "message": "توثق العقد بس ما باشرت",
    "expected": {
      "intent": "new_job",
      "jobStage": "documented",
      "started": false
    }
  },
  {
    "id": 43,
    "persona": "khalid",
    "category": "المباشرة",
    "message": "باشرت اليوم",
    "expected": {
      "intent": "new_job",
      "jobStage": "started"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true
    }
  },
  {
    "id": 44,
    "persona": "khalid",
    "category": "المباشرة",
    "message": "داومت أول يوم",
    "expected": {
      "intent": "new_job",
      "jobStage": "started"
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted",
      "replacesCurrentJob": true
    }
  },
  {
    "id": 45,
    "persona": "khalid",
    "category": "تاريخ مستقبلي",
    "message": "العقد الجديد يبدأ الشهر الجاي",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "jobStage": "documented"
    }
  },
  {
    "id": 46,
    "persona": "khalid",
    "category": "عرض تحت الدراسة",
    "message": "جاني عرض بس ما ادري اوافق",
    "expected": {
      "intent": "new_job",
      "jobStage": "reviewing"
    }
  },
  {
    "id": 47,
    "persona": "khalid",
    "category": "افتراض موافقة",
    "message": "لو قبلت عرض ب9000 وش بيتغير؟",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 9000,
      "jobStage": "accepted"
    }
  },
  {
    "id": 48,
    "persona": "khalid",
    "category": "افتراض مباشرة",
    "message": "إذا باشرت على 9000 وش يصير؟",
    "expected": {
      "intent": "new_job",
      "mode": "what_if",
      "salary": 9000,
      "jobStage": "started"
    }
  },
  {
    "id": 49,
    "persona": "khalid",
    "category": "استبدال وظيفة",
    "message": "الوظيفة الجديدة بديلة عن الحالية",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": true
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 50,
    "persona": "khalid",
    "category": "وظيفتان",
    "message": "بكمل في وظيفتي الحالية مع الجديدة",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": false
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 51,
    "persona": "khalid",
    "category": "استبدال وظيفة",
    "message": "بطلع من شركتي واروح الجديدة",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": true
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 52,
    "persona": "khalid",
    "category": "وظيفتان",
    "message": "ما راح اترك وظيفتي الحالية",
    "expected": {
      "intent": "new_job",
      "replacesCurrentJob": false
    },
    "previousState": {
      "intent": "new_job",
      "salary": 6500,
      "jobStage": "accepted"
    }
  },
  {
    "id": 53,
    "persona": "khalid",
    "category": "نفي توقيع",
    "message": "جاني عقد جديد بس ما وقعت",
    "expected": {
      "intent": "new_job",
      "jobStage": "reviewing",
      "accepted": false
    }
  },
  {
    "id": 54,
    "persona": "khalid",
    "category": "طلب تعديل",
    "message": "وصلني عقد وطلبت تعديل الراتب",
    "expected": {
      "intent": "new_job",
      "jobStage": "modification_requested"
    }
  },
  {
    "id": 55,
    "persona": "khalid",
    "category": "تراجع عن قرار",
    "message": "وافقت وبعدها غيرت رأيي",
    "expected": {
      "intent": "new_job",
      "jobStage": "ambiguous",
      "requiresClarification": "current_offer_status"
    }
  },
  {
    "id": 56,
    "persona": "khalid",
    "category": "استقالة مستقبلية",
    "message": "بفكر استقيل",
    "expected": {
      "intent": "employment_end",
      "mode": "what_if",
      "endStage": "planned",
      "endReason": "resignation"
    }
  },
  {
    "id": 57,
    "persona": "khalid",
    "category": "استقالة فعلية",
    "message": "استقلت اليوم",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "resignation"
    }
  },
  {
    "id": 58,
    "persona": "khalid",
    "category": "فصل",
    "message": "الشركة فصلتني",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "unknown"
    }
  },
  {
    "id": 59,
    "persona": "khalid",
    "category": "انتهاء مدة",
    "message": "عقدي خلص أمس",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "fixed_expiry"
    }
  },
  {
    "id": 60,
    "persona": "khalid",
    "category": "انتهاء مستقبلي",
    "message": "عقدي بينتهي الشهر الجاي",
    "expected": {
      "intent": "employment_end",
      "mode": "what_if",
      "endStage": "planned",
      "endReason": "fixed_expiry"
    }
  },
  {
    "id": 61,
    "persona": "khalid",
    "category": "إغلاق منشأة",
    "message": "الشركة قفلت",
    "expected": {
      "intent": "employment_end",
      "mode": "reported",
      "endStage": "ended",
      "endReason": "business_closed"
    }
  },
  {
    "id": 62,
    "persona": "khalid",
    "category": "تراضي",
    "message": "اتفقنا ننهي العقد بالتراضي",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "mutual"
    }
  },
  {
    "id": 63,
    "persona": "khalid",
    "category": "إشعار إنهاء",
    "message": "جاني إشعار إنهاء بس للحين أداوم",
    "expected": {
      "intent": "employment_end",
      "endStage": "planned",
      "endReason": "employer_termination"
    }
  },
  {
    "id": 64,
    "persona": "khalid",
    "category": "نفي الانتهاء",
    "message": "ما انتهى عقدي",
    "expected": {
      "intent": "employment_end_negated",
      "ended": false
    }
  },
  {
    "id": 65,
    "persona": "khalid",
    "category": "نفي الانتهاء",
    "message": "عقدي ما خلص",
    "expected": {
      "intent": "employment_end_negated",
      "ended": false
    }
  },
  {
    "id": 66,
    "persona": "khalid",
    "category": "فترة تجربة",
    "message": "انتهت التجربة وما كملوا معي",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "unknown"
    }
  },
  {
    "id": 67,
    "persona": "khalid",
    "category": "فصل بسبب مخالفة",
    "message": "فصلوني بسبب مخالفة",
    "expected": {
      "intent": "employment_end",
      "endStage": "ended",
      "endReason": "employer_termination_misconduct"
    }
  },
  {
    "id": 68,
    "persona": "reem",
    "category": "الضمان",
    "message": "هل الضمان ممكن يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 69,
    "persona": "reem",
    "category": "التقديم للضمان",
    "message": "ابي اسجل في الضمان",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 70,
    "persona": "reem",
    "category": "التقديم للضمان",
    "message": "انا مو مستفيد ضمان، اقدر اقدم؟",
    "expected": {
      "intent": "service_application_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 71,
    "persona": "reem",
    "category": "أهلية الضمان",
    "message": "هل انا مؤهل للضمان؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 72,
    "persona": "khalid",
    "category": "أثر الدخل على الضمان",
    "message": "هل زيادة راتبي توقف الضمان؟",
    "expected": {
      "intent": "social_security_impact",
      "mode": "what_if",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 73,
    "persona": "khalid",
    "category": "أثر انخفاض الدخل",
    "message": "راتبي نزل هل ينقطع الضمان؟",
    "expected": {
      "intent": "social_security_impact",
      "targetServiceId": "social_security",
      "forbidConclusion": "loss_due_to_decrease_alone"
    }
  },
  {
    "id": 74,
    "persona": "khalid",
    "category": "حساب المعاش",
    "message": "كم بيصير معاشي؟",
    "expected": {
      "intent": "benefit_amount_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 75,
    "persona": "khalid",
    "category": "شرح ظهور خدمة",
    "message": "ليش الضمان عندي ظاهر؟",
    "expected": {
      "intent": "explain_result",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 76,
    "persona": "khalid",
    "category": "اعتراض ضمان",
    "message": "الضمان توقف عندي، كيف اعترض؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security_objection"
    }
  },
  {
    "id": 77,
    "persona": "reem",
    "category": "عدم أهلية ضمان",
    "message": "جاني غير مؤهل في الضمان",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security_objection"
    }
  },
  {
    "id": 78,
    "persona": "reem",
    "category": "دخل إضافي",
    "message": "هل اقدر اقدم اذا عندي دخل ثاني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "social_security"
    }
  },
  {
    "id": 79,
    "persona": "reem",
    "category": "ضمان بعد فقد وظيفة",
    "message": "اذا انفصلت من الوظيفة هل الضمان يصير مناسب؟",
    "expected": {
      "intent": "multi_intent",
      "mode": "what_if",
      "targetServiceIds": [
        "social_security",
        "employment_end"
      ]
    }
  },
  {
    "id": 80,
    "persona": "salman",
    "category": "باحث عن عمل",
    "message": "انا عاطل وادور وظيفة وش يساعدني؟",
    "expected": {
      "intent": "eligible_services"
    }
  },
  {
    "id": 81,
    "persona": "salman",
    "category": "مصطلح حافز",
    "message": "وش هو حافز؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy"
    }
  },
  {
    "id": 82,
    "persona": "salman",
    "category": "مصطلح حافز",
    "message": "هل حافز ينفع لي؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy"
    }
  },
  {
    "id": 83,
    "persona": "salman",
    "category": "تمهير",
    "message": "ابي تمهير",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "tamheer"
    }
  },
  {
    "id": 84,
    "persona": "salman",
    "category": "أهلية تمهير",
    "message": "انا مؤهل لتمهير؟",
    "expected": {
      "intent": "eligibility_confirmation",
      "targetServiceId": "tamheer"
    }
  },
  {
    "id": 85,
    "persona": "salman",
    "category": "تدريب",
    "message": "ابي دورة تطورني",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "doroob"
    }
  },
  {
    "id": 86,
    "persona": "salman",
    "category": "إرشاد مهني",
    "message": "ابي اعرف وش تخصص يناسبني",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "career_guidance_sobol"
    }
  },
  {
    "id": 87,
    "persona": "salman",
    "category": "شهادة احترافية",
    "message": "عندي شهادة احترافية اقدر استرجع قيمتها؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "professional_certificates"
    }
  },
  {
    "id": 88,
    "persona": "salman",
    "category": "استبعاد طالب",
    "message": "انا طالب جامعة اقدر اخذ اعانة بحث عن عمل؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy",
      "expectedEligibility": "not_applicable_if_current_student"
    }
  },
  {
    "id": 89,
    "persona": "khalid",
    "category": "استبعاد موظف",
    "message": "انا موظف اقدر اخذ اعانة بحث عن عمل؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "job_search_subsidy",
      "expectedEligibility": "not_applicable_if_employed"
    }
  },
  {
    "id": 90,
    "persona": "reem",
    "category": "قرة",
    "message": "عندي طفل عمره 3 سنوات هل قرة تناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "qurra"
    }
  },
  {
    "id": 91,
    "persona": "reem",
    "category": "قرة وحد الدخل",
    "message": "راتبي 8500 هل قرة تنفع؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "qurra"
    }
  },
  {
    "id": 92,
    "persona": "reem",
    "category": "قرة ماذا لو",
    "message": "لو نزل راتبي 7500 هل قرة ممكن تناسبني؟",
    "expected": {
      "intent": "service_question",
      "mode": "what_if",
      "targetServiceId": "qurra",
      "income": 7500
    }
  },
  {
    "id": 93,
    "persona": "reem",
    "category": "وصول",
    "message": "هل وصول يناسبني؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool"
    }
  },
  {
    "id": 94,
    "persona": "reem",
    "category": "وصول ماذا لو",
    "message": "لو راتبي 7500 اقدر استفيد من وصول؟",
    "expected": {
      "intent": "service_question",
      "mode": "what_if",
      "targetServiceId": "wusool",
      "income": 7500
    }
  },
  {
    "id": 95,
    "persona": "reem",
    "category": "وصول والتأمينات",
    "message": "انا مو مسجلة بالتأمينات هل وصول ينفع؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "wusool",
      "expectedEligibility": "not_applicable_without_gosi"
    }
  },
  {
    "id": 96,
    "persona": "noura",
    "category": "الإعاقة",
    "message": "وش خدمات الإعاقة اللي تخصني؟",
    "expected": {
      "intent": "disability_support"
    }
  },
  {
    "id": 97,
    "persona": "noura",
    "category": "شرح تسهيلات",
    "message": "ليش طلعت لي التسهيلات المرورية؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "traffic_facilities_certificate"
    }
  },
  {
    "id": 98,
    "persona": "saleh",
    "category": "كبار السن",
    "message": "هل بطاقة كبار السن تلقائية؟",
    "expected": {
      "intent": "service_question",
      "targetServiceId": "senior_privilege_card"
    }
  },
  {
    "id": 99,
    "persona": "khalid",
    "category": "عمالة منزلية",
    "message": "عندي عاملة منزلية وعقدها مو موثق وش اسوي؟",
    "expected": {
      "intent": "domestic_worker",
      "targetServiceId": "domestic_worker_contract_documentation"
    }
  },
  {
    "id": 100,
    "persona": "khalid",
    "category": "خلاف عمالي",
    "message": "الشركة ما عطتني مستحقاتي بعد ما طلعت",
    "expected": {
      "intent": "labor_dispute",
      "targetServiceId": "labor_settlement"
    }
  }
]
`````

## `tests/http100_results.json`

`````text
[
  {
    "id": 1,
    "reply": "حسب بيانات خالد الحالية، عندك 4 نتيجة مرتبطة بوضعك الآن أو تستحق الانتباه. التفاصيل تحت تشرح سبب ظهور كل واحدة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 2,
    "reply": "بناء على بياناتك الحالية، لقيت 5 خدمة أو برنامج ممكن يكون مرتبطا بحالتك. ظهورها هنا مو حكم أهلية نهائي، وكل بطاقة توضح المعروف والناقص.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 3,
    "reply": "حسب بيانات النموذج الحالية: ريم، العمر 27 سنة، الحالة موظف، الدخل المعروف 8500 ريال، حجم الأسرة 3، وعندك عقد وظيفي فعال.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 4,
    "reply": "لقيت 2 تحديث في بيانات خالد. كل تحديث موضح تحته وش ممكن يتأثر وليش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 5,
    "reply": "حسب بيانات النموذج الحالية: نورة، العمر 33 سنة، الحالة غير موظف حاليا، الدخل المعروف 3200 ريال، حجم الأسرة 1، وما عندك عقد وظيفي فعال.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 6,
    "reply": "بناء على بياناتك الحالية، لقيت 2 خدمة أو برنامج ممكن يكون مرتبطا بحالتك. ظهورها هنا مو حكم أهلية نهائي، وكل بطاقة توضح المعروف والناقص.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 7,
    "reply": "بناء على بياناتك الحالية، لقيت 5 خدمة أو برنامج ممكن يكون مرتبطا بحالتك. ظهورها هنا مو حكم أهلية نهائي، وكل بطاقة توضح المعروف والناقص.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 8,
    "reply": "حسب بيانات ريم الحالية، عندك 2 نتيجة مرتبطة بوضعك الآن أو تستحق الانتباه. التفاصيل تحت تشرح سبب ظهور كل واحدة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 9,
    "reply": "لقيت 6 شيء يستحق انتباهك بين خدمة مرتبطة بحالتك أو تحديث في بياناتك. عرضتها تحت مرتبة حسب علاقتها بوضعك الحالي.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 10,
    "reply": "لقيت 1 تحديث في بيانات صالح. كل تحديث موضح تحته وش ممكن يتأثر وليش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 11,
    "reply": "عندك تطابق أولي مع الشروط المعروفة، لكن ما أقدر أؤكد الأهلية النهائية. ما زال نحتاج التحقق من الثروة، التحقق الرسمي من التواريخ وسجل الاستفادة السابق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 12,
    "reply": "عندك تطابق أولي مع الشروط المعروفة، لكن ما أقدر أؤكد الأهلية النهائية. ما زال نحتاج التحقق من الثروة، التحقق الرسمي من التواريخ وسجل الاستفادة السابق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 13,
    "reply": "إعانة البحث عن عمل: تطابق أولي وما زال غير محسوم: الثروة، التواريخ وسجل الاستفادة السابق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 14,
    "reply": "بطاقة امتياز لكبار السن: العمر والجنسية وما زال غير محسوم: حالة الإصدار الفعلية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 15,
    "reply": "العمر والجنسية يطابقان الشرطين المعروفين للبطاقة، لكن ما عندي في بيانات النموذج معلومة تؤكد هل صدرت فعليا في حسابك.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 16,
    "reply": "الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 17,
    "reply": "الخدمة موجودة من حيث المبدأ، لكن حسب البيانات الحالية فيه شرط معروف ما ينطبق الآن: الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 18,
    "reply": "عندك تطابق أولي مع الشروط المعروفة، لكن ما أقدر أؤكد الأهلية النهائية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 19,
    "reply": "إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق وما زال غير محسوم: بقية بيانات الأسرة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 20,
    "reply": "الضمان الاجتماعي: إذا بدأ الدخل الجديد قد يتغير مبلغ المعاش أو الاستحقاق وما زال غير محسوم: بقية بيانات الأسرة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 21,
    "reply": "تقصد 7,000 ريال؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 22,
    "reply": "تقصد 7,000 ريال؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 23,
    "reply": "إذا أصبح الدخل 7000 ريال بدلا من 4500 ريال بشكل فعلي، فقد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 24,
    "reply": "ارتفع الدخل من 4500 إلى 6500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل. النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 25,
    "reply": "ما دام الرقم لم يتغير، ما نعرض أثر جديد أو خدمة جديدة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 26,
    "reply": "ما دام الرقم لم يتغير، ما نعرض أثر جديد أو خدمة جديدة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 27,
    "reply": "ارتفع الدخل من 4500 إلى 8000 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل. النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 28,
    "reply": "إذا أصبح الدخل 4000 ريال بدلا من 4500 ريال بشكل فعلي، فقد يتغير مقدار المعاش بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 29,
    "reply": "ارتفع الدخل من 4500 إلى 5500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل. النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 30,
    "reply": "إذا أصبح الدخل 7500 ريال بدلا من 4500 ريال بشكل فعلي، فقد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 31,
    "reply": "ارتفع الدخل من 4500 إلى 12500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل. النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 32,
    "reply": "ارتفع الدخل من 4500 إلى 12500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل. النظام ينص على إبلاغ الوزارة خلال 15 يوما عن التغيير الذي يؤثر على الاستحقاق أو مقدار المعاش.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 33,
    "reply": "هذا الدخل من راتب وظيفة، عمل حر، أو مصدر آخر؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 34,
    "reply": "صلة لا يملأ الشاشة بخدمات غير مرتبطة بمجرد تغير رقم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 35,
    "reply": "وش مرحلة الوظيفة الجديدة الآن؟ وصلت لك للمراجعة، طلبت تعديلها، وافقت من جهتك، تم توثيقها، أو بدأت العمل فعليا؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 36,
    "reply": "هل الوظيفة الجديدة بديلة عن وظيفتك الحالية، أو أن عقدك الحالي سيبقى قائما؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 37,
    "reply": "العرض بقيمة 6500 ريال، لكن ما دام ما تم قبوله أو بدء العمل، ما يتغير دخلك الحالي ولا حالة الضمان.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 38,
    "reply": "بما أنك رفضت العرض، ما نعامل راتبه كدخل جديد ولا نشغل آثار وظيفة لم تبدأ.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 39,
    "reply": "ما دام العرض قيد التعديل، ما نعتبر الراتب الجديد دخلا فعليا ولا نغير حالتك الوظيفية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 40,
    "reply": "كم الراتب في العرض أو الوظيفة الجديدة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 41,
    "reply": "كم الراتب في العرض أو الوظيفة الجديدة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 42,
    "reply": "كم الراتب في العرض أو الوظيفة الجديدة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 43,
    "reply": "هنا فقط نعامل الراتب الجديد كدخل فعلي داخل السيناريو. ارتفع الدخل من 4500 إلى 6500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 44,
    "reply": "هنا فقط نعامل الراتب الجديد كدخل فعلي داخل السيناريو. ارتفع الدخل من 4500 إلى 6500 ريال. قد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 45,
    "reply": "كم الراتب في العرض أو الوظيفة الجديدة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 46,
    "reply": "وصول العرض وحده لا يغير دخلك الحالي ولا حالة الضمان.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 47,
    "reply": "هل الوظيفة الجديدة بديلة عن وظيفتك الحالية، أو أن عقدك الحالي سيبقى قائما؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 48,
    "reply": "هل الوظيفة الجديدة بديلة عن وظيفتك الحالية، أو أن عقدك الحالي سيبقى قائما؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 49,
    "reply": "الموافقة من الموظف ليست هي نفس بدء العمل أو بدء الدخل. إذا أصبح الدخل 6500 ريال بدلا من 4500 ريال بشكل فعلي، فقد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 50,
    "reply": "الموافقة من الموظف ليست هي نفس بدء العمل أو بدء الدخل. ما نفترض أن الراتب الجديد استبدل القديم. نحتاج فهم وضع العقدين والدخل الفعلي قبل نتيجة أدق. نحتاج الدخل الإجمالي الفعلي وبقية بيانات الأسرة قبل تقدير أدق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 51,
    "reply": "الموافقة من الموظف ليست هي نفس بدء العمل أو بدء الدخل. إذا أصبح الدخل 6500 ريال بدلا من 4500 ريال بشكل فعلي، فقد يتغير مقدار المعاش أو شرط الدخل بعد التقييم الكامل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 52,
    "reply": "الموافقة من الموظف ليست هي نفس بدء العمل أو بدء الدخل. ما نفترض أن الراتب الجديد استبدل القديم. نحتاج فهم وضع العقدين والدخل الفعلي قبل نتيجة أدق. نحتاج الدخل الإجمالي الفعلي وبقية بيانات الأسرة قبل تقدير أدق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 53,
    "reply": "وصول العرض وحده لا يغير دخلك الحالي ولا حالة الضمان.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 54,
    "reply": "ما دام العرض قيد التعديل، ما نعتبر الراتب الجديد دخلا فعليا ولا نغير حالتك الوظيفية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 55,
    "reply": "بعد ما غيرت رأيك، وش وضع العرض الآن؟ ما زلت موافق، أو تراجعت عنه؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 56,
    "reply": "الخدمة ترتبط بوجود عقد ساري، ثم يحدد سبب الإنهاء وتاريخه. الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. ساند يشترط ألا يكون المشترك قد ترك العمل بمحض إرادته.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 57,
    "reply": "الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. ساند يشترط ألا يكون المشترك قد ترك العمل بمحض إرادته. انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 58,
    "reply": "وش سبب انتهاء العلاقة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 59,
    "reply": "الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. ساند مرتبط بفقدان العمل لسبب خارج عن إرادة العامل مع تحقق بقية الشروط النظامية. انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 60,
    "reply": "الخدمة ترتبط بوجود عقد ساري، ثم يحدد سبب الإنهاء وتاريخه. الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. الدخل ما زال قائما في هذه المرحلة، لذلك نعرض الأثر كمستقبل محتمل فقط.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 61,
    "reply": "الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. ساند مرتبط بفقدان العمل لسبب خارج عن إرادة العامل مع تحقق بقية الشروط النظامية. انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 62,
    "reply": "الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 63,
    "reply": "الخدمة ترتبط بوجود عقد ساري، ثم يحدد سبب الإنهاء وتاريخه. الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. الدخل ما زال قائما في هذه المرحلة، لذلك نعرض الأثر كمستقبل محتمل فقط.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 64,
    "reply": "بما أن العقد ما انتهى، ما نعامل حالتك كإنهاء علاقة وظيفية ولا نشغل نتائج ما بعد الانتهاء.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 65,
    "reply": "بما أن العقد ما انتهى، ما نعامل حالتك كإنهاء علاقة وظيفية ولا نشغل نتائج ما بعد الانتهاء.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 66,
    "reply": "وش سبب انتهاء العلاقة؟",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 67,
    "reply": "الحاسبة الرسمية تحتاج الأجر الفعلي ونوع العقد وسبب الانتهاء ومدة الخدمة. انخفاض الدخل لا يعرض هنا كخطر على الأهلية من ناحية الدخل وحده، لكن مقدار المعاش قد يتغير بعد إعادة التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 68,
    "reply": "عدم كونك مستفيدا حاليا لا يعني أن التسجيل غير متاح. التسجيل متاح لمن تنطبق عليهم شروط الاستحقاق، لكن الأهلية تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط. وما زال يحتاج تحقق: الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة، بقية شروط الاستحقاق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 69,
    "reply": "عدم كونك مستفيدا حاليا لا يمنع التقديم على الضمان من حيث المبدأ. الأهلية نفسها تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط، وما زال يلزم التحقق من الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة، بقية شروط الاستحقاق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 70,
    "reply": "عدم كونك مستفيدا حاليا لا يمنع التقديم على الضمان من حيث المبدأ. الأهلية نفسها تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط، وما زال يلزم التحقق من الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة، بقية شروط الاستحقاق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 71,
    "reply": "ما أقدر أؤكد الأهلية من البيانات الحالية. ما زال نحتاج الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة، بقية شروط الاستحقاق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 72,
    "reply": "ارتفاع الدخل قد يغير مبلغ المعاش أو يؤثر على شرط الدخل، لكن ما أقدر أقول إن الضمان سيتوقف من الراتب وحده لأن بقية بيانات الأسرة والثروة والشروط تدخل في التقييم.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 73,
    "reply": "انخفاض الدخل لا يعني انقطاع الضمان من ناحية الدخل وحده. قد يتغير مبلغ المعاش بعد إعادة التقييم، وتبقى بقية بيانات الأسرة والثروة والشروط مؤثرة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 74,
    "reply": "ما أقدر أحدد مبلغ معاش الضمان بشكل موثوق من البيانات الموجودة في النموذج وحدها. حساب المبلغ يحتاج الدخل المحتسب الكامل للأسرة وبقية البيانات والقواعد الرسمية المطبقة على الحالة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 75,
    "reply": "الضمان الاجتماعي ضمن حالتك الحالية: الحالة الحالية للمستفيد مرتبطة بالخدمة مباشرة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 76,
    "reply": "هذه الخدمة ترتبط بحالة إيقاف المعاش أو ظهور نتيجة عدم أهلية، وتسمح بمتابعة مسار الاعتراض عبر القناة الرسمية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 77,
    "reply": "هذه الخدمة ترتبط بحالة إيقاف المعاش أو ظهور نتيجة عدم أهلية، وتسمح بمتابعة مسار الاعتراض عبر القناة الرسمية.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 78,
    "reply": "عدم كونك مستفيدا حاليا لا يمنع التقديم على الضمان من حيث المبدأ. الأهلية نفسها تحتاج فحص الدخل المحتسب للأسرة والثروة وبقية الشروط، وما زال يلزم التحقق من الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة، بقية شروط الاستحقاق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 79,
    "reply": "انتهاء العلاقة الوظيفية قد يغير دخل الأسرة الفعلي، لذلك يصبح فحص الضمان أكثر ارتباطا بالحالة. وللدقة أكثر ما زال نحتاج: الدخل الفعلي بعد انتهاء العلاقة الوظيفية، الدخل المحتسب الكامل للأسرة، الثروة والأصول المؤثرة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 80,
    "reply": "بناء على بياناتك الحالية، لقيت 5 خدمة أو برنامج ممكن يكون مرتبطا بحالتك. ظهورها هنا مو حكم أهلية نهائي، وكل بطاقة توضح المعروف والناقص.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 81,
    "reply": "البيانات المعروفة تتوافق مع عدد من الشروط المنشورة، ودخل الأسرة التجريبي 5500 ريال يقع ضمن الحد المنشور لحجم الأسرة المستخدم في النموذج. وما زال يحتاج تحقق: الثروة، التحقق الرسمي من التواريخ وسجل الاستفادة السابق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 82,
    "reply": "البيانات المعروفة تتوافق مع عدد من الشروط المنشورة، ودخل الأسرة التجريبي 5500 ريال يقع ضمن الحد المنشور لحجم الأسرة المستخدم في النموذج. وما زال يحتاج تحقق: الثروة، التحقق الرسمي من التواريخ وسجل الاستفادة السابق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 83,
    "reply": "العمر والمؤهل وحالة العمل والخبرة السابقة في بيانات النموذج تتوافق مع الشروط الأساسية المنشورة للبرنامج. وما زال يحتاج تحقق: التحقق الرسمي من رصيد التدريب وقائمة الاستبعاد.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 84,
    "reply": "عندك تطابق أولي مع الشروط المعروفة، لكن ما أقدر أؤكد الأهلية النهائية. ما زال نحتاج التحقق من التحقق الرسمي من رصيد التدريب وقائمة الاستبعاد.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 85,
    "reply": "صفحة البرنامج تنص على أن أي مواطن أو مواطنة يمكنه التسجيل والالتحاق بالمحتوى التدريبي.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 86,
    "reply": "البرنامج يخدم حديثي التخرج والباحثين عن عمل ضمن الفئات المستهدفة للإرشاد والتوجيه المهني.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 87,
    "reply": "نحتاج اسم الشهادة أو الرخصة، اعتمادها، تاريخ الحصول عليها، من دفع تكلفتها، وعدد مرات الاستفادة قبل فحص الدعم. وما زال يحتاج تحقق: الجنسية، اسم الشهادة أو الرخصة، اعتمادها لدى الصندوق، تاريخ الحصول عليها، جهة دفع التكاليف، عدد مرات الاستفادة السابقة، صلاحية الشهادة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 88,
    "reply": "البيانات الحالية تشير إلى دراسة أو تدريب",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 89,
    "reply": "العمر خارج النطاق المنشور 20 إلى 40 سنة، البيانات الحالية تشير إلى أنك موظف، يوجد معاش ضمان اجتماعي حالي في البيانات الحالية",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 90,
    "reply": "الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 91,
    "reply": "الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 92,
    "reply": "بيانات النموذج تشير إلى عمل في القطاع الخاص وتسجيل في التأمينات وأجر لا يتجاوز 8000 ريال ووجود طفل ضمن العمر المستهدف. وما زال يحتاج تحقق: التحقق الرسمي من عمر الطفل والأجر المسجل وحالة التسجيل.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 93,
    "reply": "الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 94,
    "reply": "الفئة الوظيفية والأجر والتسجيل في التأمينات ضمن البيانات المعروفة تتوافق مع إشارات أساسية منشورة للبرنامج. وما زال يحتاج تحقق: التحقق الرسمي من مدد الاشتراك وبقية ضوابط المنتج.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 95,
    "reply": "لا يظهر تسجيل حالي في التأمينات ضمن بيانات النموذج، الأجر المعروف 8500 ريال ويتجاوز الحد المنشور 8000 ريال",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 96,
    "reply": "لقيت 3 نتيجة مرتبطة بسؤالك. التفاصيل تحت توضح سبب الارتباط وما الذي ما زال يحتاج تحقق.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 97,
    "reply": "الشهادة الرقمية للتسهيلات المرورية: صفحة الخدمة تشترط تقييما ساريا وتصنيفا مؤهلا للخدمة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 98,
    "reply": "العمر والجنسية يطابقان الشرطين المنشورين، وصفحة الخدمة توضح أن البطاقة تمنح تلقائيا عند استيفائهما. لكن النموذج لا يحتوي تأكيدا أن البطاقة صدرت فعليا في حسابك. وما زال يحتاج تحقق: حالة إصدار البطاقة فعليا في النظام المصدر.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 99,
    "reply": "لديك عامل منزلي في بيانات النموذج ولا يوجد عقد سار في مساند، وهي الحالة الأساسية التي ترتبط بها الخدمة.",
    "aiMode": "local",
    "aiCalls": 0
  },
  {
    "id": 100,
    "reply": "وصفت الخلاف بأنه: الشركة ما عطتني مستحقاتي بعد ما طلعت. الخدمة هي المرحلة الأولى للنظر في دعاوى الخلافات العمالية ومحاولة الوصول إلى حل ودي.",
    "aiMode": "local",
    "aiCalls": 0
  }
]
`````

## `tests/nlu.test.js`

`````text
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
`````

## `tests/retrieval.test.js`

`````text
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
`````

## `tests/rules.test.js`

`````text
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
`````

## `tests/ui.test.js`

`````text
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
`````

