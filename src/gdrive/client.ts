import { requestUrl } from "obsidian";
import type { TokenStore } from "../auth/tokenStore";
import type { DriveFile, DriveListResponse } from "../types";
import {
  GOOGLE_DRIVE_API,
  GOOGLE_UPLOAD_API,
  FOLDER_MIME_TYPE,
  DRIVE_PAGE_SIZE,
  MULTIPART_UPLOAD_LIMIT,
} from "../constants";

/**
 * Google Drive API v3 client using Obsidian's requestUrl (works on iOS).
 */
export class GDriveClient {
  constructor(private tokenStore: TokenStore) {}

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokenStore.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  // --- File listing ---

  /**
   * List files matching a query. Handles pagination automatically.
   */
  async listFiles(
    query: string,
    fields = "files(id,name,mimeType,modifiedTime,size,parents,md5Checksum,trashed)",
    pageSize = DRIVE_PAGE_SIZE
  ): Promise<DriveFile[]> {
    const allFiles: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        q: query,
        fields: `nextPageToken,${fields}`,
        pageSize: String(pageSize),
        spaces: "drive",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const resp = await requestUrl({
        url: `${GOOGLE_DRIVE_API}/files?${params.toString()}`,
        method: "GET",
        headers: await this.headers(),
      });

      const data: DriveListResponse = resp.json;
      allFiles.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }

  // --- File metadata ---

  async getFileMetadata(fileId: string): Promise<DriveFile> {
    const fields = "id,name,mimeType,modifiedTime,size,parents,md5Checksum";
    const resp = await requestUrl({
      url: `${GOOGLE_DRIVE_API}/files/${fileId}?fields=${fields}`,
      method: "GET",
      headers: await this.headers(),
    });
    return resp.json;
  }

  // --- Download ---

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const resp = await requestUrl({
      url: `${GOOGLE_DRIVE_API}/files/${fileId}?alt=media`,
      method: "GET",
      headers: await this.headers(),
    });
    return resp.arrayBuffer;
  }

  // --- Upload (new file) ---

  async uploadFile(
    name: string,
    parentId: string,
    content: ArrayBuffer,
    mimeType = "application/octet-stream"
  ): Promise<DriveFile> {
    if (content.byteLength <= MULTIPART_UPLOAD_LIMIT) {
      return this.uploadMultipart(name, parentId, content, mimeType);
    }
    return this.uploadResumable(name, parentId, content, mimeType);
  }

  private async uploadMultipart(
    name: string,
    parentId: string,
    content: ArrayBuffer,
    mimeType: string
  ): Promise<DriveFile> {
    const boundary = "----ObsidianGDriveSync" + Date.now();
    const metadata = JSON.stringify({
      name,
      parents: [parentId],
    });

    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const postamble = encoder.encode(`\r\n--${boundary}--`);

    const body = concatBuffers(preamble, new Uint8Array(content), postamble);

    const resp = await requestUrl({
      url: `${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,modifiedTime,size,md5Checksum`,
      method: "POST",
      headers: {
        ...(await this.headers()),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: body.buffer,
    });

    return resp.json;
  }

  private async uploadResumable(
    name: string,
    parentId: string,
    content: ArrayBuffer,
    mimeType: string
  ): Promise<DriveFile> {
    // Step 1: Initiate resumable session
    const metadata = JSON.stringify({
      name,
      parents: [parentId],
    });

    const initResp = await requestUrl({
      url: `${GOOGLE_UPLOAD_API}/files?uploadType=resumable`,
      method: "POST",
      headers: {
        ...(await this.headers()),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(content.byteLength),
      },
      body: metadata,
    });

    const sessionUri = initResp.headers["location"] || initResp.headers["Location"];
    if (!sessionUri) {
      throw new Error("Resumable upload: no session URI returned");
    }

    // Step 2: Upload content
    const uploadResp = await requestUrl({
      url: sessionUri,
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(content.byteLength),
      },
      body: content,
    });

    return uploadResp.json;
  }

  // --- Update existing file ---

  async updateFile(
    fileId: string,
    content: ArrayBuffer,
    mimeType = "application/octet-stream"
  ): Promise<DriveFile> {
    if (content.byteLength <= MULTIPART_UPLOAD_LIMIT) {
      const resp = await requestUrl({
        url: `${GOOGLE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,name,modifiedTime,size,md5Checksum`,
        method: "PATCH",
        headers: {
          ...(await this.headers()),
          "Content-Type": mimeType,
        },
        body: content,
      });
      return resp.json;
    }

    // Resumable update for large files
    const initResp = await requestUrl({
      url: `${GOOGLE_UPLOAD_API}/files/${fileId}?uploadType=resumable`,
      method: "PATCH",
      headers: {
        ...(await this.headers()),
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(content.byteLength),
      },
    });

    const sessionUri = initResp.headers["location"] || initResp.headers["Location"];
    if (!sessionUri) {
      throw new Error("Resumable update: no session URI returned");
    }

    const uploadResp = await requestUrl({
      url: sessionUri,
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(content.byteLength),
      },
      body: content,
    });

    return uploadResp.json;
  }

  // --- Delete ---

  async deleteFile(fileId: string, permanent = false): Promise<void> {
    if (permanent) {
      await requestUrl({
        url: `${GOOGLE_DRIVE_API}/files/${fileId}`,
        method: "DELETE",
        headers: await this.headers(),
      });
    } else {
      // Move to trash
      await requestUrl({
        url: `${GOOGLE_DRIVE_API}/files/${fileId}`,
        method: "PATCH",
        headers: {
          ...(await this.headers()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      });
    }
  }

  // --- Folders ---

  async createFolder(name: string, parentId?: string): Promise<string> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: FOLDER_MIME_TYPE,
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const resp = await requestUrl({
      url: `${GOOGLE_DRIVE_API}/files?fields=id`,
      method: "POST",
      headers: {
        ...(await this.headers()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    });

    return resp.json.id;
  }

  /**
   * Find or create the root sync folder in Google Drive.
   */
  async ensureRootFolder(folderName: string): Promise<string> {
    const query = `name='${escapeDriveQuery(folderName)}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
    const files = await this.listFiles(query, "files(id,name)");

    if (files.length > 0) {
      return files[0].id;
    }

    return this.createFolder(folderName);
  }

  /**
   * Ensure a nested folder path exists under a parent, creating as needed.
   * Returns the ID of the deepest folder.
   */
  async ensureFolderPath(
    pathParts: string[],
    rootId: string,
    folderCache: Map<string, string>
  ): Promise<string> {
    let currentParentId = rootId;
    let currentPath = "";

    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      const cached = folderCache.get(currentPath);
      if (cached) {
        currentParentId = cached;
        continue;
      }

      const query = `name='${escapeDriveQuery(part)}' and '${currentParentId}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
      const found = await this.listFiles(query, "files(id,name)");

      if (found.length > 0) {
        currentParentId = found[0].id;
      } else {
        currentParentId = await this.createFolder(part, currentParentId);
      }

      folderCache.set(currentPath, currentParentId);
    }

    return currentParentId;
  }

  /**
   * List all files recursively under a folder.
   * Returns a map of vault-relative path -> DriveFile.
   */
  async listAllFilesRecursive(
    folderId: string,
    basePath = ""
  ): Promise<Map<string, DriveFile>> {
    const result = new Map<string, DriveFile>();
    const query = `'${folderId}' in parents and trashed=false`;
    const files = await this.listFiles(query);

    for (const file of files) {
      const filePath = basePath ? `${basePath}/${file.name}` : file.name;

      if (file.mimeType === FOLDER_MIME_TYPE) {
        const subFiles = await this.listAllFilesRecursive(file.id, filePath);
        for (const [subPath, subFile] of subFiles) {
          result.set(subPath, subFile);
        }
      } else {
        result.set(filePath, file);
      }
    }

    return result;
  }
}

// --- Helpers ---

function escapeDriveQuery(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function concatBuffers(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
