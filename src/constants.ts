import type { GDriveSyncSettings } from "./types";

export const PLUGIN_ID = "obsidian-gdrive-sync";
export const PROTOCOL_ACTION = "gdrive-sync";

// Google OAuth
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
export const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// File size thresholds
export const MULTIPART_UPLOAD_LIMIT = 5 * 1024 * 1024; // 5MB
export const DEFAULT_MAX_FILE_SIZE_MB = 50;

// Sync
export const SYNC_CONCURRENCY = 3;
export const DRIVE_PAGE_SIZE = 100;
export const SAVE_DEBOUNCE_MS = 10_000;
export const STARTUP_SYNC_DELAY_MS = 5_000;
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes before expiry

// Drive MIME types
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// Default exclusion patterns for .obsidian/
export const DEFAULT_DOT_OBSIDIAN_EXCLUDES = [
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/plugins/obsidian-gdrive-sync/data.json",
  ".obsidian/cache",
];

export const DEFAULT_SETTINGS: GDriveSyncSettings = {
  clientId: "",
  clientSecret: "",
  redirectUrl: "",
  accessToken: "",
  refreshToken: "",
  tokenExpiry: 0,
  driveFolderName: "ObsidianVault",
  syncIntervalMinutes: 0,
  conflictStrategy: "keep_newer",
  syncDotObsidian: false,
  dotObsidianExcludes: DEFAULT_DOT_OBSIDIAN_EXCLUDES,
  excludePatterns: [],
  enableEncryption: false,
  encryptionPassword: "",
  maxFileSizeMB: DEFAULT_MAX_FILE_SIZE_MB,
  syncOnStartup: true,
  syncOnSave: true,
  deletionBehavior: "sync",
  tombstoneRetentionDays: 30,
  showStatusBar: true,
  debugMode: false,
};
