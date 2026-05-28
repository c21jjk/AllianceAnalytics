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
      agent_post_outbox: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          agent_email: string | null
          agent_name: string | null
          agent_phone: string | null
          caption_snippet: string | null
          created_at: string
          delivery_method: string | null
          flip_at: string | null
          flip_to_status: string | null
          generated_post_id: string | null
          id: string
          last_error: string | null
          notification_type: string
          post_urls: Json
          property_id: string | null
          sent_at: string | null
          story_url_path: string | null
          thumbnail_url: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          caption_snippet?: string | null
          created_at?: string
          delivery_method?: string | null
          flip_at?: string | null
          flip_to_status?: string | null
          generated_post_id?: string | null
          id?: string
          last_error?: string | null
          notification_type?: string
          post_urls?: Json
          property_id?: string | null
          sent_at?: string | null
          story_url_path?: string | null
          thumbnail_url?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          caption_snippet?: string | null
          created_at?: string
          delivery_method?: string | null
          flip_at?: string | null
          flip_to_status?: string | null
          generated_post_id?: string | null
          id?: string
          last_error?: string | null
          notification_type?: string
          post_urls?: Json
          property_id?: string | null
          sent_at?: string | null
          story_url_path?: string | null
          thumbnail_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_post_outbox_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_post_outbox_generated_post_id_fkey"
            columns: ["generated_post_id"]
            isOneToOne: false
            referencedRelation: "generated_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_post_outbox_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      api_credentials: {
        Row: {
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          last_validated_at: string | null
          platform: Database["public"]["Enums"]["credential_platform"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          last_validated_at?: string | null
          platform: Database["public"]["Enums"]["credential_platform"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          last_validated_at?: string | null
          platform?: Database["public"]["Enums"]["credential_platform"]
          updated_at?: string
        }
        Relationships: []
      }
      brand_assets: {
        Row: {
          created_at: string
          drive_file_id: string | null
          drive_folder_id: string | null
          drive_modified_at: string | null
          drive_parent_subfolder_name: string | null
          filename: string
          id: string
          kind: Database["public"]["Enums"]["brand_asset_kind"]
          label: string
          logo_category: string | null
          office_id: string | null
          public_url: string
          status: string
          storage_path: string
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_modified_at?: string | null
          drive_parent_subfolder_name?: string | null
          filename: string
          id?: string
          kind: Database["public"]["Enums"]["brand_asset_kind"]
          label: string
          logo_category?: string | null
          office_id?: string | null
          public_url: string
          status?: string
          storage_path: string
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          drive_file_id?: string | null
          drive_folder_id?: string | null
          drive_modified_at?: string | null
          drive_parent_subfolder_name?: string | null
          filename?: string
          id?: string
          kind?: Database["public"]["Enums"]["brand_asset_kind"]
          label?: string
          logo_category?: string | null
          office_id?: string | null
          public_url?: string
          status?: string
          storage_path?: string
          synced_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_drive_offices: {
        Row: {
          auto_matched: boolean
          folder_id: string
          mapped_at: string
          mapped_by: string | null
          office_id: string
          subfolder_name: string
        }
        Insert: {
          auto_matched?: boolean
          folder_id: string
          mapped_at?: string
          mapped_by?: string | null
          office_id: string
          subfolder_name: string
        }
        Update: {
          auto_matched?: boolean
          folder_id?: string
          mapped_at?: string
          mapped_by?: string | null
          office_id?: string
          subfolder_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_drive_offices_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_insights: {
        Row: {
          created_at: string
          data: Json
          generated_at: string
          id: string
          is_stale: boolean
          kind: string
          last_error: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          generated_at?: string
          id?: string
          is_stale?: boolean
          kind: string
          last_error?: string | null
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          generated_at?: string
          id?: string
          is_stale?: boolean
          kind?: string
          last_error?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_templates: {
        Row: {
          based_on_variant: string
          created_at: string
          created_by: string | null
          fabric_json: Json
          format: string
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          post_type: string
          preview_image_url: string | null
          updated_at: string
        }
        Insert: {
          based_on_variant: string
          created_at?: string
          created_by?: string | null
          fabric_json: Json
          format: string
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name: string
          post_type: string
          preview_image_url?: string | null
          updated_at?: string
        }
        Update: {
          based_on_variant?: string
          created_at?: string
          created_by?: string | null
          fabric_json?: Json
          format?: string
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name?: string
          post_type?: string
          preview_image_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_subscribers: {
        Row: {
          category: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          mls_agent_id: string | null
          name: string
          notes: string | null
          office_id: string | null
          receives_office_post_alerts: boolean
          receives_owner_story: boolean
          receives_weekly_social_report: boolean
          role: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          mls_agent_id?: string | null
          name: string
          notes?: string | null
          office_id?: string | null
          receives_office_post_alerts?: boolean
          receives_owner_story?: boolean
          receives_weekly_social_report?: boolean
          role?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          mls_agent_id?: string | null
          name?: string
          notes?: string | null
          office_id?: string | null
          receives_office_post_alerts?: boolean
          receives_owner_story?: boolean
          receives_weekly_social_report?: boolean
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_subscribers_mls_agent_id_fkey"
            columns: ["mls_agent_id"]
            isOneToOne: false
            referencedRelation: "mls_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_subscribers_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_posts: {
        Row: {
          additional_images: Json
          ai_design_critique_passed: boolean | null
          ai_design_duration_ms: number | null
          ai_design_mood: string | null
          ai_design_token_input: number | null
          ai_design_token_output: number | null
          asset_count: number
          bundle_path: string | null
          bundle_url: string | null
          caption: string | null
          captions_by_platform: Json
          composition_json: Json | null
          confirmed_platforms: string[] | null
          created_at: string
          created_by: string | null
          custom_feature: string | null
          customizations: Json
          downloaded_at: string | null
          fabric_json: Json | null
          format: string
          hashtags: string[] | null
          hero_image_source_url: string | null
          hosting_agents_by_index: Json | null
          id: string
          image_path: string | null
          image_url: string | null
          last_post_error: string | null
          last_schedule_error: Json
          layer_tree: Json | null
          media_type: string
          mls_hashtag: string | null
          mls_number: string
          notes: string | null
          original_template_id: string | null
          output_mode: string
          platform_post_ids: Json
          post_type: string
          posted_at: string | null
          posted_by: string | null
          posted_to: string[]
          property_id: string | null
          reel_duration_ms: number | null
          scheduled_for: Json
          slide_metadata: Json
          source_mls: string | null
          status: string
          template_id: string
          template_props: Json
          test_mode: boolean
          updated_at: string
          variant: string
          video_path: string | null
          video_url: string | null
        }
        Insert: {
          additional_images?: Json
          ai_design_critique_passed?: boolean | null
          ai_design_duration_ms?: number | null
          ai_design_mood?: string | null
          ai_design_token_input?: number | null
          ai_design_token_output?: number | null
          asset_count?: number
          bundle_path?: string | null
          bundle_url?: string | null
          caption?: string | null
          captions_by_platform?: Json
          composition_json?: Json | null
          confirmed_platforms?: string[] | null
          created_at?: string
          created_by?: string | null
          custom_feature?: string | null
          customizations?: Json
          downloaded_at?: string | null
          fabric_json?: Json | null
          format: string
          hashtags?: string[] | null
          hero_image_source_url?: string | null
          hosting_agents_by_index?: Json | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          last_post_error?: string | null
          last_schedule_error?: Json
          layer_tree?: Json | null
          media_type?: string
          mls_hashtag?: string | null
          mls_number: string
          notes?: string | null
          original_template_id?: string | null
          output_mode?: string
          platform_post_ids?: Json
          post_type: string
          posted_at?: string | null
          posted_by?: string | null
          posted_to?: string[]
          property_id?: string | null
          reel_duration_ms?: number | null
          scheduled_for?: Json
          slide_metadata?: Json
          source_mls?: string | null
          status?: string
          template_id: string
          template_props?: Json
          test_mode?: boolean
          updated_at?: string
          variant: string
          video_path?: string | null
          video_url?: string | null
        }
        Update: {
          additional_images?: Json
          ai_design_critique_passed?: boolean | null
          ai_design_duration_ms?: number | null
          ai_design_mood?: string | null
          ai_design_token_input?: number | null
          ai_design_token_output?: number | null
          asset_count?: number
          bundle_path?: string | null
          bundle_url?: string | null
          caption?: string | null
          captions_by_platform?: Json
          composition_json?: Json | null
          confirmed_platforms?: string[] | null
          created_at?: string
          created_by?: string | null
          custom_feature?: string | null
          customizations?: Json
          downloaded_at?: string | null
          fabric_json?: Json | null
          format?: string
          hashtags?: string[] | null
          hero_image_source_url?: string | null
          hosting_agents_by_index?: Json | null
          id?: string
          image_path?: string | null
          image_url?: string | null
          last_post_error?: string | null
          last_schedule_error?: Json
          layer_tree?: Json | null
          media_type?: string
          mls_hashtag?: string | null
          mls_number?: string
          notes?: string | null
          original_template_id?: string | null
          output_mode?: string
          platform_post_ids?: Json
          post_type?: string
          posted_at?: string | null
          posted_by?: string | null
          posted_to?: string[]
          property_id?: string | null
          reel_duration_ms?: number | null
          scheduled_for?: Json
          slide_metadata?: Json
          source_mls?: string | null
          status?: string
          template_id?: string
          template_props?: Json
          test_mode?: boolean
          updated_at?: string
          variant?: string
          video_path?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      listing_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          mls_number: string
          sequence: number
          source: string
          source_mls: string | null
          storage_path: string | null
          synced_at: string
          updated_at: string
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          mls_number: string
          sequence: number
          source?: string
          source_mls?: string | null
          storage_path?: string | null
          synced_at?: string
          updated_at?: string
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          mls_number?: string
          sequence?: number
          source?: string
          source_mls?: string | null
          storage_path?: string | null
          synced_at?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      mls_agents: {
        Row: {
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string
          headshot_label_override: string | null
          id: string
          is_active: boolean
          last_name: string | null
          license_number: string | null
          phone: string | null
          raw_payload: Json | null
          source: string
          source_agent_id: string
          source_office_id: string | null
          synced_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          last_name?: string | null
          license_number?: string | null
          phone?: string | null
          raw_payload?: Json | null
          source: string
          source_agent_id: string
          source_office_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string
          headshot_label_override?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          license_number?: string | null
          phone?: string | null
          raw_payload?: Json | null
          source?: string
          source_agent_id?: string
          source_office_id?: string | null
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      mls_feeds: {
        Row: {
          api_key: string | null
          api_secret: string | null
          base_url: string | null
          created_at: string
          description: string | null
          feed_type: Database["public"]["Enums"]["mls_feed_type"]
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_validated_at: string | null
          last_validated_ok: boolean | null
          max_records: number | null
          name: string
          notes: string | null
          office_filter: string | null
          password: string | null
          rets_url: string | null
          rets_version: string | null
          short_code: string
          status_filter: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          base_url?: string | null
          created_at?: string
          description?: string | null
          feed_type?: Database["public"]["Enums"]["mls_feed_type"]
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_validated_at?: string | null
          last_validated_ok?: boolean | null
          max_records?: number | null
          name: string
          notes?: string | null
          office_filter?: string | null
          password?: string | null
          rets_url?: string | null
          rets_version?: string | null
          short_code: string
          status_filter?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          base_url?: string | null
          created_at?: string
          description?: string | null
          feed_type?: Database["public"]["Enums"]["mls_feed_type"]
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_validated_at?: string | null
          last_validated_ok?: boolean | null
          max_records?: number | null
          name?: string
          notes?: string | null
          office_filter?: string | null
          password?: string | null
          rets_url?: string | null
          rets_version?: string | null
          short_code?: string
          status_filter?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          metadata: Json
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          metadata?: Json
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          metadata?: Json
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      office_post_announcements: {
        Row: {
          audience_scope: string
          created_at: string
          group_id: string
          last_error: string | null
          recipient_count: number
          sent_at: string
        }
        Insert: {
          audience_scope: string
          created_at?: string
          group_id: string
          last_error?: string | null
          recipient_count?: number
          sent_at?: string
        }
        Update: {
          audience_scope?: string
          created_at?: string
          group_id?: string
          last_error?: string | null
          recipient_count?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_post_announcements_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "post_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      offices: {
        Row: {
          address: string | null
          bright_office_id: string | null
          city: string | null
          cmc_office_id: string | null
          created_at: string
          darwin_office_id: number | null
          display_name: string | null
          division: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          price_range_high: number | null
          price_range_median: number | null
          price_range_min: number | null
          primary_buyer_demo: string | null
          primary_contact: string | null
          primary_seller_demo: string | null
          seasonal_pattern: string | null
          short_code: string
          signature_angles: string[] | null
          sjsr_office_id: string | null
          state: string | null
          towns_served: string[] | null
          updated_at: string
          zip: string | null
          zip_codes_served: string[] | null
        }
        Insert: {
          address?: string | null
          bright_office_id?: string | null
          city?: string | null
          cmc_office_id?: string | null
          created_at?: string
          darwin_office_id?: number | null
          display_name?: string | null
          division?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          price_range_high?: number | null
          price_range_median?: number | null
          price_range_min?: number | null
          primary_buyer_demo?: string | null
          primary_contact?: string | null
          primary_seller_demo?: string | null
          seasonal_pattern?: string | null
          short_code: string
          signature_angles?: string[] | null
          sjsr_office_id?: string | null
          state?: string | null
          towns_served?: string[] | null
          updated_at?: string
          zip?: string | null
          zip_codes_served?: string[] | null
        }
        Update: {
          address?: string | null
          bright_office_id?: string | null
          city?: string | null
          cmc_office_id?: string | null
          created_at?: string
          darwin_office_id?: number | null
          display_name?: string | null
          division?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          price_range_high?: number | null
          price_range_median?: number | null
          price_range_min?: number | null
          primary_buyer_demo?: string | null
          primary_contact?: string | null
          primary_seller_demo?: string | null
          seasonal_pattern?: string | null
          short_code?: string
          signature_angles?: string[] | null
          sjsr_office_id?: string | null
          state?: string | null
          towns_served?: string[] | null
          updated_at?: string
          zip?: string | null
          zip_codes_served?: string[] | null
        }
        Relationships: []
      }
      open_houses: {
        Row: {
          comments: string | null
          created_at: string
          end_at: string | null
          feed_short_code: string
          id: string
          last_synced_at: string
          mls_number: string
          oh_unique_id: string
          property_id: string | null
          rets_created_at: string | null
          rets_updated_at: string | null
          start_at: string
          updated_at: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          end_at?: string | null
          feed_short_code: string
          id?: string
          last_synced_at?: string
          mls_number: string
          oh_unique_id: string
          property_id?: string | null
          rets_created_at?: string | null
          rets_updated_at?: string | null
          start_at: string
          updated_at?: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          end_at?: string | null
          feed_short_code?: string
          id?: string
          last_synced_at?: string
          mls_number?: string
          oh_unique_id?: string
          property_id?: string | null
          rets_created_at?: string | null
          rets_updated_at?: string | null
          start_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_houses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_story_views: {
        Row: {
          id: number
          referrer_host: string | null
          report_id: string
          user_agent: string | null
          viewed_at: string
        }
        Insert: {
          id?: number
          referrer_host?: string | null
          report_id: string
          user_agent?: string | null
          viewed_at?: string
        }
        Update: {
          id?: number
          referrer_host?: string | null
          report_id?: string
          user_agent?: string | null
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_story_views_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_followers: {
        Row: {
          captured_at: string
          captured_date: string
          follower_count: number
          platform: Database["public"]["Enums"]["post_platform"]
          raw_payload: Json
        }
        Insert: {
          captured_at?: string
          captured_date?: string
          follower_count: number
          platform: Database["public"]["Enums"]["post_platform"]
          raw_payload?: Json
        }
        Update: {
          captured_at?: string
          captured_date?: string
          follower_count?: number
          platform?: Database["public"]["Enums"]["post_platform"]
          raw_payload?: Json
        }
        Relationships: []
      }
      post_groups: {
        Row: {
          audience_scope: string | null
          category: Database["public"]["Enums"]["post_category"] | null
          created_at: string
          group_method: Database["public"]["Enums"]["post_group_method"]
          id: string
          is_locked: boolean
          posted_date: string | null
          property_id: string | null
          property_ids: string[]
          representative_caption: string | null
          representative_thumbnail: string | null
          updated_at: string
        }
        Insert: {
          audience_scope?: string | null
          category?: Database["public"]["Enums"]["post_category"] | null
          created_at?: string
          group_method?: Database["public"]["Enums"]["post_group_method"]
          id?: string
          is_locked?: boolean
          posted_date?: string | null
          property_id?: string | null
          property_ids?: string[]
          representative_caption?: string | null
          representative_thumbnail?: string | null
          updated_at?: string
        }
        Update: {
          audience_scope?: string | null
          category?: Database["public"]["Enums"]["post_category"] | null
          created_at?: string
          group_method?: Database["public"]["Enums"]["post_group_method"]
          id?: string
          is_locked?: boolean
          posted_date?: string | null
          property_id?: string | null
          property_ids?: string[]
          representative_caption?: string | null
          representative_thumbnail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_groups_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      // 2026-05-22 — Template Builder storage. See
      // docs/adr/0001-template-builder.md.
      template_definitions: {
        Row: {
          id: string
          name: string
          description: string | null
          post_types: string[]
          schema: Json
          display_order: number
          publish_state: string
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          post_types: string[]
          schema?: Json
          display_order?: number
          publish_state?: string
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          post_types?: string[]
          schema?: Json
          display_order?: number
          publish_state?: string
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      // 2026-05-21 — many-to-many join between posts and properties.
      // Lets multi-property Open House carousel posts surface in every
      // featured listing's Owner Story. See migration
      // create_post_listings_join_table.
      post_listings: {
        Row: {
          post_id: string
          property_id: string
          link_method: Database["public"]["Enums"]["post_link_method"]
          is_primary: boolean
          created_at: string
        }
        Insert: {
          post_id: string
          property_id: string
          link_method: Database["public"]["Enums"]["post_link_method"]
          is_primary?: boolean
          created_at?: string
        }
        Update: {
          post_id?: string
          property_id?: string
          link_method?: Database["public"]["Enums"]["post_link_method"]
          is_primary?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_listings_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_listings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      post_metrics_daily: {
        Row: {
          avg_watch_time_sec: number | null
          captured_at: string
          captured_date: string
          comments: number | null
          completion_rate: number | null
          engagement_rate: number | null
          follows: number | null
          impressions: number | null
          likes: number | null
          link_clicks: number | null
          plays: number | null
          post_id: string
          profile_visits: number | null
          raw_payload: Json
          reach: number | null
          saves: number | null
          shares: number | null
        }
        Insert: {
          avg_watch_time_sec?: number | null
          captured_at?: string
          captured_date?: string
          comments?: number | null
          completion_rate?: number | null
          engagement_rate?: number | null
          follows?: number | null
          impressions?: number | null
          likes?: number | null
          link_clicks?: number | null
          plays?: number | null
          post_id: string
          profile_visits?: number | null
          raw_payload?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
        }
        Update: {
          avg_watch_time_sec?: number | null
          captured_at?: string
          captured_date?: string
          comments?: number | null
          completion_rate?: number | null
          engagement_rate?: number | null
          follows?: number | null
          impressions?: number | null
          likes?: number | null
          link_clicks?: number | null
          plays?: number | null
          post_id?: string
          profile_visits?: number | null
          raw_payload?: Json
          reach?: number | null
          saves?: number | null
          shares?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_metrics_daily_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          agent_name: string | null
          audience: Json
          caption: string | null
          category: Database["public"]["Enums"]["post_category"] | null
          created_at: string
          group_id: string | null
          hashtags: string[]
          id: string
          last_synced_at: string | null
          link_method: Database["public"]["Enums"]["post_link_method"] | null
          media_type: Database["public"]["Enums"]["media_type"] | null
          media_url: string | null
          metrics: Json
          mls_number_parsed: string | null
          office_id: string | null
          permalink: string | null
          platform: Database["public"]["Enums"]["post_platform"]
          platform_post_id: string | null
          posted_at: string | null
          property_id: string | null
          search_text: string | null
          thumbnail_cached_at: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          agent_name?: string | null
          audience?: Json
          caption?: string | null
          category?: Database["public"]["Enums"]["post_category"] | null
          created_at?: string
          group_id?: string | null
          hashtags?: string[]
          id?: string
          last_synced_at?: string | null
          link_method?: Database["public"]["Enums"]["post_link_method"] | null
          media_type?: Database["public"]["Enums"]["media_type"] | null
          media_url?: string | null
          metrics?: Json
          mls_number_parsed?: string | null
          office_id?: string | null
          permalink?: string | null
          platform: Database["public"]["Enums"]["post_platform"]
          platform_post_id?: string | null
          posted_at?: string | null
          property_id?: string | null
          search_text?: string | null
          thumbnail_cached_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          agent_name?: string | null
          audience?: Json
          caption?: string | null
          category?: Database["public"]["Enums"]["post_category"] | null
          created_at?: string
          group_id?: string | null
          hashtags?: string[]
          id?: string
          last_synced_at?: string | null
          link_method?: Database["public"]["Enums"]["post_link_method"] | null
          media_type?: Database["public"]["Enums"]["media_type"] | null
          media_url?: string | null
          metrics?: Json
          mls_number_parsed?: string | null
          office_id?: string | null
          permalink?: string | null
          platform?: Database["public"]["Enums"]["post_platform"]
          platform_post_id?: string | null
          posted_at?: string | null
          property_id?: string | null
          search_text?: string | null
          thumbnail_cached_at?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "post_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          last_active_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          last_active_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          last_active_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          agent_email: string | null
          agent_name: string | null
          agent_phone: string | null
          alliance_role: string
          bathrooms_full: number | null
          bathrooms_half: number | null
          bedrooms: number | null
          buyer_agent_name: string | null
          buyer_office_name: string | null
          city: string | null
          close_date: string | null
          close_price: number | null
          created_at: string
          dom_days: number | null
          hero_image_url: string | null
          id: string
          list_price: number | null
          listing_date: string | null
          listing_office_name: string | null
          mls_number: string
          notes: string | null
          office_id: string | null
          posts_confirmed_at: string | null
          posts_confirmed_by: string | null
          posts_confirmed_platforms: string[]
          promotion_dismissed_at: string | null
          promotion_dismissed_by: string | null
          promotion_dismissed_reason: string | null
          property_type: string | null
          public_remarks: string | null
          source_mls: string | null
          state: string | null
          status: Database["public"]["Enums"]["property_status"]
          status_changed_at: string
          unit_number: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          alliance_role?: string
          bathrooms_full?: number | null
          bathrooms_half?: number | null
          bedrooms?: number | null
          buyer_agent_name?: string | null
          buyer_office_name?: string | null
          city?: string | null
          close_date?: string | null
          close_price?: number | null
          created_at?: string
          dom_days?: number | null
          hero_image_url?: string | null
          id?: string
          list_price?: number | null
          listing_date?: string | null
          listing_office_name?: string | null
          mls_number: string
          notes?: string | null
          office_id?: string | null
          posts_confirmed_at?: string | null
          posts_confirmed_by?: string | null
          posts_confirmed_platforms?: string[]
          promotion_dismissed_at?: string | null
          promotion_dismissed_by?: string | null
          promotion_dismissed_reason?: string | null
          property_type?: string | null
          public_remarks?: string | null
          source_mls?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          status_changed_at?: string
          unit_number?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          agent_email?: string | null
          agent_name?: string | null
          agent_phone?: string | null
          alliance_role?: string
          bathrooms_full?: number | null
          bathrooms_half?: number | null
          bedrooms?: number | null
          buyer_agent_name?: string | null
          buyer_office_name?: string | null
          city?: string | null
          close_date?: string | null
          close_price?: number | null
          created_at?: string
          dom_days?: number | null
          hero_image_url?: string | null
          id?: string
          list_price?: number | null
          listing_date?: string | null
          listing_office_name?: string | null
          mls_number?: string
          notes?: string | null
          office_id?: string | null
          posts_confirmed_at?: string | null
          posts_confirmed_by?: string | null
          posts_confirmed_platforms?: string[]
          promotion_dismissed_at?: string | null
          promotion_dismissed_by?: string | null
          promotion_dismissed_reason?: string | null
          property_type?: string | null
          public_remarks?: string | null
          source_mls?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          status_changed_at?: string
          unit_number?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      render_schema_cache: {
        Row: {
          created_at: string
          expires_at: string
          format: string
          id: string
          listing_id: string
          schema: Json
        }
        Insert: {
          created_at?: string
          expires_at?: string
          format: string
          id?: string
          listing_id: string
          schema: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          format?: string
          id?: string
          listing_id?: string
          schema?: Json
        }
        Relationships: []
      }
      report_deliveries: {
        Row: {
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at: string
          id: string
          recipient_email: string | null
          recipient_name: string | null
          report_id: string
          sent_at: string | null
          share_token: string
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          view_count: number
          viewed_at: string | null
        }
        Insert: {
          channel?: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          report_id: string
          sent_at?: string | null
          share_token: string
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
          view_count?: number
          viewed_at?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          report_id?: string
          sent_at?: string | null
          share_token?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
          view_count?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_deliveries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_recipients: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string | null
          phone: string | null
          report_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name?: string | null
          phone?: string | null
          report_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          phone?: string | null
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_recipients_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          audience: Json
          auto_send_at: string | null
          cadence: string
          created_at: string
          generated_at: string | null
          id: string
          is_locked: boolean
          kpis: Json
          narrative: Json
          next_send_at: string | null
          period_end: string | null
          period_start: string | null
          personal_note: string | null
          post_ids: string[]
          property_id: string
          report_token: string
          sent_at: string | null
          updated_at: string
          // Phase C.3 — Chromium-rendered Owner Report PDF artifact
        }
        Insert: {
          audience?: Json
          auto_send_at?: string | null
          cadence?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          is_locked?: boolean
          kpis?: Json
          narrative?: Json
          next_send_at?: string | null
          period_end?: string | null
          period_start?: string | null
          personal_note?: string | null
          post_ids?: string[]
          property_id: string
          report_token: string
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          audience?: Json
          auto_send_at?: string | null
          cadence?: string
          created_at?: string
          generated_at?: string | null
          id?: string
          is_locked?: boolean
          kpis?: Json
          narrative?: Json
          next_send_at?: string | null
          period_end?: string | null
          period_start?: string | null
          personal_note?: string | null
          post_ids?: string[]
          property_id?: string
          report_token?: string
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          id: number
          public_app_url: string | null
          publish_test_mode: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          public_app_url?: string | null
          publish_test_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          public_app_url?: string | null
          publish_test_mode?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          error_message: string | null
          feed_id: string | null
          feed_short_code: string | null
          finished_at: string | null
          id: number
          metadata: Json
          property_class: string | null
          records_seen: number
          records_upserted: number
          resource: string
          started_at: string
          status: Database["public"]["Enums"]["sync_run_status"]
        }
        Insert: {
          error_message?: string | null
          feed_id?: string | null
          feed_short_code?: string | null
          finished_at?: string | null
          id?: number
          metadata?: Json
          property_class?: string | null
          records_seen?: number
          records_upserted?: number
          resource: string
          started_at?: string
          status?: Database["public"]["Enums"]["sync_run_status"]
        }
        Update: {
          error_message?: string | null
          feed_id?: string | null
          feed_short_code?: string | null
          finished_at?: string | null
          id?: number
          metadata?: Json
          property_class?: string | null
          records_seen?: number
          records_upserted?: number
          resource?: string
          started_at?: string
          status?: Database["public"]["Enums"]["sync_run_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_feed_id_fkey"
            columns: ["feed_id"]
            isOneToOne: false
            referencedRelation: "mls_feeds"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_owner_story_tokens: { Args: never; Returns: number }
      invoke_edge_function: { Args: { fn_name: string }; Returns: number }
      invoke_mls_rets_sync: { Args: { feed: string }; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      link_property_offices: { Args: never; Returns: number }
      run_auto_linker: {
        Args: never
        Returns: {
          matched_addr_full: number
          matched_addr_partial: number
          matched_mls: number
        }[]
      }
      run_post_grouper: {
        Args: never
        Returns: {
          groups_created: number
          posts_assigned: number
        }[]
      }
    }
    Enums: {
      brand_asset_kind: "logo" | "agent_headshot" | "partner_logo"
      credential_platform:
        | "facebook"
        | "instagram"
        | "tiktok"
        | "claude"
        | "paragon_mls"
        | "bright_mls"
        | "google_drive"
        | "render_token"
      delivery_channel: "email" | "link"
      delivery_status: "pending" | "sent" | "viewed"
      media_type: "image" | "video" | "carousel" | "reel"
      mls_feed_type: "rets" | "reso_web_api"
      post_category:
        | "property"
        | "agent"
        | "educational"
        | "marketing"
        | "community"
        | "sold"
        | "other"
        | "open_house"
      post_group_method: "auto" | "manual"
      post_link_method:
        | "manual"
        | "auto_mls"
        | "auto_address_full"
        | "auto_address_partial"
      post_platform: "facebook" | "instagram" | "tiktok"
      property_status: "active" | "pending" | "sold" | "expired"
      sync_run_status: "running" | "success" | "partial" | "error"
      user_role: "admin" | "user"
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
      brand_asset_kind: ["logo", "agent_headshot", "partner_logo"],
      credential_platform: [
        "facebook",
        "instagram",
        "tiktok",
        "claude",
        "paragon_mls",
        "bright_mls",
        "google_drive",
        "render_token",
      ],
      delivery_channel: ["email", "link"],
      delivery_status: ["pending", "sent", "viewed"],
      media_type: ["image", "video", "carousel", "reel"],
      mls_feed_type: ["rets", "reso_web_api"],
      post_category: [
        "property",
        "agent",
        "educational",
        "marketing",
        "community",
        "sold",
        "other",
        "open_house",
      ],
      post_group_method: ["auto", "manual"],
      post_link_method: [
        "manual",
        "auto_mls",
        "auto_address_full",
        "auto_address_partial",
      ],
      post_platform: ["facebook", "instagram", "tiktok"],
      property_status: ["active", "pending", "sold", "expired"],
      sync_run_status: ["running", "success", "partial", "error"],
      user_role: ["admin", "user"],
    },
  },
} as const
