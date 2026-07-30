export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      achievements: {
        Row: {
          badge_description: string | null
          badge_icon: string | null
          badge_name: string
          earned_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          badge_description?: string | null
          badge_icon?: string | null
          badge_name: string
          earned_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          badge_description?: string | null
          badge_icon?: string | null
          badge_name?: string
          earned_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      learning_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      lectures: {
        Row: {
          course_id: string | null
          created_at: string | null
          description: string | null
          id: string
          pdf_url: string | null
          professor_id: string
          title: string
          total_slides: number | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          pdf_url?: string | null
          professor_id: string
          title: string
          total_slides?: number | null
        }
        Update: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          pdf_url?: string | null
          professor_id?: string
          title?: string
          total_slides?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lectures_professor_id_fkey"
            columns: ["professor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          message: string
          priority: string | null
          read: boolean | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          priority?: string | null
          read?: boolean | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          priority?: string | null
          read?: boolean | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      notification_preferences: {
        Row: {
          user_id: string
          lifecycle_nudges_enabled: boolean
          in_app_enabled: boolean
          email_enabled: boolean
          push_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          lifecycle_nudges_enabled?: boolean
          in_app_enabled?: boolean
          email_enabled?: boolean
          push_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          lifecycle_nudges_enabled?: boolean
          in_app_enabled?: boolean
          email_enabled?: boolean
          push_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          best_streak: number | null
          created_at: string | null
          current_level: number | null
          current_streak: number | null
          display_name: string | null
          email: string
          full_name: string | null
          has_completed_activation_onboarding: boolean
          has_seen_dashboard_tour: boolean
          id: string
          luna_patch: string | null
          luna_suit_color: string | null
          luna_visor_tint: string | null
          preferred_language: string | null
          total_xp: number | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          display_name?: string | null
          email: string
          full_name?: string | null
          has_completed_activation_onboarding?: boolean
          has_seen_dashboard_tour?: boolean
          id?: string
          luna_patch?: string | null
          luna_suit_color?: string | null
          luna_visor_tint?: string | null
          preferred_language?: string | null
          total_xp?: number | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          display_name?: string | null
          email?: string
          full_name?: string | null
          has_completed_activation_onboarding?: boolean
          has_seen_dashboard_tour?: boolean
          id?: string
          luna_patch?: string | null
          luna_suit_color?: string | null
          luna_visor_tint?: string | null
          preferred_language?: string | null
          total_xp?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      onboarding_progress: {
        Row: {
          acquisition_source: string | null
          active_batch_id: string | null
          activated_at: string | null
          completed_at: string | null
          demo_mission_step: number
          first_activity_type: string | null
          luna_customization_seen_at: string | null
          selected_path: string | null
          second_session_started_at: string | null
          study_goal: string | null
          updated_at: string
          user_id: string
          university_match_dismissed_at: string | null
          version: number
        }
        Insert: {
          acquisition_source?: string | null
          active_batch_id?: string | null
          activated_at?: string | null
          completed_at?: string | null
          demo_mission_step?: number
          first_activity_type?: string | null
          luna_customization_seen_at?: string | null
          selected_path?: string | null
          second_session_started_at?: string | null
          study_goal?: string | null
          updated_at?: string
          user_id: string
          university_match_dismissed_at?: string | null
          version?: number
        }
        Update: {
          acquisition_source?: string | null
          active_batch_id?: string | null
          activated_at?: string | null
          completed_at?: string | null
          demo_mission_step?: number
          first_activity_type?: string | null
          luna_customization_seen_at?: string | null
          selected_path?: string | null
          second_session_started_at?: string | null
          study_goal?: string | null
          updated_at?: string
          user_id?: string
          university_match_dismissed_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      quiz_questions: {
        Row: {
          correct_answer: number
          created_at: string | null
          id: string
          options: Json
          question_text: string
          slide_id: string
        }
        Insert: {
          correct_answer: number
          created_at?: string | null
          id?: string
          options?: Json
          question_text: string
          slide_id: string
        }
        Update: {
          correct_answer?: number
          created_at?: string | null
          id?: string
          options?: Json
          question_text?: string
          slide_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_slide_id_fkey"
            columns: ["slide_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id"]
          }
        ]
      }
      slides: {
        Row: {
          content_text: string | null
          created_at: string | null
          id: string
          image_url: string | null
          lecture_id: string
          slide_number: number
          summary: string | null
          title: string | null
        }
        Insert: {
          content_text?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          lecture_id: string
          slide_number: number
          summary?: string | null
          title?: string | null
        }
        Update: {
          content_text?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          lecture_id?: string
          slide_number?: number
          summary?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slides_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          }
        ]
      }
      student_progress: {
        Row: {
          completed_at: string | null
          completed_slides: number[] | null
          correct_answers: number | null
          created_at: string | null
          id: string
          last_slide_viewed: number | null
          lecture_id: string
          quiz_score: number | null
          total_questions_answered: number | null
          user_id: string
          xp_earned: number | null
        }
        Insert: {
          completed_at?: string | null
          completed_slides?: number[] | null
          correct_answers?: number | null
          created_at?: string | null
          id?: string
          last_slide_viewed?: number | null
          lecture_id: string
          quiz_score?: number | null
          total_questions_answered?: number | null
          user_id: string
          xp_earned?: number | null
        }
        Update: {
          completed_at?: string | null
          completed_slides?: number[] | null
          correct_answers?: number | null
          created_at?: string | null
          id?: string
          last_slide_viewed?: number | null
          lecture_id?: string
          quiz_score?: number | null
          total_questions_answered?: number | null
          user_id?: string
          xp_earned?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
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
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      practice_attempts: {
        Row: {
          id: string
          sheet_id: string
          student_id: string
          answers: Json
          score: number | null
          is_preview: boolean
          submitted_at: string
        }
        Insert: {
          id?: string
          sheet_id: string
          student_id: string
          answers?: Json
          score?: number | null
          is_preview?: boolean
          submitted_at?: string
        }
        Update: {
          id?: string
          sheet_id?: string
          student_id?: string
          answers?: Json
          score?: number | null
          is_preview?: boolean
          submitted_at?: string
        }
        Relationships: []
      }
      practice_sheet_questions: {
        Row: {
          id: string
          sheet_id: string
          order_index: number
          type: string
          prompt: string
          choices: Json | null
          correct_answer: string | null
          explanation: string | null
          source_quiz_question_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          sheet_id: string
          order_index?: number
          type: string
          prompt: string
          choices?: Json | null
          correct_answer?: string | null
          explanation?: string | null
          source_quiz_question_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          sheet_id?: string
          order_index?: number
          type?: string
          prompt?: string
          choices?: Json | null
          correct_answer?: string | null
          explanation?: string | null
          source_quiz_question_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      practice_sheets: {
        Row: {
          id: string
          lecture_id: string
          kind: string
          title: string
          status: string
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          lecture_id: string
          kind: string
          title: string
          status?: string
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          lecture_id?: string
          kind?: string
          title?: string
          status?: string
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _user_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      get_institution_match_suggestion: {
        Args: Record<PropertyKey, never>
        Returns: {
          university: string
        }[]
      }
      record_onboarding_activation: {
        Args: {
          p_activity_type: string
          p_course_id?: string | null
        }
        Returns: boolean
      }
      complete_activation_onboarding: {
        Args: {
          p_path: string
          p_study_goal?: string | null
        }
        Returns: Json
      }
      record_onboarding_second_session: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      app_role: "student" | "professor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
