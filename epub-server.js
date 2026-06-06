/**
 * epub-server.js 鈥?one-shot local HTTP server for Chrome extension file opening
 * Usage: node epub-server.js <epub-path> [extension-id]
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const epubPath = process.argv[2];
const extId    = process.argv[3] || 'eoopfbnganpgcbbpkbfjkkpakdpkgpfh';

if (!epubPath || !fs.existsSync(epubPath)) {
  process.exit(1);
}

const epubData = fs.readFileSync(epubPath);
const epubName = path.basename(epubPath);

// Find Chrome
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
];
const chromePath = chromeCandidates.find(p => { try { return fs.existsSync(p); } catch(_){ return false; } });
if (!chromePath) process.exit(1);

// Try ports 19876-19885 to avoid conflicts
let port = 19876;
tryListen();

function tryListen() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.url === '/book.epub') {
      res.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Content-Length': epubData.length });
      res.end(epubData);
      setTimeout(() => { try { server.close(); } catch(_){} }, 3000);
    } else {
      res.writeHead(404); res.end();
    }
  });

  server.on('error', () => {
    if (port < 19885) { port++; tryListen(); }
    else { openChrome(19876); } // fallback: try anyway
  });

  server.listen(port, '127.0.0.1', () => {
    openChrome(port);
    setTimeout(() => { try { server.close(); } catch(_){} }, 60000);
  });
}

function openChrome(p) {
  const name = encodeURIComponent(epubName);
  const url  = 'chrome-extension://' + extId +
               '/bookshelf/bookshelf.html' +
               '?serve=http%3A%2F%2F127.0.0.1%3A' + p + '%2Fbook.epub' +
               '&name=' + name;
  exec('"' + chromePath + '" "' + url + '"');
}

