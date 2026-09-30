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
      access_requests: {
        Row: {
          company_id: string
          created_at: string
          email: string
          id: string
          note: string | null
          requested_by: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          role: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id?: string
          note?: string | null
          requested_by?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          role: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          note?: string | null
          requested_by?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          company_id: string | null
          deletion_id: string | null
          id: string
          requested_at: string
          resolved_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          deletion_id?: string | null
          id?: string
          requested_at?: string
          resolved_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          deletion_id?: string | null
          id?: string
          requested_at?: string
          resolved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_deletion_requests_deletion_id_fkey"
            columns: ["deletion_id"]
            isOneToOne: false
            referencedRelation: "account_deletions"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletions: {
        Row: {
          admin_user_id: string
          completed_at: string | null
          created_at: string
          email_sha256: string
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          admin_user_id: string
          completed_at?: string | null
          created_at?: string
          email_sha256: string
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          admin_user_id?: string
          completed_at?: string | null
          created_at?: string
          email_sha256?: string
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
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
          {
            foreignKeyName: "account_provisioning_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          domain: string | null
          id: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      action_items: {
        Row: {
          action: string
          company_id: string
          conversation_id: string
          created_at: string
          detector: string
          done: boolean
          done_at: string | null
          done_by: string | null
          due: string | null
          id: string
          model: string
          owner_name: string | null
          owner_side: string
          quote: string
          segment_id: string
        }
        Insert: {
          action: string
          company_id: string
          conversation_id: string
          created_at?: string
          detector: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due?: string | null
          id?: string
          model: string
          owner_name?: string | null
          owner_side: string
          quote: string
          segment_id: string
        }
        Update: {
          action?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          detector?: string
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          due?: string | null
          id?: string
          model?: string
          owner_name?: string | null
          owner_side?: string
          quote?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "action_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      ai_guidance: {
        Row: {
          active: boolean
          body: string
          company_id: string
          counts: boolean | null
          created_at: string
          created_by: string | null
          criterion_key: string | null
          engagement_type: string | null
          feature: string
          id: string
          kind: string
          quote: string | null
          source_event_id: string | null
        }
        Insert: {
          active?: boolean
          body: string
          company_id: string
          counts?: boolean | null
          created_at?: string
          created_by?: string | null
          criterion_key?: string | null
          engagement_type?: string | null
          feature: string
          id?: string
          kind: string
          quote?: string | null
          source_event_id?: string | null
        }
        Update: {
          active?: boolean
          body?: string
          company_id?: string
          counts?: boolean | null
          created_at?: string
          created_by?: string | null
          criterion_key?: string | null
          engagement_type?: string | null
          feature?: string
          id?: string
          kind?: string
          quote?: string | null
          source_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_guidance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_guidance_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: true
            referencedRelation: "criterion_events"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: boolean
          operator_mfa_required: boolean
          signup_open: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          operator_mfa_required?: boolean
          signup_open?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          operator_mfa_required?: boolean
          signup_open?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      app_settings_events: {
        Row: {
          actor: string | null
          at: string
          id: string
          mfa_required: boolean | null
          signup_open: boolean | null
        }
        Insert: {
          actor?: string | null
          at?: string
          id?: string
          mfa_required?: boolean | null
          signup_open?: boolean | null
        }
        Update: {
          actor?: string | null
          at?: string
          id?: string
          mfa_required?: boolean | null
          signup_open?: boolean | null
        }
        Relationships: []
      }
      call_preps: {
        Row: {
          account_id: string | null
          brief: Json | null
          brief_at: string | null
          brief_model: string | null
          call_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          engagement_type: string
          id: string
          linkedin_url: string | null
          person_name: string
          person_title: string | null
          profile_text: string | null
        }
        Insert: {
          account_id?: string | null
          brief?: Json | null
          brief_at?: string | null
          brief_model?: string | null
          call_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          engagement_type?: string
          id?: string
          linkedin_url?: string | null
          person_name: string
          person_title?: string | null
          profile_text?: string | null
        }
        Update: {
          account_id?: string | null
          brief?: Json | null
          brief_at?: string | null
          brief_model?: string | null
          call_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          engagement_type?: string
          id?: string
          linkedin_url?: string | null
          person_name?: string
          person_title?: string | null
          profile_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_preps_company_id_account_id_fkey"
            columns: ["company_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "call_preps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_assignments: {
        Row: {
          assigned_by: string | null
          assigned_to: string
          company_id: string
          conversation_id: string
          created_at: string
          done_at: string | null
          id: string
          note: string | null
          reply: string | null
          segment_id: string | null
          status: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_to: string
          company_id: string
          conversation_id: string
          created_at?: string
          done_at?: string | null
          id?: string
          note?: string | null
          reply?: string | null
          segment_id?: string | null
          status?: string
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          done_at?: string | null
          id?: string
          note?: string | null
          reply?: string | null
          segment_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_assignments_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "coaching_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_assignments_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      companies: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          created_at: string
          created_by: string | null
          default_engagement_type: string | null
          id: string
          name: string
          plan: string
          retention_days: number | null
          sample_imported_at: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          created_at?: string
          created_by?: string | null
          default_engagement_type?: string | null
          id?: string
          name: string
          plan?: string
          retention_days?: number | null
          sample_imported_at?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          created_at?: string
          created_by?: string | null
          default_engagement_type?: string | null
          id?: string
          name?: string
          plan?: string
          retention_days?: number | null
          sample_imported_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      company_exports: {
        Row: {
          company_id: string
          conversations: number
          email: string
          id: string
          requested_at: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          conversations: number
          email: string
          id?: string
          requested_at?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          conversations?: number
          email?: string
          id?: string
          requested_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_exports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
      company_trackers: {
        Row: {
          company_id: string
          connected_at: string
          connected_by: string | null
          provider: string
          target: string
          token_ciphertext: string
          token_hint: string
        }
        Insert: {
          company_id: string
          connected_at?: string
          connected_by?: string | null
          provider: string
          target: string
          token_ciphertext: string
          token_hint: string
        }
        Update: {
          company_id?: string
          connected_at?: string
          connected_by?: string | null
          provider?: string
          target?: string
          token_ciphertext?: string
          token_hint?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_trackers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_edits: {
        Row: {
          actor: string | null
          at: string
          company_id: string
          conversation_id: string
          evidence_removed: number
          field: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          actor?: string | null
          at?: string
          company_id: string
          conversation_id: string
          evidence_removed?: number
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          actor?: string | null
          at?: string
          company_id?: string
          conversation_id?: string
          evidence_removed?: number
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_edits_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      conversation_views: {
        Row: {
          company_id: string
          conversation_id: string
          during_support: boolean
          id: string
          user_id: string | null
          viewed_at: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          during_support?: boolean
          id?: string
          user_id?: string | null
          viewed_at?: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          during_support?: boolean
          id?: string
          user_id?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_views_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_views_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string | null
          added_by: string | null
          company_id: string
          consent_confirmed_at: string | null
          consent_confirmed_by: string | null
          consent_statement: string | null
          created_at: string
          criteria_version: number
          engagement_type: string
          id: string
          is_sample: boolean
          occurred_at: string | null
          outcome: string | null
          outcome_set_at: string | null
          outcome_set_by: string | null
          source_key: string | null
          title: string
        }
        Insert: {
          account_id?: string | null
          added_by?: string | null
          company_id: string
          consent_confirmed_at?: string | null
          consent_confirmed_by?: string | null
          consent_statement?: string | null
          created_at?: string
          criteria_version?: number
          engagement_type?: string
          id?: string
          is_sample?: boolean
          occurred_at?: string | null
          outcome?: string | null
          outcome_set_at?: string | null
          outcome_set_by?: string | null
          source_key?: string | null
          title: string
        }
        Update: {
          account_id?: string | null
          added_by?: string | null
          company_id?: string
          consent_confirmed_at?: string | null
          consent_confirmed_by?: string | null
          consent_statement?: string | null
          created_at?: string
          criteria_version?: number
          engagement_type?: string
          id?: string
          is_sample?: boolean
          occurred_at?: string | null
          outcome?: string | null
          outcome_set_at?: string | null
          outcome_set_by?: string | null
          source_key?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_fk"
            columns: ["company_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["company_id", "id"]
          },
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
          company_id: string | null
          confirm_threshold: number
          corroborating_segments: number
          created_at: string
          definition: string
          engagement_type: string
          id: string
          key: string
          label: string
          position: number
          published_by: string | null
          version: number
          weight: number
        }
        Insert: {
          candidate_threshold?: number
          company_id?: string | null
          confirm_threshold?: number
          corroborating_segments?: number
          created_at?: string
          definition: string
          engagement_type: string
          id?: string
          key: string
          label: string
          position: number
          published_by?: string | null
          version: number
          weight?: number
        }
        Update: {
          candidate_threshold?: number
          company_id?: string | null
          confirm_threshold?: number
          corroborating_segments?: number
          created_at?: string
          definition?: string
          engagement_type?: string
          id?: string
          key?: string
          label?: string
          position?: number
          published_by?: string | null
          version?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "criteria_definitions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      criterion_events: {
        Row: {
          by_person: boolean | null
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
          reason: string | null
          recorded_by: string | null
          segment_id: string
        }
        Insert: {
          by_person?: boolean | null
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
          reason?: string | null
          recorded_by?: string | null
          segment_id: string
        }
        Update: {
          by_person?: boolean | null
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
          reason?: string | null
          recorded_by?: string | null
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
      criterion_goals: {
        Row: {
          company_id: string
          criterion_key: string
          engagement_type: string
          set_by: string | null
          target: number
          updated_at: string
        }
        Insert: {
          company_id: string
          criterion_key: string
          engagement_type: string
          set_by?: string | null
          target: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          criterion_key?: string
          engagement_type?: string
          set_by?: string | null
          target?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "criterion_goals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
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
      feedback: {
        Row: {
          body: string
          company_id: string
          created_at: string
          handled_at: string | null
          handled_by: string | null
          id: string
          page: string | null
          sent_by: string | null
          status: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          page?: string | null
          sent_by?: string | null
          status?: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          page?: string | null
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_comments: {
        Row: {
          author: string | null
          body: string
          company_id: string
          created_at: string
          id: string
          insight_id: string
        }
        Insert: {
          author?: string | null
          body: string
          company_id: string
          created_at?: string
          id?: string
          insight_id: string
        }
        Update: {
          author?: string | null
          body?: string
          company_id?: string
          created_at?: string
          id?: string
          insight_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_comments_company_id_insight_id_fkey"
            columns: ["company_id", "insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["company_id", "id"]
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
      insight_events: {
        Row: {
          actor: string | null
          at: string
          company_id: string
          detail: string | null
          id: string
          insight_id: string
          kind: string
        }
        Insert: {
          actor?: string | null
          at?: string
          company_id: string
          detail?: string | null
          id?: string
          insight_id: string
          kind: string
        }
        Update: {
          actor?: string | null
          at?: string
          company_id?: string
          detail?: string | null
          id?: string
          insight_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_events_company_id_insight_id_fkey"
            columns: ["company_id", "insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["company_id", "id"]
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
          assigned_to: string | null
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
          assigned_to?: string | null
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
          assigned_to?: string | null
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
      membership_removals: {
        Row: {
          company_id: string
          email: string
          id: string
          removed_at: string
          removed_by: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          email: string
          id?: string
          removed_at?: string
          removed_by?: string | null
          role: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          email?: string
          id?: string
          removed_at?: string
          removed_by?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_removals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_role_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          company_id: string
          email: string
          from_role: string
          id: string
          to_role: string
          user_id: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          company_id: string
          email: string
          from_role: string
          id?: string
          to_role: string
          user_id?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          email?: string
          from_role?: string
          id?: string
          to_role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_role_changes_company_id_fkey"
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
      moments: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          criterion_key: string
          engagement_type: string
          id: string
          note: string | null
          saved_by: string | null
          segment_id: string
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          criterion_key: string
          engagement_type: string
          id?: string
          note?: string | null
          saved_by?: string | null
          segment_id: string
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          criterion_key?: string
          engagement_type?: string
          id?: string
          note?: string | null
          saved_by?: string | null
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "moments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_company_id_segment_id_fkey"
            columns: ["company_id", "segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      notifications: {
        Row: {
          access_request_id: string | null
          actor: string | null
          coaching_id: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          id: string
          insight_id: string | null
          kind: string
          note_id: string | null
          read_at: string | null
          user_id: string
        }
        Insert: {
          access_request_id?: string | null
          actor?: string | null
          coaching_id?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          insight_id?: string | null
          kind: string
          note_id?: string | null
          read_at?: string | null
          user_id: string
        }
        Update: {
          access_request_id?: string | null
          actor?: string | null
          coaching_id?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          insight_id?: string | null
          kind?: string
          note_id?: string | null
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_access_request_id_fkey"
            columns: ["access_request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_coaching_id_fkey"
            columns: ["coaching_id"]
            isOneToOne: false
            referencedRelation: "coaching_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_insight_id_fkey"
            columns: ["insight_id"]
            isOneToOne: false
            referencedRelation: "insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "segment_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      our_speakers: {
        Row: {
          added_by: string | null
          company_id: string
          created_at: string
          name: string
        }
        Insert: {
          added_by?: string | null
          company_id: string
          created_at?: string
          name: string
        }
        Update: {
          added_by?: string | null
          company_id?: string
          created_at?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "our_speakers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          calls: number | null
          extractions: number | null
          id: string
          live_minutes: number | null
          name: string
          pattern_runs: number | null
          price_usd_cents: number | null
          rank: number
          self_serve: boolean
          trial_days: number | null
        }
        Insert: {
          calls?: number | null
          extractions?: number | null
          id: string
          live_minutes?: number | null
          name: string
          pattern_runs?: number | null
          price_usd_cents?: number | null
          rank: number
          self_serve?: boolean
          trial_days?: number | null
        }
        Update: {
          calls?: number | null
          extractions?: number | null
          id?: string
          live_minutes?: number | null
          name?: string
          pattern_runs?: number | null
          price_usd_cents?: number | null
          rank?: number
          self_serve?: boolean
          trial_days?: number | null
        }
        Relationships: []
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
      scorecard_purposes: {
        Row: {
          company_id: string
          engagement_type: string
          purpose: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          engagement_type: string
          purpose: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          engagement_type?: string
          purpose?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scorecard_purposes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
      segment_notes: {
        Row: {
          author: string | null
          body: string
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          segment_id: string
          updated_at: string
        }
        Insert: {
          author?: string | null
          body: string
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          segment_id: string
          updated_at?: string
        }
        Update: {
          author?: string | null
          body?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          segment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_notes_company_id_conversation_id_fkey"
            columns: ["company_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "segment_notes_company_id_segment_id_fkey"
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
      subscription_events: {
        Row: {
          actor: string | null
          at: string
          company_id: string
          from_plan: string | null
          id: string
          kind: string
          source: string
          to_plan: string | null
        }
        Insert: {
          actor?: string | null
          at?: string
          company_id: string
          from_plan?: string | null
          id?: string
          kind: string
          source: string
          to_plan?: string | null
        }
        Update: {
          actor?: string | null
          at?: string
          company_id?: string
          from_plan?: string | null
          id?: string
          kind?: string
          source?: string
          to_plan?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_from_plan_fkey"
            columns: ["from_plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_events_to_plan_fkey"
            columns: ["to_plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          company_id: string
          period_end: string
          period_start: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          scheduled_plan: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          company_id: string
          period_end: string
          period_start: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          scheduled_plan?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          company_id?: string
          period_end?: string
          period_start?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          scheduled_plan?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_scheduled_plan_fkey"
            columns: ["scheduled_plan"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
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
      tracker_events: {
        Row: {
          action: string
          actor: string | null
          at: string
          company_id: string
          id: string
          provider: string
          target: string
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          company_id: string
          id?: string
          provider: string
          target: string
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          company_id?: string
          id?: string
          provider?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracker_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_ledger: {
        Row: {
          amount: number
          at: string
          company_id: string
          id: number
          meter: string
          period_start: string
          refunded_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          at?: string
          company_id: string
          id?: never
          meter: string
          period_start: string
          refunded_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          at?: string
          company_id?: string
          id?: never
          meter?: string
          period_start?: string
          refunded_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_ai_instruction: {
        Args: {
          p_body: string
          p_criterion_key?: string
          p_engagement_type?: string
          p_feature: string
        }
        Returns: string
      }
      add_segment_note: {
        Args: { p_body: string; p_segment_id: string }
        Returns: string
      }
      admin_access_requests: {
        Args: never
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          email: string
          id: string
          note: string
          requested_by: string
          role: string
        }[]
      }
      admin_activity: {
        Args: { p_limit?: number }
        Returns: {
          action: string
          actor: string
          at: string
          detail: string
          subject: string
        }[]
      }
      admin_activity_weeks: {
        Args: { p_weeks?: number }
        Returns: {
          company_id: string
          week: string
        }[]
      }
      admin_adoption: {
        Args: never
        Returns: {
          calls: number
          closed_at: string
          company_id: string
          created_at: string
          first_call_at: string
          first_insight_at: string
          first_ticket_at: string
          name: string
          plan: string
          self_serve: boolean
        }[]
      }
      admin_companies: {
        Args: never
        Returns: {
          closed_at: string
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
      admin_company_detail: { Args: { p_company_id: string }; Returns: Json }
      admin_company_health: {
        Args: never
        Returns: {
          calls_30d: number
          calls_7d: number
          calls_limit: number
          calls_used: number
          closed_at: string
          company_id: string
          created_at: string
          extractions_limit: number
          extractions_used: number
          failures_7d: number
          last_call_at: string
          last_view_at: string
          live_limit_seconds: number
          live_used_seconds: number
          members: number
          name: string
          period_end: string
          plan: string
          views_7d: number
        }[]
      }
      admin_company_margin: {
        Args: { p_days?: number }
        Returns: {
          closed_at: string
          company_id: string
          model_calls: number
          name: string
          plan: string
          price_usd_cents: number
          usd: number
        }[]
      }
      admin_feature_adoption: {
        Args: { p_days?: number }
        Returns: {
          calls: number
          closed_at: string
          coaching: number
          company_id: string
          corrections: number
          examples: number
          feedback: number
          goals: number
          name: string
          plan: string
          preps: number
          sample_call: boolean
          speakers_marked: number
        }[]
      }
      admin_operator_mfa: { Args: never; Returns: Json }
      admin_overview: { Args: never; Returns: Json }
      admin_set_feedback_status: {
        Args: { p_feedback_id: string; p_status: string }
        Returns: undefined
      }
      admin_set_member_role: {
        Args: { p_company_id: string; p_role: string; p_user_id: string }
        Returns: undefined
      }
      admin_set_operator_mfa: {
        Args: { p_required: boolean }
        Returns: undefined
      }
      admin_set_plan: {
        Args: { p_company_id: string; p_plan: string }
        Returns: undefined
      }
      admin_set_signup_open: { Args: { p_open: boolean }; Returns: undefined }
      admin_spend_by_week: {
        Args: { p_weeks?: number }
        Returns: {
          calls: number
          detector: string
          model: string
          tier: string
          usd: number
          week: string
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
      assign_coaching: {
        Args: {
          p_assigned_to: string
          p_conversation_id: string
          p_note?: string
          p_segment_id?: string
        }
        Returns: string
      }
      assign_insight: {
        Args: { p_insight_id: string; p_user_id?: string }
        Returns: undefined
      }
      cancel_plan: { Args: never; Returns: undefined }
      change_plan: { Args: { p_plan: string }; Returns: string }
      close_company: {
        Args: { p_company_id: string; p_confirm_name: string; p_reason: string }
        Returns: Json
      }
      comment_insight: {
        Args: { p_body: string; p_insight_id: string }
        Returns: string
      }
      company_team: {
        Args: never
        Returns: {
          email: string
          is_you: boolean
          joined_at: string
          last_sign_in_at: string
          role: string
          user_id: string
        }[]
      }
      complete_account_deletion: {
        Args: { p_id: string }
        Returns: {
          admin_user_id: string
          completed_at: string | null
          created_at: string
          email_sha256: string
          id: string
          reason: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "account_deletions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_account_provisioning: {
        Args: { p_id: string; p_new_account: boolean; p_user_id: string }
        Returns: string
      }
      complete_coaching: {
        Args: { p_assignment_id: string; p_reply?: string }
        Returns: undefined
      }
      connect_tracker: {
        Args: {
          p_provider: string
          p_target: string
          p_token_ciphertext: string
          p_token_hint: string
        }
        Returns: undefined
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
      conversation_talk: {
        Args: { p_since: string }
        Returns: {
          conversation_id: string
          questions: number
          speaker: string
          words: number
        }[]
      }
      conversation_viewers: {
        Args: { p_conversation_id: string }
        Returns: {
          during_support: boolean
          email: string
          last_viewed_at: string
          views: number
        }[]
      }
      create_my_company: { Args: { p_name: string }; Returns: string }
      decide_insight: {
        Args: { p_insight_id: string; p_status: string }
        Returns: {
          assigned_to: string | null
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
      delete_account: { Args: { p_account_id: string }; Returns: undefined }
      delete_call_prep: { Args: { p_prep_id: string }; Returns: undefined }
      delete_segment_note: { Args: { p_note_id: string }; Returns: undefined }
      disconnect_tracker: { Args: never; Returns: undefined }
      dispute_criterion: {
        Args: {
          p_conversation_id: string
          p_criterion_key: string
          p_kind: string
          p_quote: string
          p_reason: string
          p_segment_id: string
        }
        Returns: string
      }
      edit_conversation: {
        Args: {
          p_account_id?: string
          p_clear_account?: boolean
          p_clear_date?: boolean
          p_conversation_id: string
          p_criteria_version?: number
          p_engagement_type?: string
          p_occurred_at?: string
          p_outcome?: string
          p_title?: string
        }
        Returns: Json
      }
      edit_insight: {
        Args: { p_insight_id: string; p_summary: string; p_title: string }
        Returns: undefined
      }
      edit_segment_note: {
        Args: { p_body: string; p_note_id: string }
        Returns: undefined
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
      import_sample_call: {
        Args: { p_segments: Json; p_title: string }
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
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number }
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
      merge_insights: {
        Args: { p_keep_id: string; p_merge_id: string }
        Returns: number
      }
      open_account_deletion: {
        Args: { p_reason: string; p_user_id: string }
        Returns: {
          admin_user_id: string
          completed_at: string | null
          created_at: string
          email_sha256: string
          id: string
          reason: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "account_deletions"
          isOneToOne: true
          isSetofReturn: false
        }
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
      plan_has_allowance: { Args: { p_meter: string }; Returns: boolean }
      plan_overview: { Args: never; Returns: Json }
      publish_scorecard: {
        Args: { p_criteria: Json; p_engagement_type: string }
        Returns: number
      }
      purge_expired_conversations: {
        Args: { p_company_id?: string; p_limit?: number }
        Returns: Json
      }
      record_action_items: {
        Args: {
          p_conversation_id: string
          p_detector: string
          p_items: Json
          p_model: string
        }
        Returns: Json
      }
      record_company_export: { Args: never; Returns: string }
      record_conversation_view: {
        Args: { p_conversation_id: string }
        Returns: undefined
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
      refund_plan_allowance: {
        Args: { p_ledger_id: number }
        Returns: undefined
      }
      remove_company_member: { Args: { p_user_id: string }; Returns: undefined }
      remove_moment: { Args: { p_moment_id: string }; Returns: undefined }
      rename_account: {
        Args: { p_account_id: string; p_domain?: string; p_name: string }
        Returns: undefined
      }
      request_account_deletion: {
        Args: { p_confirm_email: string }
        Returns: {
          company_id: string | null
          deletion_id: string | null
          id: string
          requested_at: string
          resolved_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "account_deletion_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_teammate: {
        Args: { p_email: string; p_note?: string; p_role: string }
        Returns: string
      }
      resolve_access_request: {
        Args: { p_id: string; p_note?: string; p_resolution: string }
        Returns: undefined
      }
      retention_preview: { Args: { p_days: number }; Returns: number }
      roll_subscription_periods: { Args: never; Returns: number }
      save_account: {
        Args: { p_domain?: string; p_name: string }
        Returns: string
      }
      save_call_prep: {
        Args: {
          p_account_id?: string
          p_call_at?: string
          p_engagement_type?: string
          p_linkedin_url?: string
          p_person_name: string
          p_person_title?: string
          p_prep_id?: string
          p_profile_text?: string
        }
        Returns: string
      }
      save_moment: {
        Args: { p_criterion_key: string; p_note?: string; p_segment_id: string }
        Returns: string
      }
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
      send_feedback: {
        Args: { p_body: string; p_page?: string }
        Returns: string
      }
      set_action_item_done: {
        Args: { p_done: boolean; p_item_id: string }
        Returns: undefined
      }
      set_ai_guidance: {
        Args: { p_active?: boolean; p_delete?: boolean; p_guidance_id: string }
        Returns: undefined
      }
      set_call_prep_brief: {
        Args: { p_brief: Json; p_model: string; p_prep_id: string }
        Returns: undefined
      }
      set_call_type: {
        Args: {
          p_engagement_type: string
          p_make_default?: boolean
          p_purpose?: string
        }
        Returns: undefined
      }
      set_criterion_goal: {
        Args: {
          p_criterion_key: string
          p_engagement_type: string
          p_target: number
        }
        Returns: undefined
      }
      set_member_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
      set_our_speaker: {
        Args: { p_name: string; p_ours: boolean }
        Returns: undefined
      }
      set_retention: { Args: { p_days: number }; Returns: number }
      signup_is_open: { Args: never; Returns: boolean }
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
      take_plan_allowance: {
        Args: { p_amount?: number; p_meter: string }
        Returns: Json
      }
      take_rate_limit_tokens: {
        Args: { p_bucket: string; p_internal_windows?: Json; p_windows: Json }
        Returns: Json
      }
      tracker_for_ticket: {
        Args: { p_insight_id: string }
        Returns: {
          company_id: string
          provider: string
          target: string
          token_ciphertext: string
        }[]
      }
      withdraw_coaching: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      withdraw_dispute: { Args: { p_event_id: string }; Returns: undefined }
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
