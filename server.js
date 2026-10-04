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
