# مشاريعي 📁🤖

تطبيق جوال خاص فيك (iOS و Android) لمتابعة مشاريعك وأفكارك، ومعه أجينت ذكي (Claude) يتابع مشاريعك، يراقب تطبيقاتك ومواقعك، ويحلل نشاطك.

## وش فيه

| التبويب | وش يسوي |
|---|---|
| **مشاريعي** | المشاريع والأفكار بحالاتها (فكرة / شغال / متوقف / منتهي)، المهام، نسبة الإنجاز، والمتأخر |
| **الأجينت** | محادثة مع Claude: يقرأ بياناتك الحقيقية، يضيف ويعدّل مشاريع ومهام، يقترح الخطوات الجاية |
| **المراقبة** | تحط روابط تطبيقاتك ومواقعك والـ APIs، ويفحصها: شغال أو واقف، السرعة، ونسبة التشغيل خلال 24 ساعة |
| **نشاطي** | كل حركة تسويها في التطبيق تنسجل: أيام متتالية، مهام منجزة، رسم بياني يومي |

الأجينت يقدر:
- `list_projects` / `get_project`: يشوف مشاريعك ومهامك وتقدمها
- `create_project` / `update_project` / `create_task` / `update_task`: يضيف ويعدّل (بس لما تطلب)
- `get_monitors_status` / `check_monitors_now` / `add_monitor`: يراقب روابطك
- `get_activity`: يحلل استخدامك ويطلع لك المشاريع المهملة

## البنية

```
mobile/                      تطبيق Expo (React Native + TypeScript + Expo Router)
  src/app/(tabs)/            الشاشات: مشاريعي، الأجينت، المراقبة، نشاطي
  src/app/project/[id].tsx   تفاصيل المشروع والمهام
  src/lib/                   الاتصال بـ Supabase وتسجيل النشاط
supabase/
  migrations/0001_init.sql   الجداول + الحماية (RLS): كل مستخدم يشوف بياناته فقط
  functions/agent/           الأجينت (Claude + الأدوات). مفتاح Claude يبقى هنا في السيرفر
  functions/monitor-check/   فحص الروابط (يدوي من التطبيق أو مجدول كل 10 دقائق)
```

مفتاح Claude **ما يكون في الجوال أبداً**. التطبيق يكلم دالة `agent` في Supabase، وهي اللي تكلم Claude.

---

## التشغيل خطوة بخطوة

### 1) سوّ مشروع Supabase (مجاني)
1. ادخل [supabase.com](https://supabase.com) وسوّ مشروع جديد.
2. من **SQL Editor** الصق محتوى `supabase/migrations/0001_init.sql` كامل واضغط **Run**.
3. من **Authentication → Providers → Email**: خله مفعّل. وإذا تبي تدخل على طول بدون تأكيد إيميل، طفّ خيار **Confirm email**.

### 2) خذ مفتاح Claude
من [console.anthropic.com](https://console.anthropic.com) ← **API Keys** ← سوّ مفتاح جديد.

### 3) ارفع الدوال للسيرفر
تحتاج [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref <رمز-مشروعك>

# الأسرار (تنحفظ في السيرفر بس)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24)

npx supabase functions deploy agent
npx supabase functions deploy monitor-check
```

> رمز المشروع (project ref) تلقاه في رابط لوحة التحكم: `supabase.com/dashboard/project/<الرمز>`

### 4) فعّل الفحص التلقائي كل 10 دقائق (اختياري بس أنصح فيه)
1. من **Database → Extensions** فعّل `pg_cron` و `pg_net`.
2. من **SQL Editor** شغّل التالي بعد ما تبدل `<الرمز>` و `<CRON_SECRET>` (نفس القيمة اللي حطيتها فوق):

```sql
select cron.schedule(
  'monitor-check',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://<الرمز>.supabase.co/functions/v1/monitor-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- تنظيف نتائج الفحص الأقدم من 30 يوم (مرة يومياً)
select cron.schedule(
  'monitor-checks-cleanup',
  '17 3 * * *',
  $$ delete from public.monitor_checks where checked_at < now() - interval '30 days' $$
);
```

### 5) شغّل التطبيق على جوالك

```bash
cd mobile
cp .env.example .env     # وحط فيه رابط المشروع والمفتاح العام من Project Settings → API
npm install
npx expo start
```

نزّل تطبيق **Expo Go** على جوالك وامسح الـ QR اللي يطلع. سوّ حساب بإيميلك، وابدأ.

---

## التكلفة
- **Supabase**: الخطة المجانية تكفي للاستخدام الشخصي.
- **Claude**: الأجينت يستخدم `claude-opus-5-5` (4$ لكل مليون توكن داخل، 20$ لكل مليون خارج). الرسالة الوحدة تكلف تقريباً 2 إلى 10 سنت حسب طول المحادثة وكم أداة يستخدم. لما تطول المحادثة اضغط "محادثة جديدة" عشان تقل التكلفة. تقدر تتابع الاستهلاك من console.anthropic.com.

## أفكار للمرحلة الجاية
- إشعارات على الجوال (Push) لما رابط يوقف أو مهمة تتأخر
- ملخص صباحي يومي من الأجينت
- ربط GitHub عشان الأجينت يتابع الكوميتات والـ PRs
- بناء نسخة للمتجر عن طريق `eas build`
