import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThumbsUp, MessageSquare, Share2, Globe, Smartphone } from "lucide-react";
import type { ExistingPostPreviewData } from "./types";

interface AdPreviewProps {
  pageName?: string;
  message?: string;
  imageUrl?: string;
  headline?: string;
  description?: string;
  link?: string;
  ctaLabel?: string;
  existingPost?: boolean;
  pageAvatarUrl?: string;
  existingPostData?: ExistingPostPreviewData | null;
}

const CTA_LABELS: Record<string, string> = {
  SHOP_NOW: "Shop Now",
  LEARN_MORE: "Learn More",
  SIGN_UP: "Sign Up",
  BOOK_NOW: "Book Now",
  CONTACT_US: "Contact Us",
  DOWNLOAD: "Download",
  GET_QUOTE: "Get Quote",
  APPLY_NOW: "Apply Now",
  ORDER_NOW: "Order Now",
  SUBSCRIBE: "Subscribe",
  WATCH_MORE: "Watch More",
  WHATSAPP_MESSAGE: "WhatsApp",
  SEND_MESSAGE: "Send Message",
  GET_DIRECTIONS: "Get Directions",
  CALL_NOW: "Call Now",
};

export function AdPreview({
  pageName = "Your Page",
  message,
  imageUrl,
  headline,
  description,
  link,
  ctaLabel = "LEARN_MORE",
  existingPost,
  pageAvatarUrl,
  existingPostData,
}: AdPreviewProps) {
  const [previewMode, setPreviewMode] = useState<"feed" | "story">("feed");
  const resolvedMessage = message || existingPostData?.message;
  const resolvedImageUrl = imageUrl || existingPostData?.imageUrl;
  const resolvedHeadline = headline || existingPostData?.headline;
  const resolvedDescription = description || existingPostData?.description;
  const resolvedLink = link || existingPostData?.link;
  const displayCta = CTA_LABELS[ctaLabel] || existingPostData?.ctaLabel || ctaLabel;
  
  let displayDomain = "example.com";
  try {
    displayDomain = resolvedLink ? new URL(resolvedLink.startsWith("http") ? resolvedLink : `https://${resolvedLink}`).hostname.replace("www.", "") : "example.com";
  } catch {}

  return (
    <div className="space-y-3">
      {/* Preview mode toggle */}
      <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
        <button
          type="button"
          className={`flex-1 text-xs py-1.5 px-3 rounded-md transition-all font-medium ${
            previewMode === "feed" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
          onClick={() => setPreviewMode("feed")}
        >
          📱 Feed
        </button>
        <button
          type="button"
          className={`flex-1 text-xs py-1.5 px-3 rounded-md transition-all font-medium ${
            previewMode === "story" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
          onClick={() => setPreviewMode("story")}
        >
          📖 Story
        </button>
      </div>

      {previewMode === "feed" ? (
        <FeedPreview
          pageName={pageName}
          message={resolvedMessage}
          imageUrl={resolvedImageUrl}
          headline={resolvedHeadline}
          description={resolvedDescription}
          displayDomain={displayDomain}
          displayCta={displayCta}
          existingPost={existingPost}
          pageAvatarUrl={pageAvatarUrl}
        />
      ) : (
        <StoryPreview
          pageName={pageName}
          message={resolvedMessage}
          imageUrl={resolvedImageUrl}
          displayCta={displayCta}
          existingPost={existingPost}
          pageAvatarUrl={pageAvatarUrl}
        />
      )}
    </div>
  );
}

function FeedPreview({ pageName, message, imageUrl, headline, description, displayDomain, displayCta, existingPost, pageAvatarUrl }: {
  pageName: string; message?: string; imageUrl?: string; headline?: string;
  description?: string; displayDomain: string; displayCta: string; existingPost?: boolean; pageAvatarUrl?: string;
}) {
  return (
    <div className="mx-auto max-w-[320px]">
      <Card className="overflow-hidden shadow-lg border-0 bg-background">
        {/* Header */}
        <div className="flex items-center gap-2 p-3 pb-1">
          {pageAvatarUrl ? (
            <img
              src={pageAvatarUrl}
              alt={`${pageName} logo`}
              className="h-9 w-9 rounded-full object-cover border border-border"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
              {pageName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{pageName}</p>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              Sponsored · <Globe className="h-3 w-3" />
            </p>
          </div>
        </div>

        {/* Post text */}
        {message && (
          <p className="px-3 py-1.5 text-sm leading-snug">{message.length > 120 ? message.slice(0, 120) + "..." : message}</p>
        )}

        {/* Image */}
        {imageUrl ? (
          <div className="aspect-[1.91/1] bg-muted overflow-hidden">
            <img
              src={imageUrl}
              alt="Ad"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        ) : (
          <div className="aspect-[1.91/1] bg-muted flex items-center justify-center text-muted-foreground text-xs">
            Ad image preview
          </div>
        )}

        {/* Link info + CTA */}
        {(headline || description || displayCta) && (
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-t">
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-[11px] text-muted-foreground uppercase truncate">{displayDomain}</p>
              {headline && <p className="text-sm font-semibold truncate">{headline}</p>}
              {description && <p className="text-xs text-muted-foreground truncate">{description}</p>}
            </div>
            <Button size="sm" className="shrink-0 h-8 text-xs px-3 rounded-md">
              {displayCta}
            </Button>
          </div>
        )}
        {existingPost && !headline && !description && !displayCta && (
          <div className="flex items-center justify-center px-3 py-2 bg-muted/40 border-t">
            <span className="text-xs text-muted-foreground">📌 Existing Post</span>
          </div>
        )}

        {/* Reactions bar */}
        <div className="flex items-center justify-around px-3 py-2 border-t text-muted-foreground">
          <button type="button" className="flex items-center gap-1 text-xs hover:text-foreground transition-colors">
            <ThumbsUp className="h-3.5 w-3.5" /> Like
          </button>
          <button type="button" className="flex items-center gap-1 text-xs hover:text-foreground transition-colors">
            <MessageSquare className="h-3.5 w-3.5" /> Comment
          </button>
          <button type="button" className="flex items-center gap-1 text-xs hover:text-foreground transition-colors">
            <Share2 className="h-3.5 w-3.5" /> Share
          </button>
        </div>
      </Card>
    </div>
  );
}

function StoryPreview({ pageName, message, imageUrl, displayCta, existingPost, pageAvatarUrl }: {
  pageName: string; message?: string; imageUrl?: string; displayCta: string; existingPost?: boolean; pageAvatarUrl?: string;
}) {
  return (
    <div className="mx-auto max-w-[200px]">
      <div className="rounded-2xl overflow-hidden shadow-lg bg-black relative" style={{ aspectRatio: "9/16" }}>
        {/* Story image */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Story Ad"
            className="w-full h-full object-cover absolute inset-0"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-primary/30 to-primary/60 absolute inset-0 flex items-center justify-center">
            <Smartphone className="h-8 w-8 text-white/40" />
          </div>
        )}

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 p-2 bg-gradient-to-b from-black/60 to-transparent">
          {/* Progress bar */}
          <div className="h-0.5 bg-white/30 rounded-full mb-2">
            <div className="h-full w-1/3 bg-white rounded-full" />
          </div>
          <div className="flex items-center gap-1.5">
            {pageAvatarUrl ? (
              <img src={pageAvatarUrl} alt={`${pageName} logo`} className="h-6 w-6 rounded-full object-cover border border-white/20" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-white/30 flex items-center justify-center text-white text-[10px] font-bold">
                {pageName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-white text-[10px] font-medium truncate">{pageName}</span>
            <span className="text-white/60 text-[9px]">Sponsored</span>
          </div>
        </div>

        {/* Message overlay */}
        {message && (
          <div className="absolute bottom-14 left-0 right-0 px-3">
            <p className="text-white text-[10px] leading-tight text-center drop-shadow-lg">
              {message.length > 80 ? message.slice(0, 80) + "..." : message}
            </p>
          </div>
        )}

        {/* CTA at bottom */}
        {(!existingPost || !!displayCta) && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="bg-white rounded-full py-1.5 text-center">
              <span className="text-[10px] font-semibold text-black">{displayCta}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
