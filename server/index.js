const express = require('express');
const cors = require('cors');
const { URL } = require('url');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());

// Normalize duplicate slashes in request URL (e.g. //info) to avoid 404s
app.use((req, res, next) => {
  // If the original URL (what the client requested) contains multiple
  // consecutive slashes, redirect the client to the normalized path.
  // This ensures the browser's address bar and subsequent requests are correct
  // (Express's default 404 shows the original path, so rewriting req.url alone
  // doesn't change that message).
  if (req.originalUrl && /\/\/{2,}/.test(req.originalUrl)) {
    const normalized = req.originalUrl.replace(/\/\/{2,}/g, '/');
    return res.redirect(307, normalized);
  }
  next();
});

// Helper: find a usable invocation for yt-dlp. Tries Python module via
// 'py -3 -m yt_dlp', 'python -m yt_dlp', 'python3 -m yt_dlp', then the
// 'yt-dlp' executable in PATH.
function findYtDlpInvoker() {
  const tries = [
    { cmd: 'py', args: ['-3', '-m', 'yt_dlp'] },
    { cmd: 'python', args: ['-m', 'yt_dlp'] },
    { cmd: 'python3', args: ['-m', 'yt_dlp'] },
    { cmd: 'yt-dlp', args: [] }
  ];
  for (const t of tries) {
    try {
      const check = spawnSync(t.cmd, [...t.args, '--version'], { encoding: 'utf8' });
      if (!check.error && check.status === 0 && check.stdout) {
        return t;
      }
    } catch (e) {
      // continue trying
    }
  }
  return null;
}

// If client is built, serve static files from client/dist so visiting / works
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('/', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

async function tryHead(url) {
  try {
    const headResp = await fetch(url, { method: 'HEAD' });
    return {
      contentType: headResp.headers.get('content-type') || '',
      contentLength: headResp.headers.get('content-length')
    };
  } catch (e) {
    return { contentType: '', contentLength: null };
  }
}

function makeContentDisposition(name) {
  if (!name) name = 'video'
  // Remove control characters/newlines and force an ASCII fallback for `filename`
  const stripped = name.replace(/[\r\n\t\0\x00-\x1F\x7F]/g, '');
  // Normalize and drop non-ASCII for the basic filename header (some browsers use this)
  let ascii = stripped.normalize ? stripped.normalize('NFKD').replace(/[^\x20-\x7E]/g, '') : stripped.replace(/[^\x20-\x7E]/g, '');
  if (!ascii) ascii = 'video';
  const safe = ascii.replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

app.get('/download', async (req, res) => {
  const url = req.query.url;
  const format = req.query.format;
  const direct = req.query.direct === '1' || req.query.direct === 'true';
  if (!url) return res.status(400).send('Missing url parameter.');
  let parsed;
  try { parsed = new URL(url); } catch (e) { return res.status(400).send('Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('Unsupported protocol');

  try {
    const head = await tryHead(url);
    let { contentType, contentLength } = head;

    // If HEAD didn't provide content-type, attempt a short GET and inspect
    if (!contentType) {
      try {
        const testResp = await fetch(url, { method: 'GET' });
        contentType = testResp.headers.get('content-type') || '';
        contentLength = contentLength || testResp.headers.get('content-length');
        if (contentType.startsWith('video/')) {
            const filename = path.basename(parsed.pathname) || 'video';
            res.setHeader('Content-Type', contentType);
            if (contentLength) res.setHeader('Content-Length', contentLength);
            console.log('Raw filename (direct video test):', JSON.stringify(filename));
            console.log('Filename codes:', Array.from(filename || '').map(c=>c.charCodeAt(0)));
            const cd1 = makeContentDisposition(filename);
            console.log('Content-Disposition (direct video test):', cd1);
            res.setHeader('Content-Disposition', cd1);
          return testResp.body.pipe(res);
        }
      } catch (e) {
        // ignore
      }
    }

    if (contentType && contentType.startsWith('video/')) {
      // If caller requested a direct download, redirect to the original URL so the browser downloads directly.
      if (direct && !format) {
        return res.redirect(307, url);
      }
      // If format not requested, proxy the direct video (will stream through server)
      const filename = path.basename(parsed.pathname) || 'video';
      const resp = await fetch(url);
      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      console.log('Raw filename (proxied video):', JSON.stringify(filename));
      console.log('Filename codes:', Array.from(filename || '').map(c=>c.charCodeAt(0)));
      const cd2 = makeContentDisposition(filename);
      console.log('Content-Disposition (proxied video):', cd2);
      res.setHeader('Content-Disposition', cd2);
      return resp.body.pipe(res);
    }

    // Not a direct video resource — attempt to use yt-dlp to resolve and stream
    // Find a usable invocation (py/python/yt-dlp) so this works on various setups
    const invoker = findYtDlpInvoker();
    if (!invoker) {
      console.error('yt-dlp not available via any known invocation');
      return res.status(400).send('URL is not a direct video and `yt-dlp` is not available. Install yt-dlp (e.g. `python -m pip install yt-dlp`) to enable site downloads.');
    }

    // Get a sensible filename from yt-dlp
    let filename = 'video';
    try {
      const nameCmdArgs = [...invoker.args, '--get-filename', '-o', '%(title)s.%(ext)s', url];
      if (format) nameCmdArgs.push('-f', format);
      const nameProc = spawnSync(invoker.cmd, nameCmdArgs, { encoding: 'utf8' });
      if (!nameProc.error && nameProc.stdout) filename = nameProc.stdout.trim();
    } catch (e) {
      // ignore, leave default filename
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    console.log('Raw filename (yt-dlp):', JSON.stringify(filename));
    console.log('Filename codes:', Array.from(filename || '').map(c=>c.charCodeAt(0)));
    const cd3 = makeContentDisposition(filename);
    console.log('Content-Disposition (yt-dlp):', cd3);
    res.setHeader('Content-Disposition', cd3);

    const dlCmdArgs = [...invoker.args];
    if (format) dlCmdArgs.push('-f', format);
    else dlCmdArgs.push('-f', 'best');
    dlCmdArgs.push('-o', '-', '--no-playlist', url);
    const dl = spawn(invoker.cmd, dlCmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    dl.stdout.pipe(res);
    dl.stderr.on('data', (d) => console.error('yt-dlp:', d.toString()));
    dl.on('error', (err) => {
      console.error('yt-dlp spawn error', err);
      if (!res.headersSent) res.status(500).send('yt-dlp failed: ' + err.message);
    });
    req.on('close', () => dl.kill('SIGTERM'));

  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch or process video: ' + err.message);
  }
});

// Info endpoint: return metadata (title, thumbnail, uploader, duration) using yt-dlp
app.get('/info', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url parameter.');
  try {
    const invoker = findYtDlpInvoker();
    if (!invoker) return res.status(400).send('`yt-dlp` is not available on the server.');

    const proc = spawnSync(invoker.cmd, [...invoker.args, '--dump-single-json', url], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (proc.error) {
      console.error('yt-dlp error', proc.error);
      return res.status(500).send('Failed to run yt-dlp');
    }
    if (proc.status !== 0) {
      console.error('yt-dlp stderr', proc.stderr);
      return res.status(400).send('yt-dlp failed to extract info');
    }

    let info = null;
    try {
      info = JSON.parse(proc.stdout);
    } catch (e) {
      console.error('Failed to parse yt-dlp output', e);
      return res.status(500).send('Failed to parse metadata');
    }

    const formats = (info.formats || []).map(f => ({
      format_id: f.format_id || f.format_id || null,
      ext: f.ext || null,
      format: f.format || null,
      filesize: f.filesize || f.filesize_approx || null,
      width: f.width || null,
      height: f.height || null,
      note: f.format_note || null
    }));

    const out = {
      id: info.id,
      title: info.title,
      uploader: info.uploader || info.uploader_id || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      webpage_url: info.webpage_url || null,
      formats
    };
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal error');
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('Server listening on http://localhost:' + port));
