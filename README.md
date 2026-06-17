# Video Downloader (React + Express)

This is a minimal example project that demonstrates a React frontend and a small Express backend proxy to download direct video files by URL.

Important: Use this only for downloading videos you have rights to (your own content or public-domain media). This tool will not bypass DRM or download embedded/streaming-only content from platforms that prohibit downloading.

Features
- React (Vite) frontend with simple URL input
- Express backend proxy that verifies Content-Type and streams the video

Requirements
- Node.js 18+ (for native fetch support)

Quick start

1. Install server deps and start server:

```powershell
cd server
npm install
npm start
```

2. Install client deps and start dev server in another terminal:

```powershell
cd client
npm install
npm run dev
```

3. Open the client (Vite will print the dev URL, typically http://localhost:5173). Enter a direct video URL (e.g., an MP4 file link) and click Download.

Notes
- Many video hosting sites use streaming protocols or DRM; those will not be downloadable with this proxy.
- The server does a basic HEAD/GET check for Content-Type starting with `video/` before streaming.
- You are responsible for ensuring downloads comply with site terms and copyright law.

Optional: downloading from pages (YouTube, Vimeo, embedded players)
- The server will attempt to use `yt-dlp` to resolve and stream media when a URL does not point to a direct video file. To enable this, install `yt-dlp` on your system:

PowerShell / Windows (recommended):
```powershell
python -m pip install --upgrade yt-dlp
# or use scoop/chocolatey if you prefer
```

macOS / Linux:
```bash
python3 -m pip install --user --upgrade yt-dlp
# or use your distro package manager
```

When `yt-dlp` is available in PATH, the server will spawn it to fetch the actual media and stream it to the browser. If `yt-dlp` is missing you'll get an explanatory error from the server.
