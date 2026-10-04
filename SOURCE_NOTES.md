# ملاحظات المصادر

تاريخ المراجعة: 2026-10-03

هذا الملف يوثق المصادر العامة المستخدمة لبناء قاعدة صلة وBenchmark. النتائج داخل النموذج لا تمثل قرار أهلية رسمي.

## وزارة الموارد البشرية والتنمية الاجتماعية

دليل الخدمات:
https://www.hrsd.gov.sa/ministry-services

الموقع الرسمي وإحصاءات الواجهة المستخدمة في قسم الأثر:
https://www.hrsd.gov.sa/

في تاريخ المراجعة كان الموقع يعرض 855 خدمة و36,687,106 معاملة منجزة. تستخدم هذه الأرقام كسياق للحجم فقط وليست قياسا لأثر صلة.

تقارير صوت المستفيد:
https://www.hrsd.gov.sa/en/ministry/e-participation/beneficiary-voice-reports

قسم الأثر يستخدم أرقام تقرير صوت المستفيد للربع الأول 2026 المنشور من الوزارة: 738,497 إجمالي تفاعل، منها 501,805 مكالمات واردة و43,444 شكوى و193,248 محادثة عبر التواصل الاجتماعي. ثم يعرض حساسية 3% و5% و10% على المكالمات الواردة. الحسبة افتراضية وموسومة بوضوح على أنها ليست Forecast ولا وعدا تشغيليا. افتراض ساعات العمل في النموذج هو 6 دقائق لكل مكالمة لأغراض توضيح حجم الفرصة فقط.

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

المعلومات المستخدمة في الواجهة تشمل قرابة مليوني مستخدم، أكثر من 130 خدمة ومزية، وتحسن زمن تسجيل الولادة من نحو ساعة إلى 15 دقيقة في المادة المنشورة، إضافة إلى التوصيات والمتابعة وإعادة استخدام البيانات.

### إستونيا: Proactive Government Services

https://ria.ee/en/state-information-system/personal-services/proactive-government-services

استخدمنا مفهوم أحداث الحياة، Service Owner، عرض الخطوات المنجزة والمتبقية، وبعض حالات Consent، وتوزيع أكثر من 478 ألف زيارة في 2025 حسب أنواع الأحداث المنشورة.

### فرنسا: Mes Droits Sociaux

https://www.mesdroitssociaux.gouv.fr/votre-simulateur/

استخدمنا مبدأ محاكاة 58 مساعدة في جلسة واحدة، وإعادة استخدام المعلومات المسبقة التعبئة عند الدخول. البوابة تعرض الحقوق الحالية والمحاكيات كمسارين منفصلين. في صلة استلهمنا هذا الفصل وطبقناه بشكل أوضح كـ Digital Twin مستقل لا يكتب السيناريو على الحالة الحالية. مصطلح Digital Twin وتطبيق الفصل بهذه الصورة هو قرار تصميمي في صلة وليس اسما تستخدمه البوابة الفرنسية.

### المملكة المتحدة: Tell Us Once

مسح 2013:
https://www.gov.uk/government/news/award-winning-government-service-achieves-98-satisfaction-rate-amongst-customers

تحليل المسح:
https://www.gov.uk/government/publications/tell-us-once-customer-service-survey-analysis

المؤشرات المعروضة تاريخية وموسومة بذلك داخل المنصة.

### أستراليا: myGov User Audit

https://my.gov.au/content/dam/mygov/documents/audit/mygov-useraudit-jan2023-volume2.pdf

التجربة مستخدمة كدرس تحذيري. من الأرقام المستخدمة في التقرير: 7 من 15 خدمة عضو استخدمت Tell Us Once في يونيو 2022، و34% من تحديثات التفاصيل الشخصية قبلت مباشرة في يناير 2022، و38% احتاجت تدخلا إضافيا من الموظفين. الدرس لصلة هو أن Data Mapping وتعريف الحقول وConsent وحالة التنفيذ لا تقل أهمية عن الواجهة. صفحة التدقيق الحالية توضح كذلك أن الحكومة وافقت أو وافقت من حيث المبدأ على 9 من 10 توصيات التقرير.
