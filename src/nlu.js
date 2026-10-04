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
