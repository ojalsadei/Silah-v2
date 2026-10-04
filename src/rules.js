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

