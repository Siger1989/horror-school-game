// ============================================
// multiplayer.js — 联机系统（自定义信令 + PeerJS fallback）
// 国内直连：通过 Vercel API 做信令交换 + 原生 WebRTC P2P
// Fallback：PeerJS 公共服务器（需VPN）
// ============================================

const MP = {
    peer: null,
    connections: {},   // peerId -> { pc: RTCPeerConnection, dc: RTCDataChannel } 或 PeerJS DataConnection
    players: {},       // peerId -> { name, isHost }
    myId: null,
    myName: '玩家',
    isHost: false,
    roomId: null,
    maxPlayers: 3,
    inRoom: false,
    gameStarted: false,
    // 远程玩家在游戏中的3D对象
    remoteMeshes: {},
    // 自定义信令模式
    signalingMode: 'peerjs', // 'custom' 或 'peerjs'
    customSignalingUrl: null,
    pollInterval: null,
    // 原生 WebRTC
    rtcConfig: {
        iceServers: [
            { urls: 'stun:stun.qq.com:3478' },
            { urls: 'stun:stun.miwifi.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]
    },
};

// 生成6位房间号
function genRoomId() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// ===== 检测信令服务器 =====
async function detectSignalingServer() {
    // 1. 优先尝试 Vercel API 信令（/api/peerjs/ — 国内直连）
    try {
        const resp = await fetch(window.location.origin + '/api/peerjs/peers', {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) {
            console.log('[MP] 🟢 检测到 Vercel API 信令服务器（国内直连）');
            MP.signalingMode = 'custom';
            MP.customSignalingUrl = window.location.origin + '/api/peerjs';
            return true;
        }
    } catch(e) {
        console.log('[MP] Vercel API 信令不可用');
    }

    // 2. 本地 server.js 信令（/peerjs/ — 局域网/本机）
    const localUrl = `${window.location.protocol}//${window.location.hostname}:${window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}`;
    try {
        const resp = await fetch(localUrl + '/peerjs/peers', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        if (resp.ok) {
            console.log('[MP] 🟢 检测到本地信令服务器');
            MP.signalingMode = 'custom';
            MP.customSignalingUrl = localUrl + '/peerjs';
            return true;
        }
    } catch(e) {}
    
    // 3. fallback: PeerJS 公共服务器（需VPN）
    console.log('[MP] 🟡 无国内信令，fallback 到 PeerJS 公共服务器（需VPN）');
    MP.signalingMode = 'peerjs';
    return false;
}

// ===== 自定义信令：注册/轮询/发送 =====
async function customRegister(peerId) {
    try {
        await fetch(MP.customSignalingUrl + '/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: peerId }),
        });
    } catch(e) {
        console.error('[MP] 自定义信令注册失败:', e);
    }
}

async function customSend(from, to, type, payload) {
    try {
        await fetch(MP.customSignalingUrl + '/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, type, payload }),
        });
    } catch(e) {
        console.error('[MP] 自定义信令发送失败:', e);
    }
}

async function customPoll(peerId) {
    try {
        const resp = await fetch(MP.customSignalingUrl + '/poll/' + encodeURIComponent(peerId));
        if (resp.ok) {
            return await resp.json();
        }
    } catch(e) {}
    return [];
}

function startCustomPolling() {
    if (MP.pollInterval) clearInterval(MP.pollInterval);
    MP.pollInterval = setInterval(async () => {
        if (!MP.myId) return;
        const msgs = await customPoll(MP.myId);
        for (const msg of msgs) {
            handleCustomSignalingMessage(msg);
        }
    }, 500); // 每500ms轮询一次
}

function stopCustomPolling() {
    if (MP.pollInterval) {
        clearInterval(MP.pollInterval);
        MP.pollInterval = null;
    }
}

// ===== 原生 WebRTC 连接管理（自定义信令模式） =====

// 处理自定义信令消息（offer/answer/ice-candidate + 游戏逻辑）
function handleCustomSignalingMessage(msg) {
    const fromPeer = msg.from;
    const payload = msg.payload;
    
    switch(msg.type) {
        // === WebRTC 信令 ===
        case 'webrtc-offer':
            handleOffer(fromPeer, payload);
            break;
        case 'webrtc-answer':
            handleAnswer(fromPeer, payload);
            break;
        case 'webrtc-ice':
            handleRemoteICE(fromPeer, payload);
            break;
            
        // === 游戏逻辑信令 ===
        case 'join-room':
            // 有人要加入，先建立 WebRTC 连接
            MP.players[fromPeer] = { name: payload.name, isHost: false };
            // 主动发起 WebRTC 连接到加入者
            createRTCConnection(fromPeer, true);
            // 同时回复房间信息
            customSend(MP.myId, fromPeer, 'room-info', {
                name: MP.myName,
                isHost: MP.isHost,
                roomId: MP.roomId,
                players: MP.isHost ? getPlayersList() : null,
            });
            updateRoomUI();
            break;
            
        case 'room-info':
            if (!MP.players[fromPeer]) {
                MP.players[fromPeer] = { name: payload.name, isHost: payload.isHost || false };
            }
            if (payload.roomId) MP.roomId = payload.roomId;
            if (payload.players) {
                for (const [pid, info] of Object.entries(payload.players)) {
                    if (pid !== MP.myId) {
                        MP.players[pid] = info;
                    }
                }
            }
            updateRoomUI();
            break;
            
        case 'game-start':
            startMultiplayerGame(payload.seed);
            break;
            
        case 'player-state':
            updateRemotePlayer(fromPeer, payload);
            break;
            
        case 'player-left':
            delete MP.players[fromPeer];
            removeRemotePlayerMesh(fromPeer);
            closeRTCConnection(fromPeer);
            updateRoomUI();
            break;
            
        // === WebRTC DataChannel 数据（游戏实时同步） ===
        case 'dc-data':
            handleMessage(fromPeer, payload);
            break;
    }
}

// 创建原生 RTCPeerConnection
function createRTCConnection(peerId, isInitiator) {
    if (MP.connections[peerId]?.pc) {
        console.log('[MP] 已有连接:', peerId);
        return;
    }
    
    const pc = new RTCPeerConnection(MP.rtcConfig);
    let dc = null;
    
    const connObj = { pc, dc, open: false };
    MP.connections[peerId] = connObj;
    
    // ICE candidate → 通过自定义信令转发
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            customSend(MP.myId, peerId, 'webrtc-ice', event.candidate.toJSON());
        }
    };
    
    // 连接状态变化
    pc.onconnectionstatechange = () => {
        console.log(`[MP] ${peerId} 连接状态:`, pc.connectionState);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            closeRTCConnection(peerId);
            delete MP.players[peerId];
            removeRemotePlayerMesh(peerId);
            updateRoomUI();
        }
    };
    
    if (isInitiator) {
        // 发起方：创建 DataChannel
        dc = pc.createDataChannel('game-data', { ordered: true });
        setupDataChannel(dc, peerId, connObj);
        connObj.dc = dc;
        
        // 创建 offer
        pc.createOffer().then(offer => {
            return pc.setLocalDescription(offer);
        }).then(() => {
            customSend(MP.myId, peerId, 'webrtc-offer', pc.localDescription);
        }).catch(err => {
            console.error('[MP] 创建 offer 失败:', err);
        });
    } else {
        // 接收方：等待 DataChannel
        pc.ondatachannel = (event) => {
            dc = event.channel;
            setupDataChannel(dc, peerId, connObj);
            connObj.dc = dc;
        };
    }
}

// 设置 DataChannel 事件
function setupDataChannel(dc, peerId, connObj) {
    dc.onopen = () => {
        console.log('[MP] DataChannel 打开:', peerId);
        connObj.open = true;
        // 发送 hello
        dcSend(peerId, { type: 'hello', name: MP.myName, isHost: MP.isHost, hostId: MP.isHost ? MP.myId : null });
        if (MP.isHost) {
            const playerList = getPlayersList();
            dcSend(peerId, { type: 'player-list', players: playerList, roomId: MP.roomId });
        }
        updateRoomUI();
    };
    
    dc.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(peerId, data);
        } catch(e) {}
    };
    
    dc.onclose = () => {
        console.log('[MP] DataChannel 关闭:', peerId);
        connObj.open = false;
    };
    
    dc.onerror = (err) => {
        console.error('[MP] DataChannel 错误:', peerId, err);
    };
}

// 通过 DataChannel 发送数据
function dcSend(peerId, data) {
    const conn = MP.connections[peerId];
    if (conn && conn.dc && conn.dc.readyState === 'open') {
        conn.dc.send(JSON.stringify(data));
    } else if (MP.signalingMode === 'custom') {
        // fallback: 通过信令服务器转发
        customSend(MP.myId, peerId, 'dc-data', data);
    }
}

// 处理收到的 offer
async function handleOffer(fromPeer, offer) {
    let connObj = MP.connections[fromPeer];
    if (!connObj?.pc) {
        createRTCConnection(fromPeer, false);
        connObj = MP.connections[fromPeer];
    }
    const pc = connObj.pc;
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        customSend(MP.myId, fromPeer, 'webrtc-answer', pc.localDescription);
    } catch(err) {
        console.error('[MP] 处理 offer 失败:', err);
    }
}

// 处理收到的 answer
async function handleAnswer(fromPeer, answer) {
    const connObj = MP.connections[fromPeer];
    if (!connObj?.pc) return;
    
    try {
        await connObj.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch(err) {
        console.error('[MP] 处理 answer 失败:', err);
    }
}

// 处理远程 ICE candidate
async function handleRemoteICE(fromPeer, candidate) {
    const connObj = MP.connections[fromPeer];
    if (!connObj?.pc) return;
    
    try {
        await connObj.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch(err) {
        console.error('[MP] 添加 ICE candidate 失败:', err);
    }
}

// 关闭 WebRTC 连接
function closeRTCConnection(peerId) {
    const connObj = MP.connections[peerId];
    if (connObj) {
        if (connObj.dc) connObj.dc.close();
        if (connObj.pc) connObj.pc.close();
        delete MP.connections[peerId];
    }
}

// ===== PeerJS 初始化（fallback 模式） =====
function initPeer(peerId, callback) {
    if (MP.peer) { MP.peer.destroy(); MP.peer = null; }
    
    const config = {
        iceServers: MP.rtcConfig.iceServers
    };
    
    MP.peer = peerId ? new Peer(peerId, { config }) : new Peer({ config });
    
    MP.peer.on('open', (id) => {
        MP.myId = id;
        console.log('[MP] My peer ID:', id);
        if (callback) callback(id);
    });
    MP.peer.on('connection', (conn) => {
        handlePeerJSConnection(conn);
    });
    MP.peer.on('error', (err) => {
        console.error('[MP] Peer error:', err);
        if (err.type === 'unavailable-id') {
            setLobbyStatus('房间号已被占用，请换一个');
        } else if (err.type === 'network' || err.type === 'server-error') {
            setLobbyStatus('网络连接失败，请检查是否需要VPN或使用本地服务器');
        } else {
            setLobbyStatus('连接错误: ' + err.type);
        }
    });
    MP.peer.on('disconnected', () => {
        console.log('[MP] Disconnected from signaling server');
    });
}

// PeerJS DataConnection 处理
function handlePeerJSConnection(conn) {
    conn.on('open', () => {
        MP.connections[conn.peer] = conn; // PeerJS DataConnection 对象
        conn.send({ type: 'hello', name: MP.myName, isHost: MP.isHost, hostId: MP.isHost ? MP.myId : null });
        if (MP.isHost) {
            const playerList = getPlayersList();
            conn.send({ type: 'player-list', players: playerList, roomId: MP.roomId });
        }
        updateRoomUI();
    });

    conn.on('data', (data) => {
        handleMessage(conn.peer, data);
    });

    conn.on('close', () => {
        console.log('[MP] Connection closed:', conn.peer);
        delete MP.connections[conn.peer];
        delete MP.players[conn.peer];
        removeRemotePlayerMesh(conn.peer);
        updateRoomUI();
        broadcast({ type: 'player-left', peerId: conn.peer });
    });
}

// ===== 统一发送接口 =====
function sendTo(peerId, data) {
    const conn = MP.connections[peerId];
    if (!conn) return;
    
    if (MP.signalingMode === 'custom') {
        // 原生 WebRTC 模式
        dcSend(peerId, data);
    } else {
        // PeerJS 模式
        if (conn.open) conn.send(data);
    }
}

// 广播给所有连接
function broadcast(data) {
    for (const [peerId, conn] of Object.entries(MP.connections)) {
        if (MP.signalingMode === 'custom') {
            dcSend(peerId, data);
        } else {
            if (conn.open) conn.send(data);
        }
    }
}

// 处理收到的消息（两种模式统一）
function handleMessage(fromPeer, data) {
    switch (data.type) {
        case 'hello':
            MP.players[fromPeer] = { name: data.name, isHost: data.isHost || false };
            updateRoomUI();
            if (MP.isHost) {
                broadcast({ type: 'player-joined', peerId: fromPeer, name: data.name });
            }
            break;

        case 'player-list':
            MP.roomId = data.roomId;
            for (const [pid, info] of Object.entries(data.players)) {
                if (pid !== MP.myId) {
                    MP.players[pid] = info;
                }
            }
            updateRoomUI();
            break;

        case 'player-joined':
            if (data.peerId !== MP.myId && !MP.players[data.peerId]) {
                MP.players[data.peerId] = { name: data.name, isHost: false };
                updateRoomUI();
            }
            break;

        case 'player-left':
            delete MP.players[data.peerId];
            removeRemotePlayerMesh(data.peerId);
            if (MP.signalingMode === 'custom') closeRTCConnection(data.peerId);
            updateRoomUI();
            break;

        case 'game-start':
            startMultiplayerGame(data.seed);
            break;

        case 'player-state':
            updateRemotePlayer(fromPeer, data);
            break;

        case 'player-action':
            handleRemoteAction(fromPeer, data);
            break;
    }
}

function getPlayersList() {
    const list = {};
    list[MP.myId] = { name: MP.myName, isHost: MP.isHost };
    for (const [pid, info] of Object.entries(MP.players)) {
        list[pid] = info;
    }
    return list;
}

// ===== 大厅UI交互 =====

function setLobbyStatus(msg) {
    const el = document.getElementById('lobby-status');
    if (el) el.textContent = msg;
    const el2 = document.getElementById('room-status');
    if (el2) el2.textContent = msg;
}

function showScreen(screenId) {
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'none';
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById(screenId).style.display = 'flex';
}

function updateRoomUI() {
    const container = document.getElementById('room-players');
    if (!container) return;
    container.innerHTML = '';

    // 房主
    const hostSlot = document.createElement('div');
    hostSlot.className = 'player-slot host' + (MP.isHost ? ' me' : '');
    hostSlot.innerHTML = `👤 ${MP.isHost ? MP.myName : (MP.players[Object.keys(MP.players).find(k => MP.players[k].isHost)]?.name || '房主')} <span class="tag">房主</span>${MP.isHost ? '<span class="tag" style="margin-left:4px">我</span>' : ''}`;
    container.appendChild(hostSlot);

    // 其他玩家
    const otherPlayers = Object.entries(MP.players).filter(([k, v]) => !v.isHost);
    for (const [pid, info] of otherPlayers) {
        const slot = document.createElement('div');
        slot.className = 'player-slot' + (pid === MP.myId || (info.name === MP.myName && !MP.isHost) ? ' me' : '');
        slot.innerHTML = `👤 ${info.name}${pid === MP.myId || (info.name === MP.myName && !MP.isHost) ? '<span class="tag">我</span>' : ''}`;
        container.appendChild(slot);
    }

    // 空位
    const totalPlayers = 1 + otherPlayers.length;
    for (let i = totalPlayers; i < MP.maxPlayers; i++) {
        const slot = document.createElement('div');
        slot.className = 'player-slot';
        slot.style.opacity = '0.3';
        slot.innerHTML = '👤 等待加入...';
        container.appendChild(slot);
    }

    // 房间号
    const rid = document.getElementById('room-id-display');
    if (rid) rid.textContent = MP.roomId;

    // 人数 + 信令模式提示
    const statusEl = document.getElementById('room-status');
    if (statusEl) statusEl.textContent = `${totalPlayers}/${MP.maxPlayers} 人${MP.signalingMode === 'custom' ? ' 🟢国内直连' : ' 🟡需VPN'}`;

    // 只有房主能开始游戏
    const startBtn = document.getElementById('btn-start-game');
    if (startBtn) {
        startBtn.style.display = MP.isHost ? 'block' : 'none';
    }
}

// 创建房间
function createRoom() {
    const nameInput = document.getElementById('player-name');
    MP.myName = nameInput?.value.trim() || '玩家1';
    MP.isHost = true;
    MP.inRoom = true;

    setLobbyStatus('正在创建房间...');

    MP.roomId = genRoomId();
    MP.myId = 'room-' + MP.roomId;
    
    if (MP.signalingMode === 'custom') {
        // 自定义信令模式：注册到信令服务器，等待别人加入
        customRegister(MP.myId);
        startCustomPolling();
        showScreen('room-screen');
        updateRoomUI();
    } else {
        // PeerJS fallback
        initPeer(MP.myId, (id) => {
            showScreen('room-screen');
            updateRoomUI();
        });
    }
}

// 加入房间
function joinRoom(roomId) {
    const nameInput = document.getElementById('player-name');
    MP.myName = nameInput?.value.trim() || '玩家2';
    MP.isHost = false;
    MP.inRoom = true;
    MP.roomId = roomId;

    setLobbyStatus('正在加入房间...');

    const hostPeerId = 'room-' + roomId;
    
    if (MP.signalingMode === 'custom') {
        // 自定义信令模式：注册自己，然后通过信令告诉房主
        MP.myId = 'player-' + Math.random().toString(36).substr(2, 8);
        customRegister(MP.myId);
        startCustomPolling();
        
        // 通过信令服务器告诉房主我要加入
        customSend(MP.myId, hostPeerId, 'join-room', { name: MP.myName });
        
        showScreen('room-screen');
        updateRoomUI();
        
        // 超时提示
        setTimeout(() => {
            if (Object.keys(MP.connections).length === 0) {
                setLobbyStatus('连接超时，请检查房间号或网络');
            }
        }, 10000);
    } else {
        // PeerJS fallback
        initPeer(null, (id) => {
            const conn = MP.peer.connect(hostPeerId, { reliable: true });

            conn.on('open', () => {
                MP.connections[conn.peer] = conn;
                conn.send({ type: 'hello', name: MP.myName, isHost: false });
                showScreen('room-screen');
                updateRoomUI();
            });

            conn.on('data', (data) => {
                handleMessage(conn.peer, data);
            });

            conn.on('close', () => {
                delete MP.connections[conn.peer];
                delete MP.players[conn.peer];
                removeRemotePlayerMesh(conn.peer);
                updateRoomUI();
            });

            conn.on('error', (err) => {
                setLobbyStatus('连接失败，房间号可能无效');
            });

            setTimeout(() => {
                if (!conn.open) {
                    setLobbyStatus('连接超时，请检查房间号或网络');
                }
            }, 8000);
        });
    }
}

// 分享房间
function shareRoom() {
    const url = window.location.origin + window.location.pathname + '?room=' + MP.roomId;
    if (navigator.share) {
        navigator.share({
            title: '逃离恐怖教学楼 - 邀请你加入',
            text: `我在「逃离恐怖教学楼」等你！房间号：${MP.roomId}`,
            url: url,
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(url).then(() => {
            setLobbyStatus('链接已复制！发给好友即可加入');
        }).catch(() => {
            setLobbyStatus('分享链接: ' + url);
        });
    }
}

// 离开房间
function leaveRoom() {
    broadcast({ type: 'player-left', peerId: MP.myId });
    
    // 自定义信令注销
    if (MP.signalingMode === 'custom' && MP.myId) {
        fetch(MP.customSignalingUrl + '/poll/' + encodeURIComponent(MP.myId), { method: 'DELETE' }).catch(() => {});
    }
    stopCustomPolling();
    
    // 关闭所有连接
    for (const [peerId, conn] of Object.entries(MP.connections)) {
        if (MP.signalingMode === 'custom') {
            closeRTCConnection(peerId);
        } else {
            conn.close();
        }
    }
    MP.connections = {};
    MP.players = {};
    MP.inRoom = false;
    MP.isHost = false;
    MP.roomId = null;
    MP.myId = null;
    if (MP.peer) {
        MP.peer.destroy();
        MP.peer = null;
    }
    showScreen('lobby-screen');
}

// 开始游戏（房主触发）
function startGame() {
    if (!MP.isHost) return;
    const seed = Date.now();
    broadcast({ type: 'game-start', seed: seed });
    startMultiplayerGame(seed);
}

function startMultiplayerGame(seed) {
    MP.gameStarted = true;
    document.getElementById('room-screen').style.display = 'none';
    // 触发游戏开始
    if (typeof startGameFromLobby === 'function') {
        startGameFromLobby(seed);
    }
}

// ===== 游戏内同步 =====

// 发送自己的状态（每100ms）
let syncInterval = null;
function startSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (!MP.gameStarted || !playerMesh) return;
        broadcast({
            type: 'player-state',
            x: playerMesh.position.x,
            z: playerMesh.position.z,
            rotY: playerMesh.rotation.y,
            health: gameState.health,
            isRunning: gameState.isRunning,
            isHiding: gameState.isHiding,
            flashlightOn: gameState.flashlightOn,
        });
    }, 100);
}

// 远程玩家3D模型管理 — 完整主角模型（跟本地玩家一样）
function ensureRemotePlayerMesh(peerId, name) {
    if (MP.remoteMeshes[peerId]) return MP.remoteMeshes[peerId];

    const group = new THREE.Group();
    
    // 远程玩家用不同颜色区分
    const isHost = MP.players[peerId]?.isHost;
    const bodyColor = isHost ? 0x0088ff : 0xff6600;
    const clothColor = isHost ? 0x003366 : 0x663300;
    const skinColor = 0xffcc99;
    
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9 });
    const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 1 });
    
    // 身体
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.9, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.15;
    group.add(body);
    
    // 头
    const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.82;
    group.add(head);
    
    // 头发
    const hairGeo = new THREE.SphereGeometry(0.24, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 });
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.85;
    group.add(hair);
    
    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.08, 1.82, 0.22);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.08, 1.82, 0.22);
    group.add(rightEye);
    
    // 左臂
    const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.6, 6);
    const leftArmGroup = new THREE.Group();
    const leftArm = new THREE.Mesh(armGeo, clothMat);
    leftArm.position.y = -0.3;
    leftArmGroup.add(leftArm);
    leftArmGroup.position.set(-0.4, 1.35, 0);
    group.add(leftArmGroup);
    
    // 右臂
    const rightArmGroup = new THREE.Group();
    const rightArm = new THREE.Mesh(armGeo, clothMat);
    rightArm.position.y = -0.3;
    rightArmGroup.add(rightArm);
    rightArmGroup.position.set(0.4, 1.35, 0);
    group.add(rightArmGroup);
    
    // 左腿
    const legGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.7, 6);
    const leftLegGroup = new THREE.Group();
    const leftLeg = new THREE.Mesh(legGeo, clothMat);
    leftLeg.position.y = -0.35;
    leftLegGroup.add(leftLeg);
    leftLegGroup.position.set(-0.15, 0.7, 0);
    group.add(leftLegGroup);
    
    // 右腿
    const rightLegGroup = new THREE.Group();
    const rightLeg = new THREE.Mesh(legGeo, clothMat);
    rightLeg.position.y = -0.35;
    rightLegGroup.add(rightLeg);
    rightLegGroup.position.set(0.15, 0.7, 0);
    group.add(rightLegGroup);
    
    // 手持手电筒
    const flashlightGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.35, 6);
    const flashlightMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6 });
    const flashlight = new THREE.Mesh(flashlightGeo, flashlightMat);
    flashlight.position.set(0.48, 1.0, 0.25);
    flashlight.rotation.x = Math.PI / 6;
    group.add(flashlight);
    
    // 名字标签
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = isHost ? '#ffdd44' : '#44ddff';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(name || '???', 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.y = 2.3;
    group.add(sprite);
    
    // 存储动画部件
    group.userData = {
        parts: { leftArm: leftArmGroup, rightArm: rightArmGroup, leftLeg: leftLegGroup, rightLeg: rightLegGroup, body, head },
        animTime: 0,
        isMoving: false,
    };

    scene.add(group);
    MP.remoteMeshes[peerId] = group;
    return group;
}

function removeRemotePlayerMesh(peerId) {
    const mesh = MP.remoteMeshes[peerId];
    if (mesh) {
        scene.remove(mesh);
        mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
        delete MP.remoteMeshes[peerId];
    }
}

function updateRemotePlayer(peerId, data) {
    const info = MP.players[peerId];
    const mesh = ensureRemotePlayerMesh(peerId, info?.name);
    
    // 平滑移动
    const lerpFactor = 0.3;
    mesh.position.x += (data.x - mesh.position.x) * lerpFactor;
    mesh.position.z += (data.z - mesh.position.z) * lerpFactor;
    
    // 平滑旋转
    const targetRotY = data.rotY || 0;
    let diff = targetRotY - mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    mesh.rotation.y += diff * lerpFactor;
    
    // 简单行走动画
    if (mesh.userData && mesh.userData.parts) {
        const parts = mesh.userData.parts;
        const isMoving = data.isRunning || (Math.abs(data.x - mesh.position.x) > 0.01 || Math.abs(data.z - mesh.position.z) > 0.01);
        
        if (isMoving) {
            mesh.userData.animTime += 0.15;
            const t = mesh.userData.animTime;
            const swing = Math.sin(t) * 0.4;
            parts.leftLeg.rotation.x = swing;
            parts.rightLeg.rotation.x = -swing;
            parts.leftArm.rotation.x = -swing * 0.6;
            parts.rightArm.rotation.x = swing * 0.6;
        } else {
            // 静止时慢慢归零
            mesh.userData.animTime = 0;
            parts.leftLeg.rotation.x *= 0.8;
            parts.rightLeg.rotation.x *= 0.8;
            parts.leftArm.rotation.x *= 0.8;
            parts.rightArm.rotation.x *= 0.8;
        }
    }
}

function handleRemoteAction(peerId, data) {
    // 可以扩展：攻击动画、受伤、死亡等
}

// ===== 页面初始化 =====

document.addEventListener('DOMContentLoaded', () => {
    // 绑定按钮
    document.getElementById('btn-create-room')?.addEventListener('click', createRoom);
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
        const roomId = document.getElementById('room-id-input')?.value.trim();
        if (roomId && roomId.length >= 4) {
            joinRoom(roomId);
        } else {
            setLobbyStatus('请输入有效的房间号');
        }
    });
    document.getElementById('btn-share-room')?.addEventListener('click', shareRoom);
    document.getElementById('btn-start-game')?.addEventListener('click', startGame);
    document.getElementById('btn-leave-room')?.addEventListener('click', leaveRoom);
    document.getElementById('btn-solo-play')?.addEventListener('click', () => {
        // 单人游戏，直接开始
        document.getElementById('lobby-screen').style.display = 'none';
        if (typeof startGameFromLobby === 'function') {
            startGameFromLobby(Date.now());
        }
    });

    // 检查URL中是否有房间参数
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        document.getElementById('room-id-input').value = roomParam;
        setLobbyStatus('检测到房间号 ' + roomParam + '，输入昵称后点击加入');
    }

    // 默认显示大厅，隐藏开始屏幕
    showScreen('lobby-screen');
    
    // 异步检测信令服务器
    detectSignalingServer();
});
