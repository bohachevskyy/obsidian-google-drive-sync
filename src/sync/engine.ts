import type { Vault, TFile } from "obsidian";
import type { GDriveClient } from "../gdrive/client";
import type { EncryptionService } from "../crypto/encryption";
import type {
  GDriveSyncSettings,
  SyncProgress,
  LocalFileInfo,
  RemoteFileInfo,
  SyncMetaEntry,
  SyncLogEntry,
} from "../types";
import { SyncStateManager } from "./state";
import { computeDiff } from "./differ";
import { buildSyncPlan } from "./planner";
import { SyncExecutor } from "./executor";

/**
 * Main sync orchestrator: gather → diff → plan → execute → finalize.
 */
export class SyncEngine {
  private isSyncing = false;
  private executor: SyncExecutor | null = null;

  constructor(
    private vault: Vault,
    private driveClient: GDriveClient,
    private stateManager: SyncStateManager,
    private settings: GDriveSyncSettings,
    private encryption: EncryptionService | null,
    private logger: (msg: string) => void
  ) {}

  get syncing(): boolean {
    return this.isSyncing;
  }

  updateSettings(settings: GDriveSyncSettings): void {
    this.settings = settings;
  }

  updateEncryption(encryption: EncryptionService | null): void {
    this.encryption = encryption;
  }

  abort(): void {
    this.executor?.abort();
  }

  /**
   * Run a full sync cycle.
   */
  async sync(
    onProgress?: (progress: SyncProgress) => void,
    forceFullSync = false
  ): Promise<SyncLogEntry[]> {
    if (this.isSyncing) {
      throw new Error("Sync already in progress");
    }

    this.isSyncing = true;
    try {
      return await this.doSync(onProgress, forceFullSync);
    } finally {
      this.isSyncing = false;
    }
  }

  private async doSync(
    onProgress?: (progress: SyncProgress) => void,
    forceFullSync = false
  ): Promise<SyncLogEntry[]> {
    this.logger("Starting sync...");

    // 1. Ensure root folder
    onProgress?.({
      phase: "gathering",
      total: 0,
      completed: 0,
      currentFile: "Connecting to Google Drive...",
      errors: [],
    });

    const rootFolderId = await this.driveClient.ensureRootFolder(
      this.settings.driveFolderName
    );
    this.stateManager.state.driveRootFolderId = rootFolderId;

    // 2. Gather local files
    onProgress?.({
      phase: "gathering",
      total: 0,
      completed: 0,
      currentFile: "Scanning local vault...",
      errors: [],
    });

    const localFiles = await this.gatherLocalFiles();
    this.logger(`Found ${localFiles.size} local files`);

    // 3. Gather remote files
    onProgress?.({
      phase: "gathering",
      total: 0,
      completed: 0,
      currentFile: "Scanning Google Drive...",
      errors: [],
    });

    const remoteFiles = await this.gatherRemoteFiles(rootFolderId);
    this.logger(`Found ${remoteFiles.size} remote files`);

    // 4. Load previous sync state
    const prevSync = new Map<string, SyncMetaEntry>();
    if (!forceFullSync) {
      for (const [path, entry] of Object.entries(this.stateManager.state.entries)) {
        prevSync.set(path, entry);
      }
    }
    this.logger(`Previous sync state: ${prevSync.size} entries`);

    // 5. Compute diff
    onProgress?.({
      phase: "diffing",
      total: 0,
      completed: 0,
      currentFile: "Computing changes...",
      errors: [],
    });

    const rawDiff = computeDiff(localFiles, remoteFiles, prevSync);
    this.logger(`Diff result: ${rawDiff.length} changes`);

    if (rawDiff.length === 0) {
      this.logger("No changes to sync");
      this.stateManager.state.lastFullSync = Date.now();
      await this.stateManager.save();
      onProgress?.({
        phase: "done",
        total: 0,
        completed: 0,
        currentFile: "",
        errors: [],
      });
      return [];
    }

    // 6. Build ordered plan
    const plan = buildSyncPlan(rawDiff, this.settings.conflictStrategy);
    this.logger(`Sync plan: ${plan.length} actions`);
    for (const item of plan) {
      this.logger(`  ${item.action}: ${item.path} (${item.reason})`);
    }

    // 7. Execute
    const folderCache = new Map<string, string>();
    this.executor = new SyncExecutor(
      this.vault,
      this.driveClient,
      this.stateManager,
      this.settings,
      this.encryption,
      folderCache,
      rootFolderId,
      onProgress,
      (msg) => this.logger(msg)
    );

    const log = await this.executor.execute(plan);
    this.executor = null;

    // 8. Finalize
    const pruned = this.stateManager.pruneTombstones(
      this.settings.tombstoneRetentionDays
    );
    if (pruned > 0) {
      this.logger(`Pruned ${pruned} expired tombstones`);
    }

    const prunedLogs = this.stateManager.pruneOldLogEntries();
    if (prunedLogs > 0) {
      this.logger(`Pruned ${prunedLogs} log entries older than 7 days`);
    }

    this.stateManager.state.lastFullSync = Date.now();
    await this.stateManager.save();

    const successes = log.filter((e) => e.success).length;
    const failures = log.filter((e) => !e.success).length;
    this.logger(`Sync complete: ${successes} succeeded, ${failures} failed`);

    return log;
  }

  private async gatherLocalFiles(): Promise<Map<string, LocalFileInfo>> {
    const files = new Map<string, LocalFileInfo>();
    const allFiles = this.vault.getFiles();

    for (const file of allFiles) {
      if (this.shouldExclude(file.path)) continue;
      if (file.stat.size > this.settings.maxFileSizeMB * 1024 * 1024) continue;

      files.set(file.path, {
        path: file.path,
        mtime: file.stat.mtime,
        size: file.stat.size,
      });
    }

    return files;
  }

  private async gatherRemoteFiles(
    rootFolderId: string
  ): Promise<Map<string, RemoteFileInfo>> {
    const driveFiles = await this.driveClient.listAllFilesRecursive(rootFolderId);
    const files = new Map<string, RemoteFileInfo>();

    for (const [path, driveFile] of driveFiles) {
      if (this.shouldExclude(path)) continue;

      files.set(path, {
        path,
        driveId: driveFile.id,
        mtime: new Date(driveFile.modifiedTime).getTime(),
        size: parseInt(driveFile.size || "0", 10),
        md5: driveFile.md5Checksum,
      });
    }

    return files;
  }

  private shouldExclude(path: string): boolean {
    // Always exclude plugin's own data
    if (path === ".obsidian/plugins/obsidian-gdrive-sync/data.json") {
      return true;
    }

    // Check .obsidian exclusion
    if (path.startsWith(".obsidian/")) {
      if (!this.settings.syncDotObsidian) return true;

      for (const pattern of this.settings.dotObsidianExcludes) {
        if (matchPattern(path, pattern)) return true;
      }
    }

    // Check user exclusion patterns
    for (const pattern of this.settings.excludePatterns) {
      if (matchPattern(path, pattern)) return true;
    }

    return false;
  }
}

/**
 * Simple glob-like pattern matching.
 * Supports * (any chars in one segment) and ** (any path segments).
 */
function matchPattern(path: string, pattern: string): boolean {
  // Exact match
  if (path === pattern) return true;

  // Simple prefix match (pattern ending with /)
  if (pattern.endsWith("/") && path.startsWith(pattern)) return true;

  // Convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§") // placeholder
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");

  try {
    return new RegExp(`^${regexStr}$`).test(path);
  } catch {
    return false;
  }
}
