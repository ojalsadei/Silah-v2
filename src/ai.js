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
