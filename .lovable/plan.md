# CRM Helper invalid-token স্থায়ী সমাধান

## কী বদলাবে
- Helper job token তৈরি ও যাচাই—দুটিই একই published Lovable server endpoint-এ হবে।
- Dashboard থেকে request পাঠানোর সময় বর্তমান admin login যাচাই করা হবে; admin ছাড়া token তৈরি হবে না।
- Top-up ও Teach—দুই flow একই নিয়মে চলবে।
- Cross-domain request-এর প্রয়োজনীয় অনুমতি যোগ হবে।
- Helper version বাড়িয়ে download button ও ZIP-এ একই version দেখানো হবে।

## যাচাই
- Invalid token দিয়ে endpoint সঠিকভাবে reject করে কিনা পরীক্ষা।
- নতুন authenticated token একই endpoint-এ গ্রহণ হয় কিনা পরীক্ষা।
- Type check, build এবং packaged extension version যাচাই।

## সীমা
Admiki API না থাকায় helper browser-এর logged-in session ব্যবহার করেই form পূরণ করবে; CRM layout বদলালে আবার Teach লাগতে পারে।
