const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8765;
const DIR = __dirname;

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
};

// ===== 内置 PeerJS 信令服务器（国内直连，无需VPN） =====
// 简易信令服务器：基于 HTTP 轮询，无需额外依赖
const peers = {};        // peerId -> { lastSeen, offers: [], answers: [], candidates: [] }
const CLEANUP_INTERVAL = 30000; // 30秒清理过期peer
const PEER_TIMEOUT = 60000;     // 60秒未活跃视为离线

function handlePeerJSRequest(req, res, urlPath) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return true;
    }

    // POST /peerjs/offer  — 发送offer给目标peer
    // POST /peerjs/answer — 发送answer给目标peer
    // POST /peerjs/candidate — 发送ICE candidate给目标peer
    // GET  /peerjs/poll/:peerId — 轮询获取消息
    // POST /peerjs/register — 注册peer
    // DELETE /peerjs/:peerId — 注销peer
    // GET  /peerjs/peers — 列出在线peers（仅调试）

    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        const bodyStr = Buffer.concat(body).toString();
        let data = {};
        try { data = bodyStr ? JSON.parse(bodyStr) : {}; } catch(e) {}

        // 注册
        if (urlPath === '/peerjs/register' && req.method === 'POST') {
            const peerId = data.id;
            if (!peerId) { res.writeHead(400); res.end('{"error":"missing id"}'); return; }
            peers[peerId] = peers[peerId] || { lastSeen: Date.now(), messages: [] };
            peers[peerId].lastSeen = Date.now();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ type: 'registered' }));
            return;
        }

        // 轮询获取消息
        const pollMatch = urlPath.match(/^\/peerjs\/poll\/(.+)$/);
        if (pollMatch && req.method === 'GET') {
            const peerId = decodeURIComponent(pollMatch[1]);
            if (peers[peerId]) {
                peers[peerId].lastSeen = Date.now();
                const msgs = peers[peerId].messages.splice(0); // 取走所有消息
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(msgs));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end('{"error":"peer not found"}');
            }
            return;
        }

        // 发送消息（offer/answer/candidate）
        if ((urlPath === '/peerjs/message' || urlPath === '/peerjs/offer' || 
             urlPath === '/peerjs/answer' || urlPath === '/peerjs/candidate') && req.method === 'POST') {
            const targetId = data.to;
            if (!targetId || !peers[targetId]) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end('{"error":"target peer not found"}');
                return;
            }
            // 存入目标peer的消息队列
            peers[targetId].messages.push({
                from: data.from,
                type: data.type, // 'offer', 'answer', 'candidate'
                payload: data.payload,
                timestamp: Date.now(),
            });
            peers[targetId].lastSeen = Date.now();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"type":"delivered"}');
            return;
        }

        // 注销
        const deleteMatch = urlPath.match(/^\/peerjs\/(.+)$/);
        if (deleteMatch && req.method === 'DELETE') {
            const peerId = decodeURIComponent(deleteMatch[1]);
            delete peers[peerId];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"type":"deleted"}');
            return;
        }

        // 列出peers（调试）
        if (urlPath === '/peerjs/peers' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(Object.keys(peers)));
            return;
        }

        // 不匹配的信令路由
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":"unknown signaling route"}');
    });
    return true;
}

// 定期清理过期peer
setInterval(() => {
    const now = Date.now();
    for (const [id, peer] of Object.entries(peers)) {
        if (now - peer.lastSeen > PEER_TIMEOUT) {
            delete peers[id];
        }
    }
}, CLEANUP_INTERVAL);

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0]; // 去掉query string
    
    // PeerJS 信令路由
    if (urlPath.startsWith('/peerjs')) {
        handlePeerJSRequest(req, res, urlPath);
        return;
    }

    // 静态文件服务
    let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found: ' + req.url);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}/`);
    console.log(`PeerJS signaling server at http://0.0.0.0:${PORT}/peerjs/`);
    console.log(`国内玩家直连，无需VPN！`);
});
