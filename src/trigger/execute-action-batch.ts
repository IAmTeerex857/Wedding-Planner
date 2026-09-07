import { task, tasks } from "@trigger.dev/sdk";
import { adminClient } from "./server";

type ExecuteBatchPayload = {
  workspaceId: string;
  batchId: string;
  requesterId: string;
};

type AgentAction = {
  id: string;
  action_type: "create" | "update";
  resource_type: "task" | "vendor" | "vendor_research" | "ceremony" | "budget" | "budget_allocation" | "expense";
  target_id: string | null;
  payload: Record<string, unknown>;
  status: "approved" | "executing";
};

export const executeActionBatch = task({
  id: "ido-ai-execute-action-batch",
  queue: { concurrencyLimit: 5 },
  run: async (payload: ExecuteBatchPayload) => {
    const admin = adminClient();
    const { data, error } = await admin
      .from("agent_actions")
      .select("id,action_type,resource_type,target_id,payload,status")
      .eq("workspace_id", payload.workspaceId)
      .eq("batch_id", payload.batchId)
      .in("status", ["approved", "executing"])
      .order("position");
    if (error) throw new Error(`Could not load approved actions: ${error.message}`);

    for (const action of (data ?? []) as AgentAction[]) {
      if (action.resource_type === "vendor_research") {
        if (action.status === "approved") await setActionStatus(action.id, "executing");
        const result = await executeResearch(payload, action);
        await setActionStatus(action.id, "executed", result);
      } else {
        const { error: executionError } = await admin.rpc("execute_agent_domain_action", { target_action_id: action.id, requester_id: payload.requesterId });
        if (executionError) throw executionError;
      }
    }
    return { batchId: payload.batchId, actionsProcessed: data?.length ?? 0 };
  },
  onFailure: async ({ payload, error }: { payload: ExecuteBatchPayload; error: unknown }) => {
    const admin = adminClient();
    const { data } = await admin.from("agent_actions").select("id,status").eq("workspace_id", payload.workspaceId).eq("batch_id", payload.batchId).in("status", ["approved", "executing"]);
    const message = error instanceof Error ? error.message : "Action execution failed after retries";
    for (const action of data ?? []) await setActionStatus(action.id, "failed", undefined, message);
  },
});

async function executeResearch(batch: ExecuteBatchPayload, action: AgentAction) {
  const admin = adminClient();
  const query = requiredString(action.payload.query, "Research query");
  const { data: parentBatch, error } = await admin.from("agent_action_batches").select("conversation_id").eq("id", batch.batchId).eq("workspace_id", batch.workspaceId).single();
  if (error) throw error;
  const handle = await tasks.triggerAndWait("ido-ai-vendor-research", {
    workspaceId: batch.workspaceId,
    requesterId: batch.requesterId,
    conversationId: parentBatch.conversation_id,
    query,
    location: optionalString(action.payload.location),
    sourceRef: action.id,
  }, { idempotencyKey: action.id });
  if (!handle.ok) throw new Error("Vendor research did not complete successfully");
  return { triggerRunId: handle.id };
}

async function setActionStatus(id: string, status: "executing" | "executed" | "failed", result?: Record<string, unknown>, errorMessage?: string) {
  const { error } = await adminClient().rpc("record_agent_action_execution", {
    target_action_id: id,
    execution_status: status,
    result: result ?? null,
    error_message: errorMessage ?? null,
  });
  if (error) throw new Error(`Could not record action ${status}: ${error.message}`);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
