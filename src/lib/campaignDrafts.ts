// Unpublished campaigns saved in this browser, scoped per logged-in user so one
// user's drafts never appear for another user on the same device.
export type CampaignDraft = { id: string; updatedAt: number; data: Record<string, any> };

const KEY = "myads-drafts-v2";
const keyFor = (uid?: string) => (uid ? `${KEY}:${uid}` : KEY);

export function listDrafts(uid?: string): CampaignDraft[] {
  try {
    const legacy = localStorage.getItem("myads-wizard-draft");
    const list: CampaignDraft[] = JSON.parse(localStorage.getItem(keyFor(uid)) || "[]");
    if (legacy) {
      const d = JSON.parse(legacy);
      if (d?.phase === "edit") list.push({ id: crypto.randomUUID(), updatedAt: Date.now(), data: d });
      localStorage.removeItem("myads-wizard-draft");
      localStorage.setItem(keyFor(uid), JSON.stringify(list));
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function saveDraft(id: string, data: Record<string, any>, uid?: string) {
  const list = listDrafts(uid).filter((d) => d.id !== id);
  list.unshift({ id, updatedAt: Date.now(), data });
  localStorage.setItem(keyFor(uid), JSON.stringify(list));
  window.dispatchEvent(new Event("myads-drafts"));
}

export function deleteDraft(id: string, uid?: string) {
  localStorage.setItem(keyFor(uid), JSON.stringify(listDrafts(uid).filter((d) => d.id !== id)));
  window.dispatchEvent(new Event("myads-drafts"));
}
