export const MODEL = "gpt-5.6-luna";

export type ProposalAction = "create_task" | "update_task" | "create_vendor_candidate" | "update_vendor" | "research_vendors" | "create_ceremony" | "set_budget" | "create_budget_allocation" | "create_expense" | "create_module_record";

export type ModuleResource = "ceremony_segment" | "guest" | "guest_invitation" | "vendor_quote" | "vendor_appointment" | "payment_schedule" | "venue" | "food_drink_plan" | "attire" | "traditional_requirement" | "seating_table" | "itinerary_item" | "calendar_entry" | "packing_item" | "gift" | "honeymoon_trip" | "honeymoon_booking";

export type ActionProposal = {
  action: ProposalAction;
  rationale: string;
  target_id: string | null;
  title: string | null;
  description: string | null;
  priority: "very_low" | "low" | "medium" | "high" | "very_high" | null;
  due_at: string | null;
  vendor_name: string | null;
  vendor_category: string | null;
  website: string | null;
  source_url: string | null;
  research_query: string | null;
  research_platforms: Array<"google" | "instagram" | "tiktok"> | null;
  location: string | null;
  ceremony_name: string | null;
  ceremony_kind: string | null;
  ceremony_status: "tentative" | "confirmed" | "completed" | "cancelled" | null;
  starts_at: string | null;
  location_name: string | null;
  guest_capacity: number | null;
  category: string | null;
  amount_minor: number | null;
  currency: string | null;
  expense_status: "planned" | "committed" | "part_paid" | "paid" | "cancelled" | null;
  transaction_date: string | null;
  ceremony_id: string | null;
  vendor_status: "researching" | "shortlisted" | "selected" | "rejected" | "cancelled" | null;
  record_type: ModuleResource | null;
  payload_json: string | null;
};

export type ProposedBatch = {
  reply: string;
  summary: string;
  proposals: ActionProposal[];
};

export const proposedBatchSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    summary: { type: "string" },
    proposals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create_task", "update_task", "create_vendor_candidate", "update_vendor", "research_vendors", "create_ceremony", "set_budget", "create_budget_allocation", "create_expense", "create_module_record"] },
          rationale: { type: "string" },
          target_id: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          priority: { type: ["string", "null"], enum: ["very_low", "low", "medium", "high", "very_high", null] },
          due_at: { type: ["string", "null"] },
          vendor_name: { type: ["string", "null"] },
          vendor_category: { type: ["string", "null"] },
          website: { type: ["string", "null"] },
          source_url: { type: ["string", "null"] },
          research_query: { type: ["string", "null"] },
          research_platforms: { type: ["array", "null"], items: { type: "string", enum: ["google", "instagram", "tiktok"] } },
          location: { type: ["string", "null"] },
          ceremony_name: { type: ["string", "null"] },
          ceremony_kind: { type: ["string", "null"] },
          ceremony_status: { type: ["string", "null"], enum: ["tentative", "confirmed", "completed", "cancelled", null] },
          starts_at: { type: ["string", "null"] },
          location_name: { type: ["string", "null"] },
          guest_capacity: { type: ["number", "null"] },
          category: { type: ["string", "null"] },
          amount_minor: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          expense_status: { type: ["string", "null"], enum: ["planned", "committed", "part_paid", "paid", "cancelled", null] },
          transaction_date: { type: ["string", "null"] },
          ceremony_id: { type: ["string", "null"] },
          vendor_status: { type: ["string", "null"], enum: ["researching", "shortlisted", "selected", "rejected", "cancelled", null] },
          record_type: { type: ["string", "null"], enum: ["ceremony_segment", "guest", "guest_invitation", "vendor_quote", "vendor_appointment", "payment_schedule", "venue", "food_drink_plan", "attire", "traditional_requirement", "seating_table", "itinerary_item", "calendar_entry", "packing_item", "gift", "honeymoon_trip", "honeymoon_booking", null] },
          payload_json: { type: ["string", "null"] },
        },
        required: ["action", "rationale", "target_id", "title", "description", "priority", "due_at", "vendor_name", "vendor_category", "website", "source_url", "research_query", "research_platforms", "location", "ceremony_name", "ceremony_kind", "ceremony_status", "starts_at", "location_name", "guest_capacity", "category", "amount_minor", "currency", "expense_status", "transaction_date", "ceremony_id", "vendor_status", "record_type", "payload_json"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "summary", "proposals"],
  additionalProperties: false,
} as const;

export type AgentTurnPayload = {
  workspaceId: string;
  conversationId: string;
  runId: string;
  messageId: string;
  requesterId: string;
  fileId?: string;
};

export type VendorResearchPayload = {
  workspaceId: string;
  requesterId: string;
  conversationId?: string | null;
  query: string;
  platforms?: Array<"google" | "instagram" | "tiktok">;
  location?: string;
  sourceRef?: string;
};

export type DocumentAnalysisPayload = {
  workspaceId: string;
  requesterId: string;
  fileId: string;
  conversationId: string;
  runId: string;
  messageId: string;
  sourceRef?: string;
};
