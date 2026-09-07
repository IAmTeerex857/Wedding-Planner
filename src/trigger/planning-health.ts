import { schedules, task } from "@trigger.dev/sdk";
import { adminClient, saveProposedBatch, structuredResponse, workspaceContext } from "./server";

async function checkWorkspace(workspaceId: string, sourceRef: string) {
  const context = await workspaceContext(workspaceId);
  const batch = await structuredResponse(
    JSON.stringify({ checked_at: new Date().toISOString(), workspace_context: context }),
    "Perform a planning health check. Focus on overdue work, upcoming ceremony risk, budget gaps, and missing vendor coverage. Keep recommendations factual and make only task proposals.",
  );
  const taskOnlyBatch = { ...batch, proposals: batch.proposals.filter((proposal) => proposal.action === "create_task" || proposal.action === "update_task") };
  const saved = await saveProposedBatch({ workspaceId, sourceRef, batch: { ...taskOnlyBatch, summary: taskOnlyBatch.summary } });
  const { error } = await adminClient().from("agent_suggestions").upsert({
    workspace_id: workspaceId,
    run_id: null,
    source_ref: sourceRef,
    suggestion_type: "planning_health",
    title: taskOnlyBatch.summary.slice(0, 240),
    body: taskOnlyBatch.reply,
    priority: "medium",
    status: "open",
    metadata: { batch_id: saved.id, source_ref: sourceRef },
  }, { onConflict: "workspace_id,source_ref", ignoreDuplicates: true });
  if (error) throw new Error(`Could not save planning suggestion: ${error.message}`);
  return { batchId: saved.id, proposalCount: taskOnlyBatch.proposals.length };
}

export const planningHealthCheck = task({
  id: "ido-ai-planning-health-check",
  run: async (payload: { workspaceId: string; sourceRef?: string }) => checkWorkspace(payload.workspaceId, payload.sourceRef ?? `manual:${new Date().toISOString().slice(0, 10)}`),
});

export const weeklyPlanningHealthChecks = schedules.task({
  id: "ido-ai-weekly-planning-health-checks",
  cron: { pattern: "0 17 * * 0", timezone: "Africa/Lagos" },
  run: async (payload: { timestamp: Date }) => {
    const { data, error } = await adminClient().from("workspaces").select("id").is("deleted_at", null);
    if (error) throw new Error(`Could not list workspaces: ${error.message}`);
    const sourceRef = `weekly:${payload.timestamp.toISOString().slice(0, 10)}`;
    const results = [];
    for (const workspace of data ?? []) results.push(await checkWorkspace(workspace.id, sourceRef));
    return { checked: results.length, results };
  },
});
