import React, { useState, useEffect, useRef } from "react";
import { MessageCircle, Send, X, Minus, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export function ChatWidget() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load or create conversation
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("chat_conversations")
        .select("id")
        .eq("client_id", user.id)
        .maybeSingle();
      if (data) {
        setConversationId(data.id);
      }
    };
    load();
  }, [user]);

  useEffect(() => {
    if (!conversationId) return;
    const loadMessages = async () => {
      const { data } = await (supabase as any)
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (data) setMessages(data as ChatMessage[]);
    };
    loadMessages();
  }, [conversationId]);

  useEffect(() => {
    if (!user) return;
    const count = messages.filter(m => m.sender_id !== user.id && !m.is_read).length;
    setUnreadCount(count);
  }, [messages, user]);

  useEffect(() => {
    if (!open || !conversationId || !user) return;
    const unread = messages.filter(m => m.sender_id !== user.id && !m.is_read);
    if (unread.length > 0) {
      (supabase as any)
        .from("chat_messages")
        .update({ is_read: true })
        .eq("conversation_id", conversationId)
        .neq("sender_id", user.id)
        .eq("is_read", false)
        .then(() => {
          setMessages(prev => prev.map(m => ({ ...m, is_read: true })));
        });
    }
  }, [open, messages, conversationId, user]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages(prev => {
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  useEffect(() => {
    if (!user || conversationId) return;
    const channel = supabase
      .channel("chat-conv-watch")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_conversations",
        },
        (payload) => {
          const conv = payload.new as any;
          if (conv.client_id === user.id) {
            setConversationId(conv.id);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const handleSend = async () => {
    if (!message.trim() || !user || sending) return;
    setSending(true);

    let convId = conversationId;
    if (!convId) {
      const { data, error } = await (supabase as any)
        .from("chat_conversations")
        .insert({ client_id: user.id })
        .select("id")
        .single();
      if (error || !data) { setSending(false); return; }
      convId = data.id;
      setConversationId(convId);
    }

    const { error } = await (supabase as any).from("chat_messages").insert({
      conversation_id: convId,
      sender_id: user.id,
      message: message.trim(),
    });

    if (!error) {
      await (supabase as any)
        .from("chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", convId);
      setMessage("");
    }
    setSending(false);
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Mobile: full-screen chat
  if (isMobile && open) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-primary text-primary-foreground safe-area-top">
          <button onClick={() => setOpen(false)} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <MessageCircle className="h-5 w-5" />
          <span className="font-semibold text-sm">Chat Support</span>
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
              <MessageCircle className="h-10 w-10 mb-2 opacity-30" />
              <p>Start a conversation!</p>
              <p className="text-xs mt-1">We typically reply within minutes</p>
            </div>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            return (
              <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    isMe
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md"
                  )}
                >
                  <p className="break-words">{msg.message}</p>
                  <p className={cn("text-[10px] mt-1", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <div className="border-t p-3 flex gap-2 safe-area-bottom">
          <Input
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            className="flex-1 h-10 text-sm rounded-full"
          />
          <Button size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={handleSend} disabled={!message.trim() || sending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-destructive text-destructive-foreground">
              {unreadCount}
            </Badge>
          )}
        </button>
      )}

      {/* Chat panel - desktop */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[360px] max-h-[500px] flex flex-col rounded-xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              <span className="font-semibold text-sm">Chat Support</span>
              <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="flex gap-1">
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-primary-foreground/20 rounded">
                <Minus className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-primary-foreground/20 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[350px]">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                <MessageCircle className="h-10 w-10 mb-2 opacity-30" />
                <p>Start a conversation!</p>
                <p className="text-xs mt-1">We typically reply within minutes</p>
              </div>
            )}
            {messages.map((msg) => {
              const isMe = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      isMe
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    )}
                  >
                    <p className="break-words">{msg.message}</p>
                    <p className={cn("text-[10px] mt-1", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t p-3 flex gap-2">
            <Input
              placeholder="Type a message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1 h-9 text-sm"
            />
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={!message.trim() || sending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
