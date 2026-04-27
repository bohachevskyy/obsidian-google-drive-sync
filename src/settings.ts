import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type GDriveSyncPlugin from "./main";
import { buildAuthUrl, generateState } from "./auth/oauth";
import { SyncLogModal } from "./ui/syncLogModal";

export class GDriveSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GDriveSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("gdrive-sync-settings");

    // ── Google Account ──
    containerEl.createEl("h2", { text: "Google Account" });

    // Auth status
    const statusDiv = containerEl.createDiv("auth-status");
    if (this.plugin.tokenStore.hasValidTokens()) {
      statusDiv.addClass("connected");
      statusDiv.setText("Connected to Google Drive");
    } else {
      statusDiv.addClass("disconnected");
      statusDiv.setText("Not connected");
    }

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("From your Google Cloud Console OAuth credentials")
      .addText((text) =>
        text
          .setPlaceholder("xxxx.apps.googleusercontent.com")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Client Secret")
      .setDesc("From your Google Cloud Console OAuth credentials")
      .addText((text) => {
        text
          .setPlaceholder("GOCSPX-xxxx")
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Redirect URL")
      .setDesc(
        "The URL of your OAuth redirect page (GitHub Pages). Leave empty to use manual code entry."
      )
      .addText((text) =>
        text
          .setPlaceholder("https://yourname.github.io/obsidian-gdrive-sync/redirect/")
          .setValue(this.plugin.settings.redirectUrl)
          .onChange(async (value) => {
            this.plugin.settings.redirectUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Authorize")
      .setDesc("Connect to Google Drive")
      .addButton((btn) =>
        btn
          .setButtonText(
            this.plugin.tokenStore.hasValidTokens()
              ? "Re-authorize"
              : "Authorize"
          )
          .setCta()
          .onClick(() => {
            this.startAuth();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Disconnect")
          .setWarning()
          .onClick(async () => {
            await this.plugin.tokenStore.clearTokens();
            new Notice("Disconnected from Google Drive");
            this.display();
          })
      );

    // Manual code entry (fallback)
    new Setting(containerEl)
      .setName("Manual Authorization Code")
      .setDesc(
        "If the redirect didn't work, paste the authorization code here"
      )
      .addText((text) =>
        text.setPlaceholder("Paste code here").onChange(() => {})
      )
      .addButton((btn) =>
        btn.setButtonText("Submit").onClick(async () => {
          const input = containerEl.querySelector(
            '.setting-item:last-of-type input[type="text"]'
          ) as HTMLInputElement;
          const code = input?.value?.trim();
          if (!code) {
            new Notice("Please enter an authorization code");
            return;
          }
          try {
            await this.plugin.handleAuthCode(code);
            new Notice("Successfully authorized!");
            this.display();
          } catch (err) {
            new Notice(
              "Authorization failed: " + (err as Error).message
            );
          }
        })
      );

    // ── Sync Configuration ──
    containerEl.createEl("h2", { text: "Sync Configuration" });

    new Setting(containerEl)
      .setName("Drive folder name")
      .setDesc("Name of the folder in Google Drive to store your vault")
      .addText((text) =>
        text
          .setPlaceholder("ObsidianVault")
          .setValue(this.plugin.settings.driveFolderName)
          .onChange(async (value) => {
            this.plugin.settings.driveFolderName = value.trim() || "ObsidianVault";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("How often to sync automatically (0 = manual only)")
      .addDropdown((drop) =>
        drop
          .addOption("0", "Manual only")
          .addOption("5", "Every 5 minutes")
          .addOption("15", "Every 15 minutes")
          .addOption("30", "Every 30 minutes")
          .addOption("60", "Every hour")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = parseInt(value, 10);
            await this.plugin.saveSettings();
            this.plugin.setupAutoSync();
          })
      );

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Automatically sync when Obsidian starts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync on save")
      .setDesc("Sync after file modifications (10-second debounce)")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnSave)
          .onChange(async (value) => {
            this.plugin.settings.syncOnSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Conflict resolution")
      .setDesc("How to handle conflicts when the same file is modified on multiple devices")
      .addDropdown((drop) =>
        drop
          .addOption("keep_newer", "Keep newer version")
          .addOption("keep_local", "Always keep local")
          .addOption("keep_remote", "Always keep remote")
          .addOption("keep_both", "Keep both (rename conflict)")
          .addOption("ask", "Ask me each time")
          .setValue(this.plugin.settings.conflictStrategy)
          .onChange(async (value) => {
            this.plugin.settings.conflictStrategy = value as any;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Deletion behavior")
      .setDesc("What to do when a file is deleted on another device")
      .addDropdown((drop) =>
        drop
          .addOption("sync", "Sync deletions (delete locally too)")
          .addOption("trash", "Move to trash instead of deleting")
          .addOption("keep", "Keep all files (never delete)")
          .setValue(this.plugin.settings.deletionBehavior)
          .onChange(async (value) => {
            this.plugin.settings.deletionBehavior = value as any;
            await this.plugin.saveSettings();
          })
      );

    // ── File Filtering ──
    containerEl.createEl("h2", { text: "File Filtering" });

    new Setting(containerEl)
      .setName("Sync .obsidian/ folder")
      .setDesc(
        "Sync settings, themes, and plugin configs (tokens are always excluded)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncDotObsidian)
          .onChange(async (value) => {
            this.plugin.settings.syncDotObsidian = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Exclude patterns")
      .setDesc("Glob patterns to exclude from sync (one per line)")
      .addTextArea((text) =>
        text
          .setPlaceholder("*.tmp\n.trash/**")
          .setValue(this.plugin.settings.excludePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max file size (MB)")
      .setDesc("Skip files larger than this size")
      .addText((text) =>
        text
          .setPlaceholder("50")
          .setValue(String(this.plugin.settings.maxFileSizeMB))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxFileSizeMB = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // ── Encryption ──
    containerEl.createEl("h2", { text: "Encryption" });

    new Setting(containerEl)
      .setName("Enable E2E encryption")
      .setDesc(
        "Encrypt file contents before uploading to Google Drive (AES-256-GCM)"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableEncryption)
          .onChange(async (value) => {
            this.plugin.settings.enableEncryption = value;
            await this.plugin.saveSettings();
            this.plugin.updateEncryption();
          })
      );

    new Setting(containerEl)
      .setName("Encryption password")
      .setDesc(
        "This password is stored only on this device. If you lose it, encrypted files cannot be recovered."
      )
      .addText((text) => {
        text
          .setPlaceholder("Enter encryption password")
          .setValue(this.plugin.settings.encryptionPassword)
          .onChange(async (value) => {
            this.plugin.settings.encryptionPassword = value;
            await this.plugin.saveSettings();
            this.plugin.updateEncryption();
          });
        text.inputEl.type = "password";
      });

    // ── Advanced ──
    containerEl.createEl("h2", { text: "Advanced" });

    new Setting(containerEl)
      .setName("Tombstone retention (days)")
      .setDesc("How long to remember deleted files for sync propagation")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.tombstoneRetentionDays))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.tombstoneRetentionDays = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Show status bar")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Log detailed sync information to the console")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugMode)
          .onChange(async (value) => {
            this.plugin.settings.debugMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("View sync log")
      .setDesc("See recent sync operations")
      .addButton((btn) =>
        btn.setButtonText("View Log").onClick(() => {
          new SyncLogModal(
            this.app,
            this.plugin.stateManager.getLog()
          ).open();
        })
      );

    new Setting(containerEl)
      .setName("Force full sync")
      .setDesc(
        "Clear sync state and re-sync everything. Use if sync is out of alignment."
      )
      .addButton((btn) =>
        btn
          .setButtonText("Force Full Sync")
          .setWarning()
          .onClick(async () => {
            await this.plugin.triggerSync(true);
          })
      );
  }

  private startAuth(): void {
    const { clientId, redirectUrl } = this.plugin.settings;

    if (!clientId) {
      new Notice("Please enter your Client ID first");
      return;
    }

    if (!redirectUrl) {
      new Notice(
        "Please enter your Redirect URL (your GitHub Pages callback page)"
      );
      return;
    }

    const state = generateState();
    this.plugin.pendingAuthState = state;

    const authUrl = buildAuthUrl(clientId, redirectUrl, state);

    // Open in system browser
    window.open(authUrl);

    new Notice(
      "Authorization page opened in browser. Please approve the request."
    );
  }
}
