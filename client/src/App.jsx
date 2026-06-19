import React, { useState, useEffect, useMemo } from 'react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Brightness4Icon from '@mui/icons-material/Brightness4'
import Brightness7Icon from '@mui/icons-material/Brightness7'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import LinearProgress from '@mui/material/LinearProgress'


const SERVER_BASE = (import.meta.env.VITE_SERVER_BASE || 'https://youtube-video-downloader-any-url.onrender.com').replace(/\/$/, '')


// Theme will be created dynamically inside the component so we can toggle light/dark

export default function App() {
  const [mode, setMode] = useState('light')
  const colorMode = useMemo(() => ({ toggle: () => setMode(m => (m === 'light' ? 'dark' : 'light')) }), [])

  const theme = useMemo(() => createTheme({
    palette: {
      mode,
      primary: { main: '#06b6d4', contrastText: '#fff' },
      secondary: { main: '#8b5cf6' },
      background: { default: mode === 'light' ? '#f7fbfb' : '#0b1020' },
      text: { primary: mode === 'light' ? '#0f172a' : '#e6eef6' }
    },
    typography: { fontFamily: "'Inter', 'Roboto', sans-serif" },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 999, textTransform: 'none', padding: '8px 20px' },
          containedPrimary: {
            background: 'linear-gradient(90deg, #06b6d4 0%, #8b5cf6 100%)',
            color: '#fff',
            boxShadow: '0 8px 20px rgba(99,102,241,0.12)'
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            boxShadow: '0 10px 30px rgba(2,6,23,0.08)'
          }
        }
      }
    }
  }), [mode])
  const [url, setUrl] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(null)

  const handleDownload = (e) => {
    e && e.preventDefault()
    setError(null)
    if (!videoUrl) return setError('Please enter a video URL')
    fetchDownload(url)
  }

  const fetchDownload = async (targetUrl) => {
    setDownloading(true)
    setProgress(0)
    setDownloadedBytes(0)
    setTotalBytes(null)
    try {
      if (typeof targetUrl !== 'string') {
        throw new Error('Invalid target URL')
      }

      const fetchUrl = targetUrl.startsWith(SERVER_BASE)
        ? targetUrl
        : `${SERVER_BASE}/download?url=${encodeURIComponent(targetUrl)}`

      // If we're already pointing to the server download endpoint, use a direct
      // browser navigation (anchor click) so the browser handles Content-Disposition
      // and saves the proper filename/extension instead of fetching via XHR.
      if (fetchUrl.startsWith(SERVER_BASE)) {
        const a = document.createElement('a')
        a.href = fetchUrl
        a.target = '_blank'
        a.rel = 'noopener'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setDownloading(false)
        setProgress(0)
        return
      }

      const resp = await fetch(fetchUrl)
      if (!resp.ok) {
        const txt = await resp.text().catch(()=>null)
        setError(txt || 'Download failed')
        setDownloading(false)
        return
      }

      const contentLength = resp.headers.get('content-length')
      const total = contentLength ? parseInt(contentLength, 10) : null
      if (total) setTotalBytes(total)

      const reader = resp.body.getReader()
      const chunks = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        setDownloadedBytes(received)
        if (total) setProgress(Math.floor((received / total) * 100))
      }

      const blob = new Blob(chunks)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const disp = resp.headers.get('content-disposition')
      let filename = 'video'
      if (disp) {
        const m = /filename\*=UTF-8''([^;\n\r]+)|filename="?([^";]+)"?/.exec(disp)
        if (m) filename = decodeURIComponent(m[1] || m[2])
      }
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

    } catch (e) {
      console.error(e)
      setError('Download failed: ' + e.message)
    } finally {
      setDownloading(false)
      setProgress(0)
    }
  }

  const fetchVideo = async (videoUrl = url) => {
    setError(null)
    setInfo(null)
    if (!url) return setError('Please enter a video URL')
    setLoadingInfo(true)
    try {
      if (typeof url !== 'string') {
        setError('Invalid URL')
        setLoadingInfo(false)
        return
      }

      const resp = await fetch(`${SERVER_BASE}/info?url=${encodeURIComponent(url)}`)
      if (!resp.ok) {
        const txt = await resp.text().catch(()=>null)
        setError(txt || 'Failed to get video info')
        setLoadingInfo(false)
        return
      }
      const data = await resp.json()
      setInfo(data)
      // Auto-select smallest filesize format for fastest download when available
      if (data.formats && data.formats.length) {
        let smallest = null
        for (const f of data.formats) {
          const size = f.filesize || null
          if (size == null) continue
          if (!smallest || size < smallest.size) smallest = { format: f.format || f.format_id, size }
        }
      } else {
      }
    } catch (e) {
      setError('Failed to fetch video')
    } finally {
      setLoadingInfo(false)
    }
  }

  // Auto-fetch info when URL query parameter `?url=` is present
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const u = params.get('url')
      if (u) {
        setUrl(u)
        // slight delay to ensure state is set
        setTimeout(() => fetchVideo(), 50)
      }
    } catch (e) {
      // ignore
    }
  }, [])

  // No format selection; server will choose best available format

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="sm" sx={{py:8, minHeight: '100vh', display:'flex', flexDirection:'column', alignItems:'center'}}>
        <Box className="topbar" sx={{mb:4}}>
          <Box sx={{textAlign:'left'}}>
            <Typography variant="h5" component="h1" sx={{fontWeight:700, letterSpacing: '-0.02em'}}>YouTube Video Downloader</Typography>
            <Typography variant="subtitle2" color="text.secondary">Paste a video or page URL to preview and download</Typography>
          </Box>
          <Tooltip title="Toggle theme">
            <IconButton onClick={colorMode.toggle} color="inherit">
              {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>
        </Box>

        <Card className="glass-card" sx={{width: '100%'}}>
          <CardContent>
            <Box component="form" onSubmit={handleDownload} sx={{display:'flex',gap:2,flexDirection:{xs:'column',sm:'row'}}}>
              <TextField fullWidth placeholder="https://example.com/video.mp4 or a page URL" value={url} onChange={e=>setUrl(e.target.value)} variant="outlined" size="small" />
              <Button variant="contained" color="primary" onClick={fetchVideo} disabled={loadingInfo} sx={{px:3}}> {loadingInfo ? 'Loading...' : 'Fetch'}</Button>
              <Button variant="outlined" onClick={handleDownload} sx={{px:3}}>Download</Button>
            </Box>
          </CardContent>
        </Card>

        {info && (
          <Card sx={{mt:3}}>
            <CardContent sx={{display:'flex',gap:2}}>
              {info.thumbnail && <Box component="img" src={info.thumbnail} sx={{width:160, borderRadius:1}} />}
              <Box>
                <Typography variant="h6">{info.title}</Typography>
                {info.uploader && <Typography color="text.secondary">{info.uploader}</Typography>}
                {info.duration != null && <Typography color="text.secondary">Duration: {Math.round(info.duration)}s</Typography>}
                <Box sx={{mt:2}}>
                  <Button variant="contained" onClick={() => {
                    const downloadUrl = `${SERVER_BASE}/download?url=${encodeURIComponent(info.webpage_url || url)}`
                    fetchDownload(downloadUrl)
                  }}>{downloading ? 'Starting...' : 'Download'}</Button>
                </Box>
              </Box>
            </CardContent>
          </Card>
        )}

        {downloading && (
          <Box sx={{mt:3}}>
            <LinearProgress variant={totalBytes? 'determinate':'indeterminate'} value={progress} />
            <Typography variant="body2" sx={{mt:1}}>{totalBytes ? `${progress}% — ${Math.round(downloadedBytes/1024)} KB / ${Math.round(totalBytes/1024)} KB` : `${Math.round(downloadedBytes/1024)} KB downloaded`}</Typography>
          </Box>
        )}

        {error && <Typography color="error" sx={{mt:2}}>{error}</Typography>}
      </Container>
    </ThemeProvider>
  )
}
