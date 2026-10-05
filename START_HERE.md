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

## النشر على Netlify

المشروع ينشر الواجهة والـAPI من نفس مستودع GitHub.

1. اربط مستودع `ojalsadei/Silah-v2` في Netlify
2. اختر فرع `main`
3. اترك Base directory فارغا
4. اترك Build command فارغا
5. اجعل Publish directory هو `public`
6. مجلد Functions هو `netlify/functions`
7. أضف متغيرات البيئة التالية وتأكد أن نطاقها يشمل Functions:

```text
GROQ_API_KEY=مفتاح Groq
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
```

8. اضغط Deploy
9. بعد النشر افتح `/api/health` على رابط Netlify وتأكد أن `ok` تساوي `true` وأن `services` تساوي 18
10. إذا أردت AI الكامل تأكد أن `aiEnabled` تساوي `true`

ملاحظات:

- `netlify.toml` يحتوي Rewrite من `/api/*` إلى Netlify Function
- `netlify/functions/api.mjs` يعيد استخدام نفس منطق `server.js` بدون نسخ قواعد المنتج
- لا تضف `PORT` في Netlify
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
