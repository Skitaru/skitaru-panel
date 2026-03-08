'use strict';

const express  = require('express');
const { WebSocketServer } = require('ws');
const multer   = require('multer');
const http     = require('http');
const https    = require('https');
const { spawn, exec } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const net      = require('net');
const crypto   = require('crypto');
const url      = require('url');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PORT        = process.env.PORT || 8080;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) { console.error('[FATAL] config.json fehlt.'); process.exit(1); }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Sessions ──────────────────────────────────────────────────
const sessions = new Map();

function hashPassword(pw, salt) {
  return crypto.createHmac('sha256', salt).update(pw).digest('hex');
}
function authenticate(req) {
  const token = req.headers['x-auth-token'] || req.query._t;
  if (!token) return false;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expires) { sessions.delete(token); return false; }
  s.expires = Date.now() + 8 * 3600 * 1000;
  return true;
}
function authMw(req, res, next) {
  if (authenticate(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Multer ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dest = safeServerPath(req.params.name, req.query.dir || '');
      if (!dest) return cb(new Error('Ungültiger Pfad'));
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

function safeServerPath(serverName, subPath) {
  const base   = path.resolve(`/opt/${serverName}/data`);
  const target = path.resolve(path.join(base, subPath || ''));
  return target.startsWith(base) ? target : null;
}

// ── Helpers ───────────────────────────────────────────────────
function run(cmd) {
  return new Promise((res, rej) =>
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, out, err2) =>
      err ? rej(err2 || err.message) : res(out.trim())
    )
  );
}

function fetchJson(u) {
  return new Promise((res, rej) => {
    https.get(u, { headers: { 'User-Agent': 'skitaru-panel/2' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } });
    }).on('error', rej);
  });
}

function downloadFile(fileUrl, dest, onProgress) {
  return new Promise((res, rej) => {
    const file = fs.createWriteStream(dest);
    https.get(fileUrl, { headers: { 'User-Agent': 'skitaru-panel/2' } }, r => {
      const total = parseInt(r.headers['content-length'] || '0');
      let received = 0;
      r.on('data', c => { received += c.length; if (onProgress && total) onProgress(Math.round(received/total*100)); });
      r.pipe(file);
      file.on('finish', () => file.close(res));
    }).on('error', e => { fs.unlink(dest, () => {}); rej(e); });
  });
}

// ── Port Check ────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start) {
  const usedPorts = new Set();
  try {
    const out = await run(`docker ps -a --format '{{.Ports}}'`);
    for (const m of out.matchAll(/:(\d+)->/g)) usedPorts.add(parseInt(m[1]));
  } catch {}
  let port = start;
  while (usedPorts.has(port) || !(await isPortFree(port))) port++;
  return port;
}

// ── Docker ───────────────────────────────────────────────────
async function listContainers() {
  try {
    const out = await run(`docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","status":"{{.Status}}","image":"{{.Image}}","ports":"{{.Ports}}","created":"{{.RunningFor}}"}'`);
    return out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function containerStats(name) {
  try {
    const out = await run(`docker stats --no-stream --format '{"cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}"}' ${name}`);
    return JSON.parse(out);
  } catch { return null; }
}

// ── RCON ─────────────────────────────────────────────────────
function rconSend(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);
    let buf = Buffer.alloc(0), authed = false;
    const tid = setTimeout(() => { socket.destroy(); reject(new Error('RCON Timeout – Server noch nicht vollständig gestartet?')); }, 6000);
    const write = (id, type, payload) => {
      const p = Buffer.from(payload, 'utf8');
      const pkt = Buffer.allocUnsafe(14 + p.length);
      pkt.writeInt32LE(8 + p.length + 2, 0);
      pkt.writeInt32LE(id, 4);
      pkt.writeInt32LE(type, 8);
      p.copy(pkt, 12);
      pkt.writeUInt8(0, 12 + p.length);
      pkt.writeUInt8(0, 13 + p.length);
      socket.write(pkt);
    };
    socket.on('connect', () => write(1, 3, password));
    socket.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 14) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;
        const id = buf.readInt32LE(4);
        const payload = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (!authed) {
          if (id === -1) { clearTimeout(tid); socket.destroy(); return reject(new Error('RCON Auth fehlgeschlagen')); }
          authed = true;
          write(2, 2, command);
        } else { clearTimeout(tid); socket.destroy(); resolve(payload || '(OK)'); }
      }
    });
    socket.on('error', e => { clearTimeout(tid); reject(e); });
  });
}

// ── Static ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── System ────────────────────────────────────────────────────
app.get('/api/system', authMw, async (_req, res) => {
  try {
    const out = await run("grep MemTotal /proc/meminfo");
    const totalGB = Math.floor(parseInt(out.match(/\d+/)[0]) / 1024 / 1024);
    res.json({ ramGB: totalGB });
  } catch { res.json({ ramGB: 64 }); }
});

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Fehlende Felder' });
  const config = loadConfig();
  if (username !== config.username || hashPassword(password, config.salt) !== config.passwordHash)
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + 8 * 3600 * 1000 });
  res.json({ token, username });
});
app.post('/api/logout', authMw, (req, res) => { sessions.delete(req.headers['x-auth-token']); res.json({ ok: true }); });
app.get('/api/me', authMw, (req, res) => { const s = sessions.get(req.headers['x-auth-token']); res.json({ username: s?.username || 'admin' }); });

// ── Containers ────────────────────────────────────────────────
app.get('/api/containers', authMw, async (_req, res) => res.json(await listContainers()));
app.get('/api/containers/:name/stats', authMw, async (req, res) => res.json(await containerStats(req.params.name) || {}));

app.post('/api/containers/:name/:action', authMw, async (req, res) => {
  const { name, action } = req.params;
  if (!['start','stop','restart'].includes(action)) return res.status(400).json({ error: 'Ungültig' });
  try { await run(action === 'stop' ? `docker stop -t 30 ${name}` : `docker ${action} ${name}`); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/containers/:name', authMw, async (req, res) => {
  const { name } = req.params;
  if (!/^[a-z0-9-]+$/.test(name)) return res.status(400).json({ error: 'Ungültiger Name' });
  try {
    await run(`docker stop -t 10 ${name}`).catch(() => {});
    await run(`docker rm ${name}`).catch(() => {});
    await run(`docker rmi ${name}`).catch(() => {});
    const dir = `/opt/${name}`;
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/containers/:name/command', authMw, async (req, res) => {
  const { name } = req.params;
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Kein Befehl' });
  const cfgPath = `/opt/${name}/rcon.json`;
  if (!fs.existsSync(cfgPath)) return res.status(404).json({ error: 'RCON Konfig fehlt – Server manuell erstellt?' });
  const { password, rconPort } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  try {
    const response = await rconSend('127.0.0.1', rconPort, password, command);
    res.json({ ok: true, response });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Server Info ───────────────────────────────────────────────
app.get('/api/servers/:name/info', authMw, (req, res) => {
  const p = `/opt/${req.params.name}/panel.json`;
  if (!fs.existsSync(p)) return res.status(404).json({});
  res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
});

// ── Files ─────────────────────────────────────────────────────
app.get('/api/files/:name', authMw, (req, res) => {
  const dir = safeServerPath(req.params.name, req.query.dir || '');
  if (!dir) return res.status(400).json({ error: 'Ungültiger Pfad' });
  if (!fs.existsSync(dir)) return res.json({ entries: [], cwd: req.query.dir || '' });
  try {
    const entries = fs.readdirSync(dir).map(name => {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        return { name, type: stat.isDirectory() ? 'dir' : 'file', size: stat.size, modified: stat.mtime.toISOString() };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name));
    res.json({ entries, cwd: req.query.dir || '' });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/files/:name/content', authMw, (req, res) => {
  const fp = safeServerPath(req.params.name, req.query.path || '');
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    if (fs.statSync(fp).size > 2 * 1024 * 1024) return res.status(413).json({ error: 'Datei zu groß (max 2MB)' });
    res.json({ content: fs.readFileSync(fp, 'utf8'), path: req.query.path });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/files/:name/content', authMw, (req, res) => {
  const fp = safeServerPath(req.params.name, req.query.path || '');
  if (!fp) return res.status(400).json({ error: 'Ungültiger Pfad' });
  try { fs.writeFileSync(fp, req.body.content || '', 'utf8'); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/files/:name', authMw, (req, res) => {
  const fp = safeServerPath(req.params.name, req.query.path || '');
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    fs.statSync(fp).isDirectory() ? fs.rmSync(fp, { recursive: true }) : fs.unlinkSync(fp);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/files/:name/upload', authMw, (req, res) => {
  upload.array('files')(req, res, err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, count: req.files?.length || 0 });
  });
});

app.get('/api/files/:name/download', authMw, (req, res) => {
  const fp = safeServerPath(req.params.name, req.query.path || '');
  if (!fp || !fs.existsSync(fp)) return res.status(404).end('Nicht gefunden');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fp)}"`);
  res.sendFile(fp);
});

app.post('/api/files/:name/mkdir', authMw, (req, res) => {
  const dp = safeServerPath(req.params.name, req.body.path || '');
  if (!dp) return res.status(400).json({ error: 'Ungültiger Pfad' });
  try { fs.mkdirSync(dp, { recursive: true }); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: String(e) }); }
});

// ── Paper Versions ────────────────────────────────────────────
app.get('/api/paper/versions', authMw, async (_req, res) => {
  try {
    const data = await fetchJson('https://api.papermc.io/v2/projects/paper');
    res.json([...data.versions].reverse()); // ALL versions, newest first
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

// ── WebSocket ─────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const token  = parsed.query._t;
  if (!token || !sessions.has(token) || Date.now() > sessions.get(token).expires) { ws.close(4001, 'Unauthorized'); return; }
  const pathname = parsed.pathname;
  if (pathname.startsWith('/ws/logs/')) handleLogs(ws, pathname.replace('/ws/logs/', ''));
  else if (pathname === '/ws/create') handleCreate(ws);
});

function handleLogs(ws, name) {
  const send = d => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'log', data: d }));
  send(`\x1b[32m► Verbinde mit "${name}"...\x1b[0m\n`);
  const proc = spawn('docker', ['logs', '-f', '--tail', '400', name]);
  proc.stdout.on('data', d => send(d.toString()));
  proc.stderr.on('data', d => send(d.toString()));
  proc.on('close', () => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'log', data: '\x1b[33m► Stream beendet.\x1b[0m\n' })));
  ws.on('close', () => proc.kill());
  ws.on('error', () => proc.kill());
}

function handleCreate(ws) {
  const log = (msg, type = 'output') => ws.readyState === 1 && ws.send(JSON.stringify({ type, data: msg }));
  ws.on('message', async raw => {
    let cfg;
    try { cfg = JSON.parse(raw); } catch { return log('Ungültige Konfiguration', 'error'); }
    try { await buildServer(cfg, log); }
    catch(e) { log(`FEHLER: ${e.message}`, 'error'); }
  });
}

async function buildServer(config, log) {
  let { version, name, port, ram, maxPlayers, difficulty, gamemode, onlineMode, motd } = config;
  name = (name || 'minecraft-server').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');

  const requestedPort = parseInt(port) || 25565;
  log(`► Prüfe Port ${requestedPort}...`);
  port = await findFreePort(requestedPort);
  if (port !== requestedPort) log(`  Port ${requestedPort} belegt → verwende Port ${port}.`);
  else log(`  Port ${port} ist frei.`);

  const rconPort  = await findFreePort(port + 10);
  const serverDir = `/opt/${name}`;
  const dataDir   = `${serverDir}/data`;

  if (fs.existsSync(serverDir)) throw new Error(`Server "${name}" existiert bereits`);

  log(`► Suche Build für Paper ${version}...`);
  const buildData   = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
  const builds      = buildData.builds;
  if (!builds?.length) throw new Error(`Kein Build für ${version}`);
  const latestBuild = builds[builds.length - 1].build;
  const jarName     = `paper-${version}-${latestBuild}.jar`;
  const dlUrl       = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/${jarName}`;
  log(`  Build ${latestBuild} gefunden.`);

  log(`► Erstelle Verzeichnisse...`);
  fs.mkdirSync(dataDir, { recursive: true });

  log(`► Lade paper.jar herunter...`);
  const jarPath = `${dataDir}/paper.jar`;
  await downloadFile(dlUrl, jarPath, pct => log(`  Download ${pct}%`, 'progress'));
  try { fs.chownSync(dataDir, 1001, 1001); fs.chownSync(jarPath, 1001, 1001); } catch {}

  fs.writeFileSync(`${dataDir}/eula.txt`, 'eula=true\n');
  try { fs.chownSync(`${dataDir}/eula.txt`, 1001, 1001); } catch {}

  const rconPass  = crypto.randomBytes(12).toString('hex');
  const serverMotd = motd || `${name} | Paper ${version}`;

  const props = [
    `server-port=${port}`, `enable-rcon=true`, `rcon.port=${rconPort}`,
    `rcon.password=${rconPass}`, `motd=${serverMotd}`,
    `max-players=${maxPlayers || 20}`, `difficulty=${difficulty || 'normal'}`,
    `gamemode=${gamemode || 'survival'}`, `level-name=world`,
    `online-mode=${onlineMode !== false}`, `allow-flight=false`,
    `view-distance=10`, `simulation-distance=10`,
  ].join('\n');
  fs.writeFileSync(`${dataDir}/server.properties`, props + '\n');
  try { fs.chownSync(`${dataDir}/server.properties`, 1001, 1001); } catch {}

  fs.writeFileSync(`${serverDir}/rcon.json`,  JSON.stringify({ password: rconPass, rconPort }));
  fs.writeFileSync(`${serverDir}/panel.json`, JSON.stringify({ name, version, build: latestBuild, port, rconPort, ram, maxPlayers, difficulty, gamemode, onlineMode, motd: serverMotd, created: new Date().toISOString() }));

  const jvmOpts = `-Xms512M -Xmx${ram} -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1`;

  fs.writeFileSync(`${serverDir}/Dockerfile`,
`FROM eclipse-temurin:21-jre-jammy
RUN useradd -m -u 1001 -s /bin/bash minecraft
WORKDIR /server
RUN chown minecraft:minecraft /server
ENV JVM_OPTS="${jvmOpts}"
EXPOSE ${port}/tcp ${port}/udp ${rconPort}/tcp
STOPSIGNAL SIGTERM
USER minecraft
CMD ["sh", "-c", "exec java $JVM_OPTS -jar /server/paper.jar --nogui"]
`);

  fs.writeFileSync(`${serverDir}/docker-compose.yml`,
`services:
  ${name}:
    build: { context: ., dockerfile: Dockerfile }
    container_name: ${name}
    restart: unless-stopped
    stdin_open: true
    tty: true
    ports:
      - "${port}:${port}/tcp"
      - "${port}:${port}/udp"
      - "${rconPort}:${rconPort}/tcp"
    volumes:
      - ./data:/server
    user: "1001:1001"
    environment:
      TZ: Europe/Berlin
    stop_grace_period: 30s
`);

  log(`► Baue Docker Image...`);
  await new Promise((resolve, reject) => {
    const proc = spawn('docker', ['compose', 'build', '--progress=plain'], { cwd: serverDir });
    proc.stdout.on('data', d => log(d.toString().trimEnd()));
    proc.stderr.on('data', d => log(d.toString().trimEnd()));
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Build fehlgeschlagen (code ${code})`)));
  });

  log(`► Starte Container...`);
  await new Promise((resolve, reject) => {
    const proc = spawn('docker', ['compose', 'up', '-d'], { cwd: serverDir });
    proc.stdout.on('data', d => log(d.toString().trimEnd()));
    proc.stderr.on('data', d => log(d.toString().trimEnd()));
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Start fehlgeschlagen (code ${code})`)));
  });

  log(`✔ Server "${name}" läuft auf Port ${port}!`, 'success');
}

server.listen(PORT, '0.0.0.0', () => console.log(`\x1b[32m[Skitaru Panel]\x1b[0m http://0.0.0.0:${PORT}`));
