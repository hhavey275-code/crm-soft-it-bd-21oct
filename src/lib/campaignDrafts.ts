// Unpublished campaigns saved in this browser. Each draft has its own id, so several can be kept.
export type CampaignDraft = { id: string; updatedAt: number; data: Record<string, any> };

const KEY = "myads-drafts-v2";

export function listDrafts(): CampaignDraft[] {
  try {
    const legacy = localStorage.getItem("myads-wizard-draft");
    const list: CampaignDraft[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (legacy) {
      const d = JSON.parse(legacy);
      if (d?.phase === "edit") list.push({ id: crypto.randomUUID(), updatedAt: Date.now(), data: d });
      localStorage.removeItem("myads-wizard-draft");
      localStorage.setItem(KEY, JSON.stringify(list));
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

export function saveDraft(id: string, data: Record<string, any>) {
  const list = listDrafts().filter((d) => d.id !== id);
  list.unshift({ id, updatedAt: Date.now(), data });
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("myads-drafts"));
}

export function deleteDraft(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listDrafts().filter((d) => d.id !== id)));
  window.dispatchEvent(new Event("myads-drafts"));
}
