# Stripe Radar Tuning Guide — কম Decline পেতে

Manual payment link পাঠানোর পর Stripe Radar যেন বার বার card decline না করে — এজন্য এই setup গুলো করুন।

## 1. Code-level (already done ✅)

আমাদের `create-stripe-checkout` function এই signals automatically পাঠায়:

- ✅ **Persistent Customer object** — একই client এর জন্য সব সময় একই Stripe Customer ID reuse করি (trust history build হয়)
- ✅ **Required billing address** — AVS match হয় → Radar trust বাড়ে
- ✅ **Phone number collection** — fraud signal কমে
- ✅ **Rich metadata** — `internal_user_id`, `created_by_admin`, `purpose` সব pass করি
- ✅ **Statement descriptor** — `TOPUP` suffix → chargeback কমে
- ✅ **Customer name + email + phone + company** — Stripe Customer object এ save থাকে

## 2. Stripe Dashboard Settings

### A. Webhook Setup (must do)
1. https://dashboard.stripe.com/webhooks → **Add endpoint**
2. URL: `https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/stripe-webhook`
3. Events:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`
4. Webhook signing secret টা copy করে `STRIPE_WEBHOOK_SECRET` secret এ বসান

### B. Radar Rules (Dashboard → Radar → Rules)

**Block বন্ধ করুন এই rules গুলো** (যদি থাকে):
```
Block if :card_country: != :ip_country:
Block if :risk_level: = 'elevated'
```
এগুলো legit international clients block করে।

**Review-তে পাঠান** এই rules:
```
Review if :risk_level: = 'highest'
Review if :amount_in_usd: > 5000
```

**Allow rule যোগ করুন** trusted customers এর জন্য (optional):
```
Allow if :customer_id: IN ('cus_xxx', 'cus_yyy')  
```
অথবা better:
```
Allow if :customer: HAS_TAG 'trusted_admin_topup'
```
তারপর Customer page এ গিয়ে আপনার regular client দের `trusted_admin_topup` tag দিন।

### C. Radar Settings (Dashboard → Radar → Settings)
- ✅ **Block all payments with risk score above**: `75` (default 65 অনেক aggressive)
- ✅ **Request 3D Secure on elevated risk**: ON (decline এর বদলে 3DS challenge হবে)
- ✅ **Require CVC**: ON
- ✅ **Block payments with mismatched zip code**: OFF (international clients এর জন্য)

### D. Risk Insights দেখুন
Dashboard → Radar → Reviews — কোন rule সবচেয়ে বেশি block করছে দেখুন, সেটা loosen করুন।

## 3. Client কে কি বলবেন

Payment link পাঠানোর সময় client কে জানান:
- "**ঠিক ঐ name + address দাও যেটা card statement এ আছে**"
- "**3D Secure (OTP) আসলে complete করো** — এটা security এর জন্য, fraud না"
- যদি এক বার decline হয়, **৫-১০ মিনিট পরে retry** করতে বলুন (Radar cooldown)

## 4. Decline হলে কি দেখবেন

Admin panel → **Stripe Payment Links** page → "Failure" column এ Stripe থেকে আসা reason দেখাবে:

| Failure Code | মানে | কি করবেন |
|---|---|---|
| `card_declined` + `generic_decline` | Issuer block | Client কে bank এ call করতে বলুন |
| `card_declined` + `do_not_honor` | Bank fraud check | অন্য card দিয়ে try, বা 3DS-enabled card |
| `insufficient_funds` | Balance নাই | Client জানে |
| `card_declined` + `fraudulent` | Stripe Radar block | Radar rules loosen করুন (উপরে B section) |
| `incorrect_cvc` | Wrong CVC | Client retry |
| `expired_card` | Card মেয়াদ শেষ | New card |

## 5. Long-term: Trust Build

প্রতিটি client এর প্রথম payment হয়তো risk-flag হবে। কিন্তু same `stripe_customer_id` reuse করায় ২-৩ successful payment এর পর Radar ঐ customer কে trust করে — declines অনেক কমে যায়।

---

**সমস্যা হলে**: Stripe Dashboard → Payments → declined payment এ click করুন → "Risk insights" tab এ exact reason পাবেন।
