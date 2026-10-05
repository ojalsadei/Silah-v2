# إعداد Netlify لصلة

## Build settings

```text
Branch: main
Base directory: فارغ
Build command: فارغ
Publish directory: public
Functions directory: netlify/functions
```

الإعدادات داخل `netlify.toml` لها الأولوية إذا اختلفت إعدادات الواجهة.

## Environment variables

```text
GROQ_API_KEY=مفتاحك
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=8500
```

تأكد أن نطاق المتغيرات يشمل Functions. لا تضف `PORT`.

## اختبار بعد النشر

افتح:

```text
https://YOUR-SITE.netlify.app/api/health
```

المطلوب أن ترى:

```json
{
  "ok": true,
  "aiEnabled": true,
  "services": 18
}
```

ثم افتح الموقع نفسه. إذا نجح `/api/health` فبيانات الشخصيات والخدمات والشات تستخدم نفس الـAPI المنشور.
