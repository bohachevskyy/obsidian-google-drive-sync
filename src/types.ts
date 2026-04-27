// --- Plugin Settings ---
export interface GDriveSyncSettings {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  driveFolderName: string;
  syncIntervalMinutes: number;
  conflictStrategy: ConflictStrategy;
  syncDotObsidian: boolean;
  dotObsidianExcludes: string[];
  excludePatterns: string[];
  enableEncryption: boolean;
  encryptionPassword: string;
  maxFileSizeMB: number;
  syncOnStartup: boolean;
  syncOnSave: boolean;
  deletionBehavior: "sync" | "trash" | "keep";
  tombstoneRetentionDays: number;
  showStatusBar: boolean;
  debugMode: boolean;
}

export type ConflictStrategy =
  | "keep_newer"
  | "keep_local"
  | "keep_remote"
  | "keep_both"
  | "ask";

// --- Sync State ---
export interface SyncMetaEntry {
  path: string;
  localMtime: number | null;
  remoteMtime: number | null;
  driveFileId: string | null;
  lastSyncMtime: number;
  lastSyncTime: number;
  contentHash: string | null;
  deleted: boolean;
  deletedAt: number | null;
  size: number;
  encrypted: boolean;
}

export interface SyncState {
  version: number;
  lastFullSync: number | null;
  entries: Record<string, SyncMetaEntry>;
  driveRootFolderId: string | null;
  deviceId: string;
}

// --- Sync Planning ---
export type SyncAction =
  | "upload"
  | "download"
  | "delete_local"
  | "delete_remote"
  | "conflict"
  | "noop";

export interface SyncPlanItem {
  path: string;
  action: SyncAction;
  localMtime: number | null;
  remoteMtime: number | null;
  lastSyncMtime: number | null;
  driveFileId: string | null;
  reason: string;
}

// --- Google Drive API ---
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parents?: string[];
  md5Checksum?: string;
  trashed?: boolean;
}

export interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

// --- Sync Engine ---
export interface SyncProgress {
  phase: "gathering" | "diffing" | "executing" | "done" | "error";
  total: number;
  completed: number;
  currentFile: string;
  errors: SyncError[];
}

export interface SyncError {
  path: string;
  action: SyncAction;
  error: string;
  timestamp: number;
}

export interface SyncLogEntry {
  action: SyncAction;
  path: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

// --- Local file info for diffing ---
export interface LocalFileInfo {
  path: string;
  mtime: number;
  size: number;
}

// --- Remote file info (flattened from Drive) ---
export interface RemoteFileInfo {
  path: string;
  driveId: string;
  mtime: number;
  size: number;
  md5?: string;
}
