/* ============ 泡泡糖大作战 · 零依赖联机服务器 ============ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_URL_FILE = path.join(ROOT, 'public-url.txt');
const MAX_PLAYERS = 4;
const MAX_MESSAGE = 96 * 1024;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALLOWED_AVATARS = new Set(['bunny', 'cat', 'bear', 'frog', 'penguin', 'fox']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8'
};

const rooms = new Map();
let nextClientId = 1;
let nextRoomSeq = 0;

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal) out.push('http://' + net.address + ':' + PORT);
    });
  });
  return out;
}
const LAN_ADDRESSES = lanAddresses();

function openBrowser(url) {
  if (process.env.AUTO_OPEN !== '1') return;
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`, { windowsHide: true });
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`, { windowsHide: true });
    } else {
      exec(`xdg-open "${url}"`, { windowsHide: true });
    }
  } catch (e) { /* 打不开浏览器也不影响游戏 */ }
}

function publicUrl() {
  try {
    const fromFile = fs.readFileSync(PUBLIC_URL_FILE, 'utf8').trim();
    if (/^https?:\/\/\S+$/i.test(fromFile)) return fromFile.replace(/\/+$/, '');
  } catch (e) { /* 还没有公网地址文件 */ }
  const fromEnv = String(process.env.PUBLIC_URL || '').trim();
  return /^https?:\/\//i.test(fromEnv) ? fromEnv.replace(/\/+$/, '') : '';
}

function nowId() { return 'p' + (nextClientId++); }

function sanitizeText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max || 8);
}

function avatarOf(value) {
  return ALLOWED_AVATARS.has(value) ? value : 'bunny';
}

function roomCode() {
  for (let tries = 0; tries < 200; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    // 避免连续重复的字母，念起来更清楚
    if (!rooms.has(code) && !/(.)\1/.test(code)) return code;
  }
  return 'P' + String(++nextRoomSeq).padStart(3, '0').slice(-3);
}

function roomPlayers(room) {
  return Array.from(room.members.values()).map(c => ({
    id: c.id,
    name: c.name,
    avatar: c.avatar,
    isHost: c.id === room.hostId
  }));
}

function sendTo(client, obj) {
  if (!client || !client.ws) return;
  client.ws.sendJson(obj);
}

function broadcastRoom(room, exceptId) {
  const payload = { t: 'room', code: room.code, players: roomPlayers(room), locked: room.locked, hostId: room.hostId };
  room.members.forEach(c => {
    if (c.id !== exceptId) sendTo(c, payload);
  });
}

function leaveRoom(client, reason) {
  if (!client || !client.room) return;
  const room = rooms.get(client.room);
  if (!room) { client.room = null; return; }
  const wasHost = room.hostId === client.id;
  room.members.delete(client.id);
  client.room = null;

  if (wasHost) {
    room.members.forEach(c => {
      sendTo(c, { t: 'closed', reason: reason || '房主离开了房间' });
      c.room = null;
    });
    rooms.delete(room.code);
    log(`房间 ${room.code} 已关闭（房主离开）`);
    return;
  }

  room.members.forEach(c => {
    sendTo(c, { t: 'peer-left', id: client.id, name: client.name });
  });
  broadcastRoom(room, null);
  log(`玩家 ${client.name} 离开房间 ${room.code}，剩余 ${room.members.size} 人`);
}

function log(msg) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

/* ---------------- WebSocket 帧实现 ---------------- */
class WSClient {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.ws = this;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.alive = true;
    this.closed = false;
    this.id = nowId();
    this.name = '泡泡玩家';
    this.avatar = 'bunny';
    this.room = null;
    socket.setNoDelay(true);
    socket.on('data', chunk => this.onData(chunk));
    socket.on('error', () => this.terminate());
    socket.on('close', () => {
      this.closed = true;
      leaveRoom(this, '网络连接断开');
    });
  }

  sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      this.terminate();
    }
  }

  sendJson(obj) {
    try {
      const text = JSON.stringify(obj);
      this.sendFrame(1, Buffer.from(text, 'utf8'));
    } catch (e) {
      this.terminate();
    }
  }

  ping() {
    this.alive = false;
    this.sendFrame(9, Buffer.alloc(0));
  }

  close(code, reason) {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason || ''));
    body.writeUInt16BE(code || 1000, 0);
    if (reason) body.write(reason, 2, 'utf8');
    try { this.sendFrame(8, body); } catch (e) { /* ignore */ }
    this.closed = true;
    try { this.socket.end(); } catch (e) { /* ignore */ }
    setTimeout(() => this.terminate(), 300);
  }

  terminate() {
    this.closed = true;
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > MAX_MESSAGE * 2) { this.close(1009, '消息太大'); return; }
    while (true) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) { this.close(1009, '消息太大'); return; }
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_MESSAGE) { this.close(1009, '消息太大'); return; }
      if (!masked) { this.close(1002, '缺少掩码'); return; }
      if (buf.length < offset + 4 + len) return;
      const mask = buf.subarray(offset, offset + 4);
      const payload = Buffer.from(buf.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(offset + 4 + len);

      if (opcode === 8) {
        this.closed = true;
        try { this.socket.end(); } catch (e) { /* ignore */ }
        return;
      }
      if (opcode === 9) { this.sendFrame(10, payload); continue; }
      if (opcode === 10) { this.alive = true; continue; }

      if (opcode === 0) {
        if (!this.fragmentOpcode) { this.close(1002, '无效分片'); return; }
        this.fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragments);
          const op = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = 0;
          if (op === 1) this.onMessage(full.toString('utf8'));
        }
        continue;
      }
      if (opcode === 1 || opcode === 2) {
        if (!fin) {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
        } else if (opcode === 1) {
          this.onMessage(payload.toString('utf8'));
        }
      }
    }
  }

  onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) {
      sendTo(this, { t: 'error', msg: '消息格式不正确' });
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    handleMessage(this, msg);
  }
}

function handleMessage(client, msg) {
  switch (msg.t) {
    case 'create': {
      leaveRoom(client, '重新创建房间');
      client.name = sanitizeText(msg.name, 8) || '泡泡玩家';
      client.avatar = avatarOf(msg.avatar);
      const code = roomCode();
      const room = {
        code,
        hostId: client.id,
        members: new Map(),
        locked: false,
        createdAt: Date.now()
      };
      room.members.set(client.id, client);
      client.room = code;
      rooms.set(code, room);
      sendTo(client, {
        t: 'created',
        code,
        you: client.id,
        hostId: room.hostId,
        players: roomPlayers(room)
      });
      log(`房间 ${code} 创建，房主 ${client.name}`);
      break;
    }
    case 'join': {
      const code = sanitizeText(String(msg.code || ''), 4).toUpperCase();
      const room = rooms.get(code);
      if (!room) { sendTo(client, { t: 'error', msg: '没有找到这个房间，检查一下口令吧' }); return; }
      if (room.locked) { sendTo(client, { t: 'error', msg: '这局游戏已经开始啦，等下一局吧' }); return; }
      if (room.members.size >= MAX_PLAYERS) { sendTo(client, { t: 'error', msg: '房间满员了（最多 4 人）' }); return; }
      if (room.members.has(client.id)) { sendTo(client, { t: 'error', msg: '你已经在这个房间里了' }); return; }
      leaveRoom(client, '加入新房间');
      client.name = sanitizeText(msg.name, 8) || '泡泡玩家';
      client.avatar = avatarOf(msg.avatar);
      room.members.set(client.id, client);
      client.room = code;
      sendTo(client, {
        t: 'joined',
        code,
        you: client.id,
        hostId: room.hostId,
        players: roomPlayers(room)
      });
      room.members.forEach(c => {
        if (c.id !== client.id) sendTo(c, { t: 'peer-joined', player: { id: client.id, name: client.name, avatar: client.avatar, isHost: false } });
      });
      broadcastRoom(room, null);
      log(`玩家 ${client.name} 加入房间 ${code}（${room.members.size}/4）`);
      break;
    }
    case 'lock': {
      if (!client.room) return;
      const room = rooms.get(client.room);
      if (!room || room.hostId !== client.id) return;
      room.locked = true;
      room.members.forEach(c => sendTo(c, { t: 'locked' }));
      break;
    }
    case 'unlock': {
      if (!client.room) return;
      const room = rooms.get(client.room);
      if (!room || room.hostId !== client.id) return;
      room.locked = false;
      broadcastRoom(room, null);
      break;
    }
    case 'relay': {
      if (!client.room) return;
      const room = rooms.get(client.room);
      if (!room || !room.members.has(client.id)) return;
      const payload = { t: 'relay', from: client.id, data: msg.data };
      let size = 0;
      try { size = JSON.stringify(payload).length; } catch (e) { return; }
      if (size > MAX_MESSAGE) return;
      room.members.forEach(c => {
        if (c.id !== client.id) sendTo(c, payload);
      });
      break;
    }
    case 'leave': {
      leaveRoom(client, '玩家主动离开');
      sendTo(client, { t: 'left' });
      break;
    }
    case 'ping': {
      sendTo(client, { t: 'pong', at: Date.now() });
      break;
    }
    default:
      break;
  }
}

/* ---------------- 静态文件 HTTP ---------------- */
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      game: '泡泡糖大作战',
      rooms: rooms.size,
      players: nextClientId - 1,
      lan: LAN_ADDRESSES,
      publicUrl: publicUrl()
    }));
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, '.' + pathname);
  const rootResolved = path.resolve(ROOT);
  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 · 找不到这个泡泡');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('upgrade', (req, socket, head) => {
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const key = req.headers['sec-websocket-key'];
  if (upgrade !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const client = new WSClient(socket, req);
  if (head && head.length) client.onData(head);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  端口 ${PORT} 上已经有一个泡泡糖服务器在运行。`);
    console.log(`  直接打开：http://localhost:${PORT}`);
    if (process.env.AUTO_OPEN === '1') {
      openBrowser('http://localhost:' + PORT);
    }
    console.log('');
    setTimeout(() => process.exit(0), 600);
  } else {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🫧  泡泡糖大作战 · 联机服务器已启动');
  console.log('');
  console.log('  本机打开:   http://localhost:' + PORT);
  LAN_ADDRESSES.forEach(url => console.log('  局域网加入: ' + url));
  console.log('');
  console.log('  单人 / 双人同屏不需要服务器也能玩。');
  console.log('  联机时把「局域网加入」地址发给同一 Wi-Fi 下的朋友。');
  console.log('  按 Ctrl+C 停止服务器。');
  console.log('');
  setTimeout(() => openBrowser('http://localhost:' + PORT), 350);
});

setInterval(() => {
  rooms.forEach(room => {
    room.members.forEach(c => {
      if (!c.alive) {
        log(`清理心跳超时连接 ${c.name}`);
        try { c.ws.terminate(); } catch (e) { /* ignore */ }
        return;
      }
      c.ws.ping();
    });
  });
}, 30000).unref();

process.on('SIGINT', () => {
  console.log('\n正在关闭服务器…');
  rooms.forEach(room => room.members.forEach(c => {
    try { c.ws.close(1001, '服务器关闭'); } catch (e) { /* ignore */ }
  }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
});
