## Problem

Ad Account details page-e "Download extension" link click korle file download hoy na (plain `<a download>` Lovable preview-e auth jhamela-r karone fail kore). Ar download holeo bujha jay na version update hoyeche kina, karon filename always same: `dsl-sync-extension.zip`.

## Solution

### 1. Fetch+blob pattern diye actual download fix
**File:** `src/components/pages/AdAccountDetailPage.tsx` (lines 612-619)

Current `<a href download>` ke replace korbo button onClick handler diye ja Settings page-er card-remover extension-er moto fetch+blob use korbe (oi pattern already proven kaj kore).

### 2. Versioned filename
Download time-e filename hobe `dsl-sync-extension-v1.2.1.zip` — version number `extension/manifest.json` theke read kore constant hisebe rakhbo (`EXTENSION_VERSION = "1.2.1"`). User download korle filename dekhei bujhbe kon version peyeche, ar puratan version overwrite hobe na.

### 3. Button label-e version dekhabo
Link text update kore: **"Download extension v1.2.1"** korbo, jate download-er agei user dekhe latest version ki.

### 4. Future updates
Pore jokhon extension update hobe (manifest.json version bump), ekhane shudhu `EXTENSION_VERSION` constant ta update korte hobe — label ar download filename automatic update hobe.

## Implementation snippet

```tsx
const EXTENSION_VERSION = "1.2.1";

const handleDownloadExtension = () => {
  fetch("/dsl-sync-extension.zip")
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dsl-sync-extension-v${EXTENSION_VERSION}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Extension v${EXTENSION_VERSION} downloaded`);
    })
    .catch((err) => toast.error(err.message));
};

// JSX:
<button onClick={handleDownloadExtension} className="underline text-primary">
  Download extension v{EXTENSION_VERSION}
</button>
```

## Files Changed
- `src/components/pages/AdAccountDetailPage.tsx` — add `EXTENSION_VERSION` constant, `handleDownloadExtension` function, replace `<a>` with button
