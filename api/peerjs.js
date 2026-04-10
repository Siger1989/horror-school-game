// Vercel Serverless Function — PeerJS 信令服务器（国内直连）
// 通过 rewrite: /api/peerjs/* → /api/peerjs (本文件)
// 从 req.url 解析具体路由

if (!globalThis._signalPeers) globalThis._signalPeers = {};
if (!globalThis._lastCleanup) globalThis._lastCleanup = 0;
const CLEANUP_MS = 60000;

function cleanup() {
    const now = Date.now();
    if (now - globalThis._lastCleanup < CLEANUP_MS) return;
    globalThis._lastCleanup = now;
    for (const [id, peer] of Object.entries(globalThis._signalPeers)) {
        if (now - peer.lastSeen > CLEANUP_MS) delete globalThis._signalPeers[id];
    }
}

function parseBody(req) {
    return new Promise((resolve) => {
        if (req.body && typeof req.body === 'object') return resolve(req.body);
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(data)); } catch(e) { resolve({}); }
        });
    });
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    cleanup();

    // 解析路径 — req.url 可能被 rewrite 追加了 query 参数
    // 例如: /api/peerjs/peers?path=peers 或 /api/peerjs/poll/room-123?path=poll%2Froom-123
    const url = (req.url || '').split('?')[0]; // 去掉 query string
    const pathMatch = url.match(/^\/api\/peerjs\/?(.*)/);
    const pathAfter = pathMatch ? pathMatch[1] : '';
    const segments = pathAfter.split('/').filter(Boolean);
    const action = segments[0] || '';
    const subPath = segments.slice(1).join('/');

    // GET /api/peerjs/peers
    if (action === 'peers' && req.method === 'GET') {
        return res.status(200).json(Object.keys(globalThis._signalPeers));
    }

    // POST /api/peerjs/register
    if (action === 'register' && req.method === 'POST') {
        const body = await parseBody(req);
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'missing id' });
        globalThis._signalPeers[id] = globalThis._signalPeers[id] || { lastSeen: Date.now(), messages: [] };
        globalThis._signalPeers[id].lastSeen = Date.now();
        return res.status(200).json({ type: 'registered' });
    }

    // POST /api/peerjs/message
    if (action === 'message' && req.method === 'POST') {
        const body = await parseBody(req);
        const { to, from, type, payload } = body;
        if (!to || !globalThis._signalPeers[to]) return res.status(404).json({ error: 'target peer not found' });
        globalThis._signalPeers[to].messages.push({ from, type, payload, timestamp: Date.now() });
        globalThis._signalPeers[to].lastSeen = Date.now();
        return res.status(200).json({ type: 'delivered' });
    }

    // GET /api/peerjs/poll/:id — 轮询消息
    if (action === 'poll' && req.method === 'GET' && subPath) {
        const peerId = decodeURIComponent(subPath);
        const peer = globalThis._signalPeers[peerId];
        if (!peer) return res.status(200).json([]);
        peer.lastSeen = Date.now();
        const msgs = peer.messages.splice(0);
        return res.status(200).json(msgs);
    }

    // DELETE /api/peerjs/poll/:id — 注销
    if (action === 'poll' && req.method === 'DELETE' && subPath) {
        const peerId = decodeURIComponent(subPath);
        delete globalThis._signalPeers[peerId];
        return res.status(200).json({ type: 'deleted' });
    }

    return res.status(404).json({ error: 'unknown route', debug: { url, action, subPath, segments, method: req.method } });
}
