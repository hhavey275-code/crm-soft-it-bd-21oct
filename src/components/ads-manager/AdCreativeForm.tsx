import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle } from "lucide-react";
import type { ExistingPostPreviewData } from "./types";

interface AdCreativeFormProps {
  value: {
    headline: string;
    message: string;
    description: string;
    link: string;
    image_url: string;
    object_story_id: string;
    video_url: string;
  };
  onChange: (val: AdCreativeFormProps["value"]) => void;
  pageId?: string;
  accountId?: string;
  ctaType?: string;
  onCtaTypeChange?: (v: string) => void;
  whatsappNumber?: string;
  onWhatsappNumberChange?: (v: string) => void;
  pageName?: string;
  hasError?: boolean;
  onExistingPostSelect?: (post: ExistingPostPreviewData | null) => void;
}

interface PagePost {
  id: string;
  message?: string;
  full_picture?: string;
  created_time: string;
  permalink_url?: string;
  call_to_action?: {
    type?: string;
    value?: {
      link?: string;
    };
  } | null;
  attachments?: {
    data?: Array<{
      target?: { url?: string };
      title?: string;
      description?: string;
      url?: string;
      media?: {
        image?: {
          src?: string;
        };
      };
    }>;
  } | null;
}

interface PagePostsState {
  posts: PagePost[];
  error: string | null;
  bmTokenIssue: boolean;
}

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "BOOK_NOW", label: "Book Now" },
  { value: "CONTACT_US", label: "Contact Us" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "GET_QUOTE", label: "Get Quote" },
  { value: "APPLY_NOW", label: "Apply Now" },
  { value: "ORDER_NOW", label: "Order Now" },
  { value: "SUBSCRIBE", label: "Subscribe" },
  { value: "WATCH_MORE", label: "Watch More" },
  { value: "WHATSAPP_MESSAGE", label: "Send WhatsApp Message" },
  { value: "SEND_MESSAGE", label: "Send Message" },
  { value: "GET_DIRECTIONS", label: "Get Directions" },
  { value: "CALL_NOW", label: "Call Now" },
];

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

const getPostAttachment = (post: PagePost) => post.attachments?.data?.[0];
const getPostImage = (post: PagePost) => post.full_picture || getPostAttachment(post)?.media?.image?.src || "";

const toExistingPostPreview = (post: PagePost): ExistingPostPreviewData => {
  const attachment = getPostAttachment(post);
  const ctaType = post.call_to_action?.type;
  return {
    id: post.id,
    message: post.message || "",
    imageUrl: getPostImage(post),
    permalinkUrl: post.permalink_url,
    ctaType: ctaType || undefined,
    ctaLabel: ctaType ? CTA_LABELS[ctaType] || ctaType : undefined,
    link: post.call_to_action?.value?.link || attachment?.target?.url || attachment?.url || post.permalink_url,
    headline: attachment?.title,
    description: attachment?.description,
  };
};

export function AdCreativeForm({ value, onChange, pageId, accountId, ctaType, onCtaTypeChange, whatsappNumber, onWhatsappNumberChange, pageName, hasError, onExistingPostSelect }: AdCreativeFormProps) {
  // Fetch page posts (only existing-post mode supported)
  const {
    data: postsState,
    isLoading: postsLoading,
    isFetching: postsFetching,
    error: postsQueryError,
    refetch: refetchPosts,
  } = useQuery<PagePostsState>({
    queryKey: ["page-posts", pageId, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "get_page_posts", account_id: accountId, page_id: pageId },
      });
      if (error) {
        throw new Error(error.message || "Failed to load page posts");
      }

      return {
        posts: (data?.posts || []) as PagePost[],
        error: data?.error || null,
        bmTokenIssue: !!data?.bm_token_issue,
        emptyReason: data?.empty_reason || null,
      } as PagePostsState & { emptyReason: string | null };
    },
    enabled: !!pageId && !!accountId,
    retry: false,
  });

  const postsData = postsState?.posts || [];
  const postsError = postsState?.error || postsQueryError?.message || null;
  const bmTokenIssue = !!postsState?.bmTokenIssue;
  const emptyReason = (postsState as any)?.emptyReason || null;

  const selectPost = (post: PagePost) => {
    const imageUrl = getPostImage(post);
    const preview = toExistingPostPreview(post);
    onChange({
      ...value,
      object_story_id: post.id,
      message: post.message || "",
      image_url: imageUrl,
      // Inherit original post's button/headline/description/link — Meta does not
      // allow overriding these on existing-post ads (causes subcode 1487929).
      headline: preview.headline || "",
      description: preview.description || "",
      link: preview.link || "",
    });
    // Auto-sync CTA selector to original post's CTA so review/preview shows
    // the same button as Facebook.
    if (preview.ctaType) {
      onCtaTypeChange?.(preview.ctaType);
    }
    onExistingPostSelect?.(preview);
  };

  return (
    <div className={`space-y-4 ${hasError ? "ring-2 ring-destructive rounded-lg p-3" : ""}`}>
      {hasError && (
        <p className="text-xs text-destructive font-medium">⚠️ Please select an existing post to publish your ad</p>
      )}

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Use an existing Page post</AlertTitle>
        <AlertDescription className="text-xs">
          নতুন creative তৈরি করে ad publish করা Meta App restriction-এর কারণে কাজ করছে না। আপনার Facebook Page-এ আগে post করুন, তারপর সেই post টি নিচে select করে ad চালান।
        </AlertDescription>
      </Alert>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Button আর details original post থেকে নেওয়া হবে</AlertTitle>
        <AlertDescription className="text-xs">
          Meta API existing post-এ আলাদা CTA button, headline বা link override করতে দেয় না (error subcode 1487929)। যেই button/text/link Facebook post-এ আছে, ad-এ ঠিক সেটাই দেখাবে। আলাদা button দরকার হলে Facebook page-এ গিয়ে post-টি edit করুন, অথবা সঠিক button সহ একটি নতুন post বানিয়ে এখানে select করুন।
        </AlertDescription>
      </Alert>

      {!pageId ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Page select করুন</AlertTitle>
          <AlertDescription className="text-xs">
            আগের ধাপে একটি Facebook Page select করুন, তারপর সেই Page-এর post গুলো এখানে দেখাবে।
          </AlertDescription>
        </Alert>
      ) : postsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading page posts...
        </div>
      ) : postsError ? (
        <Alert variant={bmTokenIssue ? "default" : "destructive"}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{bmTokenIssue ? "BM Page permission needed" : "Couldn't load existing posts"}</AlertTitle>
          <AlertDescription>
            <p>{postsError}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetchPosts()}
                disabled={postsFetching}
              >
                {postsFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Retry loading posts
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : !postsData?.length ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No promotable posts found</AlertTitle>
          <AlertDescription>
            <p className="text-xs">
              {emptyReason || "Post must be public, owned by this page, and not a story or draft."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => refetchPosts()}
              disabled={postsFetching}
            >
              {postsFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Refresh
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {postsData.map((post) => (
            <button
              key={post.id}
              type="button"
              className={`w-full text-left border rounded-lg p-3 transition-colors hover:bg-muted/50 ${
                value.object_story_id === post.id ? "border-primary bg-primary/5" : ""
              }`}
              onClick={() => selectPost(post)}
            >
              <div className="flex gap-3">
                {post.full_picture && (
                  <img
                    src={getPostImage(post)}
                    alt=""
                    className="w-16 h-16 rounded object-cover shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm line-clamp-2">{post.message || "(No text)"}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(post.created_time).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {value.object_story_id === post.id && (
                <Badge className="mt-2" variant="default">Selected</Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

