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

// ── Config ───────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PORT        = process.env.PORT || 8080;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[FATAL] config.json nicht gefunden. Bitte install.sh ausführen.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// ── App ──────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Session Store ─────────────────────────────────────────────
// token -> { username, expires }
const sessions = new Map();

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function authenticate(req) {
  const token = req.headers['x-auth-token'] || req.query._t;
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expires) { sessions.delete(token); return false; }
  // Extend session
  session.expires = Date.now() + 8 * 60 * 60 * 1000;
  return true;
}

function authMiddleware(req, res, next) {
  if (authenticate(req)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Multer ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const destDir = getSafeServerPath(req.params.name, req.query.dir || '');
      if (!destDir) return cb(new Error('Invalid path'));
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// ── Path Safety ───────────────────────────────────────────────
function getSafeServerPath(serverName, subPath) {
  const base = path.resolve(`/opt/${serverName}/data`);
  const target = path.resolve(path.join(base, subPath || ''));
  if (!target.startsWith(base)) return null;
  return target;
}

// ── Helpers ───────────────────────────────────────────────────
function run(cmd) {
  return new Promise((resolve, reject) =>
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(stderr || err.message) : resolve(stdout.trim())
    )
  );
}

function fetchJson(reqUrl) {
  return new Promise((resolve, reject) => {
    https.get(reqUrl, { headers: { 'User-Agent': 'skitaru-panel/2.0' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(fileUrl, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(fileUrl, { headers: { 'User-Agent': 'skitaru-panel/2.0' } }, (res) => {
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        received += chunk.length;
        if (onProgress && total) onProgress(Math.round((received / total) * 100));
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── Docker ───────────────────────────────────────────────────
async function listContainers() {
  try {
    const out = await run(
      `docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","status":"{{.Status}}","image":"{{.Image}}","ports":"{{.Ports}}","created":"{{.RunningFor}}"}'`
    );
    return out.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
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
    let buf = Buffer.alloc(0);
    let authed = false;
    const tid = setTimeout(() => { socket.destroy(); reject(new Error('RCON timeout')); }, 5000);
    const write = (id, type, payload) => {
      const p = Buffer.from(payload, 'utf8');
      const pkt = Buffer.allocUnsafe(4 + 4 + 4 + p.length + 2);
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
        const id      = buf.readInt32LE(4);
        const payload = buf.slice(12, 4 + len - 2).toString('utf8');
        buf = buf.slice(4 + len);
        if (!authed) {
          if (id === -1) { clearTimeout(tid); socket.destroy(); return reject(new Error('RCON auth failed')); }
          authed = true;
          write(2, 2, command);
        } else {
          clearTimeout(tid);
          socket.destroy();
          resolve(payload);
        }
      }
    });
    socket.on('error', e => { clearTimeout(tid); reject(e); });
  });
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

// Static files (login page etc.)
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const config = loadConfig();
  if (!username || !password)
    return res.status(400).json({ error: 'Fehlende Zugangsdaten' });

  const hash = hashPassword(password, config.salt);
  if (username !== config.username || hash !== config.passwordHash)
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });

  const token = createToken();
  sessions.set(token, { username, expires: Date.now() + 8 * 60 * 60 * 1000 });
  res.json({ token, username });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const token = req.headers['x-auth-token'];
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const token = req.headers['x-auth-token'];
  const session = sessions.get(token);
  res.json({ username: session?.username || 'admin' });
});

// ── Containers ────────────────────────────────────────────────
app.get('/api/containers', authMiddleware, async (_req, res) => {
  res.json(await listContainers());
});

app.get('/api/containers/:name/stats', authMiddleware, async (req, res) => {
  const stats = await containerStats(req.params.name);
  res.json(stats || {});
});

app.post('/api/containers/:name/:action', authMiddleware, async (req, res) => {
  const { name, action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action))
    return res.status(400).json({ error: 'Invalid action' });
  try {
    if (action === 'stop') {
      await run(`docker stop -t 30 ${name}`);
    } else {
      await run(`docker ${action} ${name}`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/containers/:name', authMiddleware, async (req, res) => {
  const { name } = req.params;
  // Validate: only allow alphanumeric + hyphen
  if (!/^[a-z0-9-]+$/.test(name))
    return res.status(400).json({ error: 'Ungültiger Name' });
  try {
    await run(`docker stop -t 10 ${name}`).catch(() => {});
    await run(`docker rm ${name}`).catch(() => {});
    await run(`docker rmi ${name}`).catch(() => {});
    const serverDir = `/opt/${name}`;
    if (fs.existsSync(serverDir))
      fs.rmSync(serverDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/containers/:name/command', authMiddleware, async (req, res) => {
  const { name } = req.params;
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command' });
  const cfgPath = `/opt/${name}/rcon.json`;
  if (!fs.existsSync(cfgPath)) return res.status(404).json({ error: 'RCON config fehlt' });
  const { password, rconPort } = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  try {
    const response = await rconSend('127.0.0.1', rconPort, password, command);
    res.json({ ok: true, response });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Server Info ───────────────────────────────────────────────
app.get('/api/servers/:name/info', authMiddleware, (req, res) => {
  const cfgPath = `/opt/${req.params.name}/panel.json`;
  if (!fs.existsSync(cfgPath)) return res.status(404).json({});
  res.json(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
});

// ── File Manager ──────────────────────────────────────────────
app.get('/api/files/:name', authMiddleware, (req, res) => {
  const dir = getSafeServerPath(req.params.name, req.query.dir || '');
  if (!dir) return res.status(400).json({ error: 'Ungültiger Pfad' });
  if (!fs.existsSync(dir)) return res.json({ entries: [], cwd: req.query.dir || '' });

  try {
    const entries = fs.readdirSync(dir).map(name => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return {
        name,
        type:     stat.isDirectory() ? 'dir' : 'file',
        size:     stat.size,
        modified: stat.mtime.toISOString(),
      };
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ entries, cwd: req.query.dir || '' });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/files/:name', authMiddleware, (req, res) => {
  const filePath = getSafeServerPath(req.params.name, req.query.path || '');
  if (!filePath) return res.status(400).json({ error: 'Ungültiger Pfad' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Nicht gefunden' });
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true });
    else fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/files/:name/upload', authMiddleware, (req, res) => {
  upload.array('files')(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, count: req.files?.length || 0 });
  });
});

app.get('/api/files/:name/download', authMiddleware, (req, res) => {
  const filePath = getSafeServerPath(req.params.name, req.query.path || '');
  if (!filePath || !fs.existsSync(filePath))
    return res.status(404).json({ error: 'Nicht gefunden' });
  res.download(filePath);
});

app.post('/api/files/:name/mkdir', authMiddleware, (req, res) => {
  const dirPath = getSafeServerPath(req.params.name, req.body.path || '');
  if (!dirPath) return res.status(400).json({ error: 'Ungültiger Pfad' });
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

// ── PaperMC Versions ──────────────────────────────────────────
app.get('/api/paper/versions', authMiddleware, async (_req, res) => {
  try {
    const data = await fetchJson('https://api.papermc.io/v2/projects/paper');
    res.json([...data.versions].reverse().slice(0, 25));
  } catch(e) { res.status(500).json({ error: String(e) }); }
});

// ══════════════════════════════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════════════════════════════
wss.on('connection', (ws, req) => {
  const parsed = url.parse(req.url, true);
  const token  = parsed.query._t;

  // Auth check
  if (!token || !sessions.has(token) || Date.now() > sessions.get(token).expires) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const pathname = parsed.pathname;

  if (pathname.startsWith('/ws/logs/')) {
    const name = pathname.replace('/ws/logs/', '');
    handleLogs(ws, name);
  } else if (pathname === '/ws/create') {
    handleCreate(ws);
  }
});

function handleLogs(ws, name) {
  ws.send(JSON.stringify({ type: 'log', data: `\x1b[32m► Verbinde mit "${name}"...\x1b[0m\n` }));
  const proc = spawn('docker', ['logs', '-f', '--tail', '300', name]);
  const send = (data) => {
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ type: 'log', data: data.toString() }));
  };
  proc.stdout.on('data', send);
  proc.stderr.on('data', send);
  proc.on('close', () => {
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ type: 'log', data: '\x1b[33m► Log-Stream beendet.\x1b[0m\n' }));
  });
  ws.on('close', () => proc.kill());
  ws.on('error', () => proc.kill());
}

function handleCreate(ws) {
  const log = (msg, type = 'output') => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, data: msg }));
  };
  ws.on('message', async (raw) => {
    let config;
    try { config = JSON.parse(raw); } catch { return log('Ungültige Konfiguration', 'error'); }
    try {
      await buildServer(config, log);
    } catch(e) {
      log(`FEHLER: ${e.message}`, 'error');
    }
  });
}

async function buildServer(config, log) {
  let { version, name, port, ram, maxPlayers, difficulty, gamemode, onlineMode } = config;
  name  = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  port  = parseInt(port) || 25565;
  const rconPort = port + 10;
  const serverDir = `/opt/${name}`;
  const dataDir   = `${serverDir}/data`;

  if (fs.existsSync(serverDir))
    throw new Error(`Server "${name}" existiert bereits.`);

  log(`► Suche Build für Paper ${version}...`);
  const buildData = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
  const builds = buildData.builds;
  if (!builds?.length) throw new Error(`Kein Build für ${version} gefunden`);
  const latestBuild = builds[builds.length - 1].build;
  const jarName     = `paper-${version}-${latestBuild}.jar`;
  const dlUrl       = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild}/downloads/${jarName}`;
  log(`  Build ${latestBuild} gefunden.`);

  log(`► Erstelle Verzeichnisse...`);
  fs.mkdirSync(dataDir, { recursive: true });

  log(`► Lade paper.jar herunter...`);
  const jarPath = `${dataDir}/paper.jar`;
  await downloadFile(dlUrl, jarPath, (pct) => log(`  Download ${pct}%`, 'progress'));
  try { fs.chownSync(dataDir, 1001, 1001); fs.chownSync(jarPath, 1001, 1001); } catch {}
  log(`  paper.jar gespeichert.`);

  fs.writeFileSync(`${dataDir}/eula.txt`, 'eula=true\n');
  try { fs.chownSync(`${dataDir}/eula.txt`, 1001, 1001); } catch {}

  const rconPass = crypto.randomBytes(12).toString('hex');

  const props = [
    `server-port=${port}`,
    `enable-rcon=true`,
    `rcon.port=${rconPort}`,
    `rcon.password=${rconPass}`,
    `motd=§a${name} §7| Paper ${version}`,
    `max-players=${maxPlayers || 20}`,
    `difficulty=${difficulty || 'normal'}`,
    `gamemode=${gamemode || 'survival'}`,
    `level-name=world`,
    `online-mode=${onlineMode !== false ? 'true' : 'false'}`,
    `allow-flight=false`,
    `view-distance=10`,
    `simulation-distance=10`,
  ].join('\n');
  fs.writeFileSync(`${dataDir}/server.properties`, props + '\n');
  try { fs.chownSync(`${dataDir}/server.properties`, 1001, 1001); } catch {}

  fs.writeFileSync(`${serverDir}/rcon.json`,
    JSON.stringify({ password: rconPass, rconPort }));
  fs.writeFileSync(`${serverDir}/panel.json`,
    JSON.stringify({ name, version, build: latestBuild, port, rconPort, ram,
      maxPlayers, difficulty, gamemode, onlineMode, created: new Date().toISOString() }));

  const jvmOpts = `-Xms512M -Xmx${ram} -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true`;

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

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\x1b[32m[Skitaru Panel]\x1b[0m http://0.0.0.0:${PORT}`);
});
