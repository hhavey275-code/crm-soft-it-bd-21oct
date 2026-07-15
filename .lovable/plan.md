## Goal
Ekta private "Documents" section jekhane admin/superadmin company formation er PDF (EIN, TIN, BIN, Trade License, Articles of Incorporation, Tax Return, etc.) upload kore category-wise organize kore rakhbe. Sidebar theke click korle **extra password prompt** ashbe (login chara o), sohi password dile vault khulbe.

## Access Model
- **Route:** `/documents` — sidebar e "Documents" menu (lock icon), only visible to `superadmin` (ba tumi bolle admin o).
- **Double gate:**
  1. Already logged in (AuthContext)
  2. Vault password prompt (session-only unlock, refresh korle abar chaibe — safer). Password hash DB te thakbe (`site_settings.documents_vault_password_hash`), tumi settings e giye set/change korte parba.
- Wrong password 5 bar hole 10 min lock.

## Categories (default, editable)
- Articles of Incorporation
- EIN Letter
- TIN Certificate
- BIN Certificate
- Trade License
- Tax Return
- Bank Documents
- Other

Tumi settings e new category add/rename/delete korte parba.

## Storage
- Supabase Storage bucket: `company-documents` (**private**, RLS locked to superadmin).
- File download hobe **signed URL** diye (5 min expiry) — direct public link nai.

## Database
Notun table `public.company_documents`:
- `id`, `category` (text), `title`, `description`, `file_path` (storage key), `file_size`, `mime_type`, `uploaded_by`, `expires_at` (optional — license expiry reminder), `tags` (text[]), `created_at`, `updated_at`
- RLS: only superadmin SELECT/INSERT/UPDATE/DELETE.
- `site_settings` e 2 ta column: `documents_vault_password_hash`, `documents_vault_categories` (jsonb array).

## UI (`/documents`)
- **Unlock screen:** password input → unlock (session storage e flag, tab close hole gone).
- **Vault dashboard:**
  - Top: Search bar + "Upload" button + category filter chips
  - Left: Category sidebar with count (e.g. "EIN (2)", "Trade License (1)")
  - Main: Card grid — each card shows: category badge, title, upload date, expiry (if set, red if soon), file size, actions (Preview PDF, Download, Edit meta, Delete)
  - PDF preview inline (iframe with signed URL)
- **Upload dialog:** category dropdown, title, description, optional expiry date, tags, file picker (PDF/image accepted, max 20MB).
- **Expiry alerts:** dashboard e top e banner — "Trade License expires in 15 days".

## Security Notes
- Vault password ≠ login password (nijer alada mone rakhte hobe).
- Password bcrypt/scrypt hash kore DB te (never plain).
- Signed URLs short-lived (300s).
- All access logged to `system_logs` (who viewed/downloaded which doc, when).
- Session unlock flag e sessionStorage use korbo (localStorage na) — tab close = auto lock.

## Implementation Steps
1. Migration: `company_documents` table + `site_settings` columns + RLS policies + `company-documents` storage bucket + storage policies.
2. Server functions: `unlock-vault` (verify password), `set-vault-password`, `upload-document`, `get-signed-url`, `delete-document`.
3. Frontend:
   - `src/routes/documents.tsx` (route)
   - `src/components/pages/DocumentsVaultPage.tsx`
   - `src/components/vault/VaultUnlock.tsx`
   - `src/components/vault/DocumentGrid.tsx`
   - `src/components/vault/UploadDocumentDialog.tsx`
   - `src/components/vault/DocumentCard.tsx`
   - Vault password setter in `SettingsContent.tsx` (superadmin only)
4. Sidebar link add (lock icon, superadmin only).
5. Expiry cron: pg_cron daily job → notification if any doc expires in ≤30 days.

## Questions before I build
1. **Access:** Sudhu tumi (superadmin), naki admin ra o dekhbe?
2. **Vault password:** Ekhoni ekta default set kore dibo (tumi porey change korba) naki first visit e setup korbe?
3. **Expiry reminder:** Push notification, in-app notification, ba dono?
4. **File types:** Sudhu PDF, naki JPG/PNG scan o allow korbo?

Bolo, tarpor implement kori.