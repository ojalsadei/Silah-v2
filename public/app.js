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
