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

## GitHub Pages

GitHub Pages يشغل ملفات Frontend ثابتة فقط. صلة يعتمد على `server.js` وGroq API، لذلك رفع الكود إلى GitHub طبيعي، لكن النسخة الحية تحتاج استضافة تشغل Node.js.

المجلد يحتوي `render.yaml` كخيار جاهز للنشر على Render. بعد ربط المستودع بالخدمة، أضف `GROQ_API_KEY` كمتغير بيئة في لوحة الاستضافة. لا تضع المفتاح داخل GitHub.
