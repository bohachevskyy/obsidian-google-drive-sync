import { Plugin, Notice, TFile, TAbstractFile, debounce } from "obsidian";
import type { GDriveSyncSettings, SyncProgress } from "./types";
import { DEFAULT_SETTINGS, PROTOCOL_ACTION, STARTUP_SYNC_DELAY_MS, SAVE_DEBOUNCE_MS } from "./constants";
import { TokenStore } from "./auth/tokenStore";
import { exchangeCodeForTokens } from "./auth/oauth";
import { GDriveClient } from "./gdrive/client";
import { SyncStateManager, createEmptySyncState } from "./sync/state";
import { SyncEngine } from "./sync/engine";
import { EncryptionService } from "./crypto/encryption";
import { StatusBarManager } from "./ui/statusBar";
import { GDriveSyncSettingTab } from "./settings";

export default class GDriveSyncPlugin extends Plugin {
  settings: GDriveSyncSettings = DEFAULT_SETTINGS;
  tokenStore!: TokenStore;
  stateManager!: SyncStateManager;
  private driveClient!: GDriveClient;
  private syncEngine!: SyncEngine;
  private encryption: EncryptionService | null = null;
  private statusBar: StatusBarManager | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  /** Used during OAuth flow to validate the state parameter. */
  pendingAuthState: string | null = null;

  /** Debounced sync triggered by file save events. */
  private debouncedSync = debounce(
    () => this.triggerSync(),
    SAVE_DEBOUNCE_MS,
    true
  );

  async onload(): Promise<void> {
    // 1. Load settings
    await this.loadSettings();

    // 2. Initialize services
    this.tokenStore = new TokenStore(this);
    this.driveClient = new GDriveClient(this.tokenStore);
    this.stateManager = new SyncStateManager(this);
    await this.stateManager.load();

    this.updateEncryption();
    this.syncEngine = new SyncEngine(
      this.app.vault,
      this.driveClient,
      this.stateManager,
      this.settings,
      this.encryption,
      (msg) => this.log(msg)
    );

    // 3. Register OAuth protocol handler
    this.registerObsidianProtocolHandler(
      PROTOCOL_ACTION,
      async (params) => {
        await this.handleOAuthCallback(params);
      }
    );

    // 4. Register commands
    this.addCommand({
      id: "sync-now",
      name: "Sync with Google Drive",
      callback: () => this.triggerSync(),
    });

    this.addCommand({
      id: "force-sync",
      name: "Force full sync with Google Drive",
      callback: () => this.triggerSync(true),
    });

    // 5. Register vault event listeners for deletion/rename tracking
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.onFileDeleted(file))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.onFileRenamed(file, oldPath)
      )
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => this.onFileModified(file))
    );

    // 6. Ribbon icon
    this.addRibbonIcon("refresh-cw", "Sync with Google Drive", () =>
      this.triggerSync()
    );

    // 7. Status bar
    if (this.settings.showStatusBar) {
      this.statusBar = new StatusBarManager(this.addStatusBarItem());
      if (!this.tokenStore.hasValidTokens()) {
        this.statusBar.setDisconnected();
      }
    }

    // 8. Settings tab
    this.addSettingTab(new GDriveSyncSettingTab(this.app, this));

    // 9. Auto-sync on startup
    this.app.workspace.onLayoutReady(() => {
      if (
        this.settings.syncOnStartup &&
        this.tokenStore.hasValidTokens()
      ) {
        setTimeout(() => this.triggerSync(), STARTUP_SYNC_DELAY_MS);
      }
      this.setupAutoSync();
    });
  }

  onunload(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // --- Settings ---

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings || {});
  }

  async saveSettings(): Promise<void> {
    const data = (await this.loadData()) || {};
    data.settings = this.settings;
    await this.saveData(data);
    this.syncEngine?.updateSettings(this.settings);
  }

  // --- Encryption ---

  updateEncryption(): void {
    if (this.settings.enableEncryption && this.settings.encryptionPassword) {
      this.encryption = new EncryptionService(
        this.settings.encryptionPassword
      );
    } else {
      this.encryption = null;
    }
    this.syncEngine?.updateEncryption(this.encryption);
  }

  // --- OAuth ---

  async handleOAuthCallback(params: Record<string, string>): Promise<void> {
    const { code, state } = params;

    if (!code) {
      new Notice("Authorization failed: no code received");
      return;
    }

    // Validate state if we have a pending one
    if (this.pendingAuthState && state !== this.pendingAuthState) {
      new Notice("Authorization failed: state mismatch (possible CSRF)");
      return;
    }
    this.pendingAuthState = null;

    await this.handleAuthCode(code);
  }

  async handleAuthCode(code: string): Promise<void> {
    try {
      const tokens = await exchangeCodeForTokens(code, this.settings);
      await this.tokenStore.storeTokens(
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn
      );
      new Notice("Successfully connected to Google Drive!");
      this.statusBar?.setIdle();
      this.log("OAuth authorization successful");
    } catch (err) {
      new Notice("Authorization failed: " + (err as Error).message);
      throw err;
    }
  }

  // --- Sync ---

  async triggerSync(forceFullSync = false): Promise<void> {
    if (!this.tokenStore.hasValidTokens()) {
      new Notice(
        "Not connected to Google Drive. Please authorize in settings."
      );
      return;
    }

    if (this.syncEngine.syncing) {
      new Notice("Sync already in progress");
      return;
    }

    try {
      this.statusBar?.setSyncing({
        phase: "gathering",
        total: 0,
        completed: 0,
        currentFile: "",
        errors: [],
      });

      const log = await this.syncEngine.sync(
        (progress) => this.statusBar?.setSyncing(progress),
        forceFullSync
      );

      const successes = log.filter((e) => e.success).length;
      const failures = log.filter((e) => !e.success).length;

      if (log.length === 0) {
        new Notice("Google Drive sync: everything up to date");
      } else if (failures === 0) {
        new Notice(`Google Drive sync: ${successes} files synced`);
      } else {
        new Notice(
          `Google Drive sync: ${successes} synced, ${failures} errors`
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.log("Sync error: " + msg);
      new Notice("Sync failed: " + msg);
      this.statusBar?.setError("error");
    }
  }

  setupAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (
      this.settings.syncIntervalMinutes > 0 &&
      this.tokenStore.hasValidTokens()
    ) {
      const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
      this.syncTimer = setInterval(() => this.triggerSync(), intervalMs);
      this.log(
        `Auto-sync enabled: every ${this.settings.syncIntervalMinutes} minutes`
      );
    }
  }

  // --- Vault event handlers ---

  private onFileDeleted(file: TAbstractFile): void {
    if (file instanceof TFile) {
      this.stateManager.markDeleted(file.path);
      this.stateManager.save();
      this.log(`Tracked deletion: ${file.path}`);
    }
  }

  private onFileRenamed(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.stateManager.handleRename(oldPath, file.path);
      this.stateManager.save();
      this.log(`Tracked rename: ${oldPath} → ${file.path}`);
    }
  }

  private onFileModified(file: TAbstractFile): void {
    if (file instanceof TFile && this.settings.syncOnSave) {
      this.debouncedSync();
    }
  }

  // --- Logging ---

  log(msg: string): void {
    if (this.settings.debugMode) {
      console.log(`[GDrive Sync] ${msg}`);
    }
  }
}
