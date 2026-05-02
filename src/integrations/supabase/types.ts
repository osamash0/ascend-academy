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
          created_at: string | null
          description: string | null
          id: string
          pdf_url: string | null
          professor_id: string
          title: string
          total_slides: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          pdf_url?: string | null
          professor_id: string
          title: string
          total_slides?: number | null
        }
        Update: {
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
          read: boolean | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          read?: boolean | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          best_streak: number | null
          created_at: string | null
          current_level: number | null
          current_streak: number | null
          email: string
          full_name: string | null
          id: string
          total_xp: number | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          email: string
          full_name?: string | null
          id?: string
          total_xp?: number | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          email?: string
          full_name?: string | null
          id?: string
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
    }
    Enums: {
      app_role: "student" | "professor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
