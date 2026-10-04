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
