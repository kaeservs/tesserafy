/**
 * Generated from the deployed schema. Do not edit.
 *
 *   pnpm db:types
 *
 * Every hand-written type for a row is a claim about the schema that nothing
 * checks, and it stays convincing long after the column it describes has
 * changed. These are the claim the database itself makes.
 */
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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_provisioning: {
        Row: {
          admin_user_id: string
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          created_at: string
          email: string
          id: string
          new_account: boolean | null
          plan: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          admin_user_id: string
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          created_at?: string
          email: string
          id?: string
          new_account?: boolean | null
          plan?: string | null
          role: string
          user_id?: string | null
        }
        Update: {
          admin_user_id?: string
          company_id?: string | null
          company_name?: string | null
          completed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          new_account?: boolean | null
          plan?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_provisioning_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: string
          retention_days: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: string
          retention_days?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: string
          retention_days?: number | null
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          company_id: string
          consent_confirmed_at: string | null
          consent_confirmed_by: string | null
          consent_statement: string | null
          created_at: string
          criteria_version: number
          engagement_type: string
          id: string
          occurred_at: string | null
          source_key: string | null
          title: string
        }
        Insert: {
          company_id: string
          consent_confirmed_at?: string | null
          consent_confirmed_by?: string | null
          consent_statement?: string | null
          created_at?: string
          criteria_version?: number
          engagement_type?: string
          id?: string
          occurred_at?: string | null
          source_key?: string | null
          title: string
        }
        Update: {
          company_id?: string
          consent_confirmed_at?: string | null
          consent_confirmed_by?: string | null
          consent_statement?: string | null
          created_at?: string
          criteria_version?: number
          engagement_type?: string
          id?: string
          occurred_at?: string | null
          source_key?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      criteria_definitions: {
        Row: {
          candidate_threshold: number
          confirm_threshold: number
          corroborating_segments: number
          created_at: string
          definition: string
          engagement_type: string
          key: string
          label: string
          position: number
          version: number
          weight: number
        }
        Insert: {
          candidate_threshold?: number
          confirm_threshold?: number
          corroborating_segments?: number
          created_at?: string
          definition: string
          engagement_type: string
          key: string
          label: string
          position: number
          version: number
          weight?: number
        }
        Update: {
          candidate_threshold?: number
          confirm_threshold?: number
          corroborating_segments?: number
          created_at?: string
          definition?: string
          engagement_type?: string
          key?: string
          label?: string
          position?: number
          version?: number
          weight?: number
        }
        Relationships: []
      }
      criterion_events: {
        Row: {
          company_id: string
          confidence: number
          conversation_id: string
          created_at: string
          criterion_key: string
          detector: string
          id: string
          kind: string
          model: string
          quote: string
          quote_end: number
          quote_start: number
          segment_id: string
        }
        Insert: {
          company_id: string
          confidence: number
          conversation_id: string
          created_at?: string
          criterion_key: string
          detector: string
          id?: string
          kind: string
          model: string
          quote: string
          quote_end: number
          quote_start: number
          segment_id: string
        }
        Update: {
          company_id?: string
          confidence?: number
          conversation_id?: string
          created_at?: string
          criterion_key?: string
          detector?: string
          id?: string
          kind?: string
          model?: string
          quote?: string
          quote_end?: number
          quote_start?: number
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "criterion_events_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "criterion_events_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      erasure_events: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          events_removed: number
          exported_tickets: Json
          id: string
          insights_removed: number
          reason: string
          requested_by: string | null
          segments_removed: number
          signals_removed: number
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          events_removed?: number
          exported_tickets?: Json
          id?: string
          insights_removed?: number
          reason: string
          requested_by?: string | null
          segments_removed?: number
          signals_removed?: number
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          events_removed?: number
          exported_tickets?: Json
          id?: string
          insights_removed?: number
          reason?: string
          requested_by?: string | null
          segments_removed?: number
          signals_removed?: number
        }
        Relationships: [
          {
            foreignKeyName: "erasure_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_declines: {
        Row: {
          company_id: string
          created_at: string
          id: string
          reason: string
          signal_ids: string[]
          signature: string
          synthesiser: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          reason: string
          signal_ids: string[]
          signature: string
          synthesiser: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          reason?: string
          signal_ids?: string[]
          signature?: string
          synthesiser?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_declines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_evidence: {
        Row: {
          company_id: string
          created_at: string
          id: string
          insight_id: string
          signal_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          insight_id: string
          signal_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          insight_id?: string
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_evidence_company_id_insight_id_fkey"
            columns: ["company_id", "insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "insight_evidence_company_id_signal_id_fkey"
            columns: ["company_id", "signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      insight_tickets: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          external_id: string
          id: string
          insight_id: string
          provider: string
          url: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          external_id: string
          id?: string
          insight_id: string
          provider: string
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          external_id?: string
          id?: string
          insight_id?: string
          provider?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_tickets_company_id_insight_id_fkey"
            columns: ["company_id", "insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      insights: {
        Row: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          model: string
          status: string
          summary: string
          synthesiser: string
          title: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          model: string
          status?: string
          summary: string
          synthesiser: string
          title: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          model?: string
          status?: string
          summary?: string
          synthesiser?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      model_usage: {
        Row: {
          cache_creation_tokens: number
          cache_read_tokens: number
          company_id: string | null
          conversation_id: string | null
          created_at: string
          detector: string | null
          duration_ms: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          tier: string
        }
        Insert: {
          cache_creation_tokens?: number
          cache_read_tokens?: number
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          detector?: string | null
          duration_ms: number
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          tier: string
        }
        Update: {
          cache_creation_tokens?: number
          cache_read_tokens?: number
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          detector?: string | null
          duration_ms?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          note: string
          user_id: string
        }
        Insert: {
          created_at?: string
          note: string
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_seconds: number
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
      segment_embeddings: {
        Row: {
          company_id: string
          created_at: string
          embedding: string
          model: string
          segment_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          embedding: string
          model: string
          segment_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          embedding?: string
          model?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_embeddings_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      segments: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          end_ms: number
          id: string
          search: unknown
          speaker: string | null
          start_ms: number
          text: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          end_ms: number
          id?: string
          search?: unknown
          speaker?: string | null
          start_ms: number
          text: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          end_ms?: number
          id?: string
          search?: unknown
          speaker?: string | null
          start_ms?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "segments_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      signal_evidence: {
        Row: {
          company_id: string
          created_at: string
          id: string
          quote: string
          quote_end: number
          quote_start: number
          segment_id: string
          signal_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          quote: string
          quote_end: number
          quote_start: number
          segment_id: string
          signal_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          quote?: string
          quote_end?: number
          quote_start?: number
          segment_id?: string
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_evidence_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "signal_evidence_company_id_signal_id_fkey"
            columns: ["company_id", "signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      signals: {
        Row: {
          company_id: string
          confidence: number
          conversation_id: string
          created_at: string
          detector: string
          id: string
          kind: string
          model: string
          summary: string
        }
        Insert: {
          company_id: string
          confidence: number
          conversation_id: string
          created_at?: string
          detector: string
          id?: string
          kind: string
          model: string
          summary: string
        }
        Update: {
          company_id?: string
          confidence?: number
          conversation_id?: string
          created_at?: string
          detector?: string
          id?: string
          kind?: string
          model?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      support_access: {
        Row: {
          admin_user_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          subject_user_id: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          reason: string
          subject_user_id: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          reason?: string
          subject_user_id?: string
        }
        Relationships: []
      }
      system_failures: {
        Row: {
          company_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          kind: string
          message: string
          model: string | null
          source: string
          status: number | null
          tier: string | null
        }
        Insert: {
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind: string
          message: string
          model?: string | null
          source: string
          status?: number | null
          tier?: string | null
        }
        Update: {
          company_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          message?: string
          model?: string | null
          source?: string
          status?: number | null
          tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_failures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_failures_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_companies: {
        Args: never
        Returns: {
          company_id: string
          conversations: number
          failures_24h: number
          last_activity: string
          members: number
          name: string
          plan: string
          retention_days: number
          segments: number
          spend_30d_usd: number
        }[]
      }
      admin_users: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          email: string
          is_admin: boolean
          last_sign_in: string
          open_support: boolean
          role: string
          user_id: string
        }[]
      }
      append_live_segment: {
        Args: {
          p_conversation_id: string
          p_end_ms: number
          p_speaker: string
          p_start_ms: number
          p_text: string
        }
        Returns: string
      }
      complete_account_provisioning: {
        Args: { p_id: string; p_new_account: boolean; p_user_id: string }
        Returns: string
      }
      conversation_for_source: {
        Args: { p_company_id: string; p_source_key: string }
        Returns: string
      }
      conversation_pipeline: {
        Args: { p_company_id?: string }
        Returns: {
          conversation_id: string
          criterion_rows: number
          embedded: number
          extraction_runs: number
          segments: number
          signals: number
        }[]
      }
      decide_insight: {
        Args: { p_insight_id: string; p_status: string }
        Returns: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          model: string
          status: string
          summary: string
          synthesiser: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "insights"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      embed_stored_segments: {
        Args: { p_company_id: string; p_model: string; p_rows: Json }
        Returns: number
      }
      end_support_access: {
        Args: { p_id: string }
        Returns: {
          admin_user_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          subject_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_access"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      erase_conversation: {
        Args: { p_conversation_id: string; p_reason?: string }
        Returns: Json
      }
      import_conversation: {
        Args: {
          p_company_id?: string
          p_consent_statement?: string
          p_criteria_version?: number
          p_engagement_type?: string
          p_occurred_at?: string
          p_segments: Json
          p_title: string
        }
        Returns: string
      }
      ingest_transcript: {
        Args: {
          p_company_id: string
          p_model: string
          p_occurred_at: string
          p_segments: Json
          p_source_key?: string
          p_title: string
        }
        Returns: string
      }
      match_segments: {
        Args: {
          p_company_id: string
          p_match_count: number
          p_min_similarity: number
          p_query_embedding: string
        }
        Returns: {
          company_id: string
          conversation_id: string
          end_ms: number
          segment_id: string
          similarity: number
          speaker: string
          start_ms: number
          text: string
        }[]
      }
      open_account_provisioning: {
        Args: {
          p_company_id?: string
          p_company_name?: string
          p_email: string
          p_plan?: string
          p_role: string
        }
        Returns: {
          admin_user_id: string
          company_id: string | null
          company_name: string | null
          completed_at: string | null
          created_at: string
          email: string
          id: string
          new_account: boolean | null
          plan: string | null
          role: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "account_provisioning"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_support_access: {
        Args: {
          p_minutes?: number
          p_reason: string
          p_subject_user_id: string
        }
        Returns: {
          admin_user_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          subject_user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_access"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge_expired_conversations: {
        Args: { p_company_id?: string; p_limit?: number }
        Returns: Json
      }
      record_criterion_events: {
        Args: { p_conversation_id: string; p_events: Json }
        Returns: Json
      }
      record_extracted_signals: {
        Args: {
          p_conversation_id: string
          p_detector: string
          p_model: string
          p_signals: Json
        }
        Returns: Json
      }
      record_failure: {
        Args: {
          p_company_id?: string
          p_conversation_id?: string
          p_kind: string
          p_message: string
          p_model?: string
          p_source: string
          p_status?: number
          p_tier?: string
        }
        Returns: string
      }
      record_insight: {
        Args: {
          p_company_id: string
          p_model: string
          p_signal_ids: string[]
          p_summary: string
          p_synthesiser: string
          p_title: string
        }
        Returns: string
      }
      record_insight_decline: {
        Args: {
          p_company_id: string
          p_reason: string
          p_signal_ids: string[]
          p_synthesiser: string
        }
        Returns: undefined
      }
      record_insight_ticket: {
        Args: {
          p_external_id: string
          p_insight_id: string
          p_provider: string
          p_url: string
        }
        Returns: {
          company_id: string
          created_at: string
          created_by: string
          external_id: string
          id: string
          insight_id: string
          provider: string
          url: string
        }
        SetofOptions: {
          from: "*"
          to: "insight_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_model_usage: {
        Args: {
          p_cache_creation_tokens?: number
          p_cache_read_tokens?: number
          p_company_id?: string
          p_conversation_id?: string
          p_detector?: string
          p_duration_ms: number
          p_input_tokens?: number
          p_model: string
          p_output_tokens?: number
          p_tier: string
        }
        Returns: string
      }
      record_segment_embeddings: {
        Args: { p_conversation_id: string; p_model: string; p_rows: Json }
        Returns: number
      }
      retention_preview: { Args: { p_days: number }; Returns: number }
      search_segments: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          conversation_id: string
          headline: string
          rank: number
          segment_id: string
          segment_text: string
          speaker: string
          start_ms: number
        }[]
      }
      segments_without_embeddings: {
        Args: { p_company_id: string; p_conversation_id?: string }
        Returns: {
          end_ms: number
          id: string
          speaker: string
          start_ms: number
          text: string
        }[]
      }
      set_retention: { Args: { p_days: number }; Returns: number }
      start_live_conversation: {
        Args: {
          p_company_id?: string
          p_consent_statement?: string
          p_criteria_version?: number
          p_engagement_type?: string
          p_title: string
        }
        Returns: string
      }
      store_insight: {
        Args: {
          p_company_id: string
          p_model: string
          p_signal_ids: string[]
          p_summary: string
          p_synthesiser: string
          p_title: string
        }
        Returns: string
      }
      store_signals: {
        Args: {
          p_company_id: string
          p_conversation_id: string
          p_detector: string
          p_model: string
          p_signals: Json
        }
        Returns: string[]
      }
      take_rate_limit_tokens: {
        Args: { p_bucket: string; p_internal_windows?: Json; p_windows: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
