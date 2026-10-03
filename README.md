# مشاريعي 📁🤖

تطبيق جوال خاص فيك (iOS و Android) لمتابعة مشاريعك وأفكارك، ومعه أجينت ذكي (Claude) يتابع مشاريعك، يراقب تطبيقاتك ومواقعك، ويحلل نشاطك.

## وش فيه

| التبويب | وش يسوي |
|---|---|
| **مشاريعي** | المشاريع والأفكار بحالاتها (فكرة / شغال / متوقف / منتهي)، المهام، نسبة الإنجاز، والمتأخر |
| **الأجينت** | محادثة مع Claude: يقرأ بياناتك الحقيقية، يضيف ويعدّل مشاريع ومهام، يقترح الخطوات الجاية |
| **المراقبة** | تحط روابط تطبيقاتك ومواقعك والـ APIs، ويفحصها: شغال أو واقف، السرعة، ونسبة التشغيل خلال 24 ساعة |
| **نشاطي** | كل حركة تسويها في التطبيق تنسجل: أيام متتالية، مهام منجزة، رسم بياني يومي |

ومعها:
- **☀️ ملخص صباحي**: كل يوم بالساعة اللي تختارها، الأجينت يقرأ مشاريعك ومهامك وروابطك و GitHub ويرسل لك ملخص قصير كإشعار، ويطلع بعد في أعلى شاشة مشاريعي.
- **🔔 إشعارات على الجوال**: لما رابط من روابطك يوقف أو يرجع يشتغل.
- **🐙 GitHub**: تربط مستودع بأي مشروع، وتشوف الكوميتات والـ PRs المفتوحة، والأجينت يتابعها معك.

الأجينت يقدر:
- `list_projects` / `get_project`: يشوف مشاريعك ومهامك وتقدمها
- `create_project` / `update_project` / `create_task` / `update_task`: يضيف ويعدّل (بس لما تطلب)
- `get_monitors_status` / `check_monitors_now` / `add_monitor`: يراقب روابطك
- `get_activity`: يحلل استخدامك ويطلع لك المشاريع المهملة
- `get_github_activity` / `link_github_repo`: يتابع مستودعاتك ويربطها بالمشاريع

## البنية

```
mobile/                      تطبيق Expo (React Native + TypeScript + Expo Router)
  src/app/(tabs)/            الشاشات: مشاريعي، الأجينت، المراقبة، نشاطي
  src/app/project/[id].tsx   تفاصيل المشروع والمهام
  src/lib/                   الاتصال بـ Supabase وتسجيل النشاط
supabase/
  migrations/0001_init.sql   الجداول + الحماية (RLS): كل مستخدم يشوف بياناته فقط
  migrations/0002_*.sql      الإشعارات، الملخص الصباحي، مستودعات GitHub
  functions/agent/           الأجينت (Claude + الأدوات). مفتاح Claude يبقى هنا في السيرفر
  functions/monitor-check/   فحص الروابط + إشعار لما رابط يوقف أو يرجع
  functions/daily-brief/     الملخص الصباحي (مجدول كل ساعة، أو من زر في التطبيق)
  functions/github/          نشاط مستودعات المشروع لشاشة المشروع
```

مفتاح Claude **ما يكون في الجوال أبداً**. التطبيق يكلم دالة `agent` في Supabase، وهي اللي تكلم Claude.

---

## التشغيل خطوة بخطوة

### 1) سوّ مشروع Supabase (مجاني)
1. ادخل [supabase.com](https://supabase.com) وسوّ مشروع جديد.
2. من **SQL Editor** الصق محتوى `supabase/migrations/0001_init.sql` كامل واضغط **Run**، وبعده نفس الشي مع `0002_push_briefs_github.sql`.
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

# اختياري: لمتابعة المستودعات الخاصة (وبدونه حد GitHub 60 طلب بالساعة)
# سوّ fine-grained token من github.com/settings/tokens بصلاحية قراءة فقط (Contents + Pull requests + Metadata)
npx supabase secrets set GITHUB_TOKEN=github_pat_...

npx supabase functions deploy agent
npx supabase functions deploy monitor-check
npx supabase functions deploy daily-brief
npx supabase functions deploy github
```

> رمز المشروع (project ref) تلقاه في رابط لوحة التحكم: `supabase.com/dashboard/project/<الرمز>`

### 4) فعّل الجدولة: فحص الروابط كل 10 دقائق + الملخص الصباحي
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

-- الملخص الصباحي: يشيك كل ساعة مين وصلت ساعته المختارة
select cron.schedule(
  'daily-brief',
  '5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<الرمز>.supabase.co/functions/v1/daily-brief',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
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

### 6) فعّل إشعارات الجوال
الإشعارات تحتاج خطوتين زيادة (مرة وحدة بس):

```bash
cd mobile
npx eas-cli@latest login     # حساب Expo مجاني
npx eas-cli@latest init      # يربط التطبيق بمشروع EAS ويضيف projectId في app.json
```

بعدها:
- **Android**: Expo Go ما يدعم الإشعارات، فتحتاج نسخة تطوير: `npx eas-cli@latest build --profile development --platform android` وتثبّتها على جوالك.
- **iPhone**: نفس الأمر بـ `--platform ios` (يحتاج حساب Apple Developer).

وبعد ما تثبّت النسخة، افتح **الإعدادات** في التطبيق ← «فعّل الإشعارات على هذا الجوال»، واختر ساعة الملخص الصباحي.

> كل شي ثاني (المشاريع، الأجينت، المراقبة، الملخص داخل التطبيق) يشتغل عادي في Expo Go بدون هالخطوة.

---

## التكلفة
- **Supabase**: الخطة المجانية تكفي للاستخدام الشخصي.
- **Claude**: الملخص الصباحي يكلف تقريباً 1 إلى 3 سنت باليوم. الأجينت يستخدم `claude-opus-5-5` (4$ لكل مليون توكن داخل، 20$ لكل مليون خارج). الرسالة الوحدة تكلف تقريباً 2 إلى 10 سنت حسب طول المحادثة وكم أداة يستخدم. لما تطول المحادثة اضغط "محادثة جديدة" عشان تقل التكلفة. تقدر تتابع الاستهلاك من console.anthropic.com.

## أفكار للمرحلة الجاية
- تنبيه لما مهمة مهمة تقرب من موعدها
- مراقبة أخطاء التطبيق نفسه (Sentry) وربطها بالأجينت
- ويدجت على الشاشة الرئيسية للجوال
- بناء نسخة للمتجر عن طريق `eas build`
