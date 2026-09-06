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
  public: {
    Tables: {
      analyses: {
        Row: {
          asset: string
          checklist: Json
          closed_at: string | null
          created_at: string
          direction: string
          entry_zone: string | null
          grade: string
          htf_bias: string
          id: string
          invalidation: Json
          invalidation_reason: string | null
          market_type: string
          max_score: number
          notes: string | null
          outcome: string
          primary_timeframe: string | null
          r_result: number | null
          raw: Json | null
          reasoning: Json
          requested_additional_images: Json
          required_confirmation: Json
          risk_reward: number | null
          score: number
          setup_stage: string
          source: string
          stop_loss: string | null
          sufficient_information: boolean
          summary: string | null
          timeframes: string[]
          tp1: string | null
          tp2: string | null
          updated_at: string
          user_id: string
          visual_evidence: string
        }
        Insert: {
          asset?: string
          checklist?: Json
          closed_at?: string | null
          created_at?: string
          direction?: string
          entry_zone?: string | null
          grade?: string
          htf_bias?: string
          id?: string
          invalidation?: Json
          invalidation_reason?: string | null
          market_type?: string
          max_score?: number
          notes?: string | null
          outcome?: string
          primary_timeframe?: string | null
          r_result?: number | null
          raw?: Json | null
          reasoning?: Json
          requested_additional_images?: Json
          required_confirmation?: Json
          risk_reward?: number | null
          score?: number
          setup_stage?: string
          source?: string
          stop_loss?: string | null
          sufficient_information?: boolean
          summary?: string | null
          timeframes?: string[]
          tp1?: string | null
          tp2?: string | null
          updated_at?: string
          user_id: string
          visual_evidence?: string
        }
        Update: {
          asset?: string
          checklist?: Json
          closed_at?: string | null
          created_at?: string
          direction?: string
          entry_zone?: string | null
          grade?: string
          htf_bias?: string
          id?: string
          invalidation?: Json
          invalidation_reason?: string | null
          market_type?: string
          max_score?: number
          notes?: string | null
          outcome?: string
          primary_timeframe?: string | null
          r_result?: number | null
          raw?: Json | null
          reasoning?: Json
          requested_additional_images?: Json
          required_confirmation?: Json
          risk_reward?: number | null
          score?: number
          setup_stage?: string
          source?: string
          stop_loss?: string | null
          sufficient_information?: boolean
          summary?: string | null
          timeframes?: string[]
          tp1?: string | null
          tp2?: string | null
          updated_at?: string
          user_id?: string
          visual_evidence?: string
        }
        Relationships: []
      }
      analysis_images: {
        Row: {
          analysis_id: string
          created_at: string
          id: string
          position: number
          storage_path: string
          timeframe: string | null
          user_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          id?: string
          position?: number
          storage_path: string
          timeframe?: string | null
          user_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          id?: string
          position?: number
          storage_path?: string
          timeframe?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_images_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      den_presets: {
        Row: {
          components: Json
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          components?: Json
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          components?: Json
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      learning_progress: {
        Row: {
          created_at: string
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          body: string
          created_at: string
          id: string
          style: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          style?: Json
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          style?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ohlc_data: {
        Row: {
          close: number | null
          high: number | null
          id: number
          low: number | null
          open: number | null
          symbol: string
          tick_volume: number | null
          time: string | null
          timeframe: string | null
          updated_at: string | null
        }
        Insert: {
          close?: number | null
          high?: number | null
          id?: number
          low?: number | null
          open?: number | null
          symbol: string
          tick_volume?: number | null
          time?: string | null
          timeframe?: string | null
          updated_at?: string | null
        }
        Update: {
          close?: number | null
          high?: number | null
          id?: number
          low?: number | null
          open?: number | null
          symbol?: string
          tick_volume?: number | null
          time?: string | null
          timeframe?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      premium_access: {
        Row: {
          hidden_pages: string[]
          last_code: string | null
          market_data_enabled: boolean
          premium_until: string
          updated_at: string
          user_id: string
        }
        Insert: {
          hidden_pages?: string[]
          last_code?: string | null
          market_data_enabled?: boolean
          premium_until: string
          updated_at?: string
          user_id: string
        }
        Update: {
          hidden_pages?: string[]
          last_code?: string | null
          market_data_enabled?: boolean
          premium_until?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      premium_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          duration_days: number
          expires_at: string | null
          id: string
          max_uses: number
          note: string | null
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          duration_days: number
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          uses?: number
        }
        Relationships: []
      }
      screenshots: {
        Row: {
          created_at: string
          id: string
          storage_path: string
          symbol: string | null
          timeframe: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          storage_path: string
          symbol?: string | null
          timeframe?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          storage_path?: string
          symbol?: string | null
          timeframe?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          account_balance: number
          beginner_mode: boolean
          created_at: string
          currency: string
          den_rules: Json
          learning_mode: boolean
          min_rr: number
          min_sample_size: number
          preferred_assets: string[]
          preferred_timeframes: string[]
          require_volume: boolean
          risk_pct: number
          strict_mode: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_balance?: number
          beginner_mode?: boolean
          created_at?: string
          currency?: string
          den_rules?: Json
          learning_mode?: boolean
          min_rr?: number
          min_sample_size?: number
          preferred_assets?: string[]
          preferred_timeframes?: string[]
          require_volume?: boolean
          risk_pct?: number
          strict_mode?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_balance?: number
          beginner_mode?: boolean
          created_at?: string
          currency?: string
          den_rules?: Json
          learning_mode?: boolean
          min_rr?: number
          min_sample_size?: number
          preferred_assets?: string[]
          preferred_timeframes?: string[]
          require_volume?: boolean
          risk_pct?: number
          strict_mode?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ohlc_symbols: { Args: never; Returns: string[] }
      ohlc_timeframes: { Args: { _symbol: string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
