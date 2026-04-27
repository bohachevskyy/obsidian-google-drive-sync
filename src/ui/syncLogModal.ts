import { Modal, App } from "obsidian";
import type { SyncLogEntry } from "../types";

export class SyncLogModal extends Modal {
  constructor(app: App, private entries: SyncLogEntry[]) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("gdrive-sync-log-modal");

    contentEl.createEl("h2", { text: "Sync Log" });

    if (this.entries.length === 0) {
      contentEl.createEl("p", { text: "No sync operations recorded yet." });
      return;
    }

    // Show newest first
    const sorted = [...this.entries].reverse();

    for (const entry of sorted) {
      const div = contentEl.createDiv("log-entry");

      const actionSpan = div.createSpan("log-action");
      actionSpan.setText(entry.action.toUpperCase());
      actionSpan.style.color = entry.success
        ? "var(--text-success)"
        : "var(--text-error)";

      const pathSpan = div.createSpan("log-path");
      pathSpan.setText(entry.path);

      const timeSpan = div.createSpan("log-time");
      timeSpan.setText(
        " — " + new Date(entry.timestamp).toLocaleString()
      );
      timeSpan.style.fontSize = "11px";
      timeSpan.style.color = "var(--text-faint)";

      if (entry.error) {
        const errorDiv = div.createDiv();
        errorDiv.setText(entry.error);
        errorDiv.style.color = "var(--text-error)";
        errorDiv.style.fontSize = "12px";
        errorDiv.style.marginTop = "2px";
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
