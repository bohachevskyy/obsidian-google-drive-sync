/**
 * E2E encryption using AES-256-GCM via Web Crypto API (works on iOS).
 *
 * Format: [1 byte version][16 bytes salt][12 bytes IV][N bytes ciphertext+tag]
 */

const VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 250_000;

export class EncryptionService {
  constructor(private password: string) {}

  async encrypt(plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await this.deriveKey(salt);

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );

    // Assemble: version + salt + iv + ciphertext
    const result = new Uint8Array(
      1 + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength
    );
    result[0] = VERSION;
    result.set(salt, 1);
    result.set(iv, 1 + SALT_LENGTH);
    result.set(new Uint8Array(ciphertext), 1 + SALT_LENGTH + IV_LENGTH);

    return result.buffer;
  }

  async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(data);

    const version = bytes[0];
    if (version !== VERSION) {
      throw new Error(`Unsupported encryption version: ${version}`);
    }

    const salt = bytes.slice(1, 1 + SALT_LENGTH);
    const iv = bytes.slice(1 + SALT_LENGTH, 1 + SALT_LENGTH + IV_LENGTH);
    const ciphertext = bytes.slice(1 + SALT_LENGTH + IV_LENGTH);

    const key = await this.deriveKey(salt);

    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  }

  private async deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Compute SHA-256 hash of content (for sync state, not encryption).
   */
  static async hash(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
  }
}
