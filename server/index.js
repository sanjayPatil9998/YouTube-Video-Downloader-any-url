const express = require('express');
const cors = require('cors');
const { URL } = require('url');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());

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
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return resp.body.pipe(res);
    }

    // Not a direct video resource — attempt to use yt-dlp to resolve and stream
    // This requires `yt-dlp` to be installed on the system (pip install yt-dlp) or available in PATH.
    // Prefer using the Python module entrypoint so it works regardless of PATH on Windows
    const check = spawnSync('py', ['-3', '-m', 'yt_dlp', '--version'], { encoding: 'utf8' });
    if (check.error) {
      console.error('yt-dlp not available via python module:', check.error.message);
      return res.status(400).send('URL is not a direct video and `yt-dlp` is not available. Install yt-dlp (e.g. `python -m pip install yt-dlp`) to enable site downloads.');
    }

    // Get a sensible filename from yt-dlp
    let filename = 'video';
    try {
      const nameArgs = ['-3', '-m', 'yt_dlp', '--get-filename', '-o', '%(title)s.%(ext)s', url];
      if (format) nameArgs.push('-f', format);
      const nameProc = spawnSync('py', nameArgs, { encoding: 'utf8' });
      if (!nameProc.error && nameProc.stdout) filename = nameProc.stdout.trim();
    } catch (e) {
      // ignore, leave default filename
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const dlArgs = ['-3', '-m', 'yt_dlp'];
    if (format) dlArgs.push('-f', format);
    else dlArgs.push('-f', 'best');
    dlArgs.push('-o', '-', '--no-playlist', url);
    const dl = spawn('py', dlArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
    const check = spawnSync('py', ['-3', '-m', 'yt_dlp', '--version'], { encoding: 'utf8' });
    if (check.error) {
      return res.status(400).send('`yt-dlp` is not available on the server.');
    }

    const proc = spawnSync('py', ['-3', '-m', 'yt_dlp', '--dump-single-json', url], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
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
