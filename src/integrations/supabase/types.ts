export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      _post_merge_migrations: {
        Row: {
          applied_at: string
          filename: string
        }
        Insert: {
          applied_at?: string
          filename: string
        }
        Update: {
          applied_at?: string
          filename?: string
        }
        Relationships: []
      }
      account: {
        Row: {
          accessToken: string | null
          accessTokenExpiresAt: string | null
          accountId: string
          createdAt: string
          id: string
          idToken: string | null
          password: string | null
          providerId: string
          refreshToken: string | null
          refreshTokenExpiresAt: string | null
          scope: string | null
          updatedAt: string
          userId: string
        }
        Insert: {
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          accountId: string
          createdAt?: string
          id: string
          idToken?: string | null
          password?: string | null
          providerId: string
          refreshToken?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          updatedAt: string
          userId: string
        }
        Update: {
          accessToken?: string | null
          accessTokenExpiresAt?: string | null
          accountId?: string
          createdAt?: string
          id?: string
          idToken?: string | null
          password?: string | null
          providerId?: string
          refreshToken?: string | null
          refreshTokenExpiresAt?: string | null
          scope?: string | null
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
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
        Relationships: []
      }
      alembic_version: {
        Row: {
          version_num: string
        }
        Insert: {
          version_num: string
        }
        Update: {
          version_num?: string
        }
        Relationships: []
      }
      analytics_backups: {
        Row: {
          backup_data: Json
          created_at: string | null
          id: string
        }
        Insert: {
          backup_data: Json
          created_at?: string | null
          id?: string
        }
        Update: {
          backup_data?: Json
          created_at?: string | null
          id?: string
        }
        Relationships: []
      }
      analytics_cache: {
        Row: {
          computed_at: string
          id: string
          lecture_id: string
          params_hash: string
          payload: Json
          ttl_seconds: number
          view_name: string
        }
        Insert: {
          computed_at?: string
          id?: string
          lecture_id: string
          params_hash?: string
          payload: Json
          ttl_seconds?: number
          view_name: string
        }
        Update: {
          computed_at?: string
          id?: string
          lecture_id?: string
          params_hash?: string
          payload?: Json
          ttl_seconds?: number
          view_name?: string
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          course_id_scope: string | null
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          name: string
          token_hash: string
          user_id: string
        }
        Insert: {
          course_id_scope?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id: string
          is_active: boolean
          last_used_at?: string | null
          name: string
          token_hash: string
          user_id: string
        }
        Update: {
          course_id_scope?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          name?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_course_id_scope_fkey"
            columns: ["course_id_scope"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_enrollments: {
        Row: {
          assignment_id: string
          enrolled_at: string | null
          user_id: string
        }
        Insert: {
          assignment_id: string
          enrolled_at?: string | null
          user_id: string
        }
        Update: {
          assignment_id?: string
          enrolled_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_enrollments_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_lectures: {
        Row: {
          assignment_id: string
          lecture_id: string
        }
        Insert: {
          assignment_id: string
          lecture_id: string
        }
        Update: {
          assignment_id?: string
          lecture_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_lectures_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_lectures_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          course_id: string | null
          created_at: string | null
          description: string | null
          due_at: string
          id: string
          min_quiz_score: number | null
          professor_id: string
          title: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          due_at: string
          id?: string
          min_quiz_score?: number | null
          professor_id: string
          title: string
        }
        Update: {
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          due_at?: string
          id?: string
          min_quiz_score?: number | null
          professor_id?: string
          title?: string
        }
        Relationships: []
      }
      backend_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          data: Json
          expires_at: string
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          data: Json
          expires_at: string
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          data?: Json
          expires_at?: string
        }
        Relationships: []
      }
      badge_definitions: {
        Row: {
          category: string
          description: string
          icon: string
          is_secret: boolean
          key: string
          metric: string | null
          name: string
          sort_order: number
          threshold: number | null
          xp_reward: number
        }
        Insert: {
          category: string
          description: string
          icon: string
          is_secret?: boolean
          key: string
          metric?: string | null
          name: string
          sort_order?: number
          threshold?: number | null
          xp_reward?: number
        }
        Update: {
          category?: string
          description?: string
          icon?: string
          is_secret?: boolean
          key?: string
          metric?: string | null
          name?: string
          sort_order?: number
          threshold?: number | null
          xp_reward?: number
        }
        Relationships: []
      }
      catalog_course_links: {
        Row: {
          catalog_course_id: string
          confidence: number
          course_id: string
          created_at: string
          id: string
          source: string
        }
        Insert: {
          catalog_course_id: string
          confidence?: number
          course_id: string
          created_at?: string
          id?: string
          source?: string
        }
        Update: {
          catalog_course_id?: string
          confidence?: number
          course_id?: string
          created_at?: string
          id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_course_links_catalog_course_id_fkey"
            columns: ["catalog_course_id"]
            isOneToOne: false
            referencedRelation: "catalog_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_course_links_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_courses: {
        Row: {
          course_code: string | null
          created_at: string
          credits: number | null
          degree_program_id: string
          external_ref: string | null
          id: string
          is_mandatory: boolean
          language: string | null
          last_scraped_at: string | null
          source: string
          title: string
          typical_semester: number | null
          updated_at: string
        }
        Insert: {
          course_code?: string | null
          created_at?: string
          credits?: number | null
          degree_program_id: string
          external_ref?: string | null
          id?: string
          is_mandatory?: boolean
          language?: string | null
          last_scraped_at?: string | null
          source?: string
          title: string
          typical_semester?: number | null
          updated_at?: string
        }
        Update: {
          course_code?: string | null
          created_at?: string
          credits?: number | null
          degree_program_id?: string
          external_ref?: string | null
          id?: string
          is_mandatory?: boolean
          language?: string | null
          last_scraped_at?: string | null
          source?: string
          title?: string
          typical_semester?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_courses_degree_program_id_fkey"
            columns: ["degree_program_id"]
            isOneToOne: false
            referencedRelation: "degree_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_lectures: {
        Row: {
          concept_id: string
          created_at: string
          lecture_id: string
          slide_indices: number[]
          weight: number
        }
        Insert: {
          concept_id: string
          created_at?: string
          lecture_id: string
          slide_indices?: number[]
          weight?: number
        }
        Update: {
          concept_id?: string
          created_at?: string
          lecture_id?: string
          slide_indices?: number[]
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "concept_lectures_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_lectures_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_mastery: {
        Row: {
          attempts: number
          concept_id: string
          correct: number
          mastery_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          concept_id: string
          correct?: number
          mastery_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          concept_id?: string
          correct?: number
          mastery_score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_mastery_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
        ]
      }
      concepts: {
        Row: {
          aliases: string[]
          canonical_name: string
          created_at: string
          embedding: string | null
          id: string
          name_key: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          canonical_name: string
          created_at?: string
          embedding?: string | null
          id?: string
          name_key: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string
          created_at?: string
          embedding?: string | null
          id?: string
          name_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_access: {
        Row: {
          access_level: string
          course_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          access_level: string
          course_id: string
          created_at?: string | null
          id: string
          user_id: string
        }
        Update: {
          access_level?: string
          course_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_access_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprint_items: {
        Row: {
          blueprint_id: string
          classification: string
          confidence: number
          created_at: string
          id: string
          include_in_course: boolean
          lecture_group_id: string
          lecture_id: string | null
          material_source_id: string
          position: number
          source_range: Json | null
          split_from_item_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          blueprint_id: string
          classification?: string
          confidence?: number
          created_at?: string
          id?: string
          include_in_course?: boolean
          lecture_group_id?: string
          lecture_id?: string | null
          material_source_id: string
          position: number
          source_range?: Json | null
          split_from_item_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          blueprint_id?: string
          classification?: string
          confidence?: number
          created_at?: string
          id?: string
          include_in_course?: boolean
          lecture_group_id?: string
          lecture_id?: string | null
          material_source_id?: string
          position?: number
          source_range?: Json | null
          split_from_item_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprint_items_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "course_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_items_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_items_material_source_id_fkey"
            columns: ["material_source_id"]
            isOneToOne: false
            referencedRelation: "material_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_blueprint_items_split_from_item_id_fkey"
            columns: ["split_from_item_id"]
            isOneToOne: false
            referencedRelation: "course_blueprint_items"
            referencedColumns: ["id"]
          },
        ]
      }
      course_blueprints: {
        Row: {
          batch_id: string
          course_id: string | null
          created_at: string
          description: string | null
          id: string
          owner_id: string
          status: string
          study_goal: string | null
          title: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          owner_id: string
          status?: string
          study_goal?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          owner_id?: string
          status?: string
          study_goal?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_blueprints_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_context: {
        Row: {
          course_id: string
          exam_dates: Json
          grading_scheme: string | null
          instructor: string | null
          syllabus_facts: Json
          updated_at: string
        }
        Insert: {
          course_id: string
          exam_dates?: Json
          grading_scheme?: string | null
          instructor?: string | null
          syllabus_facts?: Json
          updated_at?: string
        }
        Update: {
          course_id?: string
          exam_dates?: Json
          grading_scheme?: string | null
          instructor?: string | null
          syllabus_facts?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_context_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_enrollments: {
        Row: {
          course_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_localizations: {
        Row: {
          course_id: string
          created_at: string
          description: string
          error: string | null
          locale: string
          source_revision: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string
          error?: string | null
          locale: string
          source_revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string
          error?: string | null
          locale?: string
          source_revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_localizations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_visits: {
        Row: {
          course_id: string
          last_visited_at: string
          user_id: string
          visit_count: number
        }
        Insert: {
          course_id: string
          last_visited_at?: string
          user_id: string
          visit_count?: number
        }
        Update: {
          course_id?: string
          last_visited_at?: string
          user_id?: string
          visit_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_visits_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          average_rating: number | null
          color: string | null
          content_revision: number
          created_at: string | null
          demo_slug: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean
          professor_id: string
          rating_count: number | null
          status: string
          title: string
          updated_at: string | null
          what_you_will_learn: string[] | null
        }
        Insert: {
          average_rating?: number | null
          color?: string | null
          content_revision?: number
          created_at?: string | null
          demo_slug?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          professor_id: string
          rating_count?: number | null
          status?: string
          title: string
          updated_at?: string | null
          what_you_will_learn?: string[] | null
        }
        Update: {
          average_rating?: number | null
          color?: string | null
          content_revision?: number
          created_at?: string | null
          demo_slug?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          professor_id?: string
          rating_count?: number | null
          status?: string
          title?: string
          updated_at?: string | null
          what_you_will_learn?: string[] | null
        }
        Relationships: []
      }
      dead_letter_jobs: {
        Row: {
          args: Json
          error: string
          failed_at: string
          function_name: string
          id: string
          job_id: string | null
          job_try: number | null
          kwargs: Json
          resolved_at: string | null
          resolved_note: string | null
        }
        Insert: {
          args?: Json
          error: string
          failed_at?: string
          function_name: string
          id?: string
          job_id?: string | null
          job_try?: number | null
          kwargs?: Json
          resolved_at?: string | null
          resolved_note?: string | null
        }
        Update: {
          args?: Json
          error?: string
          failed_at?: string
          function_name?: string
          id?: string
          job_id?: string | null
          job_try?: number | null
          kwargs?: Json
          resolved_at?: string | null
          resolved_note?: string | null
        }
        Relationships: []
      }
      degree_programs: {
        Row: {
          created_at: string
          degree_level: string | null
          external_ref: string | null
          faculty_id: string
          id: string
          last_scraped_at: string | null
          name: string
          source: string
          total_semesters: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          degree_level?: string | null
          external_ref?: string | null
          faculty_id: string
          id?: string
          last_scraped_at?: string | null
          name: string
          source?: string
          total_semesters?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          degree_level?: string | null
          external_ref?: string | null
          faculty_id?: string
          id?: string
          last_scraped_at?: string | null
          name?: string
          source?: string
          total_semesters?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "degree_programs_faculty_id_fkey"
            columns: ["faculty_id"]
            isOneToOne: false
            referencedRelation: "faculties"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          answers: Json
          concept_report: Json | null
          course_id: string
          expired: boolean
          id: string
          question_ids: string[]
          score: number | null
          seed: number
          started_at: string
          submitted_at: string | null
          time_limit_s: number
          user_id: string
        }
        Insert: {
          answers?: Json
          concept_report?: Json | null
          course_id: string
          expired?: boolean
          id?: string
          question_ids: string[]
          score?: number | null
          seed: number
          started_at?: string
          submitted_at?: string | null
          time_limit_s: number
          user_id: string
        }
        Update: {
          answers?: Json
          concept_report?: Json | null
          course_id?: string
          expired?: boolean
          id?: string
          question_ids?: string[]
          score?: number | null
          seed?: number
          started_at?: string
          submitted_at?: string | null
          time_limit_s?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      faculties: {
        Row: {
          created_at: string
          external_ref: string | null
          id: string
          last_scraped_at: string | null
          name: string
          source: string
          university_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_ref?: string | null
          id?: string
          last_scraped_at?: string | null
          name: string
          source?: string
          university_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_ref?: string | null
          id?: string
          last_scraped_at?: string | null
          name?: string
          source?: string
          university_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculties_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_requests: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: []
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
        Relationships: []
      }
      lecture_blueprints: {
        Row: {
          blueprint_json: Json
          created_at: string | null
          pdf_hash: string
          version: number | null
        }
        Insert: {
          blueprint_json: Json
          created_at?: string | null
          pdf_hash: string
          version?: number | null
        }
        Update: {
          blueprint_json?: Json
          created_at?: string | null
          pdf_hash?: string
          version?: number | null
        }
        Relationships: []
      }
      lecture_localizations: {
        Row: {
          content: Json
          created_at: string
          error: string | null
          lecture_id: string
          locale: string
          source_revision: number
          status: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          error?: string | null
          lecture_id: string
          locale: string
          source_revision: number
          status?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          error?: string | null
          lecture_id?: string
          locale?: string
          source_revision?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_localizations_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_mind_maps: {
        Row: {
          generated_at: string | null
          id: string
          lecture_id: string
          schema_version: number
          tree_data: Json
        }
        Insert: {
          generated_at?: string | null
          id?: string
          lecture_id: string
          schema_version?: number
          tree_data: Json
        }
        Update: {
          generated_at?: string | null
          id?: string
          lecture_id?: string
          schema_version?: number
          tree_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lecture_mind_maps_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: true
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_visits: {
        Row: {
          course_id: string | null
          id: string
          lecture_id: string
          user_id: string
          visited_at: string
        }
        Insert: {
          course_id?: string | null
          id?: string
          lecture_id: string
          user_id: string
          visited_at?: string
        }
        Update: {
          course_id?: string | null
          id?: string
          lecture_id?: string
          user_id?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_visits_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_visits_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      lectures: {
        Row: {
          content_revision: number
          course_code: string | null
          course_id: string | null
          created_at: string | null
          description: string | null
          id: string
          is_archived: boolean
          key_topics: Json | null
          lecture_type: string | null
          pdf_hash: string | null
          pdf_sha256: string | null
          pdf_url: string | null
          poster_url: string | null
          professor_id: string | null
          slug: string | null
          source_language: string
          student_owner_id: string | null
          subject: string | null
          title: string
          total_slides: number | null
          visibility: string
        }
        Insert: {
          content_revision?: number
          course_code?: string | null
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          key_topics?: Json | null
          lecture_type?: string | null
          pdf_hash?: string | null
          pdf_sha256?: string | null
          pdf_url?: string | null
          poster_url?: string | null
          professor_id?: string | null
          slug?: string | null
          source_language?: string
          student_owner_id?: string | null
          subject?: string | null
          title: string
          total_slides?: number | null
          visibility?: string
        }
        Update: {
          content_revision?: number
          course_code?: string | null
          course_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          key_topics?: Json | null
          lecture_type?: string | null
          pdf_hash?: string | null
          pdf_sha256?: string | null
          pdf_url?: string | null
          poster_url?: string | null
          professor_id?: string | null
          slug?: string | null
          source_language?: string
          student_owner_id?: string | null
          subject?: string | null
          title?: string
          total_slides?: number | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "lectures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          completion_tokens: number
          course_id: string | null
          created_at: string
          est_cost_usd: number
          feature: string
          id: string
          model: string
          prompt_tokens: number
          provider: string
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          course_id?: string | null
          created_at?: string
          est_cost_usd?: number
          feature: string
          id?: string
          model: string
          prompt_tokens?: number
          provider: string
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          course_id?: string | null
          created_at?: string
          est_cost_usd?: number
          feature?: string
          id?: string
          model?: string
          prompt_tokens?: number
          provider?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_calls_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      material_sources: {
        Row: {
          batch_id: string
          classification: string
          content_hash: string | null
          created_at: string
          duplicate_of: string | null
          extracted_metadata: Json
          file_type: string
          id: string
          original_filename: string
          owner_id: string
          parse_run_id: string | null
          processing_state: string
          replaces_source_id: string | null
          updated_at: string
        }
        Insert: {
          batch_id: string
          classification?: string
          content_hash?: string | null
          created_at?: string
          duplicate_of?: string | null
          extracted_metadata?: Json
          file_type?: string
          id?: string
          original_filename: string
          owner_id: string
          parse_run_id?: string | null
          processing_state?: string
          replaces_source_id?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string
          classification?: string
          content_hash?: string | null
          created_at?: string
          duplicate_of?: string | null
          extracted_metadata?: Json
          file_type?: string
          id?: string
          original_filename?: string
          owner_id?: string
          parse_run_id?: string | null
          processing_state?: string
          replaces_source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_sources_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "material_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_sources_parse_run_id_fkey"
            columns: ["parse_run_id"]
            isOneToOne: true
            referencedRelation: "parse_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "material_sources_replaces_source_id_fkey"
            columns: ["replaces_source_id"]
            isOneToOne: false
            referencedRelation: "material_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          in_app_enabled: boolean
          lifecycle_nudges_enabled: boolean
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          lifecycle_nudges_enabled?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          in_app_enabled?: boolean
          lifecycle_nudges_enabled?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          deep_link: string | null
          id: string
          message: string
          priority: number | null
          read: boolean | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          deep_link?: string | null
          id?: string
          message: string
          priority?: number | null
          read?: boolean | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          deep_link?: string | null
          id?: string
          message?: string
          priority?: number | null
          read?: boolean | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      nudge_dismissals: {
        Row: {
          created_at: string
          dismissed: boolean
          id: string
          notification_id: string | null
          quiet_until: string
          rule_key: string
          subject_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dismissed?: boolean
          id?: string
          notification_id?: string | null
          quiet_until: string
          rule_key: string
          subject_key?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dismissed?: boolean
          id?: string
          notification_id?: string | null
          quiet_until?: string
          rule_key?: string
          subject_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudge_dismissals_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          acquisition_source: string | null
          activated_at: string | null
          active_batch_id: string | null
          completed_at: string | null
          demo_mission_step: number
          first_activity_type: string | null
          luna_customization_seen_at: string | null
          second_session_started_at: string | null
          selected_path: string | null
          study_goal: string | null
          university_match_dismissed_at: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          acquisition_source?: string | null
          activated_at?: string | null
          active_batch_id?: string | null
          completed_at?: string | null
          demo_mission_step?: number
          first_activity_type?: string | null
          luna_customization_seen_at?: string | null
          second_session_started_at?: string | null
          selected_path?: string | null
          study_goal?: string | null
          university_match_dismissed_at?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          acquisition_source?: string | null
          activated_at?: string | null
          active_batch_id?: string | null
          completed_at?: string | null
          demo_mission_step?: number
          first_activity_type?: string | null
          luna_customization_seen_at?: string | null
          second_session_started_at?: string | null
          selected_path?: string | null
          study_goal?: string | null
          university_match_dismissed_at?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      parse_jobs: {
        Row: {
          attempts: number
          error: string | null
          id: string
          last_completed_slide: number
          lecture_id: string
          pdf_path: string
          pdf_sha256: string
          started_at: string | null
          status: string
          total_pages: number
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          error?: string | null
          id?: string
          last_completed_slide?: number
          lecture_id: string
          pdf_path: string
          pdf_sha256: string
          started_at?: string | null
          status?: string
          total_pages: number
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          error?: string | null
          id?: string
          last_completed_slide?: number
          lecture_id?: string
          pdf_path?: string
          pdf_sha256?: string
          started_at?: string | null
          status?: string
          total_pages?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parse_jobs_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: true
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      parse_pages: {
        Row: {
          content: Json | null
          error: string | null
          extract: Json | null
          image_url: string | null
          page_index: number
          route: string | null
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          content?: Json | null
          error?: string | null
          extract?: Json | null
          image_url?: string | null
          page_index: number
          route?: string | null
          run_id: string
          status: string
          updated_at?: string
        }
        Update: {
          content?: Json | null
          error?: string | null
          extract?: Json | null
          image_url?: string | null
          page_index?: number
          route?: string | null
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parse_pages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "parse_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      parse_runs: {
        Row: {
          batch_id: string | null
          course_id: string | null
          error: string | null
          filename: string | null
          finished_at: string | null
          lecture_id: string | null
          outline: Json | null
          page_count: number | null
          parsing_mode: string | null
          pdf_hash: string
          pipeline_version: string
          run_id: string
          started_at: string
          status: string
          user_id: string | null
        }
        Insert: {
          batch_id?: string | null
          course_id?: string | null
          error?: string | null
          filename?: string | null
          finished_at?: string | null
          lecture_id?: string | null
          outline?: Json | null
          page_count?: number | null
          parsing_mode?: string | null
          pdf_hash: string
          pipeline_version: string
          run_id?: string
          started_at?: string
          status: string
          user_id?: string | null
        }
        Update: {
          batch_id?: string | null
          course_id?: string | null
          error?: string | null
          filename?: string | null
          finished_at?: string | null
          lecture_id?: string | null
          outline?: Json | null
          page_count?: number | null
          parsing_mode?: string | null
          pdf_hash?: string
          pipeline_version?: string
          run_id?: string
          started_at?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parse_runs_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parse_runs_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_parse_cache: {
        Row: {
          created_at: string | null
          expires_at: string | null
          pdf_hash: string
          result: Json
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          pdf_hash: string
          result: Json
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          pdf_hash?: string
          result?: Json
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id: string
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      pipeline_run_metrics: {
        Row: {
          fallbacks: Json
          finished_at: string | null
          pdf_hash: string
          pipeline_version: string
          started_at: string
          totals: Json
        }
        Insert: {
          fallbacks?: Json
          finished_at?: string | null
          pdf_hash: string
          pipeline_version?: string
          started_at?: string
          totals?: Json
        }
        Update: {
          fallbacks?: Json
          finished_at?: string | null
          pdf_hash?: string
          pipeline_version?: string
          started_at?: string
          totals?: Json
        }
        Relationships: []
      }
      practice_attempts: {
        Row: {
          answers: Json
          id: string
          is_preview: boolean
          score: number | null
          sheet_id: string
          student_id: string
          submitted_at: string
        }
        Insert: {
          answers?: Json
          id?: string
          is_preview?: boolean
          score?: number | null
          sheet_id: string
          student_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          id?: string
          is_preview?: boolean
          score?: number | null
          sheet_id?: string
          student_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_attempts_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "practice_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sheet_questions: {
        Row: {
          choices: Json | null
          correct_answer: string | null
          created_at: string
          explanation: string | null
          id: string
          order_index: number
          prompt: string
          sheet_id: string
          source_quiz_question_id: string | null
          type: string
          updated_at: string
        }
        Insert: {
          choices?: Json | null
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          order_index?: number
          prompt: string
          sheet_id: string
          source_quiz_question_id?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          choices?: Json | null
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          order_index?: number
          prompt?: string
          sheet_id?: string
          source_quiz_question_id?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sheet_questions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "practice_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sheet_questions_source_quiz_question_id_fkey"
            columns: ["source_quiz_question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sheets: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          lecture_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: string
          lecture_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          lecture_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sheets_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          best_streak: number | null
          created_at: string | null
          current_level: number | null
          current_semester: number | null
          current_streak: number | null
          degree_program_id: string | null
          display_name: string | null
          email: string
          faculty_id: string | null
          full_name: string | null
          has_completed_activation_onboarding: boolean
          has_seen_dashboard_tour: boolean
          id: string
          institution: string | null
          institution_verified: boolean
          last_active_date: string | null
          luna_patch: string | null
          luna_suit_color: string | null
          luna_visor_tint: string | null
          preferred_language: string
          social_roles: string[]
          total_xp: number | null
          university_email: string | null
          university_id: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_semester?: number | null
          current_streak?: number | null
          degree_program_id?: string | null
          display_name?: string | null
          email: string
          faculty_id?: string | null
          full_name?: string | null
          has_completed_activation_onboarding?: boolean
          has_seen_dashboard_tour?: boolean
          id?: string
          institution?: string | null
          institution_verified?: boolean
          last_active_date?: string | null
          luna_patch?: string | null
          luna_suit_color?: string | null
          luna_visor_tint?: string | null
          preferred_language?: string
          social_roles?: string[]
          total_xp?: number | null
          university_email?: string | null
          university_id?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          best_streak?: number | null
          created_at?: string | null
          current_level?: number | null
          current_semester?: number | null
          current_streak?: number | null
          degree_program_id?: string | null
          display_name?: string | null
          email?: string
          faculty_id?: string | null
          full_name?: string | null
          has_completed_activation_onboarding?: boolean
          has_seen_dashboard_tour?: boolean
          id?: string
          institution?: string | null
          institution_verified?: boolean
          last_active_date?: string | null
          luna_patch?: string | null
          luna_suit_color?: string | null
          luna_visor_tint?: string | null
          preferred_language?: string
          social_roles?: string[]
          total_xp?: number | null
          university_email?: string | null
          university_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_degree_program_id_fkey"
            columns: ["degree_program_id"]
            isOneToOne: false
            referencedRelation: "degree_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_faculty_id_fkey"
            columns: ["faculty_id"]
            isOneToOne: false
            referencedRelation: "faculties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          correct_answer: number
          created_at: string | null
          id: string
          metadata: Json | null
          options: Json
          question_text: string
          slide_id: string
        }
        Insert: {
          correct_answer: number
          created_at?: string | null
          id?: string
          metadata?: Json | null
          options?: Json
          question_text: string
          slide_id: string
        }
        Update: {
          correct_answer?: number
          created_at?: string | null
          id?: string
          metadata?: Json | null
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
          },
        ]
      }
      review_cards: {
        Row: {
          back: Json
          concept_id: string | null
          content_hash: string
          created_at: string
          front: Json
          hidden_at: string | null
          id: string
          lecture_id: string
          source_id: string | null
          source_type: string
        }
        Insert: {
          back: Json
          concept_id?: string | null
          content_hash: string
          created_at?: string
          front: Json
          hidden_at?: string | null
          id?: string
          lecture_id: string
          source_id?: string | null
          source_type: string
        }
        Update: {
          back?: Json
          concept_id?: string | null
          content_hash?: string
          created_at?: string
          front?: Json
          hidden_at?: string | null
          id?: string
          lecture_id?: string
          source_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_cards_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_cards_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      review_log: {
        Row: {
          card_id: string
          elapsed_ms: number | null
          id: number
          rating: number
          reviewed_at: string
          user_id: string
        }
        Insert: {
          card_id: string
          elapsed_ms?: number | null
          id?: never
          rating: number
          reviewed_at?: string
          user_id: string
        }
        Update: {
          card_id?: string
          elapsed_ms?: number | null
          id?: never
          rating?: number
          reviewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_log_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "review_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      review_schedule: {
        Row: {
          card_id: string
          difficulty: number
          due_at: string
          lapses: number
          last_reviewed: string | null
          reps: number
          stability: number
          state: string
          suspended: boolean
          user_id: string
        }
        Insert: {
          card_id: string
          difficulty?: number
          due_at?: string
          lapses?: number
          last_reviewed?: string | null
          reps?: number
          stability?: number
          state?: string
          suspended?: boolean
          user_id: string
        }
        Update: {
          card_id?: string
          difficulty?: number
          due_at?: string
          lapses?: number
          last_reviewed?: string | null
          reps?: number
          stability?: number
          state?: string
          suspended?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_schedule_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "review_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id: string
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      schedule_item_completions: {
        Row: {
          completed_at: string
          id: string
          lecture_id: string
          plan_date: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          lecture_id: string
          plan_date: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          lecture_id?: string
          plan_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_item_completions_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      session: {
        Row: {
          createdAt: string
          expiresAt: string
          id: string
          ipAddress: string | null
          token: string
          updatedAt: string
          userAgent: string | null
          userId: string
        }
        Insert: {
          createdAt?: string
          expiresAt: string
          id: string
          ipAddress?: string | null
          token: string
          updatedAt: string
          userAgent?: string | null
          userId: string
        }
        Update: {
          createdAt?: string
          expiresAt?: string
          id?: string
          ipAddress?: string | null
          token?: string
          updatedAt?: string
          userAgent?: string | null
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      slide_chunks: {
        Row: {
          chunk_index: number
          embedding: string | null
          id: number
          lecture_id: string
          page_index: number
          pipeline_version: string
          section: string | null
          text: string
        }
        Insert: {
          chunk_index: number
          embedding?: string | null
          id?: number
          lecture_id: string
          page_index: number
          pipeline_version: string
          section?: string | null
          text: string
        }
        Update: {
          chunk_index?: number
          embedding?: string | null
          id?: number
          lecture_id?: string
          page_index?: number
          pipeline_version?: string
          section?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "slide_chunks_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      slide_embeddings: {
        Row: {
          content_hash: string | null
          created_at: string | null
          embedding: string | null
          id: string
          lecture_id: string | null
          metadata: Json | null
          pdf_hash: string | null
          pipeline_version: string | null
          slide_index: number
        }
        Insert: {
          content_hash?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          lecture_id?: string | null
          metadata?: Json | null
          pdf_hash?: string | null
          pipeline_version?: string | null
          slide_index: number
        }
        Update: {
          content_hash?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          lecture_id?: string | null
          metadata?: Json | null
          pdf_hash?: string | null
          pipeline_version?: string | null
          slide_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "slide_embeddings_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      slide_parse_cache: {
        Row: {
          created_at: string | null
          expires_at: string | null
          pdf_hash: string
          pipeline_version: string
          slide_data: Json
          slide_index: number
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          pdf_hash: string
          pipeline_version?: string
          slide_data: Json
          slide_index: number
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          pdf_hash?: string
          pipeline_version?: string
          slide_data?: Json
          slide_index?: number
        }
        Relationships: []
      }
      slides: {
        Row: {
          ai_enhanced: boolean
          content_text: string | null
          context_note: string | null
          created_at: string | null
          embedding: string | null
          fts: unknown
          id: string
          image_url: string | null
          key_concepts: string[] | null
          lecture_id: string
          markdown_explanation: string | null
          needs_review: boolean
          page_hash: string | null
          parser_engine: string | null
          previous_version: Json | null
          regen_instruction: string | null
          review_reason: string | null
          slide_number: number
          slide_type: string | null
          status: string
          summary: string | null
          title: string | null
          updated_at: string | null
          vision_routed: boolean
          visual_description: string | null
        }
        Insert: {
          ai_enhanced?: boolean
          content_text?: string | null
          context_note?: string | null
          created_at?: string | null
          embedding?: string | null
          fts?: unknown
          id?: string
          image_url?: string | null
          key_concepts?: string[] | null
          lecture_id: string
          markdown_explanation?: string | null
          needs_review?: boolean
          page_hash?: string | null
          parser_engine?: string | null
          previous_version?: Json | null
          regen_instruction?: string | null
          review_reason?: string | null
          slide_number: number
          slide_type?: string | null
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string | null
          vision_routed?: boolean
          visual_description?: string | null
        }
        Update: {
          ai_enhanced?: boolean
          content_text?: string | null
          context_note?: string | null
          created_at?: string | null
          embedding?: string | null
          fts?: unknown
          id?: string
          image_url?: string | null
          key_concepts?: string[] | null
          lecture_id?: string
          markdown_explanation?: string | null
          needs_review?: boolean
          page_hash?: string | null
          parser_engine?: string | null
          previous_version?: Json | null
          regen_instruction?: string | null
          review_reason?: string | null
          slide_number?: number
          slide_type?: string | null
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string | null
          vision_routed?: boolean
          visual_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slides_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      student_catalog_courses: {
        Row: {
          catalog_course_id: string
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          catalog_course_id: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          catalog_course_id?: string
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_catalog_courses_catalog_course_id_fkey"
            columns: ["catalog_course_id"]
            isOneToOne: false
            referencedRelation: "catalog_courses"
            referencedColumns: ["id"]
          },
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
          slide_states: Json
          total_questions_answered: number | null
          updated_at: string | null
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
          slide_states?: Json
          total_questions_answered?: number | null
          updated_at?: string | null
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
          slide_states?: Json
          total_questions_answered?: number | null
          updated_at?: string | null
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
        ]
      }
      study_guides: {
        Row: {
          content: Json
          course_id: string
          generated_at: string
          source_lecture_count: number
        }
        Insert: {
          content: Json
          course_id: string
          generated_at?: string
          source_lecture_count?: number
        }
        Update: {
          content?: Json
          course_id?: string
          generated_at?: string
          source_lecture_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "study_guides_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_messages: {
        Row: {
          cited_slides: number[] | null
          content: string
          created_at: string | null
          id: string
          role: string
          session_id: string
        }
        Insert: {
          cited_slides?: number[] | null
          content: string
          created_at?: string | null
          id?: string
          role: string
          session_id: string
        }
        Update: {
          cited_slides?: number[] | null
          content?: string
          created_at?: string | null
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tutor_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tutor_sessions: {
        Row: {
          created_at: string | null
          id: string
          lecture_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lecture_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lecture_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_sessions_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      universities: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          email_domains: string[]
          external_ref: string | null
          id: string
          last_scraped_at: string | null
          name: string
          source: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          email_domains?: string[]
          external_ref?: string | null
          id?: string
          last_scraped_at?: string | null
          name: string
          source?: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          email_domains?: string[]
          external_ref?: string | null
          id?: string
          last_scraped_at?: string | null
          name?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      upload_quotas: {
        Row: {
          period: string
          quota_limit: number
          updated_at: string
          uploads_used: number
          user_id: string
        }
        Insert: {
          period: string
          quota_limit?: number
          updated_at?: string
          uploads_used?: number
          user_id: string
        }
        Update: {
          period?: string
          quota_limit?: number
          updated_at?: string
          uploads_used?: number
          user_id?: string
        }
        Relationships: []
      }
      user: {
        Row: {
          createdAt: string
          email: string
          emailVerified: boolean
          id: string
          image: string | null
          name: string
          role: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email: string
          emailVerified: boolean
          id: string
          image?: string | null
          name: string
          role: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          email?: string
          emailVerified?: boolean
          id?: string
          image?: string | null
          name?: string
          role?: string
          updatedAt?: string
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          created_at: string
          feature: string
          id: string
          message: string
          route: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          message: string
          route?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          message?: string
          route?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
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
        Relationships: []
      }
      verification: {
        Row: {
          createdAt: string
          expiresAt: string
          id: string
          identifier: string
          updatedAt: string
          value: string
        }
        Insert: {
          createdAt?: string
          expiresAt: string
          id: string
          identifier: string
          updatedAt?: string
          value: string
        }
        Update: {
          createdAt?: string
          expiresAt?: string
          id?: string
          identifier?: string
          updatedAt?: string
          value?: string
        }
        Relationships: []
      }
      worksheets: {
        Row: {
          created_at: string | null
          file_type: string | null
          file_url: string
          id: string
          lecture_id: string
          size_bytes: number | null
          title: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_type?: string | null
          file_url: string
          id?: string
          lecture_id: string
          size_bytes?: number | null
          title: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_type?: string | null
          file_url?: string
          id?: string
          lecture_id?: string
          size_bytes?: number | null
          title?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worksheets_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_events: {
        Row: {
          created_at: string
          dedupe_key: string | null
          id: string
          reason: string | null
          user_id: string
          xp: number
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          reason?: string | null
          user_id: string
          xp: number
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          reason?: string | null
          user_id?: string
          xp?: number
        }
        Relationships: []
      }
    }
    Views: {
      mv_course_daily_activity: {
        Row: {
          active_user_ids: string[] | null
          activity_day: string | null
          course_id: string | null
          distinct_active_users: number | null
          lecture_complete_durations_seconds: number[] | null
          tracked_event_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lectures_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _grant_badge: {
        Args: { p_key: string; p_user_id: string }
        Returns: {
          category: string
          description: string
          icon: string
          is_secret: boolean
          key: string
          metric: string | null
          name: string
          sort_order: number
          threshold: number | null
          xp_reward: number
        }
        SetofOptions: {
          from: "*"
          to: "badge_definitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _invalidate_course_overview: { Args: { cid: string }; Returns: undefined }
      add_xp_to_user:
        | { Args: { p_user_id: string; p_xp: number }; Returns: undefined }
        | { Args: { p_xp: number }; Returns: undefined }
      assignment_owner_id: {
        Args: { assignment_uuid: string }
        Returns: string
      }
      award_badge: {
        Args: { p_key: string }
        Returns: {
          category: string
          description: string
          icon: string
          is_secret: boolean
          key: string
          metric: string | null
          name: string
          sort_order: number
          threshold: number | null
          xp_reward: number
        }
        SetofOptions: {
          from: "*"
          to: "badge_definitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_demo_friends: { Args: never; Returns: string }
      cancel_friend_request: { Args: { p_addressee: string }; Returns: string }
      cleanup_backend_cache: { Args: never; Returns: number }
      cleanup_old_blueprint_versions: {
        Args: { keep_version: number }
        Returns: number
      }
      cleanup_slide_parse_cache: { Args: never; Returns: number }
      complete_activation_onboarding: {
        Args: { p_path: string; p_study_goal?: string }
        Returns: Json
      }
      confirm_catalog_courses: { Args: { p_items: Json }; Returns: number }
      course_professor_id: { Args: { course_uuid: string }; Returns: string }
      evaluate_badges: {
        Args: never
        Returns: {
          category: string
          description: string
          icon: string
          is_secret: boolean
          key: string
          metric: string | null
          name: string
          sort_order: number
          threshold: number | null
          xp_reward: number
        }[]
        SetofOptions: {
          from: "*"
          to: "badge_definitions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      friend_ids_of: {
        Args: { _uid: string }
        Returns: {
          friend_id: string
        }[]
      }
      get_degree_programs: {
        Args: { p_faculty_id: string }
        Returns: {
          degree_level: string
          id: string
          name: string
          total_semesters: number
        }[]
      }
      get_faculties: {
        Args: { p_university_id: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      get_friend_activity: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          badge_display_name: string
          badge_icon: string
          badge_key: string
          course_title: string
          created_at: string
          display_name: string
          event_type: string
          score: number
          user_id: string
        }[]
      }
      get_friend_requests: {
        Args: never
        Returns: {
          active_today: boolean
          avatar_url: string
          created_at: string
          current_level: number
          direction: string
          display_name: string
          institution: string
          institution_verified: boolean
          mutual_courses: number
          mutual_friends: number
          shared_courses: number
          social_roles: string[]
          total_xp: number
          user_id: string
        }[]
      }
      get_friend_suggestions: {
        Args: { p_limit?: number }
        Returns: {
          active_today: boolean
          avatar_url: string
          current_level: number
          display_name: string
          institution: string
          institution_verified: boolean
          mutual_courses: number
          mutual_friends: number
          relationship: string
          shared_courses: number
          social_roles: string[]
          total_xp: number
          user_id: string
        }[]
      }
      get_friends: {
        Args: never
        Returns: {
          active_today: boolean
          avatar_url: string
          current_level: number
          current_streak: number
          display_name: string
          institution: string
          institution_verified: boolean
          social_roles: string[]
          total_xp: number
          user_id: string
          weekly_xp: number
        }[]
      }
      get_global_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          active_today: boolean
          avatar_url: string
          current_level: number
          current_semester: number
          current_streak: number
          display_name: string
          faculty_id: string
          faculty_name: string
          institution: string
          institution_verified: boolean
          social_roles: string[]
          total_xp: number
          university_id: string
          university_name: string
          user_id: string
          weekly_xp: number
        }[]
      }
      get_institution_match_suggestion: {
        Args: never
        Returns: {
          university: string
        }[]
      }
      get_my_catalog_courses: {
        Args: never
        Returns: {
          catalog_course_id: string
          course_code: string
          status: string
          title: string
          typical_semester: number
        }[]
      }
      get_my_social_extras: {
        Args: never
        Returns: {
          institution: string
          social_roles: string[]
          weekly_xp: number
        }[]
      }
      get_my_verification: {
        Args: never
        Returns: {
          institution: string
          institution_verified: boolean
          university_email: string
          university_id: string
        }[]
      }
      get_recommended_courses: {
        Args: { p_limit?: number }
        Returns: {
          color: string
          description: string
          icon: string
          id: string
          lecture_count: number
          matched_course: string
          reason: string
          score: number
          title: string
        }[]
      }
      get_suggested_courses: {
        Args: { p_current_semester: number; p_program_id: string }
        Returns: {
          course_code: string
          credits: number
          id: string
          is_mandatory: boolean
          language: string
          pre_checked: boolean
          suggested_status: string
          title: string
          typical_semester: number
        }[]
      }
      get_universities: {
        Args: never
        Returns: {
          city: string
          country: string
          email_domains: string[]
          has_catalog: boolean
          id: string
          name: string
        }[]
      }
      get_user_courses: {
        Args: { p_user: string }
        Returns: {
          course_id: string
          mutual: boolean
          title: string
        }[]
      }
      get_user_profile: {
        Args: { p_user: string }
        Returns: {
          active_today: boolean
          avatar_url: string
          current_level: number
          current_streak: number
          display_name: string
          institution: string
          institution_verified: boolean
          mutual_courses: number
          mutual_friends: number
          relationship: string
          shared_courses: number
          social_roles: string[]
          total_xp: number
          user_id: string
          weekly_xp: number
        }[]
      }
      get_weekly_xp: { Args: never; Returns: number }
      get_weekly_xp_by_day: {
        Args: never
        Returns: {
          day: string
          xp: number
        }[]
      }
      grant_xp: {
        Args: { p_dedupe_key?: string; p_reason: string; p_xp: number }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_upload_quota: {
        Args: { p_limit: number; p_period: string; p_user_id: string }
        Returns: {
          allowed: boolean
          quota_limit: number
          uploads_used: number
        }[]
      }
      lecture_visible_to_caller: {
        Args: { p_lecture_id: string }
        Returns: boolean
      }
      link_university_email: {
        Args: { p_email: string }
        Returns: {
          reason: string
          university: string
          verified: boolean
        }[]
      }
      match_concepts: {
        Args: {
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          canonical_name: string
          id: string
          name_key: string
          similarity: number
        }[]
      }
      match_slides:
        | {
            Args: { p_k?: number; p_lecture_id: string; p_query: string }
            Returns: {
              markdown_explanation: string
              similarity: number
              slide_id: string
              slide_number: number
              title: string
            }[]
          }
        | {
            Args: {
              match_count: number
              match_threshold: number
              query_embedding: string
            }
            Returns: {
              content_hash: string
              id: string
              lecture_id: string
              metadata: Json
              pdf_hash: string
              similarity: number
              slide_index: number
            }[]
          }
      match_slides_by_lecture: {
        Args: {
          match_count: number
          match_threshold: number
          p_lecture_id: string
          p_pdf_hash: string
          query_embedding: string
        }
        Returns: {
          id: string
          lecture_id: string
          pdf_hash: string
          similarity: number
          slide_index: number
        }[]
      }
      match_slides_scoped: {
        Args: {
          match_count: number
          match_threshold: number
          query_embedding: string
          scoped_course_ids: string[]
        }
        Returns: {
          content_hash: string
          course_id: string
          id: string
          lecture_id: string
          metadata: Json
          similarity: number
          slide_index: number
        }[]
      }
      mutual_courses_count: {
        Args: { _me: string; _other: string }
        Returns: number
      }
      mutual_friends_count: {
        Args: { _me: string; _other: string }
        Returns: number
      }
      record_daily_activity: { Args: never; Returns: number }
      record_onboarding_activation: {
        Args: { p_activity_type: string; p_course_id?: string }
        Returns: boolean
      }
      record_onboarding_second_session: { Args: never; Returns: boolean }
      relationship_status: {
        Args: { _me: string; _other: string }
        Returns: string
      }
      remove_friend: { Args: { p_user: string }; Returns: string }
      reset_all_analytics: { Args: never; Returns: string }
      respond_friend_request: {
        Args: { p_accept: boolean; p_requester: string }
        Returns: string
      }
      restore_analytics: { Args: { p_backup_id: string }; Returns: boolean }
      search_concepts_keyword: {
        Args: {
          match_count: number
          scoped_course_ids: string[]
          search_query: string
        }
        Returns: {
          canonical_name: string
          course_id: string
          id: string
          lecture_id: string
        }[]
      }
      search_lectures_keyword: {
        Args: {
          match_count: number
          scoped_course_ids: string[]
          search_query: string
        }
        Returns: {
          course_id: string
          description: string
          id: string
          title: string
        }[]
      }
      search_slides_keyword: {
        Args: {
          match_count: number
          scoped_course_ids: string[]
          search_query: string
        }
        Returns: {
          content_text: string
          course_id: string
          id: string
          lecture_id: string
          rank: number
          slide_index: number
          title: string
        }[]
      }
      search_users: {
        Args: {
          p_common_only?: boolean
          p_institution?: string
          p_limit?: number
          p_query?: string
          p_role?: string
        }
        Returns: {
          active_today: boolean
          avatar_url: string
          current_level: number
          display_name: string
          institution: string
          institution_verified: boolean
          mutual_courses: number
          mutual_friends: number
          relationship: string
          shared_courses: number
          social_roles: string[]
          total_xp: number
          user_id: string
        }[]
      }
      search_worksheets_keyword: {
        Args: {
          match_count: number
          scoped_course_ids: string[]
          search_query: string
        }
        Returns: {
          course_id: string
          id: string
          lecture_id: string
          title: string
        }[]
      }
      send_friend_request: { Args: { p_addressee: string }; Returns: string }
      set_academic_profile: {
        Args: {
          p_current_semester: number
          p_faculty_id: string
          p_program_id: string
          p_university_id: string
        }
        Returns: undefined
      }
      set_my_social_profile: {
        Args: { p_institution: string; p_social_roles: string[] }
        Returns: undefined
      }
      shared_catalog_courses_count: {
        Args: { _me: string; _other: string }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_user_streak:
        | { Args: { p_correct: boolean }; Returns: number }
        | { Args: { p_correct: boolean; p_user_id: string }; Returns: number }
      upsert_course_visit: {
        Args: { p_course_id: string; p_user_id: string }
        Returns: undefined
      }
      verify_my_institution: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "student" | "professor" | "admin"
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
    Enums: {
      app_role: ["student", "professor", "admin"],
    },
  },
} as const

