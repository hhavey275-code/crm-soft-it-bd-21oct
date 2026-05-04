export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ad_account_card_assignments: {
        Row: {
          ad_account_id: string
          card_id: string | null
          detected_at: string
          detected_by: string
          display_string: string | null
          event_type: string
          funding_source_id: string
          id: string
          is_primary: boolean
          metadata: Json | null
        }
        Insert: {
          ad_account_id: string
          card_id?: string | null
          detected_at?: string
          detected_by?: string
          display_string?: string | null
          event_type: string
          funding_source_id: string
          id?: string
          is_primary?: boolean
          metadata?: Json | null
        }
        Update: {
          ad_account_id?: string
          card_id?: string | null
          detected_at?: string
          detected_by?: string
          display_string?: string | null
          event_type?: string
          funding_source_id?: string
          id?: string
          is_primary?: boolean
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_card_assignments_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_card_assignments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "ad_account_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_account_cards: {
        Row: {
          admin_label: string | null
          bank_name: string | null
          bm_id: string | null
          card_type: string | null
          created_at: string
          display_string: string
          exp_month: number | null
          exp_year: number | null
          first_seen_at: string
          funding_source_id: string
          holder_name: string | null
          id: string
          last_seen_at: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          admin_label?: string | null
          bank_name?: string | null
          bm_id?: string | null
          card_type?: string | null
          created_at?: string
          display_string: string
          exp_month?: number | null
          exp_year?: number | null
          first_seen_at?: string
          funding_source_id: string
          holder_name?: string | null
          id?: string
          last_seen_at?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          admin_label?: string | null
          bank_name?: string | null
          bm_id?: string | null
          card_type?: string | null
          created_at?: string
          display_string?: string
          exp_month?: number | null
          exp_year?: number | null
          first_seen_at?: string
          funding_source_id?: string
          holder_name?: string | null
          id?: string
          last_seen_at?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_cards_bm_id_fkey"
            columns: ["bm_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_account_cards_bm_id_fkey"
            columns: ["bm_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_account_insights: {
        Row: {
          account_type: string | null
          active_campaigns: number | null
          ad_account_id: string
          balance: number | null
          billing_raw_snapshot: Json | null
          billing_threshold: number | null
          cards: Json | null
          daily_spend_limit: number | null
          daily_spend_limit_currency: string | null
          daily_spend_limit_synced_at: string | null
          hidden_daily_limit: number | null
          id: string
          last_spend_date: string | null
          outstanding_balance: number | null
          timezone_name: string | null
          today_messages: number | null
          today_orders: number | null
          today_spend: number | null
          total_spending: number | null
          updated_at: string | null
          yesterday_messages: number | null
          yesterday_orders: number | null
          yesterday_spend: number | null
        }
        Insert: {
          account_type?: string | null
          active_campaigns?: number | null
          ad_account_id: string
          balance?: number | null
          billing_raw_snapshot?: Json | null
          billing_threshold?: number | null
          cards?: Json | null
          daily_spend_limit?: number | null
          daily_spend_limit_currency?: string | null
          daily_spend_limit_synced_at?: string | null
          hidden_daily_limit?: number | null
          id?: string
          last_spend_date?: string | null
          outstanding_balance?: number | null
          timezone_name?: string | null
          today_messages?: number | null
          today_orders?: number | null
          today_spend?: number | null
          total_spending?: number | null
          updated_at?: string | null
          yesterday_messages?: number | null
          yesterday_orders?: number | null
          yesterday_spend?: number | null
        }
        Update: {
          account_type?: string | null
          active_campaigns?: number | null
          ad_account_id?: string
          balance?: number | null
          billing_raw_snapshot?: Json | null
          billing_threshold?: number | null
          cards?: Json | null
          daily_spend_limit?: number | null
          daily_spend_limit_currency?: string | null
          daily_spend_limit_synced_at?: string | null
          hidden_daily_limit?: number | null
          id?: string
          last_spend_date?: string | null
          outstanding_balance?: number | null
          timezone_name?: string | null
          today_messages?: number | null
          today_orders?: number | null
          today_spend?: number | null
          total_spending?: number | null
          updated_at?: string | null
          yesterday_messages?: number | null
          yesterday_orders?: number | null
          yesterday_spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_insights_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_account_last_known_state: {
        Row: {
          account_status: number | null
          account_type: string | null
          ad_account_id: string
          amount_spent: number | null
          balance: number | null
          billing_raw_snapshot: Json | null
          billing_threshold: number | null
          cards: Json | null
          hidden_daily_limit: number | null
          last_spend_date: string | null
          last_sync_error: string | null
          last_sync_error_at: string | null
          last_synced_at: string | null
          outstanding_balance: number | null
          spend_cap: number | null
          timezone_name: string | null
          total_spending: number | null
          updated_at: string
        }
        Insert: {
          account_status?: number | null
          account_type?: string | null
          ad_account_id: string
          amount_spent?: number | null
          balance?: number | null
          billing_raw_snapshot?: Json | null
          billing_threshold?: number | null
          cards?: Json | null
          hidden_daily_limit?: number | null
          last_spend_date?: string | null
          last_sync_error?: string | null
          last_sync_error_at?: string | null
          last_synced_at?: string | null
          outstanding_balance?: number | null
          spend_cap?: number | null
          timezone_name?: string | null
          total_spending?: number | null
          updated_at?: string
        }
        Update: {
          account_status?: number | null
          account_type?: string | null
          ad_account_id?: string
          amount_spent?: number | null
          balance?: number | null
          billing_raw_snapshot?: Json | null
          billing_threshold?: number | null
          cards?: Json | null
          hidden_daily_limit?: number | null
          last_spend_date?: string | null
          last_sync_error?: string | null
          last_sync_error_at?: string | null
          last_synced_at?: string | null
          outstanding_balance?: number | null
          spend_cap?: number | null
          timezone_name?: string | null
          total_spending?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_last_known_state_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_account_notes: {
        Row: {
          ad_account_id: string
          created_at: string
          created_by: string
          created_by_name: string | null
          id: string
          note: string
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          created_at?: string
          created_by: string
          created_by_name?: string | null
          id?: string
          note: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          created_at?: string
          created_by?: string
          created_by_name?: string | null
          id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_notes_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_account_requests: {
        Row: {
          account_name: string
          admin_note: string | null
          assigned_ad_account_id: string | null
          business_manager_id: string
          created_at: string
          email: string
          id: string
          monthly_spend: string | null
          reviewed_by: string | null
          start_date: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          admin_note?: string | null
          assigned_ad_account_id?: string | null
          business_manager_id: string
          created_at?: string
          email: string
          id?: string
          monthly_spend?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          admin_note?: string | null
          assigned_ad_account_id?: string | null
          business_manager_id?: string
          created_at?: string
          email?: string
          id?: string
          monthly_spend?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_requests_assigned_ad_account_id_fkey"
            columns: ["assigned_ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          account_id: string
          account_name: string
          amount_spent: number
          balance_after_topup: number | null
          business_manager_id: string | null
          business_name: string | null
          created_at: string
          external_crm_name: string | null
          external_topup_required: boolean
          external_topup_url: string | null
          fraud_flag: boolean
          id: string
          platform: string
          reclaim_alerted_at: string | null
          spend_cap: number
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_id: string
          account_name: string
          amount_spent?: number
          balance_after_topup?: number | null
          business_manager_id?: string | null
          business_name?: string | null
          created_at?: string
          external_crm_name?: string | null
          external_topup_required?: boolean
          external_topup_url?: string | null
          fraud_flag?: boolean
          id?: string
          platform?: string
          reclaim_alerted_at?: string | null
          spend_cap?: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_id?: string
          account_name?: string
          amount_spent?: number
          balance_after_topup?: number | null
          business_manager_id?: string | null
          business_name?: string | null
          created_at?: string
          external_crm_name?: string | null
          external_topup_required?: boolean
          external_topup_url?: string | null
          fraud_flag?: boolean
          id?: string
          platform?: string
          reclaim_alerted_at?: string | null
          spend_cap?: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaign_rules: {
        Row: {
          account_id: string
          campaign_id: string | null
          campaign_name: string | null
          check_interval_minutes: number
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          last_action: string | null
          last_checked_at: string | null
          last_triggered_at: string | null
          max_cost_per_result: number | null
          max_spend: number | null
          min_results_required: number
          min_spend_required: number
          result_event: string | null
          rule_type: string
          target_id: string | null
          target_level: string
          target_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          campaign_id?: string | null
          campaign_name?: string | null
          check_interval_minutes?: number
          created_at?: string
          created_by: string
          enabled?: boolean
          id?: string
          last_action?: string | null
          last_checked_at?: string | null
          last_triggered_at?: string | null
          max_cost_per_result?: number | null
          max_spend?: number | null
          min_results_required?: number
          min_spend_required?: number
          result_event?: string | null
          rule_type?: string
          target_id?: string | null
          target_level?: string
          target_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string | null
          campaign_name?: string | null
          check_interval_minutes?: number
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          last_action?: string | null
          last_checked_at?: string | null
          last_triggered_at?: string | null
          max_cost_per_result?: number | null
          max_spend?: number | null
          min_results_required?: number
          min_spend_required?: number
          result_event?: string | null
          rule_type?: string
          target_id?: string | null
          target_level?: string
          target_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaign_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          primary_color: string | null
          slug: string
          status: string
          subscription_fee: number | null
          subscription_paid_until: string | null
          updated_at: string
          usd_rate: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          primary_color?: string | null
          slug: string
          status?: string
          subscription_fee?: number | null
          subscription_paid_until?: string | null
          updated_at?: string
          usd_rate?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          primary_color?: string | null
          slug?: string
          status?: string
          subscription_fee?: number | null
          subscription_paid_until?: string | null
          updated_at?: string
          usd_rate?: number | null
        }
        Relationships: []
      }
      agency_wallets: {
        Row: {
          agency_id: string
          balance: number
          created_at: string
          currency: string
          id: string
          total_deposited: number
          updated_at: string
        }
        Insert: {
          agency_id: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          total_deposited?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          total_deposited?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_wallets_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_log: {
        Row: {
          action: string
          conversation_id: string | null
          created_at: string
          details: Json | null
          id: string
          new_value: string | null
          old_value: string | null
          task_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          conversation_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          conversation_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_log_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          ad_account_id: string | null
          context: Json | null
          created_at: string
          id: string
          page_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          page_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          page_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          attachments: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          model_used: string | null
          role: string
          token_cost: number | null
        }
        Insert: {
          attachments?: Json | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          model_used?: string | null
          role?: string
          token_cost?: number | null
        }
        Update: {
          attachments?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model_used?: string | null
          role?: string
          token_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          config: Json
          conversation_id: string | null
          created_at: string
          id: string
          last_run_at: string | null
          next_run_at: string | null
          status: string
          task_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          status?: string
          task_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          status?: string
          task_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string
          dismissed_permanently: boolean
          id: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string
          dismissed_permanently?: boolean
          id?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string
          dismissed_permanently?: boolean
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          image_url: string | null
          target_type: string
          target_user_ids: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          target_type?: string
          target_user_ids?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          target_type?: string
          target_user_ids?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      api_call_logs: {
        Row: {
          business_manager_id: string
          call_count: number
          created_at: string
          function_name: string
          id: string
        }
        Insert: {
          business_manager_id: string
          call_count?: number
          created_at?: string
          function_name: string
          id?: string
        }
        Update: {
          business_manager_id?: string
          call_count?: number
          created_at?: string
          function_name?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_call_logs_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_call_logs_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_topup_rules: {
        Row: {
          ad_account_id: string
          created_at: string
          id: string
          is_active: boolean
          last_triggered_at: string | null
          threshold_balance: number
          topup_amount: number
          user_id: string
        }
        Insert: {
          ad_account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          threshold_balance?: number
          topup_amount?: number
          user_id: string
        }
        Update: {
          ad_account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered_at?: string | null
          threshold_balance?: number
          topup_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_topup_rules_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_name: string
          account_number: string
          bank_name: string
          branch: string | null
          created_at: string | null
          id: string
          logo_url: string | null
          routing_number: string | null
          seller_id: string | null
          status: string
          telegram_group_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_name: string
          account_number: string
          bank_name: string
          branch?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          routing_number?: string | null
          seller_id?: string | null
          status?: string
          telegram_group_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_name?: string
          branch?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          routing_number?: string | null
          seller_id?: string | null
          status?: string
          telegram_group_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      bm_access_requests: {
        Row: {
          ad_account_id: string
          admin_note: string | null
          bm_id: string
          bm_name: string
          created_at: string
          id: string
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          admin_note?: string | null
          bm_id: string
          bm_name: string
          created_at?: string
          id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          admin_note?: string | null
          bm_id?: string
          bm_name?: string
          created_at?: string
          id?: string
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_access_requests_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_invitations: {
        Row: {
          accepted_at: string | null
          ad_account_permissions: Json
          bm_role: string
          business_manager_id: string
          created_at: string
          error_message: string | null
          id: string
          invite_response: Json | null
          invited_by: string | null
          invited_email: string
          meta_business_scoped_user_id: string | null
          meta_pending_user_id: string | null
          permissions_applied_at: string | null
          permissions_apply_log: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          ad_account_permissions?: Json
          bm_role: string
          business_manager_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          invite_response?: Json | null
          invited_by?: string | null
          invited_email: string
          meta_business_scoped_user_id?: string | null
          meta_pending_user_id?: string | null
          permissions_applied_at?: string | null
          permissions_apply_log?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          ad_account_permissions?: Json
          bm_role?: string
          business_manager_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          invite_response?: Json | null
          invited_by?: string | null
          invited_email?: string
          meta_business_scoped_user_id?: string | null
          meta_pending_user_id?: string | null
          permissions_applied_at?: string | null
          permissions_apply_log?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_invitations_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_invitations_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_user_snapshots: {
        Row: {
          business_manager_id: string
          created_at: string
          email: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          meta_user_id: string
          name: string | null
          removed_at: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          business_manager_id: string
          created_at?: string
          email?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          meta_user_id: string
          name?: string | null
          removed_at?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          business_manager_id?: string
          created_at?: string
          email?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          meta_user_id?: string
          name?: string | null
          removed_at?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_user_snapshots_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_user_snapshots_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      business_managers: {
        Row: {
          access_token: string
          bm_id: string
          created_at: string
          id: string
          last_synced_at: string | null
          name: string
          platform: string
          recovery_checked_at: string | null
          recovery_ready: boolean | null
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          bm_id: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name: string
          platform?: string
          recovery_checked_at?: string | null
          recovery_ready?: boolean | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          bm_id?: string
          created_at?: string
          id?: string
          last_synced_at?: string | null
          name?: string
          platform?: string
          recovery_checked_at?: string | null
          recovery_ready?: boolean | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      card_billing_config: {
        Row: {
          client_label: string
          client_name_column: string
          created_at: string
          due_cell: string
          id: string
          next_payment_row: number
          payment_cell_column: string
          payment_date_column: string
          sheet_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_label?: string
          client_name_column?: string
          created_at?: string
          due_cell?: string
          id?: string
          next_payment_row?: number
          payment_cell_column?: string
          payment_date_column?: string
          sheet_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_label?: string
          client_name_column?: string
          created_at?: string
          due_cell?: string
          id?: string
          next_payment_row?: number
          payment_cell_column?: string
          payment_date_column?: string
          sheet_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      card_bills: {
        Row: {
          created_at: string
          due_amount_bdt: number
          id: string
          last_synced_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_amount_bdt?: number
          id?: string
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_amount_bdt?: number
          id?: string
          last_synced_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          client_id: string
          created_at: string | null
          id: string
          is_resolved: boolean | null
          last_message_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          last_message_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          id?: string
          is_resolved?: boolean | null
          last_message_at?: string | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          conversation_id: string
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string
          sender_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          sender_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_banks: {
        Row: {
          assigned_at: string | null
          bank_account_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          bank_account_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          bank_account_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_banks_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      client_daily_stats: {
        Row: {
          account_count: number
          created_at: string
          id: string
          stat_date: string
          total_orders: number
          total_spend: number
          user_id: string
        }
        Insert: {
          account_count?: number
          created_at?: string
          id?: string
          stat_date: string
          total_orders?: number
          total_spend?: number
          user_id: string
        }
        Update: {
          account_count?: number
          created_at?: string
          id?: string
          stat_date?: string
          total_orders?: number
          total_spend?: number
          user_id?: string
        }
        Relationships: []
      }
      client_feedback: {
        Row: {
          admin_note: string | null
          created_at: string
          feedback_type: string
          id: string
          message: string
          status: string
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          feedback_type: string
          id?: string
          message: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          feedback_type?: string
          id?: string
          message?: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_spend_snapshots: {
        Row: {
          account_count: number
          created_at: string
          id: string
          snapshot_date: string
          total_spend: number
        }
        Insert: {
          account_count?: number
          created_at?: string
          id?: string
          snapshot_date: string
          total_spend?: number
        }
        Update: {
          account_count?: number
          created_at?: string
          id?: string
          snapshot_date?: string
          total_spend?: number
        }
        Relationships: []
      }
      external_topup_requests: {
        Row: {
          ad_account_id: string
          amount: number
          completed_at: string | null
          completed_by: string | null
          created_at: string
          external_crm_name: string | null
          external_topup_url: string | null
          id: string
          initiated_at: string
          initiated_by: string
          notes: string | null
          proof_url: string | null
          status: string
          updated_at: string
          user_id: string | null
          wallet_deducted: boolean
        }
        Insert: {
          ad_account_id: string
          amount: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          external_crm_name?: string | null
          external_topup_url?: string | null
          id?: string
          initiated_at?: string
          initiated_by: string
          notes?: string | null
          proof_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          wallet_deducted?: boolean
        }
        Update: {
          ad_account_id?: string
          amount?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          external_crm_name?: string | null
          external_topup_url?: string | null
          id?: string
          initiated_at?: string
          initiated_by?: string
          notes?: string | null
          proof_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          wallet_deducted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "external_topup_requests_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_topups: {
        Row: {
          ad_account_id: string
          amount: number
          created_at: string
          error_message: string | null
          id: string
          last_attempt_ip: string | null
          last_attempt_via: string | null
          old_spend_cap: number | null
          resolved_at: string | null
          resolved_ip: string | null
          resolved_via: string | null
          status: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          amount: number
          created_at?: string
          error_message?: string | null
          id?: string
          last_attempt_ip?: string | null
          last_attempt_via?: string | null
          old_spend_cap?: number | null
          resolved_at?: string | null
          resolved_ip?: string | null
          resolved_via?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          amount?: number
          created_at?: string
          error_message?: string | null
          id?: string
          last_attempt_ip?: string | null
          last_attempt_via?: string | null
          old_spend_cap?: number | null
          resolved_at?: string | null
          resolved_ip?: string | null
          resolved_via?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "failed_topups_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_job_secrets: {
        Row: {
          created_at: string
          id: string
          job_name: string
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_name: string
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_name?: string
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          bdt_amount: number | null
          created_at: string
          id: string
          invoice_number: string
          top_up_request_id: string
          usd_rate: number | null
          user_id: string
        }
        Insert: {
          amount: number
          bdt_amount?: number | null
          created_at?: string
          id?: string
          invoice_number: string
          top_up_request_id: string
          usd_rate?: number | null
          user_id: string
        }
        Update: {
          amount?: number
          bdt_amount?: number | null
          created_at?: string
          id?: string
          invoice_number?: string
          top_up_request_id?: string
          usd_rate?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_top_up_request_id_fkey"
            columns: ["top_up_request_id"]
            isOneToOne: false
            referencedRelation: "top_up_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_permissions: {
        Row: {
          created_at: string | null
          id: string
          menu_key: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          menu_key: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          menu_key?: string
          user_id?: string
        }
        Relationships: []
      }
      meta_account_events: {
        Row: {
          account_meta_id: string | null
          account_status: number | null
          actor: string | null
          ad_account_id: string
          ad_account_name: string | null
          bm_id: string | null
          created_at: string
          disable_reason: string | null
          event_type: string
          id: string
          request_summary: Json | null
          response_summary: Json | null
        }
        Insert: {
          account_meta_id?: string | null
          account_status?: number | null
          actor?: string | null
          ad_account_id: string
          ad_account_name?: string | null
          bm_id?: string | null
          created_at?: string
          disable_reason?: string | null
          event_type: string
          id?: string
          request_summary?: Json | null
          response_summary?: Json | null
        }
        Update: {
          account_meta_id?: string | null
          account_status?: number | null
          actor?: string | null
          ad_account_id?: string
          ad_account_name?: string | null
          bm_id?: string | null
          created_at?: string
          disable_reason?: string | null
          event_type?: string
          id?: string
          request_summary?: Json | null
          response_summary?: Json | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          reference_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          reference_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          reference_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agency_id: string | null
          business_address: string | null
          campaign_management_enabled: boolean
          color_theme: string
          company: string | null
          created_at: string
          due_limit: number | null
          due_limit_expires_at: string | null
          due_limit_set_at: string | null
          email: string | null
          full_name: string | null
          id: string
          meta_user_token: string | null
          meta_user_token_expires_at: string | null
          monthly_spend: string | null
          others_telegram_group_id: string | null
          phone: string | null
          status: string
          updated_at: string
          usd_rate: number | null
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          business_address?: string | null
          campaign_management_enabled?: boolean
          color_theme?: string
          company?: string | null
          created_at?: string
          due_limit?: number | null
          due_limit_expires_at?: string | null
          due_limit_set_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          meta_user_token?: string | null
          meta_user_token_expires_at?: string | null
          monthly_spend?: string | null
          others_telegram_group_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          usd_rate?: number | null
          user_id: string
        }
        Update: {
          agency_id?: string | null
          business_address?: string | null
          campaign_management_enabled?: boolean
          color_theme?: string
          company?: string | null
          created_at?: string
          due_limit?: number | null
          due_limit_expires_at?: string | null
          due_limit_set_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          meta_user_token?: string | null
          meta_user_token_expires_at?: string | null
          monthly_spend?: string | null
          others_telegram_group_id?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          usd_rate?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      seller_balance_audit_log: {
        Row: {
          anomalies: Json
          approved_topup_count: number
          audit_date: string
          calculated_balance_bdt: number
          created_at: string
          delta_bdt: number
          has_issues: boolean
          id: string
          orphan_topup_ids: string[] | null
          previous_balance_bdt: number
          seller_id: string
          seller_txn_count: number
        }
        Insert: {
          anomalies?: Json
          approved_topup_count?: number
          audit_date: string
          calculated_balance_bdt?: number
          created_at?: string
          delta_bdt?: number
          has_issues?: boolean
          id?: string
          orphan_topup_ids?: string[] | null
          previous_balance_bdt?: number
          seller_id: string
          seller_txn_count?: number
        }
        Update: {
          anomalies?: Json
          approved_topup_count?: number
          audit_date?: string
          calculated_balance_bdt?: number
          created_at?: string
          delta_bdt?: number
          has_issues?: boolean
          id?: string
          orphan_topup_ids?: string[] | null
          previous_balance_bdt?: number
          seller_id?: string
          seller_txn_count?: number
        }
        Relationships: []
      }
      seller_monthly_closings: {
        Row: {
          closed_at: string
          closed_by: string | null
          closing_due_advance_bdt: number
          created_at: string
          id: string
          is_locked: boolean
          month: number
          month_bdt_in: number
          month_client_bdt: number
          month_converted_bdt: number
          month_usdt_given: number
          month_withdraw_bdt: number
          note: string | null
          opening_due_advance_bdt: number
          seller_id: string
          updated_at: string
          year: number
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          closing_due_advance_bdt?: number
          created_at?: string
          id?: string
          is_locked?: boolean
          month: number
          month_bdt_in?: number
          month_client_bdt?: number
          month_converted_bdt?: number
          month_usdt_given?: number
          month_withdraw_bdt?: number
          note?: string | null
          opening_due_advance_bdt?: number
          seller_id: string
          updated_at?: string
          year: number
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          closing_due_advance_bdt?: number
          created_at?: string
          id?: string
          is_locked?: boolean
          month?: number
          month_bdt_in?: number
          month_client_bdt?: number
          month_converted_bdt?: number
          month_usdt_given?: number
          month_withdraw_bdt?: number
          note?: string | null
          opening_due_advance_bdt?: number
          seller_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      seller_sheet_config: {
        Row: {
          col_datetime: string | null
          col_description: string | null
          col_due_adv: string | null
          col_payment_bdt: string | null
          col_payo_bdt: string | null
          col_payo_rate: string | null
          col_payo_usd: string | null
          col_proof_url: string | null
          col_total: string | null
          col_txn_id: string | null
          col_wise_bdt: string | null
          col_wise_rate: string | null
          col_wise_usd: string | null
          col_withdraw: string | null
          created_at: string
          data_start_row: number
          enabled: boolean
          header_row: number
          id: string
          last_error: string | null
          last_synced_at: string | null
          opening_balance_cell: string | null
          seller_id: string
          spreadsheet_id: string
          spreadsheet_url: string | null
          tab_pattern: string
          template_tab: string | null
          updated_at: string
        }
        Insert: {
          col_datetime?: string | null
          col_description?: string | null
          col_due_adv?: string | null
          col_payment_bdt?: string | null
          col_payo_bdt?: string | null
          col_payo_rate?: string | null
          col_payo_usd?: string | null
          col_proof_url?: string | null
          col_total?: string | null
          col_txn_id?: string | null
          col_wise_bdt?: string | null
          col_wise_rate?: string | null
          col_wise_usd?: string | null
          col_withdraw?: string | null
          created_at?: string
          data_start_row?: number
          enabled?: boolean
          header_row?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          opening_balance_cell?: string | null
          seller_id: string
          spreadsheet_id: string
          spreadsheet_url?: string | null
          tab_pattern?: string
          template_tab?: string | null
          updated_at?: string
        }
        Update: {
          col_datetime?: string | null
          col_description?: string | null
          col_due_adv?: string | null
          col_payment_bdt?: string | null
          col_payo_bdt?: string | null
          col_payo_rate?: string | null
          col_payo_usd?: string | null
          col_proof_url?: string | null
          col_total?: string | null
          col_txn_id?: string | null
          col_wise_bdt?: string | null
          col_wise_rate?: string | null
          col_wise_usd?: string | null
          col_withdraw?: string | null
          created_at?: string
          data_start_row?: number
          enabled?: boolean
          header_row?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          opening_balance_cell?: string | null
          seller_id?: string
          spreadsheet_id?: string
          spreadsheet_url?: string | null
          tab_pattern?: string
          template_tab?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_sheet_config_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      seller_transactions: {
        Row: {
          admin_note: string | null
          bank_account_id: string | null
          bdt_amount: number
          created_at: string
          description: string | null
          entry_by_name: string | null
          id: string
          proof_url: string | null
          rate: number
          reviewed_at: string | null
          reviewed_by: string | null
          seller_id: string
          status: string
          telegram_forwarded: boolean
          telegram_forwarded_at: string | null
          telegram_message_id: number | null
          tenant_payment_id: string | null
          top_up_request_id: string | null
          type: string
          usdt_amount: number
        }
        Insert: {
          admin_note?: string | null
          bank_account_id?: string | null
          bdt_amount?: number
          created_at?: string
          description?: string | null
          entry_by_name?: string | null
          id?: string
          proof_url?: string | null
          rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id: string
          status?: string
          telegram_forwarded?: boolean
          telegram_forwarded_at?: string | null
          telegram_message_id?: number | null
          tenant_payment_id?: string | null
          top_up_request_id?: string | null
          type: string
          usdt_amount?: number
        }
        Update: {
          admin_note?: string | null
          bank_account_id?: string | null
          bdt_amount?: number
          created_at?: string
          description?: string | null
          entry_by_name?: string | null
          id?: string
          proof_url?: string | null
          rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id?: string
          status?: string
          telegram_forwarded?: boolean
          telegram_forwarded_at?: string | null
          telegram_message_id?: number | null
          tenant_payment_id?: string | null
          top_up_request_id?: string | null
          type?: string
          usdt_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_transactions_tenant_payment_id_fkey"
            columns: ["tenant_payment_id"]
            isOneToOne: false
            referencedRelation: "tenant_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_transactions_top_up_request_id_fkey"
            columns: ["top_up_request_id"]
            isOneToOne: false
            referencedRelation: "top_up_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_transactions_archive_2026_05: {
        Row: {
          admin_note: string | null
          archive_reason: string | null
          archived_at: string
          bank_account_id: string | null
          bdt_amount: number
          created_at: string
          description: string | null
          entry_by_name: string | null
          id: string
          proof_url: string | null
          rate: number
          reviewed_at: string | null
          reviewed_by: string | null
          seller_id: string
          status: string
          tenant_payment_id: string | null
          top_up_request_id: string | null
          type: string
          usdt_amount: number
        }
        Insert: {
          admin_note?: string | null
          archive_reason?: string | null
          archived_at?: string
          bank_account_id?: string | null
          bdt_amount?: number
          created_at?: string
          description?: string | null
          entry_by_name?: string | null
          id?: string
          proof_url?: string | null
          rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id: string
          status?: string
          tenant_payment_id?: string | null
          top_up_request_id?: string | null
          type: string
          usdt_amount?: number
        }
        Update: {
          admin_note?: string | null
          archive_reason?: string | null
          archived_at?: string
          bank_account_id?: string | null
          bdt_amount?: number
          created_at?: string
          description?: string | null
          entry_by_name?: string | null
          id?: string
          proof_url?: string | null
          rate?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id?: string
          status?: string
          tenant_payment_id?: string | null
          top_up_request_id?: string | null
          type?: string
          usdt_amount?: number
        }
        Relationships: []
      }
      seller_usdt_banks: {
        Row: {
          assigned_at: string
          bank_account_id: string
          id: string
          seller_id: string
        }
        Insert: {
          assigned_at?: string
          bank_account_id: string
          id?: string
          seller_id: string
        }
        Update: {
          assigned_at?: string
          bank_account_id?: string
          id?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_usdt_banks_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_sync_log: {
        Row: {
          error_message: string | null
          id: string
          row_number: number | null
          seller_transaction_id: string
          spreadsheet_id: string
          status: string
          synced_at: string
          tab_name: string
        }
        Insert: {
          error_message?: string | null
          id?: string
          row_number?: number | null
          seller_transaction_id: string
          spreadsheet_id: string
          status?: string
          synced_at?: string
          tab_name: string
        }
        Update: {
          error_message?: string | null
          id?: string
          row_number?: number | null
          seller_transaction_id?: string
          spreadsheet_id?: string
          status?: string
          synced_at?: string
          tab_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_sync_log_seller_transaction_id_fkey"
            columns: ["seller_transaction_id"]
            isOneToOne: false
            referencedRelation: "seller_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: []
      }
      spend_cap_withdraw_requests: {
        Row: {
          ad_account_id: string
          admin_note: string | null
          amount_usd: number
          created_at: string
          id: string
          note: string | null
          resolved_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          admin_note?: string | null
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          admin_note?: string | null
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          business_manager_id: string
          created_at: string
          error_message: string | null
          id: string
          status: string
          synced_count: number
          total_count: number
        }
        Insert: {
          business_manager_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          synced_count?: number
          total_count?: number
        }
        Update: {
          business_manager_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          synced_count?: number
          total_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_logs_business_manager_id_fkey"
            columns: ["business_manager_id"]
            isOneToOne: false
            referencedRelation: "business_managers_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          action: string
          created_at: string
          details: string | null
          id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: string | null
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: string | null
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_forward_log: {
        Row: {
          caption_total_bdt: number | null
          forwarded_at: string
          id: string
          source_id: string
          source_type: string
          telegram_group_id: string | null
          telegram_message_id: number | null
        }
        Insert: {
          caption_total_bdt?: number | null
          forwarded_at?: string
          id?: string
          source_id: string
          source_type: string
          telegram_group_id?: string | null
          telegram_message_id?: number | null
        }
        Update: {
          caption_total_bdt?: number | null
          forwarded_at?: string
          id?: string
          source_id?: string
          source_type?: string
          telegram_group_id?: string | null
          telegram_message_id?: number | null
        }
        Relationships: []
      }
      telegram_messages: {
        Row: {
          chat_id: number
          created_at: string
          matched_request_id: string | null
          raw_update: Json
          text: string | null
          update_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          matched_request_id?: string | null
          raw_update: Json
          text?: string | null
          update_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          matched_request_id?: string | null
          raw_update?: Json
          text?: string | null
          update_id?: number
        }
        Relationships: []
      }
      tenant_banks: {
        Row: {
          bank_account_id: string
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          bank_account_id: string
          created_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          bank_account_id?: string
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_banks_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_banks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_bm_share_requests: {
        Row: {
          ad_account_external_id: string
          ad_account_name: string | null
          admin_notes: string | null
          bm_id: string
          bm_name: string | null
          created_at: string
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant_id: string
          tenant_user_id: string
          tenant_user_name: string | null
        }
        Insert: {
          ad_account_external_id: string
          ad_account_name?: string | null
          admin_notes?: string | null
          bm_id: string
          bm_name?: string | null
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id: string
          tenant_user_id: string
          tenant_user_name?: string | null
        }
        Update: {
          ad_account_external_id?: string
          ad_account_name?: string | null
          admin_notes?: string | null
          bm_id?: string
          bm_name?: string | null
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
          tenant_user_id?: string
          tenant_user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_bm_share_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_chat_conversations: {
        Row: {
          created_at: string
          id: string
          is_resolved: boolean
          last_message_at: string
          tenant_id: string
          tenant_user_email: string | null
          tenant_user_id: string
          tenant_user_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_resolved?: boolean
          last_message_at?: string
          tenant_id: string
          tenant_user_email?: string | null
          tenant_user_id: string
          tenant_user_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_resolved?: boolean
          last_message_at?: string
          tenant_id?: string
          tenant_user_email?: string | null
          tenant_user_id?: string
          tenant_user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_chat_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_chat_messages: {
        Row: {
          conversation_id: string
          created_at: string
          direction: string
          id: string
          is_read: boolean
          message: string
          sender_label: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          is_read?: boolean
          message: string
          sender_label?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          is_read?: boolean
          message?: string
          sender_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "tenant_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_payments: {
        Row: {
          adjustment_reason: string | null
          amount: number
          bank_account_id: string | null
          created_at: string
          duration_months: number | null
          id: string
          last_verify_at: string | null
          limit_amount: number | null
          payment_reference: string | null
          payment_type: string
          proof_url: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
          updated_at: string
          verification_log: string | null
          verify_attempts: number
        }
        Insert: {
          adjustment_reason?: string | null
          amount: number
          bank_account_id?: string | null
          created_at?: string
          duration_months?: number | null
          id?: string
          last_verify_at?: string | null
          limit_amount?: number | null
          payment_reference?: string | null
          payment_type?: string
          proof_url?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          verification_log?: string | null
          verify_attempts?: number
        }
        Update: {
          adjustment_reason?: string | null
          amount?: number
          bank_account_id?: string | null
          created_at?: string
          duration_months?: number | null
          id?: string
          last_verify_at?: string | null
          limit_amount?: number | null
          payment_reference?: string | null
          payment_type?: string
          proof_url?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_log?: string | null
          verify_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_stats_snapshots: {
        Row: {
          accounts_active: number | null
          accounts_disabled: number | null
          accounts_inactive: number | null
          accounts_total: number | null
          active_clients_today: number | null
          id: string
          orders_today: number | null
          orders_yesterday: number | null
          raw: Json | null
          snapshot_at: string
          spend_last_30d: number | null
          spend_lifetime: number | null
          spend_this_month: number | null
          spend_today: number | null
          spend_yesterday: number | null
          tenant_id: string
          topups_pending_count: number | null
          topups_today_amount: number | null
          topups_today_count: number | null
          total_clients: number | null
          total_wallet_balance: number | null
        }
        Insert: {
          accounts_active?: number | null
          accounts_disabled?: number | null
          accounts_inactive?: number | null
          accounts_total?: number | null
          active_clients_today?: number | null
          id?: string
          orders_today?: number | null
          orders_yesterday?: number | null
          raw?: Json | null
          snapshot_at?: string
          spend_last_30d?: number | null
          spend_lifetime?: number | null
          spend_this_month?: number | null
          spend_today?: number | null
          spend_yesterday?: number | null
          tenant_id: string
          topups_pending_count?: number | null
          topups_today_amount?: number | null
          topups_today_count?: number | null
          total_clients?: number | null
          total_wallet_balance?: number | null
        }
        Update: {
          accounts_active?: number | null
          accounts_disabled?: number | null
          accounts_inactive?: number | null
          accounts_total?: number | null
          active_clients_today?: number | null
          id?: string
          orders_today?: number | null
          orders_yesterday?: number | null
          raw?: Json | null
          snapshot_at?: string
          spend_last_30d?: number | null
          spend_lifetime?: number | null
          spend_this_month?: number | null
          spend_today?: number | null
          spend_yesterday?: number | null
          tenant_id?: string
          topups_pending_count?: number | null
          topups_today_amount?: number | null
          topups_today_count?: number | null
          total_clients?: number | null
          total_wallet_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_stats_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage_audit: {
        Row: {
          action: string
          ad_account_id: string | null
          amount: number
          created_at: string
          error_message: string | null
          failed_topup_id: string | null
          id: string
          idempotency_key: string | null
          local_total_used_after: number | null
          local_total_used_before: number | null
          master_duplicate: boolean | null
          master_total_used_after: number | null
          request_payload: Json | null
          response_body: Json | null
          response_status: number | null
          source: string
          user_id: string | null
          wallet_txn_id: string | null
        }
        Insert: {
          action: string
          ad_account_id?: string | null
          amount: number
          created_at?: string
          error_message?: string | null
          failed_topup_id?: string | null
          id?: string
          idempotency_key?: string | null
          local_total_used_after?: number | null
          local_total_used_before?: number | null
          master_duplicate?: boolean | null
          master_total_used_after?: number | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          source: string
          user_id?: string | null
          wallet_txn_id?: string | null
        }
        Update: {
          action?: string
          ad_account_id?: string | null
          amount?: number
          created_at?: string
          error_message?: string | null
          failed_topup_id?: string | null
          id?: string
          idempotency_key?: string | null
          local_total_used_after?: number | null
          local_total_used_before?: number | null
          master_duplicate?: boolean | null
          master_total_used_after?: number | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          source?: string
          user_id?: string | null
          wallet_txn_id?: string | null
        }
        Relationships: []
      }
      tenant_usage_report_keys: {
        Row: {
          action: string
          after_total_used: number | null
          amount: number
          before_total_used: number | null
          created_at: string
          id: string
          idempotency_key: string
          meta: Json | null
          source: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          after_total_used?: number | null
          amount?: number
          before_total_used?: number | null
          created_at?: string
          id?: string
          idempotency_key: string
          meta?: Json | null
          source?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          after_total_used?: number | null
          amount?: number
          before_total_used?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string
          meta?: Json | null
          source?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      tenant_withdraw_requests: {
        Row: {
          ad_account_external_id: string
          ad_account_name: string | null
          admin_notes: string | null
          amount_usd: number
          created_at: string
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tenant_id: string
          tenant_user_id: string
          tenant_user_name: string | null
        }
        Insert: {
          ad_account_external_id: string
          ad_account_name?: string | null
          admin_notes?: string | null
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id: string
          tenant_user_id: string
          tenant_user_name?: string | null
        }
        Update: {
          ad_account_external_id?: string
          ad_account_name?: string | null
          admin_notes?: string | null
          amount_usd?: number
          created_at?: string
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tenant_id?: string
          tenant_user_id?: string
          tenant_user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_withdraw_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          api_key: string
          created_at: string
          domain: string
          id: string
          last_heartbeat_at: string | null
          name: string
          pull_api_key: string | null
          stats_accounts_active: number | null
          stats_accounts_disabled: number | null
          stats_accounts_inactive: number | null
          stats_accounts_total: number | null
          stats_active_clients_today: number | null
          stats_orders_today: number | null
          stats_orders_yesterday: number | null
          stats_spend_last_30d: number | null
          stats_spend_lifetime: number | null
          stats_spend_month: number | null
          stats_spend_today: number | null
          stats_spend_yesterday: number | null
          stats_top_accounts: Json | null
          stats_topups_pending: number | null
          stats_topups_today_amount: number | null
          stats_topups_today_count: number | null
          stats_total_clients: number | null
          stats_total_wallet: number | null
          stats_updated_at: string | null
          status: string
          subscription_fee: number | null
          subscription_paid_until: string | null
          subscription_type: string
          system_limit: number | null
          total_used: number
          updated_at: string
          usd_rate: number | null
          webhook_url: string | null
        }
        Insert: {
          api_key?: string
          created_at?: string
          domain: string
          id?: string
          last_heartbeat_at?: string | null
          name: string
          pull_api_key?: string | null
          stats_accounts_active?: number | null
          stats_accounts_disabled?: number | null
          stats_accounts_inactive?: number | null
          stats_accounts_total?: number | null
          stats_active_clients_today?: number | null
          stats_orders_today?: number | null
          stats_orders_yesterday?: number | null
          stats_spend_last_30d?: number | null
          stats_spend_lifetime?: number | null
          stats_spend_month?: number | null
          stats_spend_today?: number | null
          stats_spend_yesterday?: number | null
          stats_top_accounts?: Json | null
          stats_topups_pending?: number | null
          stats_topups_today_amount?: number | null
          stats_topups_today_count?: number | null
          stats_total_clients?: number | null
          stats_total_wallet?: number | null
          stats_updated_at?: string | null
          status?: string
          subscription_fee?: number | null
          subscription_paid_until?: string | null
          subscription_type?: string
          system_limit?: number | null
          total_used?: number
          updated_at?: string
          usd_rate?: number | null
          webhook_url?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string
          domain?: string
          id?: string
          last_heartbeat_at?: string | null
          name?: string
          pull_api_key?: string | null
          stats_accounts_active?: number | null
          stats_accounts_disabled?: number | null
          stats_accounts_inactive?: number | null
          stats_accounts_total?: number | null
          stats_active_clients_today?: number | null
          stats_orders_today?: number | null
          stats_orders_yesterday?: number | null
          stats_spend_last_30d?: number | null
          stats_spend_lifetime?: number | null
          stats_spend_month?: number | null
          stats_spend_today?: number | null
          stats_spend_yesterday?: number | null
          stats_top_accounts?: Json | null
          stats_topups_pending?: number | null
          stats_topups_today_amount?: number | null
          stats_topups_today_count?: number | null
          stats_total_clients?: number | null
          stats_total_wallet?: number | null
          stats_updated_at?: string | null
          status?: string
          subscription_fee?: number | null
          subscription_paid_until?: string | null
          subscription_type?: string
          system_limit?: number | null
          total_used?: number
          updated_at?: string
          usd_rate?: number | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      top_up_requests: {
        Row: {
          ad_account_id: string | null
          admin_note: string | null
          amount: number
          bank_account_id: string | null
          bdt_amount: number | null
          created_at: string
          forward_dismissed_at: string | null
          forward_dismissed_by: string | null
          id: string
          last_verify_at: string | null
          payment_method: string
          payment_reference: string | null
          proof_url: string | null
          reviewed_by: string | null
          status: string
          telegram_forward_error: string | null
          telegram_forwarded: boolean | null
          telegram_forwarded_at: string | null
          telegram_forwarding_started_at: string | null
          updated_at: string
          usd_rate: number | null
          user_id: string
          verify_attempts: number
        }
        Insert: {
          ad_account_id?: string | null
          admin_note?: string | null
          amount: number
          bank_account_id?: string | null
          bdt_amount?: number | null
          created_at?: string
          forward_dismissed_at?: string | null
          forward_dismissed_by?: string | null
          id?: string
          last_verify_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          proof_url?: string | null
          reviewed_by?: string | null
          status?: string
          telegram_forward_error?: string | null
          telegram_forwarded?: boolean | null
          telegram_forwarded_at?: string | null
          telegram_forwarding_started_at?: string | null
          updated_at?: string
          usd_rate?: number | null
          user_id: string
          verify_attempts?: number
        }
        Update: {
          ad_account_id?: string | null
          admin_note?: string | null
          amount?: number
          bank_account_id?: string | null
          bdt_amount?: number | null
          created_at?: string
          forward_dismissed_at?: string | null
          forward_dismissed_by?: string | null
          id?: string
          last_verify_at?: string | null
          payment_method?: string
          payment_reference?: string | null
          proof_url?: string | null
          reviewed_by?: string | null
          status?: string
          telegram_forward_error?: string | null
          telegram_forwarded?: boolean | null
          telegram_forwarded_at?: string | null
          telegram_forwarding_started_at?: string | null
          updated_at?: string
          usd_rate?: number | null
          user_id?: string
          verify_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "top_up_requests_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "top_up_requests_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number | null
          bank_account_id: string | null
          created_at: string
          description: string | null
          id: string
          processed_by: string | null
          reference_id: string | null
          source_ip: string | null
          type: string
          user_id: string
          via: string | null
        }
        Insert: {
          amount: number
          balance_after?: number | null
          bank_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          processed_by?: string | null
          reference_id?: string | null
          source_ip?: string | null
          type: string
          user_id: string
          via?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number | null
          bank_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          processed_by?: string | null
          reference_id?: string | null
          source_ip?: string | null
          type?: string
          user_id?: string
          via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ad_accounts: {
        Row: {
          ad_account_id: string
          assigned_at: string
          id: string
          user_id: string
        }
        Insert: {
          ad_account_id: string
          assigned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string
          assigned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ad_accounts_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          currency: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          currency?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      business_managers_safe: {
        Row: {
          bm_id: string | null
          created_at: string | null
          id: string | null
          last_synced_at: string | null
          name: string | null
          platform: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          bm_id?: string | null
          created_at?: string | null
          id?: string | null
          last_synced_at?: string | null
          name?: string | null
          platform?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          bm_id?: string | null
          created_at?: string | null
          id?: string | null
          last_synced_at?: string | null
          name?: string | null
          platform?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      seller_monthly_balance_view: {
        Row: {
          closing_balance: number | null
          month_delta: number | null
          month_label: string | null
          month_start: string | null
          opening_balance: number | null
          seller_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_tenant_usage: {
        Args: {
          p_action: string
          p_amount: number
          p_key: string
          p_meta?: Json
          p_source?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      claim_forward_slot: {
        Args: { p_group_id: string; p_source_id: string; p_source_type: string }
        Returns: boolean
      }
      complete_forward_slot: {
        Args: {
          p_caption_total: number
          p_message_id: number
          p_source_id: string
          p_source_type: string
        }
        Returns: undefined
      }
      generate_invoice_number: { Args: never; Returns: string }
      get_agency_id_by_owner: { Args: { _owner_id: string }; Returns: string }
      get_user_agency_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      pg_advisory_lock: { Args: { key: number }; Returns: undefined }
      pg_advisory_unlock: { Args: { key: number }; Returns: boolean }
      release_forward_slot: {
        Args: { p_source_id: string; p_source_type: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "client" | "superadmin" | "seller" | "agency"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "client", "superadmin", "seller", "agency"],
    },
  },
} as const
