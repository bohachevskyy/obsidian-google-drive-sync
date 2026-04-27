import type GDriveSyncPlugin from "../main";
import type { SyncState, SyncMetaEntry, SyncLogEntry } from "../types";

const SYNC_STATE_KEY = "syncState";
const SYNC_LOG_KEY = "syncLog";
const MAX_LOG_ENTRIES = 500;

/**
 * Generate a random device identifier.
 */
function generateDeviceId(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createEmptySyncState(): SyncState {
  return {
    version: 1,
    lastFullSync: null,
    entries: {},
    driveRootFolderId: null,
    deviceId: generateDeviceId(),
  };
}

/**
 * Manages sync state persistence.
 */
export class SyncStateManager {
  state: SyncState;
  private log: SyncLogEntry[] = [];

  constructor(private plugin: GDriveSyncPlugin) {
    this.state = createEmptySyncState();
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data && data[SYNC_STATE_KEY]) {
      this.state = data[SYNC_STATE_KEY];
    }
    if (data && data[SYNC_LOG_KEY]) {
      this.log = data[SYNC_LOG_KEY];
    }
  }

  async save(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data[SYNC_STATE_KEY] = this.state;
    data[SYNC_LOG_KEY] = this.log;
    await this.plugin.saveData(data);
  }

  getEntry(path: string): SyncMetaEntry | undefined {
    return this.state.entries[path];
  }

  setEntry(path: string, entry: SyncMetaEntry): void {
    this.state.entries[path] = entry;
  }

  removeEntry(path: string): void {
    delete this.state.entries[path];
  }

  /**
   * Mark a path as deleted (tombstone).
   */
  markDeleted(path: string): void {
    const existing = this.state.entries[path];
    if (existing) {
      existing.deleted = true;
      existing.deletedAt = Date.now();
      existing.localMtime = null;
    } else {
      this.state.entries[path] = {
        path,
        localMtime: null,
        remoteMtime: null,
        driveFileId: null,
        lastSyncMtime: 0,
        lastSyncTime: Date.now(),
        contentHash: null,
        deleted: true,
        deletedAt: Date.now(),
        size: 0,
        encrypted: false,
      };
    }
  }

  /**
   * Handle file rename: move entry from old path to new path.
   */
  handleRename(oldPath: string, newPath: string): void {
    const entry = this.state.entries[oldPath];
    if (entry) {
      entry.path = newPath;
      this.state.entries[newPath] = entry;
      delete this.state.entries[oldPath];
      // Also mark old path as deleted so remote copy gets cleaned up
      this.markDeleted(oldPath);
    }
  }

  /**
   * Prune expired tombstones.
   */
  pruneTombstones(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const [path, entry] of Object.entries(this.state.entries)) {
      if (entry.deleted && entry.deletedAt && entry.deletedAt < cutoff) {
        delete this.state.entries[path];
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Get all non-deleted entries.
   */
  getActiveEntries(): SyncMetaEntry[] {
    return Object.values(this.state.entries).filter((e) => !e.deleted);
  }

  /**
   * Get all entries including deleted (tombstones).
   */
  getAllEntries(): SyncMetaEntry[] {
    return Object.values(this.state.entries);
  }

  // --- Sync log ---

  addLogEntry(entry: SyncLogEntry): void {
    this.log.push(entry);
    if (this.log.length > MAX_LOG_ENTRIES) {
      this.log = this.log.slice(-MAX_LOG_ENTRIES);
    }
  }

  getLog(): SyncLogEntry[] {
    return [...this.log];
  }

  clearLog(): void {
    this.log = [];
  }
}
