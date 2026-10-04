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
