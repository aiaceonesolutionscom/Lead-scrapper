export interface Search {
  id: string;
  keyword: string;
  country: string;
  city: string | null;
  search_mode: 'city' | 'country';
  requested_count: number;
  discovered_count: number;
  enriched_count: number;
  status: 'pending' | 'discovering' | 'enriching' | 'completed' | 'partially_completed' | 'failed' | 'cancelled';
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** In-app notification shown in the sidebar bell. */
export interface AppNotification {
  id: string;
  user_id: string;
  type: 'search' | 'info' | 'warning' | 'announcement';
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

/** Support chat thread (user-opened, admin-replied). */
export interface SupportThread {
  id: string;
  user_id: string;
  subject: string;
  status: 'open' | 'closed';
  /** Filled by list endpoints: message count, latest message + author/role. */
  message_count?: number;
  last_message?: string | null;
  last_message_at?: string | null;
  user_username?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  user_id: string;
  role: 'admin' | 'user';
  username: string;
  body: string;
  created_at: string;
}

export interface Lead {
  id: string;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  phone_valid: boolean;
  phone_country: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  status: 'new' | 'contacted' | 'interested' | 'follow_up' | 'converted' | 'archived';
  notes: string | null;
  confidence: string | null;
  verified: boolean;
  last_checked: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  lead_id: string;
  field_name: string;
  field_value: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  created_at: string;
}

export interface SearchLead {
  id: string;
  search_id: string;
  lead_id: string;
  discovered_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  note: string;
  created_at: string;
}

export interface DiscoveryBusiness {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  country_code?: string;
  website?: string;
  phone?: string;
  email?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  latitude?: number;
  longitude?: number;
  source: string;
  source_url?: string;
  category?: string;
}

export interface EnrichedBusiness extends DiscoveryBusiness {
  phone_valid?: boolean;
  phone_country?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  contact_person?: string;
  confidence?: string;
  verified?: boolean;
  relevant?: boolean;
  sources: Record<string, { value: string | null; source: string; confidence: 'high' | 'medium' | 'low' }>;
}

/**
 * Storage contract required by the extraction engine. The engine is DB-agnostic:
 * callers inject an implementation (the local SQLite store in `server/`).
 * Runtime behaviour is identical regardless of backend.
 */
export interface ExtractionStore {
  getStatus(searchId: string): Promise<string>;
  updateSearch(searchId: string, updates: Partial<Search>): Promise<void>;
  upsertLead(biz: EnrichedBusiness): Promise<Lead | null>;
  linkSearchLead(searchId: string, leadId: string): Promise<void>;
}

export interface SearchResult {
  search_id: string;
  status: string;
  discovered_count: number;
  enriched_count: number;
  requested_count: number;
  leads: Lead[];
}

export interface DashboardStats {
  total_searches: number;
  total_leads: number;
  verified_leads: number;
  new_leads: number;
  contacted_leads: number;
  converted_leads: number;
}

export interface ExportData {
  business_name: string;
  contact_person: string;
  phone: string;
  phone_country: string;
  email: string;
  website: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  address: string;
  city: string;
  country: string;
  location_url: string;
  category: string;
  confidence: string;
  verified: string;
  status: string;
  created_date: string;
}
