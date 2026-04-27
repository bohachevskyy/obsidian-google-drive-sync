import type { SyncPlanItem, ConflictStrategy } from "../types";
import { resolveConflicts } from "./conflict";

/**
 * Takes raw diff results, resolves conflicts, and orders actions for execution.
 * Order: create folders → downloads → uploads → deletions
 */
export function buildSyncPlan(
  rawPlan: SyncPlanItem[],
  conflictStrategy: ConflictStrategy
): SyncPlanItem[] {
  // Resolve conflicts
  const resolved = resolveConflicts(rawPlan, conflictStrategy);

  // Separate by action type for ordering
  const downloads: SyncPlanItem[] = [];
  const uploads: SyncPlanItem[] = [];
  const deleteLocal: SyncPlanItem[] = [];
  const deleteRemote: SyncPlanItem[] = [];
  const conflicts: SyncPlanItem[] = []; // unresolved (ask strategy)

  for (const item of resolved) {
    switch (item.action) {
      case "download":
        downloads.push(item);
        break;
      case "upload":
        uploads.push(item);
        break;
      case "delete_local":
        deleteLocal.push(item);
        break;
      case "delete_remote":
        deleteRemote.push(item);
        break;
      case "conflict":
        conflicts.push(item);
        break;
    }
  }

  // Sort paths within each group for deterministic ordering
  const sortByPath = (a: SyncPlanItem, b: SyncPlanItem) =>
    a.path.localeCompare(b.path);

  downloads.sort(sortByPath);
  uploads.sort(sortByPath);
  deleteLocal.sort(sortByPath);
  deleteRemote.sort(sortByPath);

  // Execute order: downloads first (get latest), uploads, then deletions last
  return [...downloads, ...uploads, ...deleteLocal, ...deleteRemote, ...conflicts];
}
