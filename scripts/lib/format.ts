import type { RemoteControlClient, Thread, ThreadStatus, Turn } from "./protocol.ts";
import { assertNever } from "./result.ts";

const TITLE_WIDTH = 70;

export function statusLabel(status: ThreadStatus): string {
  switch (status.type) {
    case "notLoaded":
      return "notLoaded";
    case "idle":
      return "idle";
    case "systemError":
      return "systemError";
    case "active":
      return status.activeFlags.length > 0 ? `active[${status.activeFlags.join(",")}]` : "active";
    default:
      return assertNever(status);
  }
}

export function formatThreadLine(thread: Thread): string {
  const title = (thread.name ?? "") || thread.preview.split("\n")[0] || "(untitled)";
  return [
    `[${thread.source ?? "?"}]`,
    thread.id,
    title.slice(0, TITLE_WIDTH),
    statusLabel(thread.status),
  ].join(" | ");
}

// The concatenated agent reply of one turn — what "how did it go?" asks for.
export function turnAgentText(turn: Turn): string {
  return turn.items
    .filter((item) => item["type"] === "agentMessage" && typeof item["text"] === "string")
    .map((item) => String(item["text"]))
    .join("\n");
}

export function formatClientLine(client: RemoteControlClient): string {
  const device = [client.deviceType, client.platform, client.osVersion, client.deviceModel]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
  const lastSeen =
    client.lastSeenAt == null ? "never" : new Date(client.lastSeenAt * 1000).toISOString();
  return [
    client.clientId,
    client.displayName ?? "(unnamed)",
    device === "" ? "(unknown device)" : device,
    `app ${client.appVersion ?? "?"}`,
    `lastSeen ${lastSeen}`,
  ].join(" | ");
}
