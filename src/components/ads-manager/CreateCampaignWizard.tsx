import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Loader2, AlertCircle } from "lucide-react";
import { ObjectiveSelector } from "./ObjectiveSelector";
import { AdSetForm } from "./AdSetForm";
import { AdCreativeForm } from "./AdCreativeForm";
import { AdPreview } from "./AdPreview";
import { CONVERSION_EVENT_OPTIONS, ctaRequiresUrl, getDestinationOption, getDestinationsForObjective, getPagePictureUrl, requiresPixelForObjective, type ExistingPostPreviewData, type PageOption, type PixelOption } from "./types";

interface CreateCampaignWizardProps {
  accountId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface PublishErrorState {
  stage?: string;
  message: string;
  subcode?: number;
  postEligibilityIssue?: boolean;
  isDevelopmentModeIssue?: boolean;
}

const steps = ["Objective", "Campaign", "Ad Set", "Ad", "Review & Publish"];

export function CreateCampaignWizard({ accountId, onClose, onSuccess }: CreateCampaignWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [publishError, setPublishError] = useState<PublishErrorState | null>(null);

  const [objective, setObjective] = useState("");
  const [destination, setDestination] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignType, setCampaignType] = useState<"manual" | "advantage_plus">("manual");
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageAvatarUrl, setPageAvatarUrl] = useState("");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [budgetAmount, setBudgetAmount] = useState("10");
  const [placementType, setPlacementType] = useState<"advantage" | "manual">("advantage");
  const [selectedPlacements, setSelectedPlacements] = useState<string[]>([]);
  const [pixelId, setPixelId] = useState("");
  const [conversionEvent, setConversionEvent] = useState(CONVERSION_EVENT_OPTIONS[0].value);
  const [ctaType, setCtaType] = useState("LEARN_MORE");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [selectedExistingPost, setSelectedExistingPost] = useState<ExistingPostPreviewData | null>(null);
  const [targeting, setTargeting] = useState<{
    countries: string[];
    cities: Array<{ key: string; name: string }>;
    regions: Array<{ key: string; name: string }>;
    age_min: number;
    age_max: number;
    genders: number[];
    interests: Array<{ id: string; name: string }>;
    custom_audiences: Array<{ id: string; name: string }>;
    start_time?: string;
    end_time?: string;
  }>({
    countries: ["BD"],
    cities: [],
    regions: [],
    age_min: 18,
    age_max: 65,
    genders: [],
    interests: [],
    custom_audiences: [],
  });
  const [creative, setCreative] = useState({
    headline: "",
    message: "",
    description: "",
    link: "",
    image_url: "",
    object_story_id: "",
    video_url: "",
  });

  const ctaNeedsLink = ctaRequiresUrl(ctaType);
  const hasValidLink = !creative.link || /^https?:\/\//i.test(creative.link);
  const hasCreativeContent = !!creative.object_story_id || !!creative.message.trim() || !!creative.headline.trim() || !!creative.image_url || !!creative.video_url;
  const destinationOptions = getDestinationsForObjective(objective);
  const selectedDestination = getDestinationOption(objective, destination);
  const needsPixel = requiresPixelForObjective(objective, destination);
  const needsWhatsapp = !!selectedDestination?.needsWhatsapp || ctaType === "WHATSAPP_MESSAGE";

  // 1) Fetch BM pages first (primary source)
  const { data: bmPagesData, isLoading: bmPagesLoading } = useQuery({
    queryKey: ["ads-manager-bm-pages", accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "get_bm_pages", account_id: accountId },
      });
      if (error) throw error;
      return data as { pages: PageOption[]; source: string };
    },
  });

  const bmPages = bmPagesData?.pages || [];

  // BM-only: pages come exclusively from Business Manager System User token.
  const allPages = bmPages;
  const pagesLoading = bmPagesLoading;
  const noPages = !bmPagesLoading && allPages.length === 0;

  const { data: pixelsData, isLoading: pixelsLoading } = useQuery({
    queryKey: ["ads-manager-pixels", accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "get_pixels", account_id: accountId },
      });
      if (error) throw error;
      return data as { pixels: PixelOption[] };
    },
    enabled: needsPixel,
  });

  const pixels = pixelsData?.pixels || [];

  // When page is selected, also update pageName
  const handlePageSelect = (id: string) => {
    setPageId(id);
    const page = allPages.find((p) => p.id === id);
    setPageName(page?.name || "");
    setPageAvatarUrl(getPagePictureUrl(page) || "");
    setValidationErrors((prev) => ({ ...prev, pageId: false }));
  };

  // Validate before proceeding to next step
  const validateStep = (currentStep: number): boolean => {
    const errors: Record<string, boolean> = {};
    
    switch (currentStep) {
      case 0:
        if (!objective) errors.objective = true;
        if (objective && !destination) errors.destination = true;
        break;
      case 1:
        if (!campaignName.trim()) errors.campaignName = true;
        if (!pageId) errors.pageId = true;
        break;
      case 2:
        if (!budgetAmount || parseFloat(budgetAmount) < 1) errors.budgetAmount = true;
        if (targeting.countries.length === 0) errors.countries = true;
        if (budgetType === "lifetime") {
          if (!targeting.start_time) errors.start_time = true;
          if (!targeting.end_time) errors.end_time = true;
          if (targeting.start_time && targeting.end_time && new Date(targeting.end_time) <= new Date(targeting.start_time)) {
            errors.end_time = true;
          }
        }
        if (placementType === "manual" && selectedPlacements.length === 0) errors.placements = true;
        if (needsPixel && !pixelId) errors.pixelId = true;
        break;
      case 3:
        if (!hasCreativeContent) errors.creative = true;
        // For existing posts, button/link/CTA come from the original post — don't validate overrides.
        if (!creative.object_story_id) {
          if (ctaNeedsLink && !creative.link.trim()) errors.link = true;
          if (creative.link.trim() && !hasValidLink) errors.link = true;
          if (ctaType === "WHATSAPP_MESSAGE" && !whatsappNumber.trim()) errors.whatsappNumber = true;
        }
        break;
    }

    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      const fieldNames = Object.keys(errors).map(k => {
        const map: Record<string, string> = {
          objective: "Objective",
          destination: "Destination / Performance Goal",
          campaignName: "Campaign Name",
          pageId: "Facebook Page",
          budgetAmount: "Budget",
          countries: "Country",
          start_time: "Start Date",
          end_time: "End Date",
          placements: "Placement",
          creative: "Ad Creative (message, headline, or image)",
          link: "Website URL",
          whatsappNumber: "WhatsApp Number",
          pixelId: "Meta Pixel",
        };
        return map[k] || k;
      });
      toast.error(`Please fill in: ${fieldNames.join(", ")}`);
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(step + 1);
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const geoLocations: any = { countries: targeting.countries };
      if (targeting.cities.length > 0) {
        geoLocations.cities = targeting.cities.map((c) => ({ key: c.key }));
      }
      if (targeting.regions.length > 0) {
        geoLocations.regions = targeting.regions.map((r) => ({ key: r.key }));
      }

      const metaTargeting: any = {
        geo_locations: geoLocations,
        age_min: targeting.age_min,
        age_max: targeting.age_max,
      };
      if (targeting.genders.length > 0) {
        metaTargeting.genders = targeting.genders;
      }
      if (targeting.interests.length > 0) {
        metaTargeting.flexible_spec = [
          { interests: targeting.interests.map((i) => ({ id: i.id, name: i.name })) },
        ];
      }
      // Add lifetime schedule to targeting
      if (budgetType === "lifetime") {
        if (targeting.start_time) metaTargeting.start_time = targeting.start_time;
        if (targeting.end_time) metaTargeting.end_time = targeting.end_time;
      }

      // Send placements
      const placementsPayload = placementType === "manual" && selectedPlacements.length > 0
        ? { type: "manual", platforms: selectedPlacements }
        : { type: "advantage" };

      if (placementType === "manual" && selectedPlacements.length === 0) {
        throw new Error("[adset] Select at least one manual placement.");
      }

      if (needsPixel && !pixelId) {
        throw new Error("[adset] Select a Meta Pixel for Sales campaigns.");
      }

      if (budgetType === "lifetime") {
        if (!targeting.start_time || !targeting.end_time) {
          throw new Error("[adset] Start date and end date are required for lifetime budget.");
        }
        if (new Date(targeting.end_time) <= new Date(targeting.start_time)) {
          throw new Error("[adset] End date must be after start date.");
        }
      }

      if (!hasCreativeContent) {
        throw new Error("[creative] Add a message, headline, image, video, or existing post.");
      }

      // For existing posts, original post's button/link/text are inherited (Meta does
      // not allow overrides — subcode 1487929). Skip override-only validations.
      if (!creative.object_story_id) {
        if (ctaNeedsLink && !creative.link.trim()) {
          throw new Error("[creative] Website URL is required for this CTA.");
        }

        if (creative.link.trim() && !hasValidLink) {
          throw new Error("[creative] Website URL must start with http:// or https://.");
        }

        if (ctaType === "WHATSAPP_MESSAGE" && !whatsappNumber.trim()) {
          throw new Error("[creative] WhatsApp number is required for WhatsApp CTA.");
        }
      }

      let imageHash: string | undefined;
      let videoId: string | undefined;

      if (creative.image_url) {
        const { data: imgData } = await supabase.functions.invoke("ads-manager", {
          body: { action: "upload_image", account_id: accountId, image_url: creative.image_url },
        });
        if (imgData?.error) {
          throw new Error(`Image upload: ${imgData.error}`);
        }
        imageHash = imgData?.image_hash;
      }

      if (creative.video_url) {
        const { data: vidData } = await supabase.functions.invoke("ads-manager", {
          body: { action: "upload_video", account_id: accountId, video_url: creative.video_url },
        });
        if (vidData?.error) {
          throw new Error(`Video upload: ${vidData.error}`);
        }
        videoId = vidData?.video_id;
      }

      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: {
          action: "create_campaign",
          account_id: accountId,
          name: campaignName,
          objective,
          destination,
          page_id: pageId,
          budget_type: budgetType,
          budget_amount: parseFloat(budgetAmount),
          targeting: metaTargeting,
          campaign_type: campaignType,
          pixel_id: pixelId || undefined,
          conversion_event: conversionEvent,
          cta_type: ctaType,
          whatsapp_number: needsWhatsapp ? whatsappNumber : undefined,
          placements: placementsPayload,
          creative: {
            headline: creative.headline,
            message: creative.message,
            description: creative.description,
            link: creative.link,
            image_hash: imageHash,
            video_id: videoId,
            object_story_id: creative.object_story_id || undefined,
          },
        },
      });

      if (error) throw error;
      if (data?.ok === false || data?.error) {
        const msg = data.meta_user_msg || data.meta_user_title || data.error;
        const err: any = new Error(`[${data.stage || "unknown"}] ${msg}`);
        err.stage = data.stage;
        err.metaSubcode = data.meta_subcode;
        err.postEligibilityIssue = !!data.post_eligibility_issue;
        err.isDevelopmentModeIssue = !!data.is_development_mode_issue;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      setPublishError(null);
      toast.success(data?.review_submitted ? "Ad submitted to Meta for review" : "Campaign created successfully");
      queryClient.invalidateQueries({ queryKey: ["ads-manager-campaigns"] });
      onSuccess();
    },
    onError: (err: any) => {
      setPublishError({
        stage: err.stage,
        message: err.message,
        subcode: err.metaSubcode,
        postEligibilityIssue: err.postEligibilityIssue,
        isDevelopmentModeIssue: err.isDevelopmentModeIssue,
      });
      const subcodePart = err.metaSubcode ? ` (Meta subcode ${err.metaSubcode})` : "";
      toast.error(`${err.message}${subcodePart}`);
    },
  });

  const canNext = () => {
    switch (step) {
      case 0: return !!objective && !!destination;
      case 1: return !!campaignName && !!pageId;
      case 2: return parseFloat(budgetAmount) >= 1 && targeting.countries.length > 0 && (!needsPixel || !!pixelId);
      case 3: return hasCreativeContent;
      case 4: return true;
      default: return false;
    }
  };

  // Check if ad preview should show
  const showPreview = creative.message || creative.headline || creative.object_story_id || creative.image_url || creative.video_url || selectedExistingPost?.headline || selectedExistingPost?.ctaLabel;

  return (
    <div className="space-y-4">
      <Card className="border-dashed bg-muted/30">
        <CardContent className="grid gap-3 p-4 text-sm md:grid-cols-3">
          <div>
            <p className="font-semibold text-foreground">Campaign</p>
            <p className="text-muted-foreground">Objective, campaign name, page identity</p>
          </div>
          <div>
            <p className="font-semibold text-foreground">Ad Set</p>
            <p className="text-muted-foreground">Budget, schedule, audience, placements, pixel</p>
          </div>
          <div>
            <p className="font-semibold text-foreground">Ad</p>
            <p className="text-muted-foreground">Creative, CTA, existing post preview, final publish</p>
          </div>
        </CardContent>
      </Card>

      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={`text-xs hidden sm:inline ${i === step ? "font-medium" : "text-muted-foreground"}`}>
              {s}
            </span>
            {i < steps.length - 1 && <div className="w-4 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step content - two column on step 3 (Ad Creative) and 4 (Review) */}
      {step === 3 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{steps[step]}</CardTitle>
            </CardHeader>
            <CardContent>
              <AdCreativeForm
                value={creative}
                onChange={(v) => {
                  setCreative(v);
                  if (!v.object_story_id) setSelectedExistingPost(null);
                  setValidationErrors((prev) => ({ ...prev, creative: false }));
                }}
                pageId={pageId}
                accountId={accountId}
                ctaType={ctaType}
                onCtaTypeChange={setCtaType}
                whatsappNumber={whatsappNumber}
                onWhatsappNumberChange={setWhatsappNumber}
                pageName={pageName}
                hasError={!!validationErrors.creative}
                onExistingPostSelect={setSelectedExistingPost}
              />
            </CardContent>
          </Card>

          {/* Preview panel */}
          <div className="space-y-3 lg:sticky lg:top-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  {creative.object_story_id ? "Existing Post Preview" : "Ad Preview"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {showPreview ? (
                  <AdPreview
                    pageName={pageName || "Your Page"}
                    pageAvatarUrl={pageAvatarUrl}
                    message={creative.message || selectedExistingPost?.message}
                    imageUrl={creative.image_url || selectedExistingPost?.imageUrl}
                    headline={creative.headline || selectedExistingPost?.headline}
                    description={creative.description || selectedExistingPost?.description}
                    link={creative.link || selectedExistingPost?.link}
                    ctaLabel={ctaType || "LEARN_MORE"}
                    existingPost={!!creative.object_story_id}
                    existingPostData={selectedExistingPost}
                  />
                ) : (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    <p>Ad preview will appear here</p>
                    <p className="text-xs mt-1">Fill in message, headline, or upload an image</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : step === 4 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campaign</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Objective</div>
                  <div className="font-medium">{objective.replace("OUTCOME_", "").replace(/_/g, " ")}</div>
                  <div className="text-muted-foreground">Campaign Type</div>
                  <div className="font-medium">{campaignType === "advantage_plus" ? "Advantage+" : "Manual"}</div>
                  <div className="text-muted-foreground">Campaign Name</div>
                  <div className="font-medium">{campaignName}</div>
                  <div className="text-muted-foreground">Facebook Page</div>
                  <div className="font-medium">{pageName}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ad Set</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Budget</div>
                  <div className="font-medium">{budgetType === "daily" ? `Daily $${budgetAmount}` : `Lifetime $${budgetAmount}`}</div>
                  <div className="text-muted-foreground">Countries</div>
                  <div className="font-medium">{targeting.countries.join(", ")}</div>
                  <div className="text-muted-foreground">Age Range</div>
                  <div className="font-medium">{targeting.age_min} - {targeting.age_max}</div>
                  <div className="text-muted-foreground">Placements</div>
                  <div className="font-medium">{placementType === "advantage" ? "Advantage+ (Auto)" : `${selectedPlacements.length} manual placements`}</div>
                  {needsPixel && (
                    <>
                      <div className="text-muted-foreground">Pixel</div>
                      <div className="font-medium">{pixels.find((pixel) => pixel.id === pixelId)?.name || "Not selected"}</div>
                      <div className="text-muted-foreground">Conversion Event</div>
                      <div className="font-medium">{CONVERSION_EVENT_OPTIONS.find((event) => event.value === conversionEvent)?.label || conversionEvent}</div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ad</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-muted-foreground">Creative</div>
                  <div className="font-medium">{creative.object_story_id ? "Existing Post" : "New Ad Creative"}</div>
                  <div className="text-muted-foreground">CTA Button</div>
                      <div className="font-medium">{ctaType.replace(/_/g, " ")}</div>
                   {(creative.headline || selectedExistingPost?.headline) && (
                    <>
                      <div className="text-muted-foreground">Headline</div>
                       <div className="font-medium">{creative.headline || selectedExistingPost?.headline}</div>
                    </>
                  )}
                   {(creative.description || selectedExistingPost?.description) && (
                     <>
                       <div className="text-muted-foreground">Details</div>
                       <div className="font-medium">{creative.description || selectedExistingPost?.description}</div>
                     </>
                   )}
                   {(creative.link || selectedExistingPost?.link) && (
                    <>
                      <div className="text-muted-foreground">Link</div>
                       <div className="font-medium truncate">{creative.link || selectedExistingPost?.link}</div>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground border-t pt-3 mt-3">
                  Publish দিলে campaign + ad set + ad active হয়ে Meta review-তে যাবে.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {showPreview ? (
                <AdPreview
                  pageName={pageName || "Your Page"}
                  pageAvatarUrl={pageAvatarUrl}
                  message={creative.message || selectedExistingPost?.message}
                  imageUrl={creative.image_url || selectedExistingPost?.imageUrl}
                  headline={creative.headline || selectedExistingPost?.headline}
                  description={creative.description || selectedExistingPost?.description}
                  link={creative.link || selectedExistingPost?.link}
                  ctaLabel={ctaType || "LEARN_MORE"}
                  existingPost={!!creative.object_story_id}
                  existingPostData={selectedExistingPost}
                />
              ) : (
                <div className="py-12 text-center text-muted-foreground text-sm">Preview will appear here before publish.</div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{steps[step]}</CardTitle>
          </CardHeader>
          <CardContent>
            {step === 0 && (
              <div className="space-y-6">
                <div className={validationErrors.objective ? "ring-2 ring-destructive rounded-lg" : ""}>
                  <ObjectiveSelector value={objective} onChange={(v) => {
                    setObjective(v);
                    setDestination("");
                    setValidationErrors(prev => ({ ...prev, objective: false }));
                  }} />
                </div>

                {objective && destinationOptions.length > 0 && (
                  <div className={`space-y-2 ${validationErrors.destination ? "ring-2 ring-destructive rounded-lg p-3" : ""}`}>
                    <Label>Performance Goal / Destination <span className="text-destructive">*</span></Label>
                    <p className="text-xs text-muted-foreground">
                      Meta-তে এই objective-এর জন্য কোন specific goal চান সেটা select করুন। প্রতিটি goal-এর জন্য Meta আলাদা অডিয়েন্স ও অপটিমাইজেশন ব্যবহার করে।
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {destinationOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setDestination(opt.value);
                            setCtaType(opt.cta);
                            setValidationErrors((prev) => ({ ...prev, destination: false }));
                          }}
                          className={`text-left border rounded-lg p-3 transition-all ${
                            destination === opt.value
                              ? "ring-2 ring-primary border-primary bg-primary/5"
                              : "hover:border-primary/50"
                          }`}
                        >
                          <p className="text-sm font-medium">{opt.label}</p>
                          <p className="text-xs text-muted-foreground mt-1">{opt.bangla}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {opt.needsPixel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Pixel দরকার</span>}
                            {opt.needsWhatsapp && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">WhatsApp # দরকার</span>}
                            {opt.needsLink && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Website URL দরকার</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                {/* Campaign Type */}
                <div>
                  <Label>Campaign Type</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button
                      type="button"
                      className={`border rounded-lg p-3 text-left transition-all ${
                        campaignType === "advantage_plus"
                          ? "ring-2 ring-primary border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => setCampaignType("advantage_plus")}
                    >
                      <p className="text-sm font-medium">⚡ Advantage+</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Meta AI optimizes everything</p>
                    </button>
                    <button
                      type="button"
                      className={`border rounded-lg p-3 text-left transition-all ${
                        campaignType === "manual"
                          ? "ring-2 ring-primary border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => setCampaignType("manual")}
                    >
                      <p className="text-sm font-medium">🎯 Manual</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Full control over settings</p>
                    </button>
                  </div>
                </div>

                <div>
                  <Label>Campaign Name <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. Summer Sale 2026"
                    value={campaignName}
                    onChange={(e) => { setCampaignName(e.target.value); setValidationErrors(prev => ({ ...prev, campaignName: false })); }}
                    className={validationErrors.campaignName ? "border-destructive ring-1 ring-destructive" : ""}
                  />
                  {validationErrors.campaignName && <p className="text-xs text-destructive mt-1">Campaign name is required</p>}
                </div>
                <div>
                  <Label>Facebook Page <span className="text-destructive">*</span></Label>
                  {noPages ? (
                    <div className="mt-2 p-4 border rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium">No Pages found in Business Manager</p>
                          <p className="text-muted-foreground mt-1">
                            BM System User token দিয়ে কোনো Page পাওয়া যায়নি। Business Manager → Settings → Pages-এ Page add/claim করে System User-কে Full Control দিন, তারপর refresh করুন।
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : pagesLoading ? (
                    <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading pages...
                    </div>
                  ) : (
                    <>
                    <Select value={pageId} onValueChange={handlePageSelect}>
                        <SelectTrigger className={validationErrors.pageId ? "border-destructive ring-1 ring-destructive" : ""}>
                          <SelectValue placeholder="Select a page..." />
                        </SelectTrigger>
                        <SelectContent>
                          {allPages.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} {p.category ? `(${p.category})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {validationErrors.pageId && <p className="text-xs text-destructive mt-1">Facebook Page is required</p>}
                      <p className="text-xs text-muted-foreground mt-1">
                        {allPages.length} pages found {bmPages.length > 0 ? "from Business Manager" : "from your profile"}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <AdSetForm
                accountId={accountId}
                objective={objective}
                budgetType={budgetType}
                onBudgetTypeChange={setBudgetType}
                budgetAmount={budgetAmount}
                onBudgetAmountChange={(v) => { setBudgetAmount(v); setValidationErrors(prev => ({ ...prev, budgetAmount: false })); }}
                targeting={targeting}
                onTargetingChange={(v) => {
                  setTargeting(v);
                  setValidationErrors((prev) => ({
                    ...prev,
                    countries: false,
                    start_time: false,
                    end_time: false,
                  }));
                }}
                placementType={placementType}
                onPlacementTypeChange={(v) => {
                  setPlacementType(v);
                  setValidationErrors((prev) => ({ ...prev, placements: false }));
                }}
                selectedPlacements={selectedPlacements}
                onSelectedPlacementsChange={(v) => {
                  setSelectedPlacements(v);
                  setValidationErrors((prev) => ({ ...prev, placements: false }));
                }}
                pixels={pixels}
                pixelsLoading={pixelsLoading}
                pixelId={pixelId}
                onPixelIdChange={(v) => {
                  setPixelId(v);
                  setValidationErrors((prev) => ({ ...prev, pixelId: false }));
                }}
                conversionEvent={conversionEvent}
                onConversionEventChange={setConversionEvent}
                errors={validationErrors}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Publish error block */}
      {publishError && step === steps.length - 1 && (
        <Card className="border-destructive">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="space-y-1 flex-1">
                <p className="text-sm font-medium text-destructive">
                  Publish failed at stage: {publishError.stage || "unknown"}
                  {publishError.subcode ? ` · Meta subcode ${publishError.subcode}` : ""}
                </p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{publishError.message}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {/* Reconnect removed — BM-only flow */}
                  {publishError.postEligibilityIssue && !!creative.object_story_id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCreative((prev) => ({ ...prev, object_story_id: "" }));
                        setSelectedExistingPost(null);
                        setPublishError(null);
                        setStep(3);
                      }}
                    >
                      Try another post
                    </Button>
                  )}
                </div>
                {publishError.isDevelopmentModeIssue && (
                  <p className="text-xs text-destructive">Meta App এখনও Development mode-এ আছে — এটা code থেকে fix হবে না; Meta App-কে Live/Public করতে হবে.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={step === 0 ? onClose : () => { setPublishError(null); setStep(step - 1); }}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {step === 0 ? "Cancel" : "Back"}
        </Button>

        {step < steps.length - 1 ? (
          <Button onClick={handleNext} disabled={!canNext()}>
            Next
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={() => { setPublishError(null); createMutation.mutate(); }} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Publishing...</>
            ) : (
              <><Check className="h-4 w-4 mr-1" /> Publish Ad</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
