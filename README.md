# Obsidian Google Drive Sync

Sync your Obsidian vault with Google Drive using **your own** OAuth credentials. No third-party servers, no token sharing, no trust required.

Works on **Mac, iPad, and iPhone**.

## Why this plugin?

- **You control everything.** You create your own Google Cloud Project. Your OAuth tokens never leave your device.
- **No backend server.** The OAuth redirect page is a static HTML file you host yourself on GitHub Pages.
- **Minimal permissions.** Uses Google's `drive.file` scope — the plugin can only access files it created. It cannot see anything else on your Drive.
- **Optional E2E encryption.** AES-256-GCM encrypts your notes before they leave your device.
- **iOS compatible.** Built with Obsidian's mobile-safe APIs (`requestUrl`, no Node.js dependencies).

## How it works

```
Your device ── requestUrl() ──> Google Drive API
                                    |
                              Your Google Drive
                              (drive.file scope)
                                    |
Your other device ── requestUrl() ──> Google Drive API
```

No intermediary. Your data goes directly between your device and Google's servers.

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **Select a Project** > **New Project** > name it anything > **Create**
3. In the sidebar: **APIs & Services** > **Library** > search **Google Drive API** > **Enable**
4. In the sidebar: **APIs & Services** > **OAuth consent screen**
   - Choose **External** > **Create**
   - Fill in app name (e.g. "My Obsidian Sync") and your email
   - Click through the remaining steps (no scopes needed here)
   - Add your email as a **Test user**
   - **Publish the app** (click "Publish App" on the consent screen page — this prevents your refresh token from expiring every 7 days. Since you use `drive.file` scope, no Google review is required.)
5. In the sidebar: **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**
   - Application type: **Web application**
   - Name: anything
   - Authorized redirect URIs: add your GitHub Pages URL (see step 2)
   - Click **Create**
   - Copy the **Client ID** and **Client Secret**

### 2. Host the redirect page

The `redirect/index.html` file needs to be accessible via HTTPS. The easiest way:

1. Create a new GitHub repository (e.g. `obsidian-gdrive-sync`)
2. Push this project to it
3. Go to repo **Settings** > **Pages** > Source: **Deploy from a branch** > Branch: `main`, folder: `/redirect`
4. Your redirect URL will be: `https://YOUR_USERNAME.github.io/obsidian-gdrive-sync/`
5. Add this URL as the **Authorized redirect URI** in your Google Cloud credentials (step 1.5)

### 3. Install the plugin

Build the plugin:

```bash
npm install
npm run build
```

Copy these files into your Obsidian vault:

```
YourVault/.obsidian/plugins/obsidian-gdrive-sync/
  ├── main.js
  ├── manifest.json
  └── styles.css
```

Or use the install script:

```bash
VAULT_PATH="/path/to/your/vault"
mkdir -p "$VAULT_PATH/.obsidian/plugins/obsidian-gdrive-sync"
cp main.js manifest.json styles.css "$VAULT_PATH/.obsidian/plugins/obsidian-gdrive-sync/"
```

### 4. Configure

1. Open Obsidian > **Settings** > **Community Plugins** > enable **Google Drive Sync**
2. Go to the plugin settings and enter:
   - **Client ID** from step 1
   - **Client Secret** from step 1
   - **Redirect URL** from step 2
3. Click **Authorize** > approve in your browser
4. Click the sync icon in the ribbon or use Command Palette: **Sync with Google Drive**

### 5. Set up iPad / iPhone

1. On your iOS device, create a new vault in Obsidian
2. Copy the 3 plugin files into the vault's `.obsidian/plugins/obsidian-gdrive-sync/` folder (via Files app, AirDrop, or any file transfer method)
3. Enable the plugin in Settings > Community Plugins
4. Enter the same Client ID, Client Secret, and Redirect URL
5. Click Authorize > sync pulls down your vault

## Configuration

| Setting | Default | Description |
|---|---|---|
| Drive folder name | `ObsidianVault` | Name of the sync folder in Google Drive |
| Auto-sync interval | Manual | 5 / 15 / 30 / 60 minutes, or manual only |
| Sync on startup | On | Sync when Obsidian launches |
| Sync on save | On | Sync after file changes (10s debounce) |
| Conflict strategy | Keep newer | `keep_newer` / `keep_local` / `keep_remote` / `keep_both` / `ask` |
| Deletion behavior | Sync | `sync` (propagate) / `trash` (move to trash) / `keep` (never delete) |
| E2E encryption | Off | AES-256-GCM encryption before upload |
| Max file size | 50 MB | Skip files larger than this |
| Sync .obsidian/ | Off | Sync settings, themes, configs (tokens always excluded) |

## Security

- **OAuth tokens** are stored locally in `.obsidian/plugins/obsidian-gdrive-sync/data.json` and never transmitted to any third party.
- **The redirect page** is static HTML with zero server-side code. It passes the one-time auth code to Obsidian via `obsidian://` protocol. The code is useless without your client secret.
- **`drive.file` scope** means the plugin can only access files it created. It cannot read, modify, or delete any other files on your Google Drive.
- **E2E encryption** (optional) uses AES-256-GCM with PBKDF2 key derivation (250,000 iterations). Content is encrypted before leaving your device.
- **No telemetry, no analytics, no external calls** other than Google's OAuth and Drive APIs.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
