

## "Lovable App not installed" — Fix Plan

### Asol Karon

Apni GitHub e Lovable App install korechen ✅ (screenshot e dekha jacche), kintu **ei workspace er sathe GitHub connection link kora nei**. Tai Lovable bujhte parche na je app ta install ache.

Confirm: workspace e ekhon **0 ta connection** ache.

---

### Solution — 2 Step e Fix

**Step 1: GitHub Connector add korun (ei project e)**

1. Bam dik er sidebar e **Connectors** click korun (root level e ache)
2. **GitHub** find korun
3. **"Connect project"** button click korun
4. Popup ashbe → apnar **GitHub account/organization** select korun (jeta te Lovable App install kora)
5. **"Create Repository"** click korun → Lovable notun ekta repo banabe ba existing er sathe link korbe

**Step 2: Onno project er jonno (jodi "transfer" lage)**

Jodi apni already onno ekta Lovable project er CRM ke ei workspace e anachhen:
- Connector flow e **"Transfer anyway"** option ashte pare
- Confirm korun → 2-way sync setup hobe automatically

---

### Common Mistakes (eigulo check korun)

1. **Wrong GitHub account** — Lovable App ki *personal account* e install, naki *organization* e? Connect korar somoy thik account select korte hobe.
2. **Repo deleted/renamed** — agei jodi connect chilo ar repo GitHub e delete/rename hoye thake → reconnect kaj korbe na. GitHub e repo restore korte hobe age.
3. **Multiple GitHub accounts** — ek Lovable account e ekhon ekta GitHub account-i connect kora jay. Onno account theke install thakle kaj korbe na.
4. **Organization permissions** — repo organization er hole, organization owner ke Lovable App approve korte hobe (GitHub → Org Settings → Third-party access)

---

### Apni ki korben

Ami tool diye direct GitHub connect korte parchi na — eta **apnake manually korte hobe** Connectors panel theke (security reason e user action lage).

Try korun:

1. Sidebar → **Connectors** → **GitHub** → Connect project
2. Hole — done ✅
3. Na hole — exact error message ba screenshot share korun, ami next step bolbo

---

### Jodi ekhono kaj na kore (Backup Plan)

- GitHub e jaan: https://github.com/settings/installations
- Lovable App er pashe **Configure** click korun
- "Repository access" e ensure korun apnar repo selected ache (All repos ba specific repo)
- Save → fire eshe abar Connectors → GitHub try korun

