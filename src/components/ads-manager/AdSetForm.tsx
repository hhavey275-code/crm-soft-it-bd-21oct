import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { X, Search, MapPin, Users, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { CONVERSION_EVENT_OPTIONS, requiresPixelForObjective, type PixelOption } from "./types";

interface LocationItem {
  key: string;
  name: string;
  type: string; // country, city, region, zip, etc.
  country_code?: string;
  region?: string;
}

interface AudienceItem {
  id: string;
  name: string;
  subtype: string;
  approximate_count?: number;
}

interface TargetingData {
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
}

type BudgetType = "daily" | "lifetime";

interface AdSetFormProps {
  accountId: string;
  objective?: string;
  budgetType: BudgetType;
  onBudgetTypeChange: (v: BudgetType) => void;
  budgetAmount: string;
  onBudgetAmountChange: (v: string) => void;
  targeting: TargetingData;
  onTargetingChange: (t: TargetingData) => void;
  placementType?: "advantage" | "manual";
  onPlacementTypeChange?: (v: "advantage" | "manual") => void;
  selectedPlacements?: string[];
  onSelectedPlacementsChange?: (v: string[]) => void;
  pixels?: PixelOption[];
  pixelsLoading?: boolean;
  pixelId?: string;
  onPixelIdChange?: (v: string) => void;
  conversionEvent?: string;
  onConversionEventChange?: (v: string) => void;
  errors?: Partial<Record<"budgetAmount" | "countries" | "start_time" | "end_time" | "placements" | "pixelId", boolean>>;
}

const commonCountries = [
  { code: "BD", name: "Bangladesh" },
  { code: "US", name: "United States" },
  { code: "IN", name: "India" },
  { code: "GB", name: "United Kingdom" },
  { code: "AE", name: "UAE" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "PK", name: "Pakistan" },
  { code: "MY", name: "Malaysia" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
];

const PLACEMENT_OPTIONS = [
  { id: "facebook_feed", label: "Facebook Feed", group: "Facebook" },
  { id: "facebook_stories", label: "Facebook Stories", group: "Facebook" },
  { id: "facebook_reels", label: "Facebook Reels", group: "Facebook" },
  { id: "facebook_right_column", label: "Right Column", group: "Facebook" },
  { id: "instagram_feed", label: "Instagram Feed", group: "Instagram" },
  { id: "instagram_stories", label: "Instagram Stories", group: "Instagram" },
  { id: "instagram_reels", label: "Instagram Reels", group: "Instagram" },
  { id: "instagram_explore", label: "Instagram Explore", group: "Instagram" },
  { id: "audience_network", label: "Audience Network", group: "Others" },
  { id: "messenger", label: "Messenger", group: "Others" },
];

export function AdSetForm({
  accountId,
  objective,
  budgetType,
  onBudgetTypeChange,
  budgetAmount,
  onBudgetAmountChange,
  targeting,
  onTargetingChange,
  placementType = "advantage",
  onPlacementTypeChange,
  selectedPlacements = [],
  onSelectedPlacementsChange,
  pixels = [],
  pixelsLoading = false,
  pixelId = "",
  onPixelIdChange,
  conversionEvent = "PURCHASE",
  onConversionEventChange,
  errors,
}: AdSetFormProps) {
  const [interestSearch, setInterestSearch] = useState("");
  const [searchDebounce, setSearchDebounce] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [locationDebounce, setLocationDebounce] = useState("");

  const handleInterestSearch = useCallback((val: string) => {
    setInterestSearch(val);
    const timer = setTimeout(() => setSearchDebounce(val), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleLocationSearch = useCallback((val: string) => {
    setLocationSearch(val);
    const timer = setTimeout(() => setLocationDebounce(val), 500);
    return () => clearTimeout(timer);
  }, []);

  const { data: interestResults } = useQuery({
    queryKey: ["interest-search", searchDebounce, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "search_interests", account_id: accountId, query: searchDebounce },
      });
      if (error) throw error;
      return (data?.interests || []) as Array<{ id: string; name: string; audience_size_lower_bound?: number }>;
    },
    enabled: searchDebounce.length >= 2,
  });

  const { data: locationResults } = useQuery({
    queryKey: ["location-search", locationDebounce, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "search_locations", account_id: accountId, query: locationDebounce },
      });
      if (error) throw error;
      return (data?.locations || []) as LocationItem[];
    },
    enabled: locationDebounce.length >= 2,
  });

  const { data: audiencesData, isLoading: audiencesLoading } = useQuery({
    queryKey: ["custom-audiences", accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "get_custom_audiences", account_id: accountId },
      });
      if (error) throw error;
      return (data?.audiences || []) as AudienceItem[];
    },
  });

  const updateTargeting = (partial: Partial<TargetingData>) => {
    onTargetingChange({ ...targeting, ...partial });
  };

  const addCountry = (code: string) => {
    if (!targeting.countries.includes(code)) {
      updateTargeting({ countries: [...targeting.countries, code] });
    }
  };

  const removeCountry = (code: string) => {
    updateTargeting({ countries: targeting.countries.filter((c) => c !== code) });
  };

  const addLocation = (loc: LocationItem) => {
    if (loc.type === "country") {
      addCountry(loc.country_code || loc.key);
    } else if (loc.type === "city") {
      if (!targeting.cities.find((c) => c.key === loc.key)) {
        updateTargeting({ cities: [...targeting.cities, { key: loc.key, name: loc.name }] });
      }
    } else if (loc.type === "region") {
      if (!targeting.regions.find((r) => r.key === loc.key)) {
        updateTargeting({ regions: [...targeting.regions, { key: loc.key, name: loc.name }] });
      }
    }
    setLocationSearch("");
    setLocationDebounce("");
  };

  const removeCity = (key: string) => {
    updateTargeting({ cities: targeting.cities.filter((c) => c.key !== key) });
  };

  const removeRegion = (key: string) => {
    updateTargeting({ regions: targeting.regions.filter((r) => r.key !== key) });
  };

  const addInterest = (interest: { id: string; name: string }) => {
    if (!targeting.interests.find((i) => i.id === interest.id)) {
      updateTargeting({ interests: [...targeting.interests, interest] });
    }
    setInterestSearch("");
    setSearchDebounce("");
  };

  const removeInterest = (id: string) => {
    updateTargeting({ interests: targeting.interests.filter((i) => i.id !== id) });
  };

  const toggleAudience = (aud: AudienceItem) => {
    const exists = targeting.custom_audiences.find((a) => a.id === aud.id);
    if (exists) {
      updateTargeting({ custom_audiences: targeting.custom_audiences.filter((a) => a.id !== aud.id) });
    } else {
      updateTargeting({ custom_audiences: [...targeting.custom_audiences, { id: aud.id, name: aud.name }] });
    }
  };

  const customAudiences = audiencesData?.filter((a) => a.subtype === "CUSTOM") || [];
  const lookalikeAudiences = audiencesData?.filter((a) => a.subtype === "LOOKALIKE") || [];
  const needsPixel = requiresPixelForObjective(objective);

  const togglePlacement = (id: string) => {
    if (!onSelectedPlacementsChange) return;
    if (selectedPlacements.includes(id)) {
      onSelectedPlacementsChange(selectedPlacements.filter((p) => p !== id));
    } else {
      onSelectedPlacementsChange([...selectedPlacements, id]);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">Ad Set</strong> controls budget, audience, placements, and conversion tracking.
      </div>

      {/* Budget Type & Amount */}
      <div className="space-y-2 rounded-lg border border-border p-4">
        <Label className="text-sm font-semibold">Budget & Schedule</Label>
        <Select value={budgetType} onValueChange={(v) => onBudgetTypeChange(v as BudgetType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily Budget</SelectItem>
            <SelectItem value="lifetime">Lifetime Budget</SelectItem>
          </SelectContent>
        </Select>
        <div>
          <Label>{budgetType === "daily" ? "Daily Budget (USD)" : "Lifetime Budget (USD)"}</Label>
          <Input
            type="number"
            min="1"
            placeholder={budgetType === "daily" ? "e.g. 20" : "e.g. 500"}
            value={budgetAmount}
            onChange={(e) => onBudgetAmountChange(e.target.value)}
            className={errors?.budgetAmount ? "border-destructive ring-1 ring-destructive" : ""}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {budgetType === "daily" ? "Minimum $1/day recommended" : "Total budget for the campaign lifetime"}
          </p>
        </div>
        {budgetType === "lifetime" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input
                type="datetime-local"
                value={targeting.start_time || ""}
                onChange={(e) => updateTargeting({ start_time: e.target.value })}
                className={errors?.start_time ? "border-destructive ring-1 ring-destructive" : ""}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="datetime-local"
                value={targeting.end_time || ""}
                onChange={(e) => updateTargeting({ end_time: e.target.value })}
                className={errors?.end_time ? "border-destructive ring-1 ring-destructive" : ""}
              />
            </div>
          </div>
        )}
      </div>

      {needsPixel && (
        <div className={`space-y-3 rounded-lg border p-4 ${errors?.pixelId ? "border-destructive ring-1 ring-destructive" : "border-border"}`}>
          <div>
            <Label className="text-sm font-semibold">Pixel & Conversion Event</Label>
            <p className="text-xs text-muted-foreground mt-1">Sales objective publish করতে Pixel লাগবে, না হলে Meta ad set reject করবে.</p>
          </div>

          <div>
            <Label>Meta Pixel</Label>
            <Select value={pixelId} onValueChange={(v) => onPixelIdChange?.(v)}>
              <SelectTrigger>
                <SelectValue placeholder={pixelsLoading ? "Loading pixels..." : "Select a pixel"} />
              </SelectTrigger>
              <SelectContent>
                {pixels.map((pixel) => (
                  <SelectItem key={pixel.id} value={pixel.id}>
                    {pixel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!pixelsLoading && pixels.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">এই ad account-এ কোনো pixel পাওয়া যায়নি.</p>
            )}
          </div>

          <div>
            <Label>Conversion Event</Label>
            <Select value={conversionEvent} onValueChange={(v) => onConversionEventChange?.(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONVERSION_EVENT_OPTIONS.map((event) => (
                  <SelectItem key={event.value} value={event.value}>
                    {event.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Placements */}
      <div className={`space-y-2 rounded-lg border p-4 ${errors?.placements ? "border-destructive ring-1 ring-destructive" : "border-border"}`}>
        <Label>Placements</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`border rounded-lg p-3 text-left transition-all ${
              placementType === "advantage"
                ? "ring-2 ring-primary border-primary bg-primary/5"
                : "hover:border-primary/50"
            }`}
            onClick={() => onPlacementTypeChange?.("advantage")}
          >
            <p className="text-sm font-medium">Advantage+ Placements</p>
            <p className="text-xs text-muted-foreground mt-0.5">Meta optimizes automatically</p>
          </button>
          <button
            type="button"
            className={`border rounded-lg p-3 text-left transition-all ${
              placementType === "manual"
                ? "ring-2 ring-primary border-primary bg-primary/5"
                : "hover:border-primary/50"
            }`}
            onClick={() => onPlacementTypeChange?.("manual")}
          >
            <p className="text-sm font-medium">Manual Placements</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose where ads appear</p>
          </button>
        </div>

        {placementType === "manual" && (
          <div className="mt-3 space-y-3">
            {["Facebook", "Instagram", "Others"].map((group) => (
              <div key={group}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{group}</p>
                <div className="space-y-1">
                  {PLACEMENT_OPTIONS.filter((p) => p.group === group).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer text-sm">
                      <Checkbox
                        checked={selectedPlacements.includes(p.id)}
                        onCheckedChange={() => togglePlacement(p.id)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Location Targeting */}
      <div className={`rounded-lg border p-4 ${errors?.countries ? "border-destructive ring-1 ring-destructive" : "border-border"}`}>
        <Label className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Locations
        </Label>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {targeting.countries.map((code) => {
            const country = commonCountries.find((c) => c.code === code);
            return (
              <Badge key={`c-${code}`} variant="secondary" className="gap-1">
                🌐 {country?.name || code}
                <X className="h-3 w-3 cursor-pointer" onClick={() => removeCountry(code)} />
              </Badge>
            );
          })}
          {targeting.cities.map((city) => (
            <Badge key={`city-${city.key}`} variant="secondary" className="gap-1">
              🏙️ {city.name}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeCity(city.key)} />
            </Badge>
          ))}
          {targeting.regions.map((region) => (
            <Badge key={`reg-${region.key}`} variant="secondary" className="gap-1">
              📍 {region.name}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeRegion(region.key)} />
            </Badge>
          ))}
        </div>

        {/* Quick country add */}
        <Select onValueChange={addCountry}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Quick add country..." />
          </SelectTrigger>
          <SelectContent>
            {commonCountries
              .filter((c) => !targeting.countries.includes(c.code))
              .map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {/* Location search for cities/regions/zips */}
        <div className="relative mt-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cities, regions, zip codes..."
            value={locationSearch}
            onChange={(e) => handleLocationSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {locationResults && locationResults.length > 0 && (
          <div className="border rounded-md mt-1 max-h-40 overflow-y-auto">
            {locationResults.map((loc) => (
              <button
                key={`${loc.type}-${loc.key}`}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex justify-between"
                onClick={() => addLocation(loc)}
              >
                <span>{loc.name} {loc.region ? `(${loc.region})` : ""}</span>
                <Badge variant="outline" className="text-[10px] ml-2 shrink-0">{loc.type}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Age & Gender */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Min Age</Label>
          <Input
            type="number"
            min={13}
            max={65}
            value={targeting.age_min}
            onChange={(e) => updateTargeting({ age_min: parseInt(e.target.value) || 18 })}
          />
        </div>
        <div>
          <Label>Max Age</Label>
          <Input
            type="number"
            min={13}
            max={65}
            value={targeting.age_max}
            onChange={(e) => updateTargeting({ age_max: parseInt(e.target.value) || 65 })}
          />
        </div>
        <div>
          <Label>Gender</Label>
          <Select
            value={targeting.genders[0]?.toString() || "0"}
            onValueChange={(v) => updateTargeting({ genders: v === "0" ? [] : [parseInt(v)] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">All</SelectItem>
              <SelectItem value="1">Male</SelectItem>
              <SelectItem value="2">Female</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Interests */}
      <div className="rounded-lg border border-border p-4">
        <Label>Interests (optional)</Label>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {targeting.interests.map((int) => (
            <Badge key={int.id} variant="secondary" className="gap-1">
              {int.name}
              <X className="h-3 w-3 cursor-pointer" onClick={() => removeInterest(int.id)} />
            </Badge>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search interests..."
            value={interestSearch}
            onChange={(e) => handleInterestSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {interestResults && interestResults.length > 0 && (
          <div className="border rounded-md mt-1 max-h-40 overflow-y-auto">
            {interestResults.map((int) => (
              <button
                key={int.id}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                onClick={() => addInterest({ id: int.id, name: int.name })}
              >
                {int.name}
                {int.audience_size_lower_bound && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ~{(int.audience_size_lower_bound / 1_000_000).toFixed(1)}M+
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom & Lookalike Audiences */}
      <div className="rounded-lg border border-border p-4">
        <Label className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Audiences (optional)
        </Label>
        {audiencesLoading ? (
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading audiences...
          </div>
        ) : (!customAudiences.length && !lookalikeAudiences.length) ? (
          <p className="text-xs text-muted-foreground mt-2">No custom or lookalike audiences found for this account.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {lookalikeAudiences.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Lookalike Audiences</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {lookalikeAudiences.map((aud) => (
                    <label key={aud.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer text-sm">
                      <Checkbox
                        checked={!!targeting.custom_audiences.find((a) => a.id === aud.id)}
                        onCheckedChange={() => toggleAudience(aud)}
                      />
                      <span className="flex-1 truncate">{aud.name}</span>
                      {aud.approximate_count && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          ~{(aud.approximate_count / 1_000_000).toFixed(1)}M
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {customAudiences.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Custom Audiences</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {customAudiences.map((aud) => (
                    <label key={aud.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer text-sm">
                      <Checkbox
                        checked={!!targeting.custom_audiences.find((a) => a.id === aud.id)}
                        onCheckedChange={() => toggleAudience(aud)}
                      />
                      <span className="flex-1 truncate">{aud.name}</span>
                      {aud.approximate_count && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          ~{(aud.approximate_count / 1_000).toFixed(0)}K
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
