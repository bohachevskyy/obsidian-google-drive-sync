import { Modal, App, Setting } from "obsidian";
import type { SyncPlanItem } from "../types";

export type ConflictResolution = "keep_local" | "keep_remote" | "keep_both";

export class ConflictModal extends Modal {
  private resolution: ConflictResolution = "keep_local";
  private resolvePromise:
    | ((value: ConflictResolution) => void)
    | null = null;

  constructor(
    app: App,
    private item: SyncPlanItem,
    private localContent: string | null,
    private remoteContent: string | null
  ) {
    super(app);
  }

  /**
   * Show the modal and return the user's resolution choice.
   */
  async getResolution(): Promise<ConflictResolution> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("gdrive-sync-conflict-modal");

    contentEl.createEl("h2", { text: "Sync Conflict" });
    contentEl.createEl("p", {
      text: `File: ${this.item.path}`,
    });
    contentEl.createEl("p", {
      text: this.item.reason,
      cls: "setting-item-description",
    });

    // Show content comparison if available
    if (this.localContent !== null || this.remoteContent !== null) {
      const container = contentEl.createDiv("conflict-container");

      const localSide = container.createDiv("conflict-side");
      localSide.createEl("h4", { text: "Local" });
      const localPre = localSide.createDiv("conflict-content");
      localPre.setText(
        this.localContent ?? "(file does not exist locally)"
      );

      const remoteSide = container.createDiv("conflict-side");
      remoteSide.createEl("h4", { text: "Remote" });
      const remotePre = remoteSide.createDiv("conflict-content");
      remotePre.setText(
        this.remoteContent ?? "(file does not exist remotely)"
      );
    }

    // Resolution buttons
    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginTop = "16px";
    buttonContainer.style.justifyContent = "flex-end";

    const keepLocalBtn = buttonContainer.createEl("button", {
      text: "Keep Local",
    });
    keepLocalBtn.addEventListener("click", () => {
      this.resolution = "keep_local";
      this.close();
    });

    const keepRemoteBtn = buttonContainer.createEl("button", {
      text: "Keep Remote",
    });
    keepRemoteBtn.addEventListener("click", () => {
      this.resolution = "keep_remote";
      this.close();
    });

    const keepBothBtn = buttonContainer.createEl("button", {
      text: "Keep Both",
    });
    keepBothBtn.addEventListener("click", () => {
      this.resolution = "keep_both";
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(this.resolution);
      this.resolvePromise = null;
    }
  }
}
