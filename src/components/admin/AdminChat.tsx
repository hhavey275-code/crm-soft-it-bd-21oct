import React, { useState, useEffect, useRef } from "react";
import { MessageCircle, Send, CheckCircle, Circle, Plus, Search, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface Conversation {
  id: string;
  client_id: string;
  last_message_at: string;
  is_resolved: boolean;
  created_at: string;
  client_name?: string;
  client_email?: string;
  last_message?: string;
  unread_count?: number;
  source?: "client" | "tenant";
  tenant_name?: string;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
  direction?: "inbound" | "outbound";
}

interface ClientProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export function AdminChat() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    const { data: convos } = await (supabase as any)
      .from("chat_conversations")
      .select("*")
      .order("last_message_at", { ascending: false });

    const clientIds = (convos ?? []).map((c: any) => c.client_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", clientIds);

    const enriched = await Promise.all(
      (convos ?? []).map(async (conv: any) => {
        const profile = profiles?.find(p => p.user_id === conv.client_id);
        const { data: lastMsg } = await (supabase as any)
          .from("chat_messages")
          .select("message")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { count } = await (supabase as any)
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .eq("is_read", false)
          .neq("sender_id", user?.id ?? "");

        return {
          ...conv,
          client_name: profile?.full_name || "Unknown",
          client_email: profile?.email || "",
          last_message: lastMsg?.message || "",
          unread_count: count || 0,
          source: "client" as const,
        };
      })
    );

    // Tenant conversations (separate table)
    const { data: tenantConvos } = await (supabase as any)
      .from("tenant_chat_conversations")
      .select("*, tenants(name)")
      .order("last_message_at", { ascending: false });

    const tenantEnriched = await Promise.all(
      (tenantConvos ?? []).map(async (conv: any) => {
        const { data: lastMsg } = await (supabase as any)
          .from("tenant_chat_messages")
          .select("message")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { count } = await (supabase as any)
          .from("tenant_chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conv.id)
          .eq("is_read", false)
          .eq("direction", "inbound");

        return {
          id: conv.id,
          client_id: conv.tenant_user_id,
          last_message_at: conv.last_message_at,
          is_resolved: conv.is_resolved,
          created_at: conv.created_at,
          client_name: conv.tenant_user_name || "Tenant user",
          client_email: conv.tenant_user_email || "",
          last_message: lastMsg?.message || "",
          unread_count: count || 0,
          source: "tenant" as const,
          tenant_name: conv.tenants?.name ?? "Tenant",
        } as Conversation;
      })
    );

    const merged = [...enriched, ...tenantEnriched].sort(
      (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );
    setConversations(merged);
  };

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (!selectedId) return;
    const sel = conversations.find(c => c.id === selectedId);
    const isTenant = sel?.source === "tenant";
    const msgTable = isTenant ? "tenant_chat_messages" : "chat_messages";
    const load = async () => {
      const { data } = await (supabase as any)
        .from(msgTable)
        .select("*")
        .eq("conversation_id", selectedId)
        .order("created_at", { ascending: true });
      if (data) {
        // Normalize tenant rows to ChatMessage shape
        const normalized = (data as any[]).map((m: any) => ({
          ...m,
          sender_id: isTenant
            ? (m.direction === "inbound" ? (sel?.client_id ?? "tenant") : (user?.id ?? "admin"))
            : m.sender_id,
        })) as ChatMessage[];
        setMessages(normalized);
      }

      if (isTenant) {
        await (supabase as any)
          .from("tenant_chat_messages")
          .update({ is_read: true })
          .eq("conversation_id", selectedId)
          .eq("direction", "inbound")
          .eq("is_read", false);
      } else {
        await (supabase as any)
          .from("chat_messages")
          .update({ is_read: true })
          .eq("conversation_id", selectedId)
          .neq("sender_id", user?.id ?? "")
          .eq("is_read", false);
      }

      loadConversations();
    };
    load();
  }, [selectedId, conversations.length]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`admin-chat-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          if (newMsg.conversation_id === selectedId) {
            setMessages(prev => {
              if (prev.find(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            if (newMsg.sender_id !== user?.id) {
              (supabase as any).from("chat_messages").update({ is_read: true }).eq("id", newMsg.id).then();
            }
          }
          loadConversations();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_conversations" },
        () => { loadConversations(); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tenant_chat_messages" },
        (payload) => {
          const newMsg = payload.new as any;
          if (newMsg.conversation_id === selectedId) {
            const sel = conversations.find(c => c.id === selectedId);
            const normalized = {
              ...newMsg,
              sender_id: newMsg.direction === "inbound" ? (sel?.client_id ?? "tenant") : (user?.id ?? "admin"),
            } as ChatMessage;
            setMessages(prev => prev.find(m => m.id === normalized.id) ? prev : [...prev, normalized]);
          }
          loadConversations();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tenant_chat_conversations" },
        () => { loadConversations(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedId, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const selected = conversations.find(c => c.id === selectedId);

  const handleSend = async () => {
    if (!reply.trim() || !selectedId || !user || sending) return;
    setSending(true);
    if (selected?.source === "tenant") {
      // Insert outbound message; tenant ChatWidget polls for these
      await (supabase as any).from("tenant_chat_messages").insert({
        conversation_id: selectedId,
        direction: "outbound",
        sender_label: "Master Support",
        message: reply.trim(),
      });
      await (supabase as any)
        .from("tenant_chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", selectedId);
    } else {
      await (supabase as any).from("chat_messages").insert({
        conversation_id: selectedId,
        sender_id: user.id,
        message: reply.trim(),
      });
      await (supabase as any)
        .from("chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", selectedId);

      if (selected) {
        await (supabase as any).from("notifications").insert({
          user_id: selected.client_id,
          type: "chat_message",
          title: "New Message from Support",
          message: reply.trim().substring(0, 100),
          reference_id: selectedId,
        });
      }
    }
    
    setReply("");
    setSending(false);
  };

  const handleResolve = async (convId: string, resolved: boolean) => {
    const conv = conversations.find(c => c.id === convId);
    const table = conv?.source === "tenant" ? "tenant_chat_conversations" : "chat_conversations";
    await (supabase as any)
      .from(table)
      .update({ is_resolved: !resolved })
      .eq("id", convId);
    loadConversations();
  };

  const loadClients = async () => {
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "client");

    if (!roleData) return;
    const clientUserIds = roleData.map(r => r.user_id);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", clientUserIds)
      .eq("status", "active");

    setClients((profiles as ClientProfile[]) || []);
  };

  const handleStartChat = async (clientId: string) => {
    const existing = conversations.find(c => c.client_id === clientId);
    if (existing) {
      setSelectedId(existing.id);
      setNewChatOpen(false);
      return;
    }

    const { data, error } = await (supabase as any)
      .from("chat_conversations")
      .insert({ client_id: clientId })
      .select("id")
      .single();

    if (!error && data) {
      setSelectedId(data.id);
      await loadConversations();
    }
    setNewChatOpen(false);
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const filteredClients = clients.filter(c =>
    (c.full_name || "").toLowerCase().includes(clientSearch.toLowerCase()) ||
    (c.email || "").toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Mobile: show either list or chat
  const showList = isMobile ? !selectedId : true;
  const showChat = isMobile ? !!selectedId : true;

  return (
    <div className={cn("flex gap-4", isMobile ? "flex-col h-[calc(100vh-6rem)]" : "h-[calc(100vh-8rem)]")}>
      {/* Conversations list */}
      {showList && (
        <Card className={cn("flex flex-col shrink-0", isMobile ? "flex-1 min-h-0" : "w-[340px]")}>
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Chat Inbox
              </h2>
              <Dialog open={newChatOpen} onOpenChange={(open) => {
                setNewChatOpen(open);
                if (open) loadClients();
              }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8">
                    <Plus className="h-4 w-4 mr-1" /> New
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Start Chat with Client</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search clients..."
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <ScrollArea className="max-h-[300px]">
                      {filteredClients.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No clients found</p>
                      )}
                      {filteredClients.map((client) => {
                        const hasConvo = conversations.some(c => c.client_id === client.user_id);
                        return (
                          <button
                            key={client.user_id}
                            onClick={() => handleStartChat(client.user_id)}
                            className="w-full text-left p-3 hover:bg-accent/50 rounded-md transition-colors flex items-center justify-between"
                          >
                            <div>
                              <p className="text-sm font-medium">{client.full_name || "Unnamed"}</p>
                              <p className="text-xs text-muted-foreground">{client.email}</p>
                            </div>
                            {hasConvo && (
                              <Badge variant="secondary" className="text-[10px]">Existing</Badge>
                            )}
                          </button>
                        );
                      })}
                    </ScrollArea>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
            </p>
          </div>
          <ScrollArea className="flex-1">
            {conversations.length === 0 && (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No conversations yet
              </div>
            )}
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={cn(
                  "w-full text-left p-4 border-b hover:bg-accent/50 transition-colors",
                  selectedId === conv.id && "bg-accent"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{conv.client_name}</span>
                    {conv.source === "tenant" && (
                      <Badge className="bg-purple-500/15 text-purple-600 border border-purple-500/30 hover:bg-purple-500/20 text-[9px] h-4 px-1.5 shrink-0">
                        Tenant: {conv.tenant_name}
                      </Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {conv.is_resolved && (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    )}
                    {(conv.unread_count ?? 0) > 0 && (
                      <Badge className="h-5 min-w-[20px] flex items-center justify-center p-0 text-[10px]">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.client_email}</p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground truncate flex-1">{conv.last_message}</p>
                  <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
                    {formatTime(conv.last_message_at)}
                  </span>
                </div>
              </button>
            ))}
          </ScrollArea>
        </Card>
      )}

      {/* Chat area */}
      {showChat && (
        <Card className="flex-1 flex flex-col min-w-0">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a conversation to start replying</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="p-3 sm:p-4 border-b flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isMobile && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSelectedId(null)}>
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{selected?.client_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{selected?.client_email}</p>
                  </div>
                </div>
                <Button
                  variant={selected?.is_resolved ? "outline" : "default"}
                  size="sm"
                  className="shrink-0 text-xs h-8"
                  onClick={() => selected && handleResolve(selected.id, selected.is_resolved)}
                >
                  {selected?.is_resolved ? (
                    <><Circle className="h-3.5 w-3.5 mr-1" /> Reopen</>
                  ) : (
                    <><CheckCircle className="h-3.5 w-3.5 mr-1" /> Resolve</>
                  )}
                </Button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                    <p>No messages yet. Send the first message!</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const isAdmin = msg.sender_id !== selected?.client_id;
                  return (
                    <div key={msg.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm",
                          isMobile ? "max-w-[85%]" : "max-w-[70%]",
                          isAdmin
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                        )}
                      >
                        <p className="break-words">{msg.message}</p>
                        <p className={cn("text-[10px] mt-1", isAdmin ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply input */}
              <div className="border-t p-2 sm:p-3 flex gap-2">
                <Input
                  placeholder="Type a reply..."
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  className="flex-1 h-9 text-sm"
                />
                <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!reply.trim() || sending}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
