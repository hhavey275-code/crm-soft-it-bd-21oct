import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Loader2, X, MessageCircle, MousePointer, ThumbsUp, Eye, ShoppingCart, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { managedAds } from "@/lib/managedAdsApi";

const OBJECTIVES = [
  { v: "SALES", l: "Sales", d: "Website-এ purchase/lead (Pixel দিয়ে)", icon: ShoppingCart },
  { v: "MESSAGES", l: "Messages", d: "Messenger-এ message আনুন", icon: MessageCircle },
  { v: "TRAFFIC", l: "Traffic", d: "Website-এ visitor পাঠান", icon: MousePointer },
  { v: "ENGAGEMENT", l: "Engagement", d: "Post-এ like/comment/share", icon: ThumbsUp },
  { v: "AWARENESS", l: "Awareness", d: "বেশি মানুষের কাছে পৌঁছান", icon: Eye },
] as const;

const EVENTS = [
  ["PURCHASE", "Purchase"], ["ADD_TO_CART", "Add to cart"], ["INITIATE_CHECKOUT", "Initiate checkout"],
  ["LEAD", "Lead"], ["COMPLETE_REGISTRATION", "Complete registration"], ["CONTACT", "Contact"], ["VIEW_CONTENT", "View content"],
] as const;

interface Props {
  accounts: { id: string; account_id: string; name: string; kind: "shared" | "own" }[];
  allPages: any[];
  walletBalance: number;
  onClose: () => void;
  onCreated: () => void;
}

export function ManagedCreateWizard({ accounts, allPages, walletBalance, onClose, onCreated }: Props) {
  const [accId, setAccId] = useState(accounts[0]?.id ?? "");
  const acc = accounts.find((a) => a.id === accId);
  const pages = allPages.filter((p) => p.status !== "rejected");
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pageDbId, setPageDbId] = useState(pages[0]?.id ?? "");
  const pickAccount = (id: string) => {
    setAccId(id);
    const a = accounts.find((x) => x.id === id);
    const first = allPages.find((p) => p.status !== "rejected");
    setPageDbId(first?.id ?? "");
  };
  const [objective, setObjective] = useState<(typeof OBJECTIVES)[number]["v"]>("MESSAGES");
  const [campaignName, setCampaignName] = useState("New Campaign");
  const [adsetName, setAdsetName] = useState("New Ad Set");
  const [adName, setAdName] = useState("New Ad");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [amount, setAmount] = useState("5");
  const [endTime, setEndTime] = useState("");
  const [bidStrategy, setBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState("");
  const [countries, setCountries] = useState("BD");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [gender, setGender] = useState("all");
  const [interests, setInterests] = useState<{ id: string; name: string }[]>([]);
  const [iq, setIq] = useState("");
  const [iResults, setIResults] = useState<any[]>([]);
  const [creativeMode, setCreativeMode] = useState<"post" | "new">("post");
  const [postId, setPostId] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState<{ b64: string; url: string } | null>(null);
  const [pixels, setPixels] = useState<any[] | null>(null);
  const [pixelId, setPixelId] = useState("");
  const [customEvent, setCustomEvent] = useState("PURCHASE");
  const [posts, setPosts] = useState<any[] | null>(null);
  const [postsNeedAccess, setPostsNeedAccess] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // Pixels of the chosen ad account (for Sales)
  useEffect(() => {
    setPixels(null); setPixelId("");
    if (objective !== "SALES" || !accId || !pageDbId) return;
    managedAds<{ pixels: any[] }>({ action: "pixels", pageDbId, adAccountDbId: accId })
      .then((r) => { setPixels(r.pixels); if (r.pixels[0]) setPixelId(r.pixels[0].id); })
      .catch((e) => { setPixels([]); toast.error(e.message); });
  }, [objective, accId, pageDbId]);

  const loadPosts = async () => {
    if (!accId || !pageDbId) return;
    setLoadingPosts(true);
    try {
      const r = await managedAds<{ posts: any[]; needsAccess?: boolean }>({ action: "posts", pageDbId, adAccountDbId: accId });
      setPosts(r.posts); setPostsNeedAccess(!!r.needsAccess);
    } catch (e: any) { setPosts([]); toast.error(e.message); } finally { setLoadingPosts(false); }
  };
  useEffect(() => { setPosts(null); setPostId(""); }, [accId, pageDbId]);
  useEffect(() => { if (step === 2 && creativeMode === "post" && posts === null) loadPosts(); }, [step, creativeMode, posts]);

  const requestAccess = async () => {
    try {
      await managedAds({ action: "request_page_access", pageDbId, adAccountDbId: accId });
      toast.success("Request পাঠানো হয়েছে — Page-এর admin Facebook-এ (Settings → Business access / notification) request accept করলে চালু হবে");
    } catch (e: any) { toast.error(e.message); }
  };

  const page = pages.find((p) => p.id === pageDbId);
  const amt = Number(amount) || 0;
  const overWallet = acc?.kind !== "own" && amt > walletBalance;

  const searchInterests = async () => {
    if (iq.trim().length < 2) return;
    try {
      const r = await managedAds<{ interests: any[] }>({ action: "interests", pageDbId, adAccountDbId: accId, q: iq.trim() });
      setIResults(r.interests);
    } catch (e: any) { toast.error(e.message); }
  };

  const onImage = (f?: File) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("ছবি ৫MB-এর কম হতে হবে");
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      setImage({ b64: s.split(",")[1], url: s });
    };
    reader.readAsDataURL(f);
  };

  const parsePostId = (v: string) => {
    const m = v.match(/(?:posts|videos|permalink\/|story_fbid=|fbid=)\/?(\d{5,})/);
    return m ? m[1] : v.trim();
  };

  const submit = async (publish: boolean) => {
    if (!accId) return toast.error("Ad account বাছুন");
    if (!pageDbId) return toast.error("Page বাছুন");
    if (overWallet) return toast.error("Wallet balance-এর বেশি budget দেওয়া যাবে না");
    if (objective === "SALES" && !pixelId) return toast.error("Pixel / Dataset বাছুন");
    setSaving(true);
    try {
      await managedAds({
        action: "create", pageDbId, adAccountDbId: accId, objective,
        pixelId: objective === "SALES" ? pixelId : undefined,
        customEvent: objective === "SALES" ? customEvent : undefined, campaignName, adsetName, adName,
        budgetType, amount: amt,
        endTime: budgetType === "lifetime" && endTime ? new Date(endTime).toISOString() : undefined,
        bidStrategy, bidAmount: bidAmount ? Number(bidAmount) : undefined,
        countries: countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => c.length === 2),
        ageMin: Number(ageMin), ageMax: Number(ageMax),
        genders: gender === "male" ? [1] : gender === "female" ? [2] : [],
        interests,
        existingPostId: creativeMode === "post" && postId ? parsePostId(postId) : undefined,
        message: creativeMode === "new" ? message : undefined,
        headline: creativeMode === "new" ? headline : undefined,
        link: creativeMode === "new" || objective === "SALES" ? link : undefined,
        imageBase64: creativeMode === "new" ? image?.b64 : undefined,
        publish,
      });
      toast.success(publish ? "Ad publish হয়েছে — Meta review-এর পর চালু হবে" : "Draft (বন্ধ অবস্থায়) তৈরি হয়েছে");
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const steps = ["Campaign", "Ad Set", "Ad"];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onClose}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-xl font-bold">নতুন Campaign</h1>
      </div>
      <div className="flex gap-2">
        {steps.map((s, i) => (
          <button key={s} onClick={() => setStep(i)}
            className={cn("flex-1 rounded-md border px-3 py-2 text-sm text-left", step === i ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground")}>
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="space-y-4 pt-6">
            {step === 0 && (
              <>
                <div>
                  <Label>Ad account</Label>
                  <Select value={accId} onValueChange={pickAccount}>
                    <SelectTrigger><SelectValue placeholder="Ad account বাছুন" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({a.account_id}) — {a.kind === "shared" ? "Shared, wallet থেকে খরচ" : "আমার নিজের account"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {acc?.kind === "own" ? "খরচ এই ad account-এর নিজের limit থেকে যাবে, wallet থেকে কাটবে না।" : "খরচ প্রতি ১৫ মিনিটে আপনার wallet থেকে কাটা হবে।"}
                  </p>
                </div>
                <div>
                  <Label>Page</Label>
                  <Select value={pageDbId} onValueChange={setPageDbId}>
                    <SelectTrigger><SelectValue placeholder="Page বাছুন" /></SelectTrigger>
                    <SelectContent>{pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.page_name}</SelectItem>)}</SelectContent>
                  </Select>
                  {!pages.length && <p className="text-xs text-destructive mt-1">কোনো page নেই — আগে "My Pages" থেকে Facebook দিয়ে page যুক্ত করুন।</p>}
                </div>
                <div>
                  <Label>Campaign objective</Label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {OBJECTIVES.map((o) => (
                      <button key={o.v} onClick={() => setObjective(o.v)}
                        className={cn("flex items-start gap-3 rounded-md border p-3 text-left", objective === o.v ? "border-primary bg-primary/5" : "hover:border-primary/50")}>
                        <o.icon className="h-5 w-5 mt-0.5 text-primary" />
                        <div><p className="text-sm font-medium">{o.l}</p><p className="text-xs text-muted-foreground">{o.d}</p></div>
                      </button>
                    ))}
                  </div>
                </div>
                {objective === "SALES" && (
                  <div className="grid gap-3 sm:grid-cols-2 rounded-md border p-3">
                    <div>
                      <Label>Pixel / Dataset</Label>
                      <Select value={pixelId} onValueChange={setPixelId}>
                        <SelectTrigger><SelectValue placeholder={pixels === null ? "লোড হচ্ছে…" : "Pixel বাছুন"} /></SelectTrigger>
                        <SelectContent>{(pixels ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.id})</SelectItem>)}</SelectContent>
                      </Select>
                      {pixels && pixels.length === 0 && <p className="text-xs text-destructive mt-1">এই ad account-এ কোনো Pixel/Dataset নেই — admin-কে বলুন।</p>}
                    </div>
                    <div>
                      <Label>Conversion event</Label>
                      <Select value={customEvent} onValueChange={setCustomEvent}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{EVENTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-2"><Label>Website link (যেখানে কিনবে)</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." /></div>
                  </div>
                )}
                <div><Label>Campaign নাম</Label><Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} /></div>
              </>
            )}

            {step === 1 && (
              <>
                <div><Label>Ad Set নাম</Label><Input value={adsetName} onChange={(e) => setAdsetName(e.target.value)} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Budget ধরন</Label>
                    <Select value={budgetType} onValueChange={(v) => setBudgetType(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="daily">Daily budget</SelectItem><SelectItem value="lifetime">Lifetime budget</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>পরিমাণ ($)</Label>
                    <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                    {acc?.kind !== "own" && <p className={cn("text-xs mt-1", overWallet ? "text-destructive" : "text-muted-foreground")}>Wallet: ${walletBalance.toFixed(2)}</p>}
                  </div>
                  {budgetType === "lifetime" && (
                    <div><Label>শেষ তারিখ</Label><Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Bid strategy</Label>
                    <Select value={bidStrategy} onValueChange={setBidStrategy}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOWEST_COST_WITHOUT_CAP">Highest volume (auto)</SelectItem>
                        <SelectItem value="COST_CAP">Cost per result goal</SelectItem>
                        <SelectItem value="LOWEST_COST_WITH_BID_CAP">Bid cap</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {bidStrategy !== "LOWEST_COST_WITHOUT_CAP" && (
                    <div><Label>Bid amount ($)</Label><Input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} /></div>
                  )}
                </div>
                <div className="border-t pt-4 space-y-3">
                  <p className="font-medium text-sm">Audience</p>
                  <div><Label>দেশ (কোড, কমা দিয়ে)</Label><Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="BD, IN" /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>বয়স থেকে</Label><Input type="number" min={18} max={65} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></div>
                    <div><Label>পর্যন্ত</Label><Input type="number" min={18} max={65} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></div>
                    <div>
                      <Label>Gender</Label>
                      <Select value={gender} onValueChange={setGender}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="all">সবাই</SelectItem><SelectItem value="male">পুরুষ</SelectItem><SelectItem value="female">নারী</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Detailed targeting (interest)</Label>
                    <div className="flex gap-2">
                      <Input value={iq} onChange={(e) => setIq(e.target.value)} placeholder="যেমন: Fashion" onKeyDown={(e) => e.key === "Enter" && searchInterests()} />
                      <Button variant="outline" onClick={searchInterests}>খুঁজুন</Button>
                    </div>
                    {iResults.length > 0 && (
                      <div className="mt-2 max-h-40 overflow-auto rounded-md border">
                        {iResults.map((i) => (
                          <button key={i.id} className="flex w-full justify-between px-3 py-1.5 text-sm hover:bg-muted"
                            onClick={() => { if (!interests.some((x) => x.id === i.id)) setInterests([...interests, { id: i.id, name: i.name }]); }}>
                            <span>{i.name}</span>
                            {i.audience && <span className="text-xs text-muted-foreground">{Number(i.audience).toLocaleString()}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {interests.map((i) => (
                        <Badge key={i.id} variant="secondary" className="gap-1">{i.name}
                          <X className="h-3 w-3 cursor-pointer" onClick={() => setInterests(interests.filter((x) => x.id !== i.id))} />
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div><Label>Ad নাম</Label><Input value={adName} onChange={(e) => setAdName(e.target.value)} /></div>
                <div className="flex gap-2">
                  <Button size="sm" variant={creativeMode === "post" ? "default" : "outline"} onClick={() => setCreativeMode("post")}>পুরোনো post ব্যবহার</Button>
                  <Button size="sm" variant={creativeMode === "new" ? "default" : "outline"} disabled={objective === "ENGAGEMENT"} onClick={() => setCreativeMode("new")}>নতুন ad বানান</Button>
                </div>
                {creativeMode === "post" ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>{page?.page_name}-এর post বাছুন</Label>
                      <Button size="sm" variant="ghost" disabled={loadingPosts} onClick={loadPosts}>{loadingPosts ? "লোড হচ্ছে…" : "আবার আনুন"}</Button>
                    </div>
                    {postsNeedAccess && (
                      <div className="rounded-md border border-destructive/50 p-3 text-sm space-y-2">
                        <p>এই Page এখনো আমাদের Business Manager-কে access দেয়নি, তাই post দেখা ও ad চালানো যাবে না।</p>
                        <Button size="sm" onClick={requestAccess}>Page access request পাঠান</Button>
                        <p className="text-xs text-muted-foreground">Request পাঠানোর পর Page-এর admin Facebook-এ accept করবেন, তারপর "আবার আনুন" চাপুন।</p>
                      </div>
                    )}
                    {posts && posts.length > 0 && (
                      <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2">
                        {posts.map((p) => (
                          <button key={p.id} type="button" onClick={() => setPostId(p.id)}
                            className={cn("relative flex gap-2 rounded-md border p-2 text-left text-xs", postId === p.id ? "border-primary bg-primary/5" : "hover:border-primary/50")}>
                            {p.picture ? <img src={p.picture} alt="" className="h-14 w-14 shrink-0 rounded object-cover" /> : <div className="h-14 w-14 shrink-0 rounded bg-muted" />}
                            <span className="line-clamp-3">{p.message || "(লেখা নেই)"}</span>
                            {postId === p.id && <Check className="absolute right-1 top-1 h-4 w-4 text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {posts && posts.length === 0 && !postsNeedAccess && <p className="text-xs text-muted-foreground">কোনো post পাওয়া যায়নি।</p>}
                    <Input value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="অথবা post link / ID লিখুন" />
                  </div>
                ) : (
                  <>
                    <div><Label>Primary text</Label><Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
                    <div><Label>Headline</Label><Input value={headline} onChange={(e) => setHeadline(e.target.value)} /></div>
                    {objective !== "MESSAGES" && objective !== "SALES" && <div><Label>Website link</Label><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." /></div>}
                    <div><Label>ছবি</Label><Input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} /></div>
                  </>
                )}
              </>
            )}

            <div className="flex justify-between border-t pt-4">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>পেছনে</Button>
              {step < 2 ? (
                <Button onClick={() => setStep(step + 1)}>পরের ধাপ</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" disabled={saving} onClick={() => submit(false)}>Draft রাখুন</Button>
                  <Button disabled={saving || overWallet} onClick={() => submit(true)}>
                    {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Publish
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle className="text-sm">Ad preview</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 p-3">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div><p className="text-sm font-semibold">{page?.page_name ?? "Page"}</p><p className="text-xs text-muted-foreground">Sponsored</p></div>
              </div>
              {creativeMode === "post" ? (() => {
                const sp = posts?.find((p) => p.id === postId);
                return sp ? (
                  <>
                    {sp.message && <p className="px-3 pb-2 text-sm whitespace-pre-line line-clamp-6">{sp.message}</p>}
                    {sp.picture && <img src={sp.picture} alt="" className="w-full object-cover" />}
                  </>
                ) : <p className="px-3 pb-6 text-sm text-muted-foreground">{postId ? "আপনার বাছাই করা post-টি এখানে দেখাবে" : "একটি post বাছুন"}</p>;
              })() : (
                <>
                  {message && <p className="px-3 pb-2 text-sm whitespace-pre-line">{message}</p>}
                  {image ? <img src={image.url} alt="" className="w-full aspect-square object-cover" /> : <div className="aspect-square bg-muted" />}
                  <div className="flex items-center justify-between bg-muted/50 p-3">
                    <p className="text-sm font-semibold truncate">{headline || "Headline"}</p>
                    <Button size="sm" variant="secondary">{objective === "MESSAGES" ? "Send message" : "Learn more"}</Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
