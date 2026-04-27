import type { SyncProgress } from "../types";

/**
 * Manages the status bar item showing sync state.
 */
export class StatusBarManager {
  constructor(private el: HTMLElement) {
    this.el.addClass("gdrive-sync-status");
    this.setIdle();
  }

  setIdle(): void {
    this.el.removeClass("syncing");
    this.el.setText("GDrive: idle");
  }

  setSyncing(progress: SyncProgress): void {
    this.el.addClass("syncing");
    switch (progress.phase) {
      case "gathering":
        this.el.setText(`GDrive: ${progress.currentFile}`);
        break;
      case "diffing":
        this.el.setText("GDrive: computing changes...");
        break;
      case "executing":
        if (progress.total > 0) {
          this.el.setText(
            `GDrive: ${progress.completed}/${progress.total}`
          );
        } else {
          this.el.setText("GDrive: syncing...");
        }
        break;
      case "done":
        this.el.removeClass("syncing");
        this.el.setText("GDrive: synced");
        // Revert to idle after 5 seconds
        setTimeout(() => this.setIdle(), 5000);
        break;
      case "error":
        this.el.removeClass("syncing");
        this.el.setText("GDrive: error");
        break;
    }
  }

  setError(msg: string): void {
    this.el.removeClass("syncing");
    this.el.setText(`GDrive: ${msg}`);
  }

  setDisconnected(): void {
    this.el.removeClass("syncing");
    this.el.setText("GDrive: not connected");
  }
}
