import type { SyncPlanItem, ConflictStrategy } from "../types";

/**
 * Resolve conflicts in the sync plan according to the chosen strategy.
 * Mutates the plan items in place (changes action from 'conflict' to a concrete action).
 */
export function resolveConflicts(
  plan: SyncPlanItem[],
  strategy: ConflictStrategy
): SyncPlanItem[] {
  const resolved: SyncPlanItem[] = [];
  const deferred: SyncPlanItem[] = [];

  for (const item of plan) {
    if (item.action !== "conflict") {
      resolved.push(item);
      continue;
    }

    switch (strategy) {
      case "keep_newer":
        resolved.push(resolveKeepNewer(item));
        break;
      case "keep_local":
        resolved.push({ ...item, action: "upload", reason: item.reason + " → keeping local" });
        break;
      case "keep_remote":
        resolved.push({ ...item, action: "download", reason: item.reason + " → keeping remote" });
        break;
      case "keep_both":
        resolved.push(
          { ...item, action: "download", reason: item.reason + " → downloading remote as conflict copy" }
        );
        // The executor will rename the local file before downloading
        break;
      case "ask":
        // Keep as conflict — the executor will queue these for user interaction
        deferred.push(item);
        break;
    }
  }

  return [...resolved, ...deferred];
}

function resolveKeepNewer(item: SyncPlanItem): SyncPlanItem {
  const localTime = item.localMtime ?? 0;
  const remoteTime = item.remoteMtime ?? 0;

  if (localTime >= remoteTime) {
    return { ...item, action: "upload", reason: item.reason + " → local is newer" };
  }
  return { ...item, action: "download", reason: item.reason + " → remote is newer" };
}

/**
 * Generate a conflict-copy filename.
 * e.g., "notes/todo.md" → "notes/todo.conflict-abc123-1704067200.md"
 */
export function conflictCopyPath(
  originalPath: string,
  deviceId: string
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const lastDot = originalPath.lastIndexOf(".");
  if (lastDot === -1) {
    return `${originalPath}.conflict-${deviceId}-${timestamp}`;
  }
  const base = originalPath.substring(0, lastDot);
  const ext = originalPath.substring(lastDot);
  return `${base}.conflict-${deviceId}-${timestamp}${ext}`;
}
