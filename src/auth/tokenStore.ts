import type GDriveSyncPlugin from "../main";
import { refreshAccessToken } from "./oauth";
import { TOKEN_REFRESH_MARGIN_MS } from "../constants";

/**
 * Manages access/refresh tokens with automatic refresh.
 */
export class TokenStore {
  constructor(private plugin: GDriveSyncPlugin) {}

  hasValidTokens(): boolean {
    return !!(
      this.plugin.settings.refreshToken &&
      this.plugin.settings.clientId &&
      this.plugin.settings.clientSecret
    );
  }

  isTokenExpired(): boolean {
    return Date.now() >= this.plugin.settings.tokenExpiry - TOKEN_REFRESH_MARGIN_MS;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getAccessToken(): Promise<string> {
    if (!this.hasValidTokens()) {
      throw new Error("Not authenticated. Please authorize with Google Drive first.");
    }

    if (this.isTokenExpired()) {
      await this.refresh();
    }

    return this.plugin.settings.accessToken;
  }

  /**
   * Store new tokens from an OAuth exchange.
   */
  async storeTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<void> {
    this.plugin.settings.accessToken = accessToken;
    this.plugin.settings.refreshToken = refreshToken;
    this.plugin.settings.tokenExpiry = Date.now() + expiresIn * 1000;
    await this.plugin.saveSettings();
  }

  /**
   * Clear all stored tokens (disconnect).
   */
  async clearTokens(): Promise<void> {
    this.plugin.settings.accessToken = "";
    this.plugin.settings.refreshToken = "";
    this.plugin.settings.tokenExpiry = 0;
    await this.plugin.saveSettings();
  }

  private async refresh(): Promise<void> {
    try {
      const result = await refreshAccessToken(this.plugin.settings);
      this.plugin.settings.accessToken = result.accessToken;
      this.plugin.settings.tokenExpiry = Date.now() + result.expiresIn * 1000;
      await this.plugin.saveSettings();
      this.plugin.log("Access token refreshed successfully");
    } catch (err) {
      this.plugin.log("Failed to refresh token: " + (err as Error).message);
      throw err;
    }
  }
}
