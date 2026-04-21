

## GitHub Repo theke CRM Port korar Plan

Apnar GitHub e ekta ready CRM repo ache. Setar **purakhane code** ei Lovable project e ante hobe, tarpor Supabase connect kore edit korbo.

### Important Limitation (jana dorkar)

Lovable e direct GitHub repo **import** kora jay na akhono. Tai amader manual port korte hobe — but ami pura process ta automate kore debo.

---

### Step-by-step Plan

**Step 1 — Repo URL & Access**
- Apni amake **GitHub repo er URL** den (e.g. `https://github.com/username/crm-repo`)
- Repo ta **public** kina confirm korben. Private hole ami access korte parbo na — sekhetre apnake ZIP download kore upload korte hobe.

**Step 2 — Repo Analysis**
- Ami repo ta fetch kore dekhbo:
  - Tech stack ki (React/Next/Vite/etc.)
  - Folder structure
  - Dependencies (package.json)
  - Supabase already connected ache kina
  - Database schema / migrations ache kina
  - Environment variables ki ki lage

**Step 3 — Compatibility Check**
Ei Lovable project use kore: **TanStack Start + React 19 + Vite 7 + Tailwind v4**.

Apnar repo jodi different stack e thake (jemon Next.js, CRA, React Router DOM), tahole port korar somoy adapt korte hobe:
- `react-router-dom` → `@tanstack/react-router`
- `pages/` folder → `src/routes/` (file-based routing)
- API routes → TanStack server functions

**Step 4 — Code Port**
Ami repo theke ei file/folder gulo port korbo:
- `src/components/` — UI components
- `src/pages/` ba `src/routes/` — pages (routing convert kore)
- `src/lib/` , `src/hooks/`, `src/utils/` — helpers
- `src/types/` — TypeScript types
- Styles, assets, images
- `package.json` theke missing dependencies install

**Step 5 — Lovable Cloud (Supabase) Setup**
Apnar already Supabase ache. Duita option:

- **Option A:** Apnar existing Supabase project use kori (URL + anon key + service role key lagbe — Cloud settings e add korbo)
- **Option B:** Lovable Cloud enable kori (notun fresh Supabase, schema migrate kore debo)

Repo te jodi `supabase/migrations/` ba SQL schema thake, sheta Lovable Cloud e migrate kore debo.

**Step 6 — Auth & RLS**
- Supabase auth setup (email/password, Google, etc.)
- User roles table (admin/user) — security best practice mene
- RLS policies — protitiya table e

**Step 7 — Test & Fix**
- Build error fix
- Runtime error fix (browser console check kore)
- Routing test
- Database connection test

---

### Apnar theke ja ja lagbe (ekhuni)

1. **GitHub repo URL** — full link
2. Repo **public na private** — confirm
3. Apnar **Supabase project er URL + keys** (Option A chaile) — Project Settings → API theke pawa jabe
4. Repo te jodi **`.env.example`** thake, oitar content

---

### Technical Notes

- Port korar somoy `src/routeTree.gen.ts` automatic generate hobe — manually edit korbo na
- TanStack Start er Worker runtime e kichu Node-only package kaj kore na (e.g. `sharp`, `puppeteer`, raw `child_process`) — repo te oi rokom thakle alternative use korbo
- Visual look apnar repo er motoi rakhbo, sudhu structure adapt korbo

---

**Plan approve korle**, apni repo URL + Supabase keys diben, ami port shuru kore debo. Jodi koto baro repo (koy ta file) ta agei jante chai, URL pawar por ami inspect kore size estimate debo.

