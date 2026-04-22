DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tenant_chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_chat_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tenant_chat_conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_chat_conversations;
  END IF;
END $$;

ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_chat_conversations REPLICA IDENTITY FULL;