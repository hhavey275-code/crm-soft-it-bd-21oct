import React, { useState, useEffect, useRef, useCallback } from "react";
import { Bot, Send, Plus, ArrowLeft, Loader2, Wrench, ImagePlus, Trash2, X, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface Conversation {
  id: string;
  title: string;
  ad_account_id: string | null;
  page_id: string | null;
  status: string;
  context: any;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  attachments: any[];
  model_used: string | null;
  created_at: string;
}

interface FilePreview {
  file: File;
  url: string;
  type: "image" | "video";
}

interface ConvContext {
  ad_account_id?: string;
  ad_account_name?: string;
  page_id?: string;
  page_name?: string;
  selected_post_id?: string;
}

const AGENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`;

export function AgentChat() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [filePreviews, setFilePreviews] = useState<FilePreview[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [convContext, setConvContext] = useState<ConvContext>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { scrollToBottom(); }, [messages, streamingContent, scrollToBottom]);

  async function loadConversations() {
    const { data } = await (supabase as any)
      .from("agent_conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  }

  async function loadMessages(convId: string) {
    const { data } = await (supabase as any)
      .from("agent_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  }

  async function createConversation() {
    const { data, error } = await (supabase as any)
      .from("agent_conversations")
      .insert({ user_id: user!.id, title: "New Agent Chat" })
      .select()
      .single();
    if (error) { toast.error("Failed to create conversation"); return; }
    setConversations((prev) => [data, ...prev]);
    setSelectedId(data.id);
    setMessages([]);
    setConvContext(data.context || {});
    if (isMobile) setShowList(false);
  }

  async function deleteConversation(id: string) {
    await (supabase as any).from("agent_conversations").delete().eq("id", id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setMessages([]);
      setShowList(true);
      setConvContext({});
    }
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    loadMessages(id);
    const conv = conversations.find((c) => c.id === id);
    setConvContext(conv?.context || {});
    if (isMobile) setShowList(false);
  }

  // File handling
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    addFiles(Array.from(files));
    e.target.value = "";
  }

  function addFiles(files: File[]) {
    const validFiles = files.filter((f) => {
      const isImage = f.type.startsWith("image/");
      const isVideo = f.type.startsWith("video/");
      if (!isImage && !isVideo) { toast.error(`${f.name} — শুধু image বা video দিতে পারবেন`); return false; }
      if (f.size > 20 * 1024 * 1024) { toast.error(`${f.name} — ফাইল 20MB এর বেশি হতে পারবে না`); return false; }
      return true;
    });
    const newPreviews: FilePreview[] = validFiles.map((file) => ({
      file, url: URL.createObjectURL(file),
      type: file.type.startsWith("image/") ? "image" : "video",
    }));
    setFilePreviews((prev) => [...prev, ...newPreviews].slice(0, 5));
  }

  function removeFile(index: number) {
    setFilePreviews((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].url);
      updated.splice(index, 1);
      return updated;
    });
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFiles(files);
  }

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function sendMessage() {
    if ((!input.trim() && filePreviews.length === 0) || !selectedId || isLoading) return;

    const userMsg = input.trim();
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setActiveTool(null);

    const attachments: { type: string; data: string; name: string; mime: string }[] = [];
    for (const fp of filePreviews) {
      const b64 = await fileToBase64(fp.file);
      attachments.push({ type: fp.type, data: b64, name: fp.file.name, mime: fp.file.type });
    }

    filePreviews.forEach((fp) => URL.revokeObjectURL(fp.url));
    setFilePreviews([]);

    const tempUserMsg: Message = {
      id: crypto.randomUUID(), role: "user", content: userMsg,
      attachments: attachments.map((a) => ({ type: a.type, name: a.name, mime: a.mime })),
      model_used: null, created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(AGENT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          conversation_id: selectedId, message: userMsg,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        toast.error(errData.error || `Error ${resp.status}`);
        setIsLoading(false); return;
      }

      if (!resp.body) { toast.error("No stream body"); setIsLoading(false); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullAssistant = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.type === "text") {
              fullAssistant += parsed.content;
              setStreamingContent(fullAssistant);
            } else if (parsed.type === "tool_start") {
              setActiveTool(parsed.tool);
            } else if (parsed.type === "tool_result") {
              setActiveTool(null);
            } else if (parsed.type === "context_update") {
              // Update local context when agent resolves page/account
              setConvContext((prev) => ({ ...prev, ...parsed.context }));
            } else if (parsed.type === "error") {
              toast.error(parsed.content);
            }
          } catch { /* partial JSON */ }
        }
      }

      if (fullAssistant) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), role: "assistant", content: fullAssistant,
          attachments: [], model_used: null, created_at: new Date().toISOString(),
        }]);
      }
      setStreamingContent("");

      if (messages.length <= 1) {
        const shortTitle = userMsg.slice(0, 60) + (userMsg.length > 60 ? "..." : "");
        await (supabase as any)
          .from("agent_conversations")
          .update({ title: shortTitle || "Image/Video message" })
          .eq("id", selectedId);
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, title: shortTitle || "Image/Video message" } : c))
        );
      }
    } catch (err: any) {
      toast.error("Failed to send: " + (err.message || "Network error"));
    } finally {
      setIsLoading(false);
      setActiveTool(null);
    }
  }

  // ──── Render helpers ────

  function renderAttachments(attachments: any[]) {
    if (!attachments || attachments.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {attachments.map((att: any, i: number) => (
          <div key={i} className="rounded border border-border bg-background/50 px-2 py-1 text-xs text-muted-foreground flex items-center gap-1">
            {att.type === "image" ? <ImagePlus className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
            {att.name || `${att.type} file`}
          </div>
        ))}
      </div>
    );
  }

  function renderContextChips() {
    const chips: { label: string; value: string }[] = [];
    if (convContext.ad_account_id) chips.push({ label: "Ad Account", value: convContext.ad_account_name || convContext.ad_account_id });
    if (convContext.page_id) chips.push({ label: "Page", value: convContext.page_name || convContext.page_id });
    if (convContext.selected_post_id) chips.push({ label: "Post", value: convContext.selected_post_id.slice(0, 20) });
    if (chips.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 px-3 py-1.5 border-b border-border bg-muted/30">
        {chips.map((chip) => (
          <Badge key={chip.label} variant="secondary" className="text-xs font-normal">
            {chip.label}: {chip.value}
          </Badge>
        ))}
      </div>
    );
  }

  // ──── Render ────

  const conversationList = (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" /> AI Agent
        </h2>
        <Button size="sm" variant="outline" onClick={createConversation}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet. Start one!</div>
        ) : (
          conversations.map((conv) => (
            <div key={conv.id} onClick={() => selectConversation(conv.id)}
              className={cn("group flex cursor-pointer items-center justify-between border-b border-border px-3 py-3 hover:bg-accent/50 transition-colors", selectedId === conv.id && "bg-accent")}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{conv.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(conv.updated_at).toLocaleDateString()}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );

  const chatPanel = (
    <div className={cn("flex h-full flex-col bg-background", isDragging && "ring-2 ring-primary ring-inset")}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {isMobile && (
          <Button size="icon" variant="ghost" onClick={() => setShowList(true)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <Bot className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold text-foreground">
          {conversations.find((c) => c.id === selectedId)?.title || "AI Marketing Agent"}
        </span>
        {activeTool && (
          <Badge variant="secondary" className="ml-auto text-xs animate-pulse">
            <Wrench className="h-3 w-3 mr-1" />{activeTool}
          </Badge>
        )}
      </div>

      {/* Context Chips */}
      {renderContextChips()}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-primary p-8">
            <ImagePlus className="h-10 w-10 text-primary" />
            <p className="text-sm font-medium text-foreground">Image বা Video ড্রপ করুন</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 px-3 py-2">
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">AI Marketing Agent</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              আমাকে বলুন কোন Ad Account-এ কী করতে চান। আমি Ad তৈরি, Budget পরিবর্তন, Performance Analysis সবকিছু করতে পারি।
            </p>
            <p className="text-xs text-muted-foreground">
              📎 Image/Video attach করতে পারবেন — ড্রাগ করুন বা 📎 বাটন চাপুন
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                "act_XXXX তে $20 budget এ traffic ad চালাও",
                "আমার account-এর performance দেখাও",
                "Page ID দিয়ে existing post ad চালাও",
                "এই page-এর recent posts দেখাও",
              ].map((s) => (
                <Button key={s} size="sm" variant="outline" className="text-xs"
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {renderAttachments(msg.attachments)}
                    </>
                  )}
                </div>
              </div>
            ))}
            {streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{streamingContent}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
            {isLoading && !streamingContent && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {activeTool ? `Executing: ${activeTool}...` : "Thinking..."}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* File previews */}
      {filePreviews.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="flex gap-2 overflow-x-auto">
            {filePreviews.map((fp, i) => (
              <div key={i} className="relative flex-shrink-0 h-16 w-16 rounded-md border border-border overflow-hidden bg-muted">
                {fp.type === "image" ? (
                  <img src={fp.url} alt={fp.file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Paperclip className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <button type="button" onClick={() => removeFile(i)}
                  className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow">
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-0 inset-x-0 bg-background/70 px-1 truncate text-[10px] text-foreground">
                  {fp.file.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-3">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileSelect} />
          <Button type="button" size="icon" variant="ghost" disabled={isLoading || !selectedId}
            onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Command দিন বা image/video attach করুন..." disabled={isLoading || !selectedId} className="flex-1" />
          <Button type="submit" size="icon" disabled={isLoading || (!input.trim() && filePreviews.length === 0) || !selectedId}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );

  if (isMobile) {
    return <div className="h-[calc(100vh-4rem)]">{showList ? conversationList : chatPanel}</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-lg border border-border">
      <div className="w-72 flex-shrink-0">{conversationList}</div>
      <div className="flex-1 relative">
        {selectedId ? chatPanel : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <Bot className="h-12 w-12 mx-auto text-primary/30" />
              <p>Select a conversation or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
