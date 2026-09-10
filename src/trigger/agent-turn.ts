import { task } from "@trigger.dev/sdk";
import type { AgentTurnPayload } from "./contracts";
import { adminClient, assertMembership, saveAssistantReply, saveProposedBatch, structuredResponse, workspaceContext } from "./server";

export const agentTurn = task({
  id: "ido-ai-agent-turn",
  queue: { concurrencyLimit: 5 },
  run: async (payload: AgentTurnPayload) => {
    await assertMembership(payload.workspaceId, payload.requesterId);
    const admin = adminClient();
    const { data: message, error } = await admin.from("agent_messages").select("id,content,created_by,conversation_id,run_id").eq("id", payload.messageId).eq("workspace_id", payload.workspaceId).eq("role", "user").single();
    if (error || !message || message.created_by !== payload.requesterId) throw new Error("Queued message is unavailable");
    if (message.conversation_id !== payload.conversationId || message.run_id !== payload.runId) throw new Error("Queued message scope is invalid");
    await admin.from("agent_runs").update({ status: "running", model: "gpt-5.6-luna", started_at: new Date().toISOString() }).eq("id", payload.runId).eq("workspace_id", payload.workspaceId);

    const [context, historyResult, profileResult] = await Promise.all([
      workspaceContext(payload.workspaceId),
      admin.from("agent_messages").select("role,content,metadata,created_at").eq("workspace_id", payload.workspaceId).eq("conversation_id", payload.conversationId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(30),
      admin.from("agent_planning_profiles").select("wedding_date,priorities,preferences,constraints,onboarding_answers").eq("workspace_id", payload.workspaceId).maybeSingle(),
    ]);
    if (historyResult.error || profileResult.error) throw new Error("Could not load agent memory");
    const contextInput = JSON.stringify({
      user_message: message.content,
      recent_conversation: (historyResult.data ?? []).reverse(),
      planning_profile: profileResult.data,
      workspace_context: context,
    });
    let userContent: unknown = contextInput;
    if (payload.fileId) {
      const { data: file, error: fileError } = await admin.from("files").select("id,bucket_id,storage_path,original_name,mime_type,size_bytes").eq("id", payload.fileId).eq("workspace_id", payload.workspaceId).is("deleted_at", null).single();
      if (fileError || !file || !file.mime_type.startsWith("image/")) throw new Error("Attached image is unavailable");
      if (Number(file.size_bytes) > 10 * 1024 * 1024) throw new Error("Attached image exceeds the 10 MB limit");
      const { data: signed, error: signedError } = await admin.storage.from(file.bucket_id).createSignedUrl(file.storage_path, 300);
      if (signedError || !signed) throw new Error("Could not create a private image URL");
      userContent = [
        { type: "input_text", text: contextInput },
        { type: "input_image", image_url: signed.signedUrl },
      ];
    }
    const batch = await structuredResponse(userContent);
    const savedBatch = await saveProposedBatch({ workspaceId: payload.workspaceId, conversationId: payload.conversationId, runId: payload.runId, requesterId: payload.requesterId, batch });
    const reply = await saveAssistantReply({ workspaceId: payload.workspaceId, conversationId: payload.conversationId, runId: payload.runId, replyToId: message.id, content: batch.reply });
    const { error: completionError } = await admin.from("agent_runs").update({ status: "completed", output: { message_id: reply.id, batch_id: savedBatch.id }, completed_at: new Date().toISOString() }).eq("id", payload.runId).eq("workspace_id", payload.workspaceId);
    if (completionError) throw new Error(`Could not complete agent run: ${completionError.message}`);
    return { messageId: reply.id, batchId: savedBatch.id, proposalCount: batch.proposals.length };
  },
  onFailure: async ({ payload }: { payload: AgentTurnPayload }) => {
    const { error } = await adminClient().from("agent_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", payload.runId).eq("workspace_id", payload.workspaceId);
    if (error) console.error("Could not persist failed agent run", error.message);
  },
});
