# Fix: Date-range Meta spend check log missing in system_logs

## সমস্যা

Apr 27 এর spend check করলেন Holy Gift v4 update দিয়ে — কোনো log entry আসেনি system_logs এ।

কারণ `get-account-insights/index.ts` এ logging block পুরোটাই এই condition এর ভেতরে আছে:

```ts
// line 784
if (!date && !date_from && !date_to) {
  // ... DB upsert + unhealthy events ...
}

// line 1135 — এই block ও কেবল উপরের branch এর ভেতরে evaluate হয়
if (source === "meta") {
  // api_call_logs insert
  // system_logs insert ("Meta Insights Refresh") ← এটা skip হচ্ছে
}
```

মানে যখনই `date_from`/`date_to` পাঠানো হয় (date-range spend report, single-day spend check, history check), পুরো logging block bypass হয়ে যায় — `proxy_ip`, `proxy=X direct=Y`, কিছুই log হয় না।

আগের patch এ আমি ধরে নিয়েছিলাম log block top-level এ আছে, কিন্তু আসলে nested ছিল।

## Fix

`get-account-insights/index.ts` এ system_logs insert এবং api_call_logs insert কে `if (!date && !date_from && !date_to)` block থেকে বের করে আনব। শুধু DB upsert ও `client_daily_stats`/`meta_account_events` write গুলো ওই branch এ থাকবে (ওগুলো শুধু default refresh এর জন্য valid)।

### পরিবর্তিত structure

```ts
if (!date && !date_from && !date_to) {
  // ad_account_insights upsert
  // client_daily_stats upsert
  // meta_account_events insert (unhealthy)
}

// 👇 এগুলো এখন সব branch এ run করবে
if (source === "meta") {
  // api_call_logs insert
  // system_logs insert with rangeLabel (already supports date_from..date_to)
}
```

`rangeLabel` already handles তিন case (`date_from..date_to`, `date`, `today/yesterday`), তাই কোনো extra change লাগবে না। Date-range query এর log এ দেখাবে:

```
Refreshed 47 ad account(s) [range=2026-04-27..2026-04-27] | calls=141 (proxy=141 100%, direct=0) | proxy_ip=...
```

## Deploy

`get-account-insights` redeploy করব। এরপর Apr 27 spend check আবার করলে system_logs এ entry আসবে।
