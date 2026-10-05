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

GitHub Pages وحده لا يناسب صلة لأن المشروع يحتوي Backend وGroq API. النسخة الحالية مجهزة للنشر على Netlify مباشرة من نفس المستودع.

في Netlify:

1. استورد مستودع `Silah-v2`
2. استخدم فرع `main` للإنتاج
3. Publish directory: `public`
4. Functions directory: `netlify/functions`
5. أضف `GROQ_API_KEY` في Environment Variables مع نطاق يشمل Functions
6. أضف `GROQ_MODEL=openai/gpt-oss-20b`
7. أضف `GROQ_TIMEOUT_MS=8500`
8. لا تضف `.env` إلى GitHub ولا تضع المفتاح داخل أي ملف عام

`netlify.toml` يربط مسارات `/api/*` بالـFunction، و`netlify/functions/api.mjs` يعيد استخدام نفس `server.js` المستخدم محليا.

يبقى `render.yaml` داخل المشروع فقط للتوافق مع الاستضافة السابقة ويمكن حذفه لاحقا بعد التأكد من نجاح Netlify إذا لم تعد تحتاج Render.
