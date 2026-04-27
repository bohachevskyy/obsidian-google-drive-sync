import type {
  SyncMetaEntry,
  SyncPlanItem,
  SyncAction,
  LocalFileInfo,
  RemoteFileInfo,
} from "../types";

/**
 * Three-way diff: compare local vault, remote Drive, and previous sync snapshot.
 * Returns a list of sync plan items describing what action to take for each path.
 */
export function computeDiff(
  localFiles: Map<string, LocalFileInfo>,
  remoteFiles: Map<string, RemoteFileInfo>,
  prevSync: Map<string, SyncMetaEntry>
): SyncPlanItem[] {
  const allPaths = new Set<string>();
  for (const path of localFiles.keys()) allPaths.add(path);
  for (const path of remoteFiles.keys()) allPaths.add(path);
  for (const [path, entry] of prevSync.entries()) {
    if (!entry.deleted) allPaths.add(path);
  }
  // Also include tombstoned entries to propagate deletions
  for (const [path, entry] of prevSync.entries()) {
    if (entry.deleted) allPaths.add(path);
  }

  const plan: SyncPlanItem[] = [];

  for (const path of allPaths) {
    const local = localFiles.get(path) || null;
    const remote = remoteFiles.get(path) || null;
    const prev = prevSync.get(path) || null;

    const item = diffPath(path, local, remote, prev);
    if (item.action !== "noop") {
      plan.push(item);
    }
  }

  return plan;
}

function diffPath(
  path: string,
  local: LocalFileInfo | null,
  remote: RemoteFileInfo | null,
  prev: SyncMetaEntry | null
): SyncPlanItem {
  const base: Omit<SyncPlanItem, "action" | "reason"> = {
    path,
    localMtime: local?.mtime ?? null,
    remoteMtime: remote?.mtime ?? null,
    lastSyncMtime: prev?.lastSyncMtime ?? null,
    driveFileId: remote?.driveId ?? prev?.driveFileId ?? null,
  };

  // Handle tombstoned entries (explicitly deleted locally)
  if (prev?.deleted) {
    if (remote && !local) {
      // Local was deleted, remote still exists → delete remote
      return { ...base, action: "delete_remote", reason: "locally deleted (tombstone)" };
    }
    if (!remote && !local) {
      // Both gone, clean up
      return { ...base, action: "noop", reason: "both deleted" };
    }
    if (local) {
      // File was re-created locally after deletion
      return { ...base, action: "upload", reason: "re-created after deletion" };
    }
  }

  // CASE 1: File in all three (known file)
  if (local && remote && prev && !prev.deleted) {
    const localChanged = !mtimeEqual(local.mtime, prev.lastSyncMtime);
    const remoteChanged = !mtimeEqual(remote.mtime, prev.lastSyncMtime);

    if (!localChanged && !remoteChanged) {
      return { ...base, action: "noop", reason: "unchanged" };
    }
    if (localChanged && !remoteChanged) {
      return { ...base, action: "upload", reason: "local modified" };
    }
    if (!localChanged && remoteChanged) {
      return { ...base, action: "download", reason: "remote modified" };
    }
    // Both changed
    return { ...base, action: "conflict", reason: "both modified since last sync" };
  }

  // CASE 2: Local + prevSync, no remote (remote deleted?)
  if (local && prev && !prev.deleted && !remote) {
    const localChanged = !mtimeEqual(local.mtime, prev.lastSyncMtime);
    if (!localChanged) {
      return { ...base, action: "delete_local", reason: "deleted remotely" };
    }
    // Local modified but remote deleted — conflict, default to re-upload
    return { ...base, action: "upload", reason: "local modified, remote deleted — re-uploading" };
  }

  // CASE 3: Remote + prevSync, no local (local deleted?)
  if (remote && prev && !prev.deleted && !local) {
    const remoteChanged = !mtimeEqual(remote.mtime, prev.lastSyncMtime);
    if (!remoteChanged) {
      return { ...base, action: "delete_remote", reason: "deleted locally" };
    }
    // Remote modified but local deleted — conflict, default to re-download
    return { ...base, action: "download", reason: "remote modified, local deleted — re-downloading" };
  }

  // CASE 4: Local only, new file
  if (local && !prev && !remote) {
    return { ...base, action: "upload", reason: "new local file" };
  }

  // CASE 5: Remote only, new file (from another device)
  if (remote && !prev && !local) {
    return { ...base, action: "download", reason: "new remote file" };
  }

  // CASE 6: prevSync only (both sides deleted)
  if (!local && !remote && prev) {
    return { ...base, action: "noop", reason: "both deleted, cleanup" };
  }

  // CASE 7: Local AND remote, but no prevSync (created independently on both sides)
  if (local && remote && !prev) {
    return { ...base, action: "conflict", reason: "exists on both sides, no sync history" };
  }

  return { ...base, action: "noop", reason: "unhandled case" };
}

/**
 * Compare mtimes with 1-second tolerance (Google Drive has second-level precision).
 */
function mtimeEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1000;
}
