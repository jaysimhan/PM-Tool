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
    PostgrestVersion: "14.15"
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
          created_at: string
          email: string
          id: string
          kind: string
          name: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          kind?: string
          name: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          kind?: string
          name?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          assigned_by_id: string | null
          assigned_date: string
          created_at: string | null
          estimated_hours: number | null
          id: string
          proposed_end_date: string | null
          proposed_start_date: string | null
          rejection_reason: string | null
          response_date: string | null
          status: string
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_by_id?: string | null
          assigned_date?: string
          created_at?: string | null
          estimated_hours?: number | null
          id?: string
          proposed_end_date?: string | null
          proposed_start_date?: string | null
          rejection_reason?: string | null
          response_date?: string | null
          status?: string
          task_id: string
          user_id: string
        }
        Update: {
          assigned_by_id?: string | null
          assigned_date?: string
          created_at?: string | null
          estimated_hours?: number | null
          id?: string
          proposed_end_date?: string | null
          proposed_start_date?: string | null
          rejection_reason?: string | null
          response_date?: string | null
          status?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_assigned_by_id_fkey"
            columns: ["assigned_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changes: Json
          entity_id: string
          entity_type: string
          id: string
          timestamp: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes: Json
          entity_id: string
          entity_type: string
          id?: string
          timestamp?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json
          entity_id?: string
          entity_type?: string
          id?: string
          timestamp?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string | null
          department: string | null
          favicon: string | null
          id: string
          name: string
          website: string | null
        }
        Insert: {
          created_at?: string | null
          department?: string | null
          favicon?: string | null
          id?: string
          name: string
          website?: string | null
        }
        Update: {
          created_at?: string | null
          department?: string | null
          favicon?: string | null
          id?: string
          name?: string
          website?: string | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_internal: boolean | null
          task_id: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          task_id?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_internal?: boolean | null
          task_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_kpi_snapshots: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          metric_name: string
          metric_value: number
          snapshot_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          metric_name: string
          metric_value?: number
          snapshot_date: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          metric_name?: string
          metric_value?: number
          snapshot_date?: string
        }
        Relationships: []
      }
      dashboard_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_access?: boolean
          scope?: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_access?: boolean
          scope?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leaves: {
        Row: {
          created_at: string | null
          description: string | null
          end_date: string
          hours: number | null
          id: string
          start_date: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          end_date: string
          hours?: number | null
          id?: string
          start_date: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          end_date?: string
          hours?: number | null
          id?: string
          start_date?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leaves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_recovery_attempts: {
        Row: {
          attempted_at: string
          id: number
          succeeded: boolean
          user_id: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          succeeded: boolean
          user_id: string
        }
        Update: {
          attempted_at?: string
          id?: number
          succeeded?: boolean
          user_id?: string
        }
        Relationships: []
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          code: string
          created_at: string | null
          flag: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          flag?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          flag?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      request_form_fields: {
        Row: {
          created_at: string
          default_value: string | null
          enabled: boolean
          field_key: string
          field_type: string
          help_text: string | null
          id: string
          is_core: boolean
          label: string
          locked: boolean
          options: Json
          placeholder: string | null
          position: number
          required: boolean
          skill_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_value?: string | null
          enabled?: boolean
          field_key: string
          field_type: string
          help_text?: string | null
          id?: string
          is_core?: boolean
          label: string
          locked?: boolean
          options?: Json
          placeholder?: string | null
          position?: number
          required?: boolean
          skill_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_value?: string | null
          enabled?: boolean
          field_key?: string
          field_type?: string
          help_text?: string | null
          id?: string
          is_core?: boolean
          label?: string
          locked?: boolean
          options?: Json
          placeholder?: string | null
          position?: number
          required?: boolean
          skill_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_form_fields_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      request_form_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          send_confirmation: boolean
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_access?: boolean
          scope?: string
          send_confirmation?: boolean
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          public_access?: boolean
          scope?: string
          send_confirmation?: boolean
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_form_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      request_form_submissions: {
        Row: {
          confirmation_error: string | null
          confirmation_sent_at: string | null
          created_at: string
          id: string
          link_id: string
          request_ref: string
          requester_email: string
          requester_name: string
          task_id: string | null
        }
        Insert: {
          confirmation_error?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          id?: string
          link_id: string
          request_ref: string
          requester_email: string
          requester_name: string
          task_id?: string | null
        }
        Update: {
          confirmation_error?: string | null
          confirmation_sent_at?: string | null
          created_at?: string
          id?: string
          link_id?: string
          request_ref?: string
          requester_email?: string
          requester_name?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_form_submissions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "request_form_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_form_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string
          created_at: string | null
          embedding: string | null
          id: string
          name: string
        }
        Insert: {
          category: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          color: string
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      task_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          id: string
          task_id: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          task_id: string
          type: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: string
          task_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          depends_on_task_id: string
          task_id: string
          type: string
        }
        Insert: {
          depends_on_task_id: string
          task_id: string
          type: string
        }
        Update: {
          depends_on_task_id?: string
          task_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_skills: {
        Row: {
          skill_id: string
          task_id: string
        }
        Insert: {
          skill_id: string
          task_id: string
        }
        Update: {
          skill_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_skills_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_tags: {
        Row: {
          tag_id: string
          task_id: string
        }
        Insert: {
          tag_id: string
          task_id: string
        }
        Update: {
          tag_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tags_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_teams: {
        Row: {
          task_id: string
          team_id: string
        }
        Insert: {
          task_id: string
          team_id: string
        }
        Update: {
          task_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_teams_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          accepted_date: string | null
          actual_hours: number | null
          assigned_by_id: string | null
          assigned_date: string | null
          assignee_id: string | null
          category_id: string | null
          checklist: Json | null
          client_id: string | null
          completed_date: string | null
          created_at: string | null
          custom_fields: Json
          department: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          is_subtask: boolean | null
          parent_task_id: string | null
          priority: string | null
          proposed_end_date: string | null
          proposed_start_date: string | null
          region_id: string | null
          request_id: string | null
          requester_email: string | null
          requester_id: string | null
          requester_name: string | null
          sort_order: number
          status: string
          tags: string[] | null
          title: string
        }
        Insert: {
          accepted_date?: string | null
          actual_hours?: number | null
          assigned_by_id?: string | null
          assigned_date?: string | null
          assignee_id?: string | null
          category_id?: string | null
          checklist?: Json | null
          client_id?: string | null
          completed_date?: string | null
          created_at?: string | null
          custom_fields?: Json
          department?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_subtask?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          proposed_end_date?: string | null
          proposed_start_date?: string | null
          region_id?: string | null
          request_id?: string | null
          requester_email?: string | null
          requester_id?: string | null
          requester_name?: string | null
          sort_order?: number
          status: string
          tags?: string[] | null
          title: string
        }
        Update: {
          accepted_date?: string | null
          actual_hours?: number | null
          assigned_by_id?: string | null
          assigned_date?: string | null
          assignee_id?: string | null
          category_id?: string | null
          checklist?: Json | null
          client_id?: string | null
          completed_date?: string | null
          created_at?: string | null
          custom_fields?: Json
          department?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_subtask?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          proposed_end_date?: string | null
          proposed_start_date?: string | null
          region_id?: string | null
          request_id?: string | null
          requester_email?: string | null
          requester_id?: string | null
          requester_name?: string | null
          sort_order?: number
          status?: string
          tags?: string[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_id_fkey"
            columns: ["assigned_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          team_id: string
          user_id: string
        }
        Insert: {
          team_id: string
          user_id: string
        }
        Update: {
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_skills: {
        Row: {
          skill_id: string
          team_id: string
        }
        Insert: {
          skill_id: string
          team_id: string
        }
        Update: {
          skill_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_skills_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          is_home_team: boolean
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_home_team?: boolean
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_home_team?: boolean
          name?: string
        }
        Relationships: []
      }
      user_clients: {
        Row: {
          client_id: string
          user_id: string
        }
        Insert: {
          client_id: string
          user_id: string
        }
        Update: {
          client_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_regions: {
        Row: {
          region_id: string
          user_id: string
        }
        Insert: {
          region_id: string
          user_id: string
        }
        Update: {
          region_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_regions_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_regions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_skills: {
        Row: {
          proficiency_level: string | null
          skill_id: string
          user_id: string
        }
        Insert: {
          proficiency_level?: string | null
          skill_id: string
          user_id: string
        }
        Update: {
          proficiency_level?: string | null
          skill_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_skills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar: string | null
          created_at: string | null
          daily_capacity: number
          deleted_at: string | null
          deleted_email: string | null
          email: string
          id: string
          is_active: boolean
          name: string
          onboarding_completed: boolean
          role: string
          sessions_revoked_at: string | null
        }
        Insert: {
          avatar?: string | null
          created_at?: string | null
          daily_capacity?: number
          deleted_at?: string | null
          deleted_email?: string | null
          email: string
          id: string
          is_active?: boolean
          name: string
          onboarding_completed?: boolean
          role?: string
          sessions_revoked_at?: string | null
        }
        Update: {
          avatar?: string | null
          created_at?: string | null
          daily_capacity?: number
          deleted_at?: string | null
          deleted_email?: string | null
          email?: string
          id?: string
          is_active?: boolean
          name?: string
          onboarding_completed?: boolean
          role?: string
          sessions_revoked_at?: string | null
        }
        Relationships: []
      }
      work_categories: {
        Row: {
          created_at: string | null
          default_hours: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          default_hours?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          default_hours?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      work_category_skills: {
        Row: {
          category_id: string
          skill_id: string
        }
        Insert: {
          category_id: string
          skill_id: string
        }
        Update: {
          category_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_category_skills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_category_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      work_category_teams: {
        Row: {
          category_id: string
          team_id: string
        }
        Insert: {
          category_id: string
          team_id: string
        }
        Update: {
          category_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_category_teams_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "work_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_category_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_assignment: {
        Args: {
          p_assignment_id: string
          p_deadline: string
          p_end_date?: string
          p_estimated_hours: number
          p_start_date?: string
        }
        Returns: Json
      }
      access_request_audience: {
        Args: never
        Returns: {
          id: string
        }[]
      }
      add_client_department: {
        Args: { p_client_id: string; p_department: string }
        Returns: Json
      }
      aggregate_daily_kpis: { Args: { p_date?: string }; Returns: Json }
      assign_task: {
        Args: { p_auto_accept?: boolean; p_task_id: string; p_user_id: string }
        Returns: Json
      }
      assign_task_checked: {
        Args: { p_task_id: string; p_user_id: string | null; p_auto_accept: boolean; p_expected_assignment_id: string | null; p_expected_status: string | null }
        Returns: Json
      }
      backfill_daily_kpis: { Args: { p_days?: number }; Returns: Json }
      can_assign_work: { Args: never; Returns: boolean }
      can_edit_task: { Args: { p_task_id: string }; Returns: boolean }
      can_manage_team: { Args: { p_team_id: string }; Returns: boolean }
      complete_onboarding_step_one: {
        Args: { p_name: string; p_team_id?: string }
        Returns: Json
      }
      create_subtask: {
        Args: { p_parent_task_id: string; p_title?: string }
        Returns: Database["public"]["Tables"]["tasks"]["Row"]
      }
      current_user_has_password: { Args: never; Returns: boolean }
      current_user_is_form_admin: { Args: never; Returns: boolean }
      current_user_sees_access_requests: { Args: never; Returns: boolean }
      default_onboarding_team: { Args: never; Returns: string }
      detach_subtask: { Args: { p_task_id: string }; Returns: Json }
      duplicate_subtask: {
        Args: { p_task_id: string }
        Returns: Database["public"]["Tables"]["tasks"]["Row"]
      }
      delete_user_account: { Args: { p_user_id: string }; Returns: Json }
      generate_mfa_recovery_codes: { Args: never; Returns: string[] }
      get_or_create_dashboard_link: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "dashboard_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_or_create_request_form_link: {
        Args: never
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          send_confirmation: boolean
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "request_form_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_public_dashboard: { Args: { p_token: string }; Returns: Json }
      get_public_dashboard_cached: { Args: { p_token: string }; Returns: Json }
      get_public_request_form: { Args: { p_token: string }; Returns: Json }
      get_request_form_config: { Args: never; Returns: Json }
      is_live_user: { Args: never; Returns: boolean }
      is_org_admin: { Args: never; Returns: boolean }
      is_team_manager: { Args: never; Returns: boolean }
      leads_team: { Args: { p_team_id: string }; Returns: boolean }
      list_my_sessions: { Args: never; Returns: Json }
      match_skills: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          category: string
          id: string
          name: string
          similarity: number
        }[]
      }
      mfa_recovery_code_hash: { Args: { p_code: string }; Returns: string }
      my_mfa_recovery_code_status: { Args: never; Returns: Json }
      notify_reassignment_needed: {
        Args: { p_reason: string; p_team_id: string; p_user_id: string }
        Returns: number
      }
      onboarding_account_state: { Args: { p_email: string }; Returns: Json }
      onboarding_email_status: { Args: { p_email: string }; Returns: Json }
      redeem_mfa_recovery_code: { Args: { p_code: string }; Returns: Json }
      reorder_subtasks: {
        Args: { p_ordered_ids: string[]; p_parent_task_id: string }
        Returns: Json
      }
      reject_assignment: {
        Args: { p_assignment_id: string; p_reason: string }
        Returns: Json
      }
      set_task_status: {
        Args: { p_status: string; p_task_id: string }
        Returns: Json
      }
      remove_team_member: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: Json
      }
      request_access: {
        Args: { p_email: string; p_name: string; p_note?: string }
        Returns: Json
      }
      request_form_field_json: {
        Args: { f: Database["public"]["Tables"]["request_form_fields"]["Row"] }
        Returns: Json
      }
      request_reactivation: {
        Args: { p_email: string; p_note?: string }
        Returns: Json
      }
      resolve_access_request: {
        Args: { p_id: string; p_status: string }
        Returns: {
          created_at: string
          email: string
          id: string
          kind: string
          name: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_my_session: { Args: { p_session_id: string }; Returns: Json }
      revoke_my_sessions: { Args: { p_keep_current?: boolean }; Returns: Json }
      save_request_form_config: { Args: { p_fields: Json }; Returns: Json }
      set_user_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: Json
      }
      set_user_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: Json
      }
      submit_public_request: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      task_stage: { Args: { p_status: string }; Returns: string }
      transfer_super_admin_ownership: {
        Args: { new_super_admin_id: string }
        Returns: undefined
      }
      update_dashboard_link: {
        Args: { p_public_access: boolean }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "dashboard_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_request_form_link: {
        Args: { p_public_access?: boolean; p_send_confirmation?: boolean }
        Returns: {
          created_at: string
          created_by: string | null
          id: string
          public_access: boolean
          scope: string
          send_confirmation: boolean
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "request_form_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_current_password: {
        Args: { p_password: string }
        Returns: boolean
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
