import type { Vault, TFile, TAbstractFile } from "obsidian";
import type { GDriveClient } from "../gdrive/client";
import type { SyncStateManager } from "./state";
import type { EncryptionService } from "../crypto/encryption";
import type {
  SyncPlanItem,
  SyncMetaEntry,
  SyncLogEntry,
  SyncProgress,
  GDriveSyncSettings,
} from "../types";
import { conflictCopyPath } from "./conflict";
import { SYNC_CONCURRENCY } from "../constants";

/**
 * Executes a sync plan: uploads, downloads, and deletes files.
 */
export class SyncExecutor {
  private aborted = false;

  constructor(
    private vault: Vault,
    private driveClient: GDriveClient,
    private stateManager: SyncStateManager,
    private settings: GDriveSyncSettings,
    private encryption: EncryptionService | null,
    private folderCache: Map<string, string>,
    private rootFolderId: string,
    private onProgress?: (progress: SyncProgress) => void,
    private logger?: (msg: string) => void
  ) {}

  abort(): void {
    this.aborted = true;
  }

  async execute(plan: SyncPlanItem[]): Promise<SyncLogEntry[]> {
    const log: SyncLogEntry[] = [];
    const total = plan.length;
    let completed = 0;

    // Process with concurrency limit
    const queue = [...plan];
    const running: Promise<void>[] = [];

    const processItem = async (item: SyncPlanItem): Promise<void> => {
      if (this.aborted) return;

      this.reportProgress("executing", total, completed, item.path);

      const entry: SyncLogEntry = {
        action: item.action,
        path: item.path,
        timestamp: Date.now(),
        success: false,
      };

      try {
        switch (item.action) {
          case "upload":
            await this.executeUpload(item);
            break;
          case "download":
            await this.executeDownload(item);
            break;
          case "delete_local":
            await this.executeDeleteLocal(item);
            break;
          case "delete_remote":
            await this.executeDeleteRemote(item);
            break;
          case "conflict":
            // Unresolved conflict (ask strategy) — skip for now
            this.log(`CONFLICT (unresolved): ${item.path} — ${item.reason}`);
            entry.error = "Unresolved conflict";
            log.push(entry);
            return;
        }
        entry.success = true;
        this.log(`${item.action.toUpperCase()}: ${item.path}`);
      } catch (err) {
        entry.error = (err as Error).message;
        this.log(`ERROR ${item.action}: ${item.path} — ${entry.error}`);
      }

      log.push(entry);
      this.stateManager.addLogEntry(entry);
      completed++;
    };

    for (const item of queue) {
      if (this.aborted) break;

      if (running.length >= SYNC_CONCURRENCY) {
        await Promise.race(running);
        // Remove completed promises
        for (let i = running.length - 1; i >= 0; i--) {
          // Check if resolved by trying to race with an immediate resolve
          const resolved = await Promise.race([
            running[i].then(() => true),
            Promise.resolve(false),
          ]);
          if (resolved) {
            running.splice(i, 1);
          }
        }
      }

      const promise = processItem(item).catch(() => {});
      running.push(promise);
    }

    // Wait for remaining
    await Promise.all(running);

    this.reportProgress("done", total, completed, "");
    return log;
  }

  private async executeUpload(item: SyncPlanItem): Promise<void> {
    const file = this.vault.getAbstractFileByPath(item.path);
    if (!file || !("stat" in file)) {
      throw new Error(`File not found in vault: ${item.path}`);
    }

    let content = await this.vault.readBinary(file as TFile);
    const encrypted = !!(this.settings.enableEncryption && this.encryption);

    if (encrypted && this.encryption) {
      content = await this.encryption.encrypt(content);
    }

    // Ensure parent folders exist
    const parentPath = getParentPath(item.path);
    let parentId = this.rootFolderId;
    if (parentPath) {
      const parts = parentPath.split("/");
      parentId = await this.driveClient.ensureFolderPath(
        parts,
        this.rootFolderId,
        this.folderCache
      );
    }

    const fileName = getFileName(item.path);
    let driveFile;

    if (item.driveFileId) {
      // Update existing file
      driveFile = await this.driveClient.updateFile(item.driveFileId, content);
    } else {
      // Create new file
      driveFile = await this.driveClient.uploadFile(
        fileName,
        parentId,
        content
      );
    }

    // Update sync state
    const tfile = file as TFile;
    const hash = await computeHash(await this.vault.readBinary(tfile));
    const remoteMtime = new Date(driveFile.modifiedTime).getTime();

    this.stateManager.setEntry(item.path, {
      path: item.path,
      localMtime: tfile.stat.mtime,
      remoteMtime,
      driveFileId: driveFile.id,
      lastSyncMtime: tfile.stat.mtime,
      lastSyncTime: Date.now(),
      contentHash: hash,
      deleted: false,
      deletedAt: null,
      size: tfile.stat.size,
      encrypted,
    });
  }

  private async executeDownload(item: SyncPlanItem): Promise<void> {
    if (!item.driveFileId) {
      throw new Error(`No drive file ID for download: ${item.path}`);
    }

    // For keep_both conflict: rename local file before downloading
    if (
      this.settings.conflictStrategy === "keep_both" &&
      item.reason.includes("conflict copy")
    ) {
      const existingFile = this.vault.getAbstractFileByPath(item.path);
      if (existingFile) {
        const copyPath = conflictCopyPath(
          item.path,
          this.stateManager.state.deviceId
        );
        await this.vault.rename(existingFile, copyPath);
      }
    }

    let content = await this.driveClient.downloadFile(item.driveFileId);

    // Check if we need to decrypt
    const prevEntry = this.stateManager.getEntry(item.path);
    const isEncrypted = prevEntry?.encrypted ?? this.settings.enableEncryption;

    if (isEncrypted && this.encryption) {
      content = await this.encryption.decrypt(content);
    }

    // Ensure parent directory exists in vault
    const parentPath = getParentPath(item.path);
    if (parentPath) {
      await ensureVaultFolder(this.vault, parentPath);
    }

    // Write file to vault
    const existing = this.vault.getAbstractFileByPath(item.path);
    if (existing && "stat" in existing) {
      await this.vault.modifyBinary(existing as TFile, content);
    } else {
      await this.vault.createBinary(item.path, content);
    }

    // Get the written file's stat
    const written = this.vault.getAbstractFileByPath(item.path) as TFile;
    const hash = await computeHash(content);

    this.stateManager.setEntry(item.path, {
      path: item.path,
      localMtime: written?.stat?.mtime ?? Date.now(),
      remoteMtime: item.remoteMtime,
      driveFileId: item.driveFileId,
      lastSyncMtime: written?.stat?.mtime ?? Date.now(),
      lastSyncTime: Date.now(),
      contentHash: hash,
      deleted: false,
      deletedAt: null,
      size: content.byteLength,
      encrypted: isEncrypted,
    });
  }

  private async executeDeleteLocal(item: SyncPlanItem): Promise<void> {
    if (this.settings.deletionBehavior === "keep") {
      this.log(`SKIP delete_local (keep mode): ${item.path}`);
      return;
    }

    const file = this.vault.getAbstractFileByPath(item.path);
    if (file) {
      if (this.settings.deletionBehavior === "trash") {
        await this.vault.trash(file, true); // system trash
      } else {
        await this.vault.delete(file);
      }
    }

    this.stateManager.removeEntry(item.path);
  }

  private async executeDeleteRemote(item: SyncPlanItem): Promise<void> {
    if (!item.driveFileId) {
      // Nothing to delete remotely
      this.stateManager.removeEntry(item.path);
      return;
    }

    const permanent = this.settings.deletionBehavior === "sync";
    await this.driveClient.deleteFile(item.driveFileId, permanent);
    this.stateManager.removeEntry(item.path);
  }

  private reportProgress(
    phase: SyncProgress["phase"],
    total: number,
    completed: number,
    currentFile: string
  ): void {
    if (this.onProgress) {
      this.onProgress({ phase, total, completed, currentFile, errors: [] });
    }
  }

  private log(msg: string): void {
    if (this.logger) {
      this.logger(msg);
    }
  }
}

// --- Helpers ---

function getParentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

function getFileName(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? filePath : filePath.substring(lastSlash + 1);
}

async function ensureVaultFolder(vault: Vault, folderPath: string): Promise<void> {
  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!vault.getAbstractFileByPath(current)) {
      await vault.createFolder(current);
    }
  }
}

async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}
