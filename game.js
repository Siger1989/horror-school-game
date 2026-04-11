// ============================================
// 逃离恐怖教学楼 - 游戏主脚本
// ============================================

// 辅助函数：获取视觉尺寸（竖屏旋转后宽高互换）
function getVisualSize() {
    const isPortraitMobile = ('ontouchstart' in window) && window.innerWidth < 769 && window.innerWidth < window.innerHeight;
    if (isPortraitMobile) {
        // 竖屏旋转为横屏时，视觉宽度=物理高度，视觉高度=物理宽度
        return { width: window.innerHeight, height: window.innerWidth };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}

// 游戏配置
const GAME_CONFIG = {
    player: {
        speed: 5,
        runSpeed: 8,
        batteryDrainRate: 0.5,
        batteryRechargeRate: 0.2,
        maxBattery: 100,
        flashlightRange: 25,
        flashlightAngle: Math.PI / 3,
        flashlightHorizontalAngle: Math.PI / 2,
    },
    enemies: {
        zombie: {
            speed: 2.5,
            runSpeed: 5,
            detectionRange: 6,
            lightDetectionRange: 14,
            lightDetectionAngle: Math.PI / 4,
            wanderSpeed: 1,
            visionAngle: Math.PI / 3,  // 60度视野锥（缩窄）
            visionRange: 10,
            noiseDetectionRange: 10,  // 噪音检测范围
            chaseRange: 8,  // 追击锁定范围，超出则丢失目标
        },
        jumper: {
            speed: 1.2,
            jumpSpeed: 18,
            detectionRange: 8,
            lightDetectionRange: 10,
            wanderSpeed: 0.8,
            visionAngle: Math.PI / 2.5,  // 72度视野锥（缩窄）
            visionRange: 12,
            jumpCooldown: 3,
            jumpChargeTime: 1.0,
            noiseDetectionRange: 8,
            chaseRange: 7,  // 追击锁定范围
        },
        ghost: {
            speed: 1.5,
            wanderRange: 15,
            scareDistance: 5,
        },
        spitter: {
            speed: 2.0,
            runSpeed: 3.5,
            wanderSpeed: 0.8,
            visionAngle: Math.PI / 3,
            visionRange: 12,
            detectionRange: 10,
            chaseRange: 8,
            spitCooldown: 3.5,
            noiseDetectionRange: 7,
        },
    },
    scene: {
        tileSize: 5,
        gridWidth: 28,
        gridHeight: 10,  // 缩减高度匹配实际布局：走廊8+南北教室各20+墙=48~50
        ambientLight: 0.2,
    },
    game: {
        totalKeys: 3,
        exitDoorLocked: true,
    },
    camera: {
        height: 8,
        distance: 7,
    },
};

// 游戏状态
let gameState = {
    isPlaying: false,
    keysCollected: 0,
    battery: 100,
    flashlightOn: true,
    isRunning: false,
    zombies: [],     // 普通僵尸
    jumpers: [],    // 跳跃僵尸
    ghosts: [],
    keys: [],
    lights: [],
    exitDoor: null,
    player: null,
    colliders: [],
    // 躲藏系统
    isHiding: false,
    hideSpot: null,
    nearHideSpot: null,
    hideSpots: [],
    preHidePosition: null,  // 进入躲藏前的位置
    // 攻击系统
    isAttacking: false,
    attackCooldown: 0,
    attackRange: 2.5,       // 近战攻击距离
    attackAngle: Math.PI / 3, // 攻击锥角度（60度）
    attackDamage: 50,       // 近战伤害
    attackDuration: 0.3,    // 攻击动画时长
    // 玩家血量
    playerHP: 100,
    maxPlayerHP: 100,
    damageCooldown: 0,      // 受伤无敌帧
    // 跳跃系统
    isJumping: false,
    jumpVelocity: 0,
    playerY: 0,             // 玩家当前Y偏移
    // 翻越系统
    isVaulting: false,
    vaultProgress: 0,
    vaultStart: null,
    vaultEnd: null,
    nearVaultObstacle: null,
    // 毒液系统
    poisonTimer: 0,         // 中毒剩余时间
    poisonDamageCD: 0,      // 中毒伤害间隔
    // 毒液僵尸
    spitters: [],
    // 毒液投射物
    projectiles: [],
    // 绷带物品
    bandages: [],
    // 翻越障碍物列表（矮物体可翻越）
    vaultObstacles: [],
    // 尸体列表
    corpses: [],
};

// Three.js 核心变量
let scene, camera, renderer;
let playerMesh, flashlightBeam;
let clock, deltaTime;

// 输入状态
let cameraAngle = -Math.PI * 0.5; // 相机绕玩家旋转角度（弧度），初始-PI/2让相机在X负方向（走廊西端=后方）
let aimJoystickEverUsed = false; // 右摇杆是否使用过（一旦使用，电筒方向完全由右摇杆决定）

// ============================================
// 初始化游戏
// ============================================
function init() {
    try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14141e);
    scene.fog = new THREE.Fog(0x14141e, 20, 60);
    
    // 环境光 - 冷调蓝紫微光，模拟阴冷教学楼（手机端提亮）
    const ambientLight = new THREE.AmbientLight(0x4a4a70, 1.0);
    scene.add(ambientLight);
    
    // 月光方向光 - 冷蓝色月光（提亮）
    const moonLight = new THREE.DirectionalLight(0x6688cc, 0.6);
    moonLight.position.set(10, 80, 10);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = 2048;
    moonLight.shadow.mapSize.height = 2048;
    moonLight.shadow.camera.near = 1;
    moonLight.shadow.camera.far = 200;
    moonLight.shadow.camera.left = -80;
    moonLight.shadow.camera.right = 80;
    moonLight.shadow.camera.top = 80;
    moonLight.shadow.camera.bottom = -80;
    moonLight.shadow.bias = -0.001;
    moonLight.shadow.normalBias = 0.02;
    scene.add(moonLight);
    
    const vs = getVisualSize();
    camera = new THREE.PerspectiveCamera(60, vs.width / vs.height, 0.1, 1000);
    camera.position.set(0, GAME_CONFIG.camera.height, GAME_CONFIG.camera.distance);
    camera.lookAt(0, 0, 0);
    
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // 设置渲染分辨率，但不设置内联style（让CSS控制显示尺寸）
    renderer.setSize(vs.width, vs.height, false);  // false = 不设置style
    renderer.localClippingEnabled = true;  // 启用局部裁剪平面（视线遮挡）
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    clock = new THREE.Clock();
    
    createSchoolBuilding();
    createPlayer();
    createEnemies();
    createKeys();
    createLights();
    createExitDoor();
    
    setupEventListeners();
    
    animate();
    
    } catch(e) {
        console.error('init()崩溃:', e.message, e.stack);
        alert('游戏初始化失败: ' + e.message);
    }
}

// ============================================
// 创建教学楼场景
// ============================================
function createSchoolBuilding() {
    const { tileSize, gridWidth, gridHeight } = GAME_CONFIG.scene;
    const wallHeight = 8;
    
    // 使用BoxGeometry作为地板，有厚度防止透光
    const floorThickness = 1;
    const floorGeometry = new THREE.BoxGeometry(gridWidth * tileSize, floorThickness, gridHeight * tileSize);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2a2520,
        roughness: 0.9,
        metalness: 0.1,
        side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.y = -floorThickness / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // 天花板在俯视游戏中不需要，去掉以避免遮挡视线
    // 地板已有厚度(BoxGeometry)，不会从下方透光
    
    const wallMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x3a3535,
        roughness: 0.95,
        metalness: 0.05,
    });
    
    createWall(0, wallHeight / 2, -gridHeight * tileSize / 2, gridWidth * tileSize, wallHeight, 0.5, wallMaterial);
    createWall(0, wallHeight / 2, gridHeight * tileSize / 2, gridWidth * tileSize, wallHeight, 0.5, wallMaterial);
    createWall(-gridWidth * tileSize / 2, wallHeight / 2, 0, 0.5, wallHeight, gridHeight * tileSize, wallMaterial);
    createWall(gridWidth * tileSize / 2, wallHeight / 2, 0, 0.5, wallHeight, gridHeight * tileSize, wallMaterial);
    
    createClassroomsAndCorridors(tileSize, gridWidth, gridHeight, wallHeight, wallMaterial);
    createDebris();
}

function createWall(x, y, z, width, height, depth, material) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    
    // 添加碰撞体
    gameState.colliders.push({
        position: new THREE.Vector3(x, y, z),
        width: width,
        height: height,
        depth: depth
    });
}

function createClassroomsAndCorridors(tileSize, gridWidth, gridHeight, wallHeight, material) {
    // ============================================================
    // 高校教学楼布局：东西向中央走廊 + 南北两侧各4间教室
    // 走廊沿X轴贯通，玩家从西端出发，出口在东端
    // ============================================================
    const totalW = gridWidth * tileSize; // 140
    const totalH = gridHeight * tileSize; // 110
    const halfW = totalW / 2; // 70
    const halfH = totalH / 2; // 55

    const corridorWidth = 8;  // 走廊宽度（Z方向）
    const corridorHalf = corridorWidth / 2; // 4
    const doorWidth = 4;      // 门的宽度
    const roomDepth = 20;     // 教室进深（Z方向）
    const numRooms = 4;       // 每侧教室数量
    const classroomWidth = (totalW - 4) / numRooms; // 每间教室宽度（X方向）≈34

    // ---- 走廊南墙（z = corridorHalf = 4），带4个门口 ----
    const southWallZ = corridorHalf;
    // 走廊南墙：4个门口对应4间南侧教室
    for (let i = 0; i < numRooms; i++) {
        const roomLeftX = -halfW + 2 + classroomWidth * i;
        const roomRightX = roomLeftX + classroomWidth;
        const doorCenterX = roomLeftX + classroomWidth / 2;

        // 门左侧墙壁
        const leftWallWidth = doorCenterX - doorWidth / 2 - roomLeftX;
        if (leftWallWidth > 0.5) {
            createWall(roomLeftX + leftWallWidth / 2, wallHeight / 2, southWallZ, leftWallWidth, wallHeight, 0.3, material);
        }
        // 门右侧墙壁
        const rightWallWidth = roomRightX - (doorCenterX + doorWidth / 2);
        if (rightWallWidth > 0.5) {
            createWall(doorCenterX + doorWidth / 2 + rightWallWidth / 2, wallHeight / 2, southWallZ, rightWallWidth, wallHeight, 0.3, material);
        }
    }

    // ---- 走廊北墙（z = -corridorHalf = -4），带4个门口 ----
    const northWallZ = -corridorHalf;
    for (let i = 0; i < numRooms; i++) {
        const roomLeftX = -halfW + 2 + classroomWidth * i;
        const roomRightX = roomLeftX + classroomWidth;
        const doorCenterX = roomLeftX + classroomWidth / 2;

        const leftWallWidth = doorCenterX - doorWidth / 2 - roomLeftX;
        if (leftWallWidth > 0.5) {
            createWall(roomLeftX + leftWallWidth / 2, wallHeight / 2, northWallZ, leftWallWidth, wallHeight, 0.3, material);
        }
        const rightWallWidth = roomRightX - (doorCenterX + doorWidth / 2);
        if (rightWallWidth > 0.5) {
            createWall(doorCenterX + doorWidth / 2 + rightWallWidth / 2, wallHeight / 2, northWallZ, rightWallWidth, wallHeight, 0.3, material);
        }
    }

    // ---- 北侧4间教室 ----
    const northBackZ = northWallZ - roomDepth; // -4 - 20 = -24
    // 北侧后墙
    createWall(0, wallHeight / 2, northBackZ, totalW, wallHeight, 0.3, material);
    // 北侧教室隔墙（3面隔墙分4间）
    for (let i = 0; i <= numRooms; i++) {
        const x = -halfW + 2 + classroomWidth * i;
        // 两端隔墙是完整墙，中间隔墙也需要完整
        createWall(x, wallHeight / 2, northWallZ - roomDepth / 2, 0.3, wallHeight, roomDepth, material);
    }
    // 北侧教室内部
    for (let i = 0; i < numRooms; i++) {
        const roomCX = -halfW + 2 + classroomWidth * i + classroomWidth / 2;
        const roomCZ = northWallZ - roomDepth / 2;
        createClassroomInterior(roomCX, roomCZ, classroomWidth * 0.7, roomDepth * 0.6);
    }

    // ---- 南侧4间教室 ----
    const southBackZ = southWallZ + roomDepth; // 4 + 20 = 24
    createWall(0, wallHeight / 2, southBackZ, totalW, wallHeight, 0.3, material);
    for (let i = 0; i <= numRooms; i++) {
        const x = -halfW + 2 + classroomWidth * i;
        createWall(x, wallHeight / 2, southWallZ + roomDepth / 2, 0.3, wallHeight, roomDepth, material);
    }
    for (let i = 0; i < numRooms; i++) {
        const roomCX = -halfW + 2 + classroomWidth * i + classroomWidth / 2;
        const roomCZ = southWallZ + roomDepth / 2;
        createClassroomInterior(roomCX, roomCZ, classroomWidth * 0.7, roomDepth * 0.6);
    }

    // ---- 走廊装饰柱子 ----
    const pillarGeometry = new THREE.BoxGeometry(0.6, wallHeight, 0.6);
    const pillarMaterial = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.8 });
    for (let x = -halfW + 10; x < halfW; x += 15) {
        for (const z of [northWallZ + 0.8, southWallZ - 0.8]) {
            const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
            pillar.position.set(x, wallHeight / 2, z);
            pillar.castShadow = true;
            pillar.receiveShadow = true;
            scene.add(pillar);
            gameState.colliders.push({
                position: new THREE.Vector3(x, wallHeight / 2, z),
                width: 0.6, height: wallHeight, depth: 0.6
            });
        }
    }

    // ---- 走廊地砖线（视觉装饰）----
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x3a3530, roughness: 0.95 });
    for (let x = -halfW + 5; x < halfW; x += 10) {
        const lineGeo = new THREE.BoxGeometry(0.1, 0.02, corridorWidth);
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.position.set(x, 0.01, 0);
        scene.add(line);
    }

    // ---- 走廊白炽灯（时亮时暗闪烁灯）----
    const hallFixtureMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.6 });
    for (let x = -halfW + 15; x < halfW; x += 18) {
        // 灯管外壳
        const lightFixture = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.6), hallFixtureMat);
        lightFixture.position.set(x, wallHeight - 0.1, 0);
        scene.add(lightFixture);
        // 发光灯管 - 每盏灯独立材质，这样闪烁不会互相影响
        const tubeMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, emissive: 0xccddff, emissiveIntensity: 0.8,
            transparent: true, opacity: 0.9
        });
        const tube = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.25), tubeMat);
        tube.position.set(x, wallHeight - 0.2, 0);
        scene.add(tube);
        // 走廊白炽灯 - 冷白光，闪烁
        const hallPointLight = new THREE.PointLight(0xccddff, 3500, 28, 1.3);
        hallPointLight.position.set(x, wallHeight - 0.5, 0);
        hallPointLight.castShadow = false;
        scene.add(hallPointLight);
        // 地面光斑
        const spotMat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
        const spot = new THREE.Mesh(new THREE.CircleGeometry(3, 16), spotMat);
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(x, 0.05, 0);
        scene.add(spot);
        // 注册为闪烁灯
        gameState.lights.push({
            light: hallPointLight,
            indicator: spot,
            position: hallPointLight.position.clone(),
            radius: 22,
            isFlicker: true,
            flickerPhase: Math.random() * 10,
            flickerSpeed: 8 + Math.random() * 12,
            deadCountdown: 5 + Math.random() * 15,
            isDead: false,
            deadDuration: 0,
            deadTimer: 0,
            tubeMat: tubeMat,
        });
    }
    
    // ---- 教室日光灯 ----
    for (let i = 0; i < numRooms; i++) {
        const roomCX = -halfW + 2 + classroomWidth * i + classroomWidth / 2;
        // 教室无灯 - 黑暗恐怖
        const northZ = northWallZ - roomDepth / 2;
        const southZ = southWallZ + roomDepth / 2;
    }
}

function createClassroomInterior(cx, cz, roomW, roomD) {
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
    
    // 课桌排列（3排4列）
    const rows = 3, cols = 4;
    const spacingX = roomW / (cols + 1);
    const spacingZ = roomD / (rows + 1);
    
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const deskX = cx - roomW / 2 + spacingX * (c + 1);
            const deskZ = cz - roomD / 2 + spacingZ * (r + 1);
            const isFlipped = Math.random() > 0.7;
            
            const desk = new THREE.Group();
            const topGeo = new THREE.BoxGeometry(1.2, 0.08, 0.6);
            const top = new THREE.Mesh(topGeo, deskMat);
            top.position.y = 0.75;
            top.castShadow = true;
            desk.add(top);
            const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.75, 4);
            for (let lx = -1; lx <= 1; lx += 2) {
                for (let lz = -1; lz <= 1; lz += 2) {
                    const leg = new THREE.Mesh(legGeo, deskMat);
                    leg.position.set(lx * 0.5, 0.38, lz * 0.24);
                    desk.add(leg);
                }
            }
            
            if (isFlipped) {
                desk.rotation.x = Math.random() * Math.PI * 0.6 + 0.3;
                desk.rotation.z = (Math.random() - 0.5) * 0.5;
            }
            desk.position.set(deskX, 0, deskZ);
            desk.rotation.y = Math.random() * 0.3;
            scene.add(desk);
            
            // 碰撞体+翻越标记
            gameState.colliders.push({
                position: new THREE.Vector3(deskX, 0.5, deskZ),
                width: 1.0, height: 1, depth: 0.5
            });
            // 课桌是矮障碍物，可以翻越
            gameState.vaultObstacles.push({ x: deskX, z: deskZ, height: 0.8, width: 1.2, depth: 0.6 });
        }
    }
}

function createDebris() {
    const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 });
    
    for (let i = 0; i < 30; i++) {
        const size = Math.random() * 0.5 + 0.2;
        const debrisGeometry = new THREE.BoxGeometry(size, 0.2, size);
        const debris = new THREE.Mesh(debrisGeometry, debrisMaterial);
        
        // 碎片只在走廊内生成（z: -3~3，x: 全范围）
        debris.position.set(
            (Math.random() - 0.5) * GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize * 0.8,
            0.1,
            (Math.random() - 0.5) * 5  // 限制在走廊范围
        );
        
        debris.rotation.y = Math.random() * Math.PI;
        debris.receiveShadow = true;
        scene.add(debris);
        // 碎片太小，不做碰撞
    }
    
    // 添加可躲藏的柜子
    createLockers();
    createWallDecorations();
}

function createClassroomFurniture() {
    const deskMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9 });
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.9 });
    
    // 在几个区域放置倒/翻的课桌
    const deskAreas = [
        { cx: -15, cz: -8, count: 4 },
        { cx: 15, cz: -8, count: 4 },
        { cx: -10, cz: 10, count: 3 },
        { cx: 10, cz: 10, count: 3 },
    ];
    
    deskAreas.forEach(area => {
        for (let i = 0; i < area.count; i++) {
            const desk = new THREE.Group();
            // 桌面
            const topGeo = new THREE.BoxGeometry(1.4, 0.08, 0.7);
            const top = new THREE.Mesh(topGeo, deskMat);
            top.position.y = 0.75;
            top.castShadow = true;
            desk.add(top);
            // 桌腿
            const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.75, 4);
            for (let lx = -1; lx <= 1; lx += 2) {
                for (let lz = -1; lz <= 1; lz += 2) {
                    const leg = new THREE.Mesh(legGeo, deskMat);
                    leg.position.set(lx * 0.6, 0.38, lz * 0.28);
                    desk.add(leg);
                }
            }
            
            // 随机倾斜/倒翻（混乱场景）
            const isFlipped = Math.random() > 0.5;
            if (isFlipped) {
                desk.rotation.x = Math.random() * Math.PI * 0.8 + 0.5;
                desk.rotation.z = (Math.random() - 0.5) * 0.5;
            }
            
            desk.position.set(
                area.cx + (i - area.count / 2) * 2.5 + (Math.random() - 0.5),
                0,
                area.cz + (Math.random() - 0.5) * 3
            );
            desk.rotation.y = Math.random() * Math.PI;
            scene.add(desk);
            
            // 添加碰撞体（只对未翻倒的桌子）
            if (!isFlipped) {
                gameState.colliders.push({
                    position: new THREE.Vector3(desk.position.x, 0.5, desk.position.z),
                    width: 1.1,
                    height: 1,
                    depth: 0.5
                });
            }
            
            // 偶尔旁边放椅子
            if (Math.random() > 0.3) {
                const chair = new THREE.Group();
                const seatGeo = new THREE.BoxGeometry(0.45, 0.05, 0.45);
                const seat = new THREE.Mesh(seatGeo, chairMat);
                seat.position.y = 0.45;
                chair.add(seat);
                // 靠背
                const backGeo = new THREE.BoxGeometry(0.45, 0.5, 0.05);
                const back = new THREE.Mesh(backGeo, chairMat);
                back.position.set(0, 0.7, -0.2);
                chair.add(back);
                // 椅腿
                for (let cx = -1; cx <= 1; cx += 2) {
                    for (let cz = -1; cz <= 1; cz += 2) {
                        const cleg = new THREE.Mesh(legGeo, chairMat);
                        cleg.position.set(cx * 0.18, 0.22, cz * 0.18);
                        chair.add(cleg);
                    }
                }
                
                chair.position.set(
                    desk.position.x + (Math.random() - 0.5) * 2,
                    0,
                    desk.position.z + (Math.random() > 0.5 ? 1 : -1)
                );
                chair.rotation.y = Math.random() * Math.PI * 2;
                if (Math.random() > 0.5) {
                    chair.rotation.x = Math.random() * 1.2;
                    chair.rotation.z = (Math.random() - 0.5) * 0.6;
                }
                scene.add(chair);
                // 椅子太小，不做碰撞
            }
        }
    });
}

function createWallDecorations() {
    const { gridWidth, gridHeight, tileSize } = GAME_CONFIG.scene;
    const wallZ1 = -(gridHeight * tileSize / 2) + 0.5;
    const wallZ2 = gridHeight * tileSize / 2 - 0.5;
    
    // 黑板（在教学楼几个位置）
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x1a3a2a, roughness: 0.5 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.8 });
    
    // 黑板放在教室后墙上：北侧教室后墙z=-24，南侧教室后墙z=24
    const boardPositions = [
        { x: -40, z: -23.7, ry: 0 },   // 北侧第1间教室
        { x: 0, z: -23.7, ry: 0 },     // 北侧第3间教室
        { x: -20, z: 23.7, ry: Math.PI }, // 南侧第2间教室
        { x: 30, z: 23.7, ry: Math.PI },  // 南侧第4间教室
    ];
    
    boardPositions.forEach(pos => {
        const board = new THREE.Group();
        // 黑板
        const boardGeo = new THREE.BoxGeometry(4, 2.5, 0.1);
        const bb = new THREE.Mesh(boardGeo, boardMat);
        bb.position.y = 3;
        board.add(bb);
        // 边框
        const frameGeo = new THREE.BoxGeometry(4.3, 2.8, 0.08);
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.y = 3;
        frame.position.z = pos.ry === 0 ? -0.05 : 0.05;
        board.add(frame);
        // 粉笔痕迹（白色条）
        for (let l = 0; l < 3; l++) {
            const lineGeo = new THREE.BoxGeometry(2.5 + Math.random(), 0.05, 0.01);
            const lineMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
            const line = new THREE.Mesh(lineGeo, lineMat);
            line.position.set((Math.random() - 0.5) * 1.5, 2.5 + l * 0.4, pos.ry === 0 ? 0.06 : -0.06);
            line.rotation.y = (Math.random() - 0.5) * 0.1;
            board.add(line);
        }
        
        board.position.set(pos.x, 0, pos.z);
        board.rotation.y = pos.ry;
        scene.add(board);
        // 黑板贴墙装饰，墙壁已有碰撞，不再单独加碰撞体
    });
    
    // 墙上血手印
    const bloodMat = new THREE.MeshBasicMaterial({ color: 0x440000, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
        const handGeo = new THREE.CircleGeometry(0.15 + Math.random() * 0.1, 6);
        const hand = new THREE.Mesh(handGeo, bloodMat);
        const side = Math.random() > 0.5 ? 1 : -1;
        hand.position.set(
            (Math.random() - 0.5) * gridWidth * tileSize * 0.8,
            1 + Math.random() * 3,
            side * (gridHeight * tileSize / 2 - 0.3)
        );
        hand.rotation.y = side > 0 ? 0 : Math.PI;
        hand.rotation.z = (Math.random() - 0.5) * 1;
        scene.add(hand);
    }
    
    // 地面裂缝（装饰线条）
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = 0; i < 12; i++) {
        const crackGeo = new THREE.BoxGeometry(0.03, 0.01, 1 + Math.random() * 2);
        const crack = new THREE.Mesh(crackGeo, crackMat);
        crack.position.set(
            (Math.random() - 0.5) * gridWidth * tileSize * 0.7,
            0.01,
            (Math.random() - 0.5) * gridHeight * tileSize * 0.7
        );
        crack.rotation.y = Math.random() * Math.PI;
        scene.add(crack);
    }
}

function createLockers() {
    const lockerMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x5a6a7a,
        roughness: 0.7,
        metalness: 0.3,
    });
    
    const lockerPositions = [
        // 走廊靠墙（z=-3北墙边，z=3南墙边）
        { x: -20, z: -3, rotation: 0 },
        { x: -5, z: -3, rotation: 0 },
        { x: 15, z: -3, rotation: 0 },
        { x: -20, z: 3, rotation: 0 },
        { x: -5, z: 3, rotation: 0 },
        { x: 15, z: 3, rotation: 0 },
        // 北侧教室内
        { x: -40, z: -14, rotation: Math.PI / 2 },
        { x: 10, z: -14, rotation: Math.PI / 2 },
        // 南侧教室内
        { x: -30, z: 14, rotation: Math.PI / 2 },
        { x: 30, z: 14, rotation: Math.PI / 2 },
        // 走廊两端
        { x: -55, z: 0, rotation: Math.PI / 2 },
        { x: 55, z: 0, rotation: Math.PI / 2 },
    ];
    
    lockerPositions.forEach((pos) => {
        const lockerGroup = new THREE.Group();
        
        // 柜子主体
        const lockerGeometry = new THREE.BoxGeometry(1.5, 3, 1);
        const locker = new THREE.Mesh(lockerGeometry, lockerMaterial);
        locker.position.y = 1.5;
        locker.castShadow = true;
        locker.receiveShadow = true;
        lockerGroup.add(locker);
        
        // 柜门细节
        const doorGeometry = new THREE.BoxGeometry(1.3, 1.3, 0.1);
        const door1 = new THREE.Mesh(doorGeometry, lockerMaterial);
        door1.position.set(0, 2.2, 0.5);
        lockerGroup.add(door1);
        
        const door2 = new THREE.Mesh(doorGeometry, lockerMaterial);
        door2.position.set(0, 0.8, 0.5);
        lockerGroup.add(door2);
        
        // 通风孔
        const ventGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.1);
        const vent = new THREE.Mesh(ventGeometry, new THREE.MeshStandardMaterial({ color: 0x333333 }));
        vent.position.set(0, 2.8, 0.5);
        lockerGroup.add(vent);
        
        lockerGroup.position.set(pos.x, 0, pos.z);
        lockerGroup.rotation.y = pos.rotation;
        
        scene.add(lockerGroup);
        
        // 添加碰撞体
        if (pos.rotation === 0) {
            gameState.colliders.push({
                position: new THREE.Vector3(pos.x, 1.5, pos.z),
                width: 1.3,
                height: 3,
                depth: 0.8
            });
        } else {
            gameState.colliders.push({
                position: new THREE.Vector3(pos.x, 1.5, pos.z),
                width: 0.8,
                height: 3,
                depth: 1.3
            });
        }
        
        // 注册为躲藏点
        gameState.hideSpots.push({
            position: new THREE.Vector3(pos.x, 0, pos.z),
            type: 'locker',
        });
    });
}

// ============================================
// 创建玩家
// ============================================
function createPlayer() {
    // 手电筒灯光（只创建一次，两种模型共用）
    createFlashlight();
    
    // 先创建一个不可见占位 Group，确保 playerMesh 永远不为 null
    // 避免游戏循环中访问 playerMesh.position 崩溃
    const startX = -GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 + 8;
    playerMesh = new THREE.Group();
    playerMesh.position.set(startX, 0, 0);
    playerMesh.visible = false; // 加载完成前不可见
    scene.add(playerMesh);
    gameState.player = playerMesh;
    
    // 优先尝试GLB模型，加载失败才回退原始模型
    // 避免先创建原始模型再替换的双重资源浪费
    if (window.THREE && window.THREE.GLTFLoader) {
        createGLBPlayer();
    } else {
        // 没有GLTFLoader，直接用原始模型
        createPrimitivePlayer();
    }
}

// 创建手电筒灯光（只调用一次）
function createFlashlight() {
    if (gameState.flashlightLight) return; // 防止重复创建
    
    const flashlightLight = new THREE.SpotLight(0xddeeff, 6000, 35, Math.PI / 6, 0.7, 3);
    flashlightLight.position.set(0.1, 0.3, 0.08);
    flashlightLight.castShadow = true;
    flashlightLight.shadow.mapSize.width = 1024;
    flashlightLight.shadow.mapSize.height = 1024;
    flashlightLight.shadow.bias = -0.002;
    flashlightLight.shadow.normalBias = 0.02;
    scene.add(flashlightLight);
    
    const flashlightTarget = new THREE.Object3D();
    const playerStartX = -GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 + 8;
    flashlightTarget.position.set(playerStartX + 10, 0, 0);
    scene.add(flashlightTarget);
    flashlightLight.target = flashlightTarget;
    
    gameState.flashlightLight = flashlightLight;
    gameState.flashlightTarget = flashlightTarget;
    
    // 玩家附近微弱点光源 — 模拟手电筒反光照亮持筒者+周围
    // 强度低，衰减快，只照亮1-2米范围，让人物和附近地面稍微可见
    const playerGlow = new THREE.PointLight(0xccddff, 40, 6, 2);
    playerGlow.position.set(0, 0.3, 0);
    scene.add(playerGlow);
    gameState.playerGlow = playerGlow;
}

// ===== GLB模型玩家 =====
function createGLBPlayer() {
    const loader = new THREE.GLTFLoader();
    loader.load('./models/Aj.glb', (gltf) => {
        const model = gltf.scene;
        
        // 缩放到目标高度
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const targetHeight = 0.45;
        const scale = targetHeight / size.y;
        model.scale.set(scale, scale, scale);
        
        // 底部对齐地面
        const scaledBox = new THREE.Box3().setFromObject(model);
        const groundOffset = -scaledBox.min.y;
        
        // 启用阴影
        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        // 找骨骼
        const bones = {};
        model.traverse(child => {
            if (child.isBone) {
                const name = child.name.replace('mixamorig:', '');
                bones[name] = child;
            }
        });
        
        // 记录原始旋转
        const origRot = {};
        Object.keys(bones).forEach(name => {
            origRot[name] = {
                x: bones[name].rotation.x,
                y: bones[name].rotation.y,
                z: bones[name].rotation.z,
            };
        });
        
        // 保存当前位置（占位Group的位置）
        const currentPos = { x: playerMesh.position.x, z: playerMesh.position.z };
        
        // 清除占位Group内容，将GLB模型加入
        while (playerMesh.children.length > 0) {
            playerMesh.remove(playerMesh.children[0]);
        }
        playerMesh.add(model);
        playerMesh.position.set(currentPos.x, groundOffset, currentPos.z);
        playerMesh.visible = true; // 加载完成，显示模型
        
        gameState.glbGroundOffset = groundOffset;
        gameState.usingGLBPlayer = true;
        gameState.glbBones = bones;
        gameState.glbOrigRot = origRot;
        gameState.glbOrigHipsY = bones.Hips ? bones.Hips.position.y : 0;
        
        gameState.playerAnimTime = 0;
        gameState.isMoving = false;
        
        // 立即应用idle姿态，避免T-Pose闪现
        applyGLBIdlePose(bones);
        
        console.log('GLB模型加载成功，骨骼数:', Object.keys(bones).length, 'groundOffset:', groundOffset);
        
    }, undefined, (err) => {
        console.warn('GLB加载失败，回退到原始模型:', err);
        if (!gameState.usingGLBPlayer) createPrimitivePlayer();
    });
}

// 获取玩家Y坐标基准（GLB模型有groundOffset，原始模型为0）
// 应用GLB模型idle姿态（消除T-Pose）
function applyGLBIdlePose(bones) {
    // 只修正T-Pose中明显不自然的骨骼（手臂水平展开）
    // 其他骨骼保持原始旋转，不要全部归零！
    const pose = {
        LeftUpLeg: {x:0, y:0, z:0.05}, RightUpLeg: {x:0, y:0, z:-0.05},
        LeftLeg: {x:0, y:0, z:0}, RightLeg: {x:0, y:0, z:0},
        LeftArm: {x:0, y:0, z:0.15}, RightArm: {x:0, y:0, z:-0.15},
        LeftForeArm: {x:-0.3, y:0, z:0}, RightForeArm: {x:-0.3, y:0, z:0},
        LeftShoulder: {x:0, y:0, z:0}, RightShoulder: {x:0, y:0, z:0},
        LeftHand: {x:0, y:0, z:0}, RightHand: {x:0, y:0, z:0},
        LeftToeBase: {x:0, y:0, z:0}, RightToeBase: {x:0, y:0, z:0},
        Neck: {x:0, y:0, z:0}, Head: {x:0, y:0, z:0},
        Spine: {x:0, y:0, z:0}, Spine1: {x:0, y:0, z:0}, Spine2: {x:0, y:0, z:0},
    };
    Object.keys(pose).forEach(name => {
        if (!bones[name]) return;
        bones[name].rotation.x = pose[name].x;
        bones[name].rotation.y = pose[name].y;
        bones[name].rotation.z = pose[name].z;
    });
    // 注意：不再把其余骨骼归零！保持原始旋转
}

function getPlayerGroundY() {
    return gameState.usingGLBPlayer && gameState.glbGroundOffset ? gameState.glbGroundOffset : 0;
}

// ===== 原始程序化模型（回退） =====
function createPrimitivePlayer() {
    const playerGroup = new THREE.Group();
    const skinColor = 0xffdbac;
    const shirtColor = 0x3a6ea5;
    const pantsColor = 0x2c3e50;
    const shoeColor = 0x1a1a2e;
    const hairColor = 0x2c1810;
    
    // 腿（用Group包裹以便动画）
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.18, 0.8, 0);
    const legGeo = new THREE.CylinderGeometry(0.15, 0.13, 0.8, 6);
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor });
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.y = -0.4;
    leftLeg.castShadow = false;
    leftLegGroup.add(leftLeg);
    const shoeGeo = new THREE.BoxGeometry(0.22, 0.12, 0.35);
    const shoeMat = new THREE.MeshStandardMaterial({ color: shoeColor });
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(0, -0.74, 0.06);
    leftShoe.castShadow = false;
    leftLegGroup.add(leftShoe);
    playerGroup.add(leftLegGroup);
    
    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.18, 0.8, 0);
    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.y = -0.4;
    rightLeg.castShadow = false;
    rightLegGroup.add(rightLeg);
    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0, -0.74, 0.06);
    rightShoe.castShadow = false;
    rightLegGroup.add(rightShoe);
    playerGroup.add(rightLegGroup);
    
    // 身体
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.25, 0.7, 6);
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor });
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 1.15;
    body.castShadow = false;
    playerGroup.add(body);
    
    // 手臂（用Group包裹以便动画）
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.35, 1.4, 0);
    const armGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.6, 6);
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    const leftArm = new THREE.Mesh(armGeo, skinMat);
    leftArm.position.y = -0.3;
    leftArm.castShadow = false;
    leftArmGroup.add(leftArm);
    playerGroup.add(leftArmGroup);
    
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.35, 1.4, 0);
    const rightArm = new THREE.Mesh(armGeo, skinMat);
    rightArm.position.y = -0.3;
    rightArm.castShadow = false;
    rightArmGroup.add(rightArm);
    playerGroup.add(rightArmGroup);
    
    // 脖子
    const neckGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.15, 6);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.55;
    neck.castShadow = false;
    playerGroup.add(neck);
    
    // 头
    const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.8;
    head.castShadow = false;
    playerGroup.add(head);
    
    // 头发
    const hairGeo = new THREE.SphereGeometry(0.27, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor });
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.82;
    hair.castShadow = false;
    playerGroup.add(hair);
    
    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.08, 1.82, 0.22);
    playerGroup.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.08, 1.82, 0.22);
    playerGroup.add(rightEye);
    
    // 手持手电筒（右手）
    const flashlightGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.35, 6);
    const flashlightMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6 });
    const flashlight = new THREE.Mesh(flashlightGeo, flashlightMat);
    flashlight.position.set(0.48, 1.0, 0.25);
    flashlight.rotation.x = Math.PI / 6;
    flashlight.castShadow = false;
    playerGroup.add(flashlight);
    
    // 手电筒头部（亮光部分）
    const flashHeadGeo = new THREE.CylinderGeometry(0.09, 0.06, 0.06, 6);
    const flashHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0x333300 });
    const flashHead = new THREE.Mesh(flashHeadGeo, flashHeadMat);
    flashHead.position.set(0.48, 1.2, 0.35);
    flashHead.rotation.x = Math.PI / 6;
    flashHead.castShadow = false;
    playerGroup.add(flashHead);
    
    // 将原始模型加入占位Group（playerMesh已由createPlayer创建）
    while (playerMesh.children.length > 0) {
        playerMesh.remove(playerMesh.children[0]);
    }
    playerMesh.add(playerGroup);
    playerMesh.position.set(-GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 + 8, 0, 0);
    playerMesh.visible = true;
    
    gameState.player = playerMesh;
    gameState.usingGLBPlayer = false;
    // 存储动画部件引用
    gameState.playerParts = {
        leftLeg: leftLegGroup,
        rightLeg: rightLegGroup,
        leftArm: leftArmGroup,
        rightArm: rightArmGroup,
        body: body,
        head: head,
    };
    gameState.playerAnimTime = 0;
    gameState.isMoving = false;
}

// ============================================
// 创建敌人
// ============================================
function createEnemies() {
    createZombies();
    createJumpers();
    createSpitters();
    createGhosts();
    createBandages();
}

// ============================================
// 普通僵尸 - 站立行走的经典僵尸
// ============================================
function createZombies() {
    const zombieCount = 3;
    const positions = [
        { x: -15, z: -14 },  // 北侧教室
        { x: 25, z: -14 },   // 北侧教室
        { x: -20, z: 14 },   // 南侧教室
    ];
    
    // 先创建原始模型占位（防止异步加载期间mesh为null）
    createPrimitiveZombies(zombieCount, positions);
    
    // 然后异步加载monster GLB模型替换
    if (window.THREE && window.THREE.GLTFLoader) {
        const loader = new THREE.GLTFLoader();
        loader.load('./models/monster.glb', (gltf) => {
            const baseModel = gltf.scene;
            const animClip = gltf.animations && gltf.animations.length > 0 ? gltf.animations[0] : null;
            
            for (let i = 0; i < zombieCount; i++) {
                const model = baseModel.clone();
                
                // 缩放到与原始僵尸差不多高（约1.6单位）
                const box = new THREE.Box3().setFromObject(model);
                const size = box.getSize(new THREE.Vector3());
                const targetHeight = 1.6;
                const scale = targetHeight / size.y;
                model.scale.set(scale, scale, scale);
                
                // 底部对齐地面
                const scaledBox = new THREE.Box3().setFromObject(model);
                model.position.y -= scaledBox.min.y;
                
                // 启用阴影
                model.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                
                // 找骨骼
                const bones = {};
                model.traverse(child => {
                    if (child.isBone) bones[child.name] = child;
                });
                
                // 创建AnimationMixer播放自带动画
                let zMixer = null;
                if (animClip) {
                    zMixer = new THREE.AnimationMixer(model);
                    const action = zMixer.clipAction(animClip);
                    action.play();
                }
                
                // 添加红眼发光
                const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
                const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
                const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
                leftEye.position.set(-0.08, 1.5, 0.2);
                model.add(leftEye);
                const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
                rightEye.position.set(0.08, 1.5, 0.2);
                model.add(rightEye);
                
                // 保存旧位置和朝向
                const oldZombie = gameState.zombies[i];
                const oldPos = oldZombie ? oldZombie.mesh.position.clone() : new THREE.Vector3(positions[i].x, 0, positions[i].z);
                const oldAngle = oldZombie ? oldZombie.facingAngle : Math.random() * Math.PI * 2;
                
                // 移除旧模型
                if (oldZombie && oldZombie.mesh) scene.remove(oldZombie.mesh);
                
                model.userData.facingAngle = oldAngle;
                model.rotation.y = oldAngle;
                model.position.set(oldPos.x, model.position.y, oldPos.z);
                
                // 兼容parts接口
                const parts = {
                    leftLeg: createZombieBoneProxy(bones['BipTrump L Thigh_021'], bones['BipTrump L Calf_02']),
                    rightLeg: createZombieBoneProxy(bones['BipTrump R Thigh_021'], bones['BipTrump R Calf_014']),
                    leftArm: createZombieBoneProxy(bones['BipTrump L UpperArm_011'], bones['BipTrump L Forearm_07']),
                    rightArm: createZombieBoneProxy(bones['BipTrump R UpperArm_023'], bones['BipTrump R Forearm_019']),
                    torso: createZombieBoneProxy(bones['BipTrump Spine1_025'], null),
                    head: createZombieBoneProxy(bones['BipTrump Head_01'], null),
                };
                
                // 更新zombie数据
                if (oldZombie) {
                    oldZombie.mesh = model;
                    oldZombie.parts = parts;
                    oldZombie.usingGLB = true;
                    oldZombie.mixer = zMixer;
                    oldZombie.bones = bones;
                }
                
                scene.add(model);
            }
            console.log('Monster GLB加载成功，替换', zombieCount, '个僵尸');
            
        }, undefined, (err) => {
            console.warn('Monster GLB加载失败，保持原始模型:', err);
        });
    }
}

// 僵尸骨骼代理（简化版，直接设置骨骼rotation）
function createZombieBoneProxy(bone1, bone2) {
    const proxy = {
        rotation: { x: 0, y: 0, z: 0 },
        _b1: bone1, _b2: bone2,
    };
    // 用getter/setter让rotation.x/y/z直接驱动骨骼
    Object.defineProperty(proxy.rotation, 'x', {
        get() { return this._x || 0; },
        set(v) { this._x = v; if (this._b1) this._b1.rotation.x = v * 0.6; if (this._b2) this._b2.rotation.x = v * 0.4; }
    });
    Object.defineProperty(proxy.rotation, 'y', {
        get() { return this._y || 0; },
        set(v) { this._y = v; if (this._b1) this._b1.rotation.y = v * 0.6; if (this._b2) this._b2.rotation.y = v * 0.4; }
    });
    Object.defineProperty(proxy.rotation, 'z', {
        get() { return this._z || 0; },
        set(v) { this._z = v; if (this._b1) this._b1.rotation.z = v * 0.6; if (this._b2) this._b2.rotation.z = v * 0.4; }
    });
    return proxy;
}

// 原始程序化僵尸模型（回退）
function createPrimitiveZombies(zombieCount, positions) {
    for (let i = 0; i < zombieCount; i++) {
        const zombieGroup = new THREE.Group();
        const skinColor = 0x5a7a5a;
        const darkSkin = 0x3a5a3a;
        const clothColor = 0x4a4a3a;
        
        const leftLegGroup = new THREE.Group();
        leftLegGroup.position.set(-0.16, 0.75, 0);
        const legGeo = new THREE.CylinderGeometry(0.15, 0.14, 0.75, 6);
        const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 1 });
        const leftLeg = new THREE.Mesh(legGeo, clothMat);
        leftLeg.position.y = -0.38;
        leftLeg.castShadow = true;
        leftLegGroup.add(leftLeg);
        const footGeo = new THREE.BoxGeometry(0.2, 0.1, 0.3);
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const leftFoot = new THREE.Mesh(footGeo, darkMat);
        leftFoot.position.set(0, -0.7, 0.05);
        leftFoot.castShadow = true;
        leftLegGroup.add(leftFoot);
        zombieGroup.add(leftLegGroup);
        
        const rightLegGroup = new THREE.Group();
        rightLegGroup.position.set(0.16, 0.75, 0);
        const rightLeg = new THREE.Mesh(legGeo, clothMat);
        rightLeg.position.y = -0.38;
        rightLeg.castShadow = true;
        rightLegGroup.add(rightLeg);
        const rightFoot = new THREE.Mesh(footGeo, darkMat);
        rightFoot.position.set(0, -0.7, 0.05);
        rightFoot.castShadow = true;
        rightLegGroup.add(rightFoot);
        zombieGroup.add(rightLegGroup);
        
        const torsoGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.7, 6);
        const torsoMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 1 });
        const torso = new THREE.Mesh(torsoGeo, torsoMat);
        torso.position.y = 1.1;
        torso.rotation.x = 0.15;
        torso.castShadow = true;
        zombieGroup.add(torso);
        
        const leftArmGroup = new THREE.Group();
        leftArmGroup.position.set(-0.3, 1.35, 0);
        const armGeo = new THREE.CylinderGeometry(0.09, 0.07, 0.55, 6);
        const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9 });
        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(0, -0.28, 0.15);
        leftArm.rotation.x = -Math.PI / 2.8;
        leftArm.rotation.z = 0.1;
        leftArm.castShadow = true;
        leftArmGroup.add(leftArm);
        zombieGroup.add(leftArmGroup);
        
        const rightArmGroup = new THREE.Group();
        rightArmGroup.position.set(0.3, 1.35, 0);
        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(0, -0.28, 0.15);
        rightArm.rotation.x = -Math.PI / 2.5;
        rightArm.rotation.z = -0.1;
        rightArm.castShadow = true;
        rightArmGroup.add(rightArm);
        zombieGroup.add(rightArmGroup);
        
        const headGeo = new THREE.SphereGeometry(0.28, 8, 8);
        const headMat = new THREE.MeshStandardMaterial({ color: darkSkin, roughness: 1 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.6;
        head.scale.set(1, 1.1, 1);
        head.castShadow = true;
        zombieGroup.add(head);
        
        const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 1.63, 0.24);
        zombieGroup.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 1.63, 0.24);
        zombieGroup.add(rightEye);
        
        const mouthGeo = new THREE.BoxGeometry(0.15, 0.04, 0.06);
        const mouthMat = new THREE.MeshBasicMaterial({ color: 0x1a0a0a });
        const mouth = new THREE.Mesh(mouthGeo, mouthMat);
        mouth.position.set(0, 1.48, 0.25);
        zombieGroup.add(mouth);
        
        const bloodGeo = new THREE.CircleGeometry(0.06, 5);
        const bloodMat = new THREE.MeshBasicMaterial({ color: 0x440000, side: THREE.DoubleSide });
        const blood1 = new THREE.Mesh(bloodGeo, bloodMat);
        blood1.position.set(0.15, 1.2, 0.28);
        blood1.rotation.x = -0.15;
        zombieGroup.add(blood1);
        
        zombieGroup.userData.facingAngle = Math.random() * Math.PI * 2;
        zombieGroup.rotation.y = zombieGroup.userData.facingAngle;
        
        const pos = positions[i];
        zombieGroup.position.set(pos.x, 0, pos.z);
        
        gameState.zombies.push({
            type: 'walker',
            mesh: zombieGroup,
            state: 'wander',
            hp: 100,
            dead: false,
            speed: GAME_CONFIG.enemies.zombie.speed,
            runSpeed: GAME_CONFIG.enemies.zombie.runSpeed,
            wanderTarget: new THREE.Vector3(),
            wanderTimer: 0,
            originalPos: new THREE.Vector3(pos.x, 0, pos.z),
            facingAngle: zombieGroup.userData.facingAngle,
            attractedToLight: null,
            lightTarget: new THREE.Vector3(),
            turningSpeed: 2.0,
            animTime: Math.random() * Math.PI * 2,
            combatLockTimer: 0,
            parts: {
                leftLeg: leftLegGroup,
                rightLeg: rightLegGroup,
                leftArm: leftArmGroup,
                rightArm: rightArmGroup,
                torso: torso,
                head: head,
            },
            usingGLB: false,
        });
        
        scene.add(zombieGroup);
    }
}

// ============================================
// 跳跃僵尸 - 趴地爬行的恐怖怪物
// ============================================
function createJumpers() {
    const jumperCount = 3;
    const positions = [
        { x: 0, z: -14 },     // 北侧教室
        { x: -50, z: 14 },    // 南侧教室
        { x: 50, z: 0 },      // 走廊东段
    ];
    
    for (let i = 0; i < jumperCount; i++) {
        const jumperGroup = new THREE.Group();
        const skinColor = 0x6a4a5a; // 紫灰色皮肤
        const darkColor = 0x3a2a3a;
        const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9 });
        const darkMat = new THREE.MeshStandardMaterial({ color: darkColor, roughness: 0.8 });
        
        // 身体 - 长条形趴地躯干
        const torsoGeo = new THREE.BoxGeometry(0.5, 0.2, 1.2);
        const torso = new THREE.Mesh(torsoGeo, darkMat);
        torso.position.y = 0.25;
        torso.castShadow = true;
        jumperGroup.add(torso);
        
        // 头 - 低垂贴地，扁平
        const headGeo = new THREE.SphereGeometry(0.22, 6, 6);
        headGeo.scale(1.2, 0.7, 1);
        const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, 0.2, 0.7);
        head.castShadow = true;
        jumperGroup.add(head);
        
        // 三只发光黄眼
        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.12, 0.22, 0.88);
        jumperGroup.add(leftEye);
        const centerEye = new THREE.Mesh(eyeGeo, eyeMat);
        centerEye.position.set(0, 0.24, 0.9);
        jumperGroup.add(centerEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.12, 0.22, 0.88);
        jumperGroup.add(rightEye);
        
        // 前肢（左/右）- 用Group包裹做爬行动画
        const leftArmGroup = new THREE.Group();
        leftArmGroup.position.set(-0.35, 0.2, 0.3);
        const armGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6);
        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(0, -0.1, 0.15);
        leftArm.rotation.x = Math.PI / 2;
        leftArm.castShadow = true;
        leftArmGroup.add(leftArm);
        // 前爪
        const clawGeo = new THREE.ConeGeometry(0.03, 0.15, 4);
        const clawMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5 });
        const leftClaw1 = new THREE.Mesh(clawGeo, clawMat);
        leftClaw1.position.set(0, -0.08, 0.42);
        leftClaw1.rotation.x = Math.PI / 4;
        leftArmGroup.add(leftClaw1);
        const leftClaw2 = new THREE.Mesh(clawGeo, clawMat);
        leftClaw2.position.set(0, -0.12, 0.42);
        leftClaw2.rotation.x = Math.PI / 4;
        leftArmGroup.add(leftClaw2);
        jumperGroup.add(leftArmGroup);
        
        const rightArmGroup = new THREE.Group();
        rightArmGroup.position.set(0.35, 0.2, 0.3);
        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(0, -0.1, 0.15);
        rightArm.rotation.x = Math.PI / 2;
        rightArm.castShadow = true;
        rightArmGroup.add(rightArm);
        const rightClaw1 = new THREE.Mesh(clawGeo, clawMat);
        rightClaw1.position.set(0, -0.08, 0.42);
        rightClaw1.rotation.x = Math.PI / 4;
        rightArmGroup.add(rightClaw1);
        const rightClaw2 = new THREE.Mesh(clawGeo, clawMat);
        rightClaw2.position.set(0, -0.12, 0.42);
        rightClaw2.rotation.x = Math.PI / 4;
        rightArmGroup.add(rightClaw2);
        jumperGroup.add(rightArmGroup);
        
        // 后肢（左/右）- 粗壮弯曲
        const leftLegGroup = new THREE.Group();
        leftLegGroup.position.set(-0.25, 0.2, -0.4);
        const thighGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.4, 6);
        const leftThigh = new THREE.Mesh(thighGeo, skinMat);
        leftThigh.position.set(0, -0.05, -0.1);
        leftThigh.rotation.x = -0.3;
        leftThigh.castShadow = true;
        leftLegGroup.add(leftThigh);
        const calfGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.35, 6);
        const leftCalf = new THREE.Mesh(calfGeo, skinMat);
        leftCalf.position.set(0, -0.15, -0.25);
        leftCalf.rotation.x = 0.6;
        leftCalf.castShadow = true;
        leftLegGroup.add(leftCalf);
        jumperGroup.add(leftLegGroup);
        
        const rightLegGroup = new THREE.Group();
        rightLegGroup.position.set(0.25, 0.2, -0.4);
        const rightThigh = new THREE.Mesh(thighGeo, skinMat);
        rightThigh.position.set(0, -0.05, -0.1);
        rightThigh.rotation.x = -0.3;
        rightThigh.castShadow = true;
        rightLegGroup.add(rightThigh);
        const rightCalf = new THREE.Mesh(calfGeo, skinMat);
        rightCalf.position.set(0, -0.15, -0.25);
        rightCalf.rotation.x = 0.6;
        rightCalf.castShadow = true;
        rightLegGroup.add(rightCalf);
        jumperGroup.add(rightLegGroup);
        
        // 脊刺
        const spikeGeo = new THREE.ConeGeometry(0.04, 0.15, 4);
        const spikeMat = new THREE.MeshStandardMaterial({ color: 0x443344 });
        for (let s = 0; s < 4; s++) {
            const spike = new THREE.Mesh(spikeGeo, spikeMat);
            spike.position.set(0, 0.4, -0.2 + s * 0.2);
            spike.rotation.x = -Math.PI / 4;
            jumperGroup.add(spike);
        }
        
        // 尾巴
        const tailGeo = new THREE.CylinderGeometry(0.05, 0.02, 0.6, 6);
        const tail = new THREE.Mesh(tailGeo, skinMat);
        tail.position.set(0, 0.15, -0.8);
        tail.rotation.x = 0.4;
        tail.castShadow = true;
        jumperGroup.add(tail);
        
        const pos = positions[i];
        jumperGroup.position.set(pos.x, 0, pos.z);
        jumperGroup.userData.facingAngle = Math.random() * Math.PI * 2;
        jumperGroup.rotation.y = jumperGroup.userData.facingAngle;
        
        gameState.jumpers.push({
            type: 'jumper',
            mesh: jumperGroup,
            state: 'wander',
            hp: 80,
            dead: false,
            speed: GAME_CONFIG.enemies.jumper.speed,
            wanderTarget: new THREE.Vector3(),
            wanderTimer: 0,
            originalPos: new THREE.Vector3(pos.x, 0, pos.z),
            facingAngle: jumperGroup.userData.facingAngle,
            jumpTarget: new THREE.Vector3(),
            jumpOrigin: new THREE.Vector3(),
            jumpProgress: 0,
            jumpCooldownTimer: 0,
            jumpChargeTimer: 0,
            attractedToLight: null,
            lightTarget: new THREE.Vector3(),
            animTime: Math.random() * Math.PI * 2,
            combatLockTimer: 0,
            parts: {
                torso: torso,
                head: head,
                leftArm: leftArmGroup,
                rightArm: rightArmGroup,
                leftLeg: leftLegGroup,
                rightLeg: rightLegGroup,
            },
        });
        
        scene.add(jumperGroup);
    }
}

function createGhosts() {
    const ghostCount = 3;
    const positions = [
        { x: -20, z: 0 },
        { x: 20, z: 0 },
        { x: 0, z: -14 },
    ];
    
    for (let i = 0; i < ghostCount; i++) {
        const ghostGroup = new THREE.Group();
        
        const bodyGeometry = new THREE.SphereGeometry(0.8, 8, 8);
        const bodyMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xaaaaaa,
            transparent: true,
            opacity: 0.6,
            emissive: 0x222222,
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = 1.5;
        body.castShadow = true;
        ghostGroup.add(body);
        
        for (let j = 0; j < 3; j++) {
            const tailGeometry = new THREE.SphereGeometry(0.3, 8, 8);
            const tail = new THREE.Mesh(tailGeometry, bodyMaterial);
            tail.position.set((j - 1) * 0.3, 0.8, 0);
            ghostGroup.add(tail);
        }
        
        const pos = positions[i];
        ghostGroup.position.set(pos.x, 0, pos.z);
        
        gameState.ghosts.push({
            mesh: ghostGroup,
            state: 'wander',
            speed: GAME_CONFIG.enemies.ghost.speed,
            wanderTarget: new THREE.Vector3(),
            wanderTimer: 0,
            isScared: false,
        });
        
        scene.add(ghostGroup);
    }
}

// ============================================
// 创建钥匙
// ============================================
function createKeys() {
    // 钥匙分布在走廊和教室内
    // halfW = 70, 走廊 z=-4~4, 北教室 z=-4~-24, 南教室 z=4~24
    const keyPositions = [
        { x: -35, z: -14 },  // 北侧第2间教室深处
        { x: 20, z: 14 },    // 南侧第3间教室深处
        { x: 40, z: 0 },     // 走廊中段
    ];
    
    for (let i = 0; i < GAME_CONFIG.game.totalKeys; i++) {
        const keyGroup = new THREE.Group();
        
        const keyGeometry = new THREE.TorusGeometry(0.3, 0.1, 8, 16);
        const keyMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xffd700,
            metalness: 0.8,
            roughness: 0.2,
            emissive: 0x333300,
        });
        const keyRing = new THREE.Mesh(keyGeometry, keyMaterial);
        keyGroup.add(keyRing);
        
        const toothGeometry = new THREE.BoxGeometry(0.1, 0.6, 0.05);
        const tooth = new THREE.Mesh(toothGeometry, keyMaterial);
        tooth.position.y = -0.3;
        keyGroup.add(tooth);
        
        const pos = keyPositions[i];
        keyGroup.position.set(pos.x, 0.5, pos.z);
        
        const keyLight = new THREE.PointLight(0xffd700, 1, 5);
        keyLight.position.y = 0.5;
        keyGroup.add(keyLight);
        
        gameState.keys.push({
            mesh: keyGroup,
            collected: false,
            baseY: 0.5,
            floatOffset: Math.random() * Math.PI * 2,
        });
        
        scene.add(keyGroup);
    }
}

// ============================================
// 创建绷带（回血物品）
// ============================================
function createBandages() {
    const bandageCount = 5;
    // 可选区域：走廊和各教室
    const spawnAreas = [
        { xMin: -60, xMax: 60, zMin: -3, zMax: 3 },     // 走廊
        { xMin: -55, xMax: -25, zMin: -22, zMax: -6 },   // 北侧教室1
        { xMin: -15, xMax: 15, zMin: -22, zMax: -6 },    // 北侧教室2
        { xMin: 25, xMax: 55, zMin: -22, zMax: -6 },     // 北侧教室3
        { xMin: -55, xMax: -25, zMin: 6, zMax: 22 },     // 南侧教室1
        { xMin: -15, xMax: 15, zMin: 6, zMax: 22 },      // 南侧教室2
        { xMin: 25, xMax: 55, zMin: 6, zMax: 22 },       // 南侧教室3
    ];
    
    for (let i = 0; i < bandageCount; i++) {
        const bandageGroup = new THREE.Group();
        
        // 绷带卷 - 白色圆柱
        const rollGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8);
        const rollMat = new THREE.MeshStandardMaterial({ 
            color: 0xf5f0e0, roughness: 0.9, metalness: 0.0 
        });
        const roll = new THREE.Mesh(rollGeo, rollMat);
        roll.rotation.z = Math.PI / 2;
        roll.castShadow = true;
        bandageGroup.add(roll);
        
        // 红十字标记
        const crossGeo1 = new THREE.BoxGeometry(0.22, 0.02, 0.06);
        const crossMat = new THREE.MeshBasicMaterial({ color: 0xcc0000 });
        const crossH = new THREE.Mesh(crossGeo1, crossMat);
        crossH.position.set(0, 0.21, 0);
        bandageGroup.add(crossH);
        const crossGeo2 = new THREE.BoxGeometry(0.06, 0.02, 0.22);
        const crossV = new THREE.Mesh(crossGeo2, crossMat);
        crossV.position.set(0, 0.21, 0);
        bandageGroup.add(crossV);
        
        // 随机选一个区域
        const area = spawnAreas[Math.floor(Math.random() * spawnAreas.length)];
        const x = area.xMin + Math.random() * (area.xMax - area.xMin);
        const z = area.zMin + Math.random() * (area.zMax - area.zMin);
        
        bandageGroup.position.set(x, 0.5, z);
        
        // 微弱的绿色光芒，表示可拾取
        const bandageLight = new THREE.PointLight(0x44ff88, 0.8, 4);
        bandageLight.position.y = 0.3;
        bandageGroup.add(bandageLight);
        
        gameState.bandages.push({
            mesh: bandageGroup,
            collected: false,
            baseY: 0.5,
            floatOffset: Math.random() * Math.PI * 2,
            healAmount: 30, // 回复30点血
        });
        
        scene.add(bandageGroup);
    }
}
// 创建固定灯光
// ============================================
function createLights() {
    const lightPositions = [
        { x: -35, z: -14 },   // 北侧教室
        { x: 20, z: -14 },    // 北侧教室
        { x: -20, z: 14 },    // 南侧教室
        { x: 35, z: 14 },     // 南侧教室
    ];
    
    for (let i = 0; i < lightPositions.length; i++) {
        const pos = lightPositions[i];
        
        const indicatorGeometry = new THREE.RingGeometry(2, 2.2, 16);
        const indicatorMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffaa,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
        });
        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
        indicator.rotation.x = -Math.PI / 2;
        indicator.position.set(pos.x, 0.1, pos.z);
        scene.add(indicator);
        
        const light = new THREE.PointLight(0xffcc88, 6.0, 25, 1.5);
        light.position.set(pos.x, 4, pos.z);
        light.castShadow = false; // 由方向光负责投影
        scene.add(light);
        
        gameState.lights.push({
            indicator: indicator,
            light: light,
            position: new THREE.Vector3(pos.x, 0, pos.z),
            radius: 5,
            isFlicker: false,  // 非闪烁灯
        });
    }
    
    // ====== 破旧日光灯 - 会闪烁、偶尔熄灭 ======
    const flickerLightDefs = [
        { x: -5, z: 0 },
        { x: 5, z: 0 },
    ];
    
    for (let i = 0; i < flickerLightDefs.length; i++) {
        const pos = flickerLightDefs[i];
        
        // 日光灯灯管模型
        const fixtureGroup = new THREE.Group();
        // 灯座（长条金属外壳）
        const housingGeo = new THREE.BoxGeometry(2.0, 0.15, 0.4);
        const housingMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.6 });
        const housing = new THREE.Mesh(housingGeo, housingMat);
        housing.position.y = 7.85;
        fixtureGroup.add(housing);
        // 灯管（发光白色条）
        const tubeGeo = new THREE.BoxGeometry(1.8, 0.08, 0.2);
        const tubeMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            emissive: 0xffeecc, 
            emissiveIntensity: 1.0,
            transparent: true, 
            opacity: 0.9 
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.position.y = 7.75;
        fixtureGroup.add(tube);
        // 两端支架
        for (let sx = -1; sx <= 1; sx += 2) {
            const bracketGeo = new THREE.BoxGeometry(0.1, 0.3, 0.3);
            const bracket = new THREE.Mesh(bracketGeo, housingMat);
            bracket.position.set(sx * 0.9, 7.7, 0);
            fixtureGroup.add(bracket);
        }
        fixtureGroup.position.set(pos.x, 0, pos.z);
        scene.add(fixtureGroup);
        
        // 地面光斑
        const spotGeo = new THREE.CircleGeometry(3.5, 16);
        const spotMat = new THREE.MeshBasicMaterial({ 
            color: 0xffeecc,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const spot = new THREE.Mesh(spotGeo, spotMat);
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(pos.x, 0.05, pos.z);
        scene.add(spot);
        
        // 灯光
        const flickerLight = new THREE.PointLight(0xffeedd, 5.0, 22, 1.5);
        flickerLight.position.set(pos.x, 7.5, pos.z);
        flickerLight.castShadow = false; // 由方向光负责投影
        scene.add(flickerLight);
        
        gameState.lights.push({
            indicator: spot,
            light: flickerLight,
            position: new THREE.Vector3(pos.x, 0, pos.z),
            radius: 4,
            isFlicker: true,
            tubeMesh: tube,
            tubeMat: tubeMat,
            // 闪烁状态
            flickerPhase: Math.random() * 100,
            flickerSpeed: 5 + Math.random() * 10,  // 闪烁频率
            isDead: false,       // 是否完全熄灭
            deadTimer: 0,        // 熄灭计时
            deadDuration: 0,     // 熄灭持续时间
            nextDeadTime: 8 + Math.random() * 15,  // 多少秒后下次熄灭
            deadCountdown: 8 + Math.random() * 15, // 倒计时
        });
    }
}

// ============================================
// 创建出口大门
// ============================================
function createExitDoor() {
    const doorGroup = new THREE.Group();
    
    const frameGeometry = new THREE.BoxGeometry(4, 5, 0.3);
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a3a });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.y = 2.5;
    doorGroup.add(frame);
    
    const doorGeometry = new THREE.BoxGeometry(3.5, 4.5, 0.2);
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4a3a });
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.set(0, 2.25, 0.1);
    doorGroup.add(door);
    
    const lockGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const lockMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 });
    const lock = new THREE.Mesh(lockGeometry, lockMaterial);
    lock.position.set(1.5, 2.25, 0.25);
    doorGroup.add(lock);
    
    doorGroup.position.set(GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 - 5, 0, 0);
    doorGroup.rotation.y = Math.PI / 2;
    
    const signGeometry = new THREE.BoxGeometry(3, 0.5, 0.1);
    const signMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x003300 });
    const sign = new THREE.Mesh(signGeometry, signMaterial);
    sign.position.y = 5.25;
    doorGroup.add(sign);
    
    scene.add(doorGroup);
    
    // 出口门碰撞体
    const doorX = GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 - 5;
    gameState.colliders.push({
        position: new THREE.Vector3(doorX, 2.5, 0),
        width: 0.4,
        height: 5,
        depth: 3.2
    });
    
    gameState.exitDoor = {
        mesh: doorGroup,
        locked: true,
        lockMesh: lock,
    };
}

// ============================================
// 事件监听
// ============================================
function setupEventListeners() {
    // 阻止手机端默认触摸行为
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    
    window.addEventListener('resize', () => {
        const vs = getVisualSize();
        camera.aspect = vs.width / vs.height;
        camera.updateProjectionMatrix();
        renderer.setSize(vs.width, vs.height, false);  // false = 不设置style，让CSS控制
    });
    
    document.getElementById('start-button').addEventListener('click', () => {
        document.getElementById('start-screen').style.display = 'none';
        gameState.isPlaying = true;
    });
    
    document.getElementById('restart-button').addEventListener('click', () => {
        restartGame();
    });

    // 全局函数：联机大厅调用开始游戏
    window.startGameFromLobby = function(seed) {
        document.getElementById('lobby-screen') && (document.getElementById('lobby-screen').style.display = 'none');
        document.getElementById('room-screen') && (document.getElementById('room-screen').style.display = 'none');
        document.getElementById('start-screen') && (document.getElementById('start-screen').style.display = 'none');
        gameState.isPlaying = true;
        // 启动联机同步
        if (typeof startSync === 'function') {
            startSync();
        }
    };

    // ===== 手机触控支持 =====
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isMobile) {
        document.getElementById('game-container').classList.add('mobile-active');
    }

    // 竖屏CSS旋转时，需要把触摸坐标转换到旋转后的坐标系
    // 仅用于 touch-rotate-zone 等需要屏幕绝对坐标的场景
    function adjustTouchForRotation(clientX, clientY) {
        if (isMobile && window.innerWidth < 769 && window.innerWidth < window.innerHeight) {
            return { x: clientY, y: window.innerWidth - clientX };
        }
        return { x: clientX, y: clientY };
    }

    // 判断当前是否竖屏CSS旋转状态
    function isPortraitRotated() {
        return isMobile && window.innerWidth < 769 && window.innerWidth < window.innerHeight;
    }

    // 虚拟摇杆状态 — 使用触摸起始点作为中心，避免CSS旋转坐标系问题
    let joystickActive = false;
    let joystickX = 0, joystickY = 0;
    let joystickTouchId = null;
    let joystickCenterX = 0, joystickCenterY = 0;  // 触摸起始点作为摇杆中心
    const JOYSTICK_MAX_R = 42;

    const joystickZone = document.getElementById('joystick-zone');
    const joystickThumb = document.getElementById('joystick-thumb');
    const joystickBase = document.getElementById('joystick-base');

    if (joystickZone) {
        joystickZone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();  // 阻止冒泡，不触发屏幕旋转
            const touch = e.changedTouches[0];
            joystickTouchId = touch.identifier;
            joystickActive = true;
            joystickThumb.classList.add('active');
            joystickCenterX = touch.clientX;
            joystickCenterY = touch.clientY;
            joystickX = 0; joystickY = 0;
        }, { passive: false });

        joystickZone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const touch of e.changedTouches) {
                if (touch.identifier === joystickTouchId) {
                    updateJoystickFromDelta(touch.clientX - joystickCenterX, touch.clientY - joystickCenterY);
                    break;
                }
            }
        }, { passive: false });

        joystickZone.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const touch of e.changedTouches) {
                if (touch.identifier === joystickTouchId) {
                    joystickActive = false;
                    joystickTouchId = null;
                    joystickX = 0; joystickY = 0;
                    joystickThumb.style.left = '41px';
                    joystickThumb.style.top = '41px';
                    joystickThumb.classList.remove('active');
                    break;
                }
            }
        }, { passive: false });

        joystickZone.addEventListener('touchcancel', (e) => {
            joystickActive = false;
            joystickTouchId = null;
            joystickX = 0; joystickY = 0;
            joystickThumb.style.left = '41px';
            joystickThumb.style.top = '41px';
            joystickThumb.classList.remove('active');
        }, { passive: false });
    }

    function updateJoystickFromDelta(rawDx, rawDy) {
        // 竖屏旋转90度时，触摸的 dx/dy 需要映射到游戏方向
        // 物理上手指左右滑 = rawDx，前后滑 = rawDy
        // 旋转90度后：视觉左右(游戏X) = 物理前后(rawDy)，视觉前后(游戏Z) = 物理左右反方向(-rawDx)
        let dx, dy;
        if (isPortraitRotated()) {
            dx = rawDy;      // 手指前后滑 → 游戏左右
            dy = -rawDx;     // 手指左右滑 → 游戏前后（反向）
        } else {
            dx = rawDx;
            dy = rawDy;
        }
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_MAX_R) { dx = dx / dist * JOYSTICK_MAX_R; dy = dy / dist * JOYSTICK_MAX_R; }
        joystickX = dx / JOYSTICK_MAX_R;  // -1 到 1
        joystickY = dy / JOYSTICK_MAX_R;  // -1 到 1
        joystickThumb.style.left = (41 + dx) + 'px';
        joystickThumb.style.top = (41 + dy) + 'px';
    }

    // ===== 屏幕单指滑动旋转视角 =====
    let screenDragTouchId = null;
    let screenDragLastX = 0, screenDragLastY = 0;
    const gameContainer = document.getElementById('game-container');

    gameContainer.addEventListener('touchstart', (e) => {
        // 两指进入缩放模式，不处理单指拖拽
        if (e.touches.length >= 2) {
            screenDragTouchId = null;
            return;
        }
        const touch = e.changedTouches[0];
        // 只在屏幕中上部空白区域开始拖拽（避开底部摇杆和按钮区域）
        const adj = adjustTouchForRotation(touch.clientX, touch.clientY);
        const bottomLimit = (isPortraitRotated() ? window.innerWidth : window.innerHeight) - 160;
        if (adj.y > bottomLimit) return;
        screenDragTouchId = touch.identifier;
        screenDragLastX = adj.x;
        screenDragLastY = adj.y;
    }, { passive: true });

    gameContainer.addEventListener('touchmove', (e) => {
        if (screenDragTouchId === null) return;
        for (const touch of e.changedTouches) {
            if (touch.identifier === screenDragTouchId) {
                const adj = adjustTouchForRotation(touch.clientX, touch.clientY);
                const dx = adj.x - screenDragLastX;
                const dy = adj.y - screenDragLastY;
                // 水平滑动 → 旋转视角
                cameraAngle += dx * 0.003;
                // 垂直滑动 → 俯仰
                mouseY = Math.max(-1, Math.min(1, mouseY - dy * 0.004));
                screenDragLastX = adj.x;
                screenDragLastY = adj.y;
                break;
            }
        }
    }, { passive: true });

    gameContainer.addEventListener('touchend', (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === screenDragTouchId) {
                screenDragTouchId = null;
                break;
            }
        }
    }, { passive: true });

    gameContainer.addEventListener('touchcancel', () => {
        screenDragTouchId = null;
    }, { passive: true });

    // ===== 两指缩放远近 =====
    let pinchStartDist = 0;
    let pinchStartCamDist = 0;

    gameContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            screenDragTouchId = null;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchStartDist = Math.sqrt(dx * dx + dy * dy);
            pinchStartCamDist = GAME_CONFIG.camera.distance;
        }
    }, { passive: true });

    gameContainer.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && pinchStartDist > 0) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currDist = Math.sqrt(dx * dx + dy * dy);
            const scale = pinchStartDist / currDist;
            const ratio = GAME_CONFIG.camera.height / GAME_CONFIG.camera.distance;
            GAME_CONFIG.camera.distance = Math.max(12, Math.min(45, pinchStartCamDist * scale));
            GAME_CONFIG.camera.height = GAME_CONFIG.camera.distance * ratio;
        }
    }, { passive: true });

    gameContainer.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            pinchStartDist = 0;
        }
    }, { passive: true });

    // ===== 右侧电筒方向摇杆（绝对角度控制电筒方向） =====
    let aimJoystickActive = false;
    let aimJoystickX = 0;
    let aimJoystickY = 0;
    let aimJoystickAngle = 0;       // 摇杆偏移的绝对角度（弧度，相对于屏幕上方=0）
    let aimJoystickIntensity = 0;   // 摇杆偏移强度 0~1
    let aimJoystickLastAngle = 0;   // 松开时保持的最后角度
    let aimJoystickTouchId = null;
    let aimJoystickCenterX = 0, aimJoystickCenterY = 0;
    const AIM_JOYSTICK_MAX_R = 42;
    const aimJoystickZone = document.getElementById('aim-joystick-zone');
    const aimJoystickThumb = document.getElementById('aim-joystick-thumb');

    if (aimJoystickZone) {
        aimJoystickZone.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();  // 阻止冒泡，不触发屏幕旋转
            const touch = e.changedTouches[0];
            aimJoystickTouchId = touch.identifier;
            aimJoystickActive = true;
            aimJoystickEverUsed = true;
            aimJoystickThumb.classList.add('active');
            aimJoystickCenterX = touch.clientX;
            aimJoystickCenterY = touch.clientY;
            aimJoystickX = 0;
            aimJoystickY = 0;
            aimJoystickIntensity = 0;
        }, { passive: false });

        aimJoystickZone.addEventListener('touchmove', (e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const touch of e.changedTouches) {
                if (touch.identifier === aimJoystickTouchId) {
                    let rawDx = touch.clientX - aimJoystickCenterX;
                    let rawDy = touch.clientY - aimJoystickCenterY;
                    let dx, dy;
                    if (isPortraitRotated()) {
                        dx = rawDy;
                        dy = -rawDx;
                    } else {
                        dx = rawDx;
                        dy = rawDy;
                    }
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > AIM_JOYSTICK_MAX_R) { dx = dx / dist * AIM_JOYSTICK_MAX_R; dy = dy / dist * AIM_JOYSTICK_MAX_R; }
                    aimJoystickX = dx / AIM_JOYSTICK_MAX_R;
                    aimJoystickY = dy / AIM_JOYSTICK_MAX_R;
                    aimJoystickIntensity = Math.min(dist, AIM_JOYSTICK_MAX_R) / AIM_JOYSTICK_MAX_R;
                    // 计算绝对角度：dx正=右, dy正=下
                    // 映射到游戏世界：右→+X(sin), 下→-Z(-cos)，所以角度=atan2(dx, -dy)
                    if (dist > 5) {  // 死区5px，避免微小抖动
                        aimJoystickAngle = Math.atan2(dx, -dy);
                        aimJoystickLastAngle = aimJoystickAngle;
                    }
                    aimJoystickThumb.style.left = (41 + dx) + 'px';
                    aimJoystickThumb.style.top = (41 + dy) + 'px';
                    break;
                }
            }
        }, { passive: false });

        aimJoystickZone.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            for (const touch of e.changedTouches) {
                if (touch.identifier === aimJoystickTouchId) {
                    aimJoystickActive = false;
                    aimJoystickTouchId = null;
                    aimJoystickIntensity = 0;
                    // 松开摇杆时电筒方向保持，不清零角度
                    aimJoystickThumb.style.left = '41px';
                    aimJoystickThumb.style.top = '41px';
                    aimJoystickThumb.classList.remove('active');
                    break;
                }
            }
        }, { passive: false });

        aimJoystickZone.addEventListener('touchcancel', (e) => {
            aimJoystickActive = false;
            aimJoystickTouchId = null;
            aimJoystickIntensity = 0;
            aimJoystickThumb.style.left = '41px';
            aimJoystickThumb.style.top = '41px';
            aimJoystickThumb.classList.remove('active');
        }, { passive: false });
    }

    // 电筒摇杆输入 — 绝对角度控制电筒方向
    window._mobileAim = {
        get active() { return isMobile && aimJoystickActive; },
        get x() { return aimJoystickX; },
        get y() { return aimJoystickY; },
        get angle() { return aimJoystickAngle; },           // 当前绝对角度（激活时）
        get intensity() { return aimJoystickIntensity; },    // 偏移强度
        get lastAngle() { return aimJoystickLastAngle; }     // 即使松开也保持最后角度
    };


    // 动作按钮
    function bindMobileBtn(id, onDown, onUp) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.add('pressed'); onDown(); }, { passive: false });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.remove('pressed'); if (onUp) onUp(); }, { passive: false });
        btn.addEventListener('touchcancel', (e) => { btn.classList.remove('pressed'); if (onUp) onUp(); });
    }

    bindMobileBtn('btn-attack', () => { if (gameState.isPlaying && !gameState.isHiding) performAttack(); });
    bindMobileBtn('btn-run', () => { gameState.isRunning = true; }, () => { gameState.isRunning = false; });
    bindMobileBtn('btn-hide', () => { if (gameState.isPlaying) toggleHide(); });
    bindMobileBtn('btn-flashlight', () => { toggleFlashlight(); });
    bindMobileBtn('btn-jump', () => {
        if (gameState.isPlaying && !gameState.isHiding) {
            if (gameState.nearVaultObstacle && !gameState.isJumping && !gameState.isVaulting) {
                gameState.isVaulting = true;
                gameState.vaultProgress = 0;
            } else if (!gameState.isJumping) {
                startJump();
            }
        }
    });

    // 手机端摇杆输入注入到移动系统
    window._mobileJoystick = { get active() { return isMobile && joystickActive; }, get x() { return joystickX; }, get y() { return joystickY; } };
}

function toggleFlashlight() {
    gameState.flashlightOn = !gameState.flashlightOn;
}

// ============================================
// 跳跃系统
// ============================================
function startJump() {
    gameState.isJumping = true;
    gameState.jumpVelocity = 6; // 起跳速度
}

function updateJump(deltaTime) {
    if (!gameState.isJumping) {
        // 重力回落
        if (gameState.playerY > 0) {
            gameState.jumpVelocity -= 18 * deltaTime;
            gameState.playerY += gameState.jumpVelocity * deltaTime;
            if (gameState.playerY <= 0) {
                gameState.playerY = 0;
                gameState.jumpVelocity = 0;
            }
        }
        if (playerMesh) playerMesh.position.y = gameState.playerY + getPlayerGroundY();
        return;
    }
    
    gameState.jumpVelocity -= 18 * deltaTime; // 重力
    gameState.playerY += gameState.jumpVelocity * deltaTime;
    
    if (gameState.playerY <= 0) {
        gameState.playerY = 0;
        gameState.jumpVelocity = 0;
        gameState.isJumping = false;
    }
    
    if (playerMesh) playerMesh.position.y = gameState.playerY + getPlayerGroundY();
}

// ============================================
// 翻越系统
// ============================================
function startVault() {
    if (!gameState.nearVaultObstacle) return;
    gameState.isVaulting = true;
    gameState.vaultProgress = 0;
    const obs = gameState.nearVaultObstacle;
    const pPos = playerMesh.position;
    
    // 翻越方向：从玩家位置越过障碍到另一侧
    const facingAngle = playerMesh.rotation.y;
    const vaultDist = 3.0; // 翻越距离
    gameState.vaultStart = new THREE.Vector3(pPos.x, 0, pPos.z);
    gameState.vaultEnd = new THREE.Vector3(
        pPos.x + Math.sin(facingAngle) * vaultDist,
        0,
        pPos.z + Math.cos(facingAngle) * vaultDist
    );
}

function updateVault(deltaTime) {
    if (!gameState.isVaulting) return;
    
    gameState.vaultProgress += deltaTime * 2.5; // 0.4秒完成翻越
    
    if (gameState.vaultProgress >= 1) {
        gameState.isVaulting = false;
        gameState.playerY = 0;
        if (playerMesh && gameState.vaultEnd) {
            playerMesh.position.set(gameState.vaultEnd.x, getPlayerGroundY(), gameState.vaultEnd.z);
        }
        if (playerMesh) playerMesh.position.y = getPlayerGroundY();
        return;
    }
    
    const t = gameState.vaultProgress;
    // 水平移动
    if (playerMesh && gameState.vaultStart && gameState.vaultEnd) {
        playerMesh.position.x = gameState.vaultStart.x + (gameState.vaultEnd.x - gameState.vaultStart.x) * t;
        playerMesh.position.z = gameState.vaultStart.z + (gameState.vaultEnd.z - gameState.vaultStart.z) * t;
        // 垂直抛物线
        playerMesh.position.y = 1.5 * Math.sin(t * Math.PI) + getPlayerGroundY();
    }
    
    // 翻越动画：身体前倾
    if (gameState.usingGLBPlayer && gameState.glbBones) {
        const bones = gameState.glbBones;
        if (bones.Spine) bones.Spine.rotation.x = -0.4 * Math.sin(t * Math.PI);
        if (bones.Spine1) bones.Spine1.rotation.x = -0.2 * Math.sin(t * Math.PI);
    } else if (gameState.playerParts) {
        gameState.playerParts.body.rotation.x = -0.4 * Math.sin(t * Math.PI);
    }
}

function updateVaultPrompt() {
    // 检测附近矮障碍物
    let nearest = null;
    let nearestDist = 2.5;
    
    gameState.vaultObstacles.forEach((obs) => {
        const dist = playerMesh.position.distanceTo(new THREE.Vector3(obs.x, 0, obs.z));
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = obs;
        }
    });
    
    gameState.nearVaultObstacle = nearest;
    const prompt = document.getElementById('vault-prompt');
    if (prompt) {
        prompt.style.display = (nearest && !gameState.isHiding && !gameState.isJumping && !gameState.isVaulting) ? 'block' : 'none';
    }
}

// ============================================
// 近战攻击系统
// ============================================
function performAttack() {
    if (gameState.attackCooldown > 0 || gameState.isAttacking) return;
    
    gameState.isAttacking = true;
    gameState.attackCooldown = 0.6; // 0.6秒冷却
    
    // 获取玩家面朝方向（手电筒方向）
    const playerPos = playerMesh.position;
    const facingAngle = playerMesh.rotation.y;
    const facingDir = new THREE.Vector3(Math.sin(facingAngle), 0, Math.cos(facingAngle));
    
    // 攻击刀光效果
    createSlashEffect(playerPos, facingDir);
    
    // 检测攻击范围内的敌人（前方扇形区域）
    const attackRange = gameState.attackRange;
    const attackAngle = gameState.attackAngle;
    
    // 检查所有僵尸
    const allEnemies = [...gameState.zombies, ...gameState.jumpers, ...gameState.spitters];
    allEnemies.forEach((enemy) => {
        if (enemy.dead) return;
        const enemyPos = enemy.mesh.position;
        const dist = playerPos.distanceTo(enemyPos);
        
        if (dist > attackRange) return;
        
        // 检查是否在攻击扇形内
        const toEnemy = new THREE.Vector3().subVectors(enemyPos, playerPos);
        toEnemy.y = 0;
        toEnemy.normalize();
        const angle = facingDir.angleTo(toEnemy);
        
        if (angle < attackAngle / 2) {
            // 检查是否从背后攻击（伤害翻倍）
            const enemyFacing = new THREE.Vector3(
                Math.sin(enemy.facingAngle), 0, Math.cos(enemy.facingAngle)
            );
            const fromBehind = facingDir.dot(enemyFacing) > 0; // 同方向=背后
            
            const damage = fromBehind ? gameState.attackDamage * 2 : gameState.attackDamage;
            damageEnemy(enemy, damage, fromBehind);
        }
    });
    
    // 攻击动画：右臂挥刀
    if (gameState.usingGLBPlayer && gameState.glbBones) {
        const bones = gameState.glbBones;
        if (bones.RightArm) {
            bones.RightArm.rotation.x = -1.5;
            bones.RightArm.rotation.z = -0.8;
        }
        if (bones.RightForeArm) {
            bones.RightForeArm.rotation.x = 0.3;
        }
        setTimeout(() => {
            if (gameState.glbBones) {
                if (bones.RightArm) { bones.RightArm.rotation.x = 0; bones.RightArm.rotation.z = 0; }
                if (bones.RightForeArm) bones.RightForeArm.rotation.x = 0;
            }
        }, 200);
    } else if (gameState.playerParts) {
        gameState.playerParts.rightArm.rotation.x = -1.5;
        gameState.playerParts.rightArm.rotation.z = -0.8;
        setTimeout(() => {
            if (gameState.playerParts) {
                gameState.playerParts.rightArm.rotation.x = 0;
                gameState.playerParts.rightArm.rotation.z = 0;
            }
        }, 200);
    }
}

function damageEnemy(enemy, damage, fromBehind) {
    if (!enemy.hp) {
        // 默认血量：普通僵尸100，跳跃僵尸80
        enemy.hp = enemy.type === 'walker' ? 100 : 80;
    }
    enemy.hp -= damage;
    
    // 受伤闪烁效果
    flashEnemyDamage(enemy);
    
    if (enemy.hp <= 0) {
        killEnemy(enemy);
    }
}

function flashEnemyDamage(enemy) {
    // 让敌人所有子网格短暂变红
    const originalColors = [];
    enemy.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
            originalColors.push({ mesh: child, color: child.material.color.getHex() });
            child.material.color.setHex(0xff2222);
        }
    });
    setTimeout(() => {
        originalColors.forEach(({ mesh, color }) => {
            if (mesh.material) mesh.material.color.setHex(color);
        });
    }, 120);
}

function killEnemy(enemy) {
    enemy.dead = true;
    
    // 飙血效果
    createBloodSplash(enemy.mesh.position);
    
    // 死亡动画：向前倒下
    const mesh = enemy.mesh;
    const facingAngle = enemy.facingAngle || 0;
    // 朝着面朝方向倒下
    const fallDir = enemy.type === 'walker' ? 1 : 0.5;
    
    // 倒下动画：旋转倒地（0.5秒内完成）
    enemy.deathAnim = { progress: 0, facingAngle: facingAngle, type: enemy.type };
    
    // 从活跃列表中移除，加入尸体列表
    let list = enemy.type === 'walker' ? gameState.zombies : 
               enemy.type === 'jumper' ? gameState.jumpers : gameState.spitters;
    const idx = list.indexOf(enemy);
    if (idx >= 0) list.splice(idx, 1);
    
    // 尸体保留
    gameState.corpses.push(enemy);
}

function createBloodSplash(position) {
    // 地面血滩
    const bloodGeo = new THREE.CircleGeometry(0.8 + Math.random() * 0.4, 12);
    const bloodMat = new THREE.MeshBasicMaterial({ 
        color: 0x880000, 
        transparent: true, 
        opacity: 0.85,
        side: THREE.DoubleSide
    });
    const bloodPool = new THREE.Mesh(bloodGeo, bloodMat);
    bloodPool.rotation.x = -Math.PI / 2;
    bloodPool.position.set(position.x, 0.02, position.z);
    scene.add(bloodPool);
    
    // 飞溅血滴粒子
    for (let i = 0; i < 12; i++) {
        const dropGeo = new THREE.SphereGeometry(0.03 + Math.random() * 0.04, 4, 4);
        const dropMat = new THREE.MeshBasicMaterial({ color: 0xaa0000 });
        const drop = new THREE.Mesh(dropGeo, dropMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.3 + Math.random() * 0.8;
        drop.position.set(
            position.x + Math.cos(angle) * dist,
            0.02 + Math.random() * 0.1,
            position.z + Math.sin(angle) * dist
        );
        scene.add(drop);
        // 血滴2秒后淡出
        setTimeout(() => { scene.remove(drop); }, 2000);
    }
}

function createSlashEffect(playerPos, facingDir) {
    // 大型刀光弧线效果 — 更明显
    const slashGeo = new THREE.RingGeometry(0.3, 2.0, 16, 1, -Math.PI / 4, Math.PI / 2);
    const slashMat = new THREE.MeshBasicMaterial({ 
        color: 0x88ccff, 
        transparent: true, 
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    const slash = new THREE.Mesh(slashGeo, slashMat);
    slash.position.copy(playerPos);
    slash.position.y = 1.0;
    slash.position.x += facingDir.x * 1.2;
    slash.position.z += facingDir.z * 1.2;
    slash.rotation.x = -Math.PI / 2;
    slash.rotation.z = Math.atan2(facingDir.x, facingDir.z);
    scene.add(slash);
    
    // 中心光柱
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.15, 2.5, 6);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.7 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(playerPos);
    beam.position.y = 1.2;
    beam.position.x += facingDir.x * 1.0;
    beam.position.z += facingDir.z * 1.0;
    beam.rotation.x = Math.atan2(facingDir.z, facingDir.x) + Math.PI / 2;
    beam.rotation.z = -Math.atan2(facingDir.x, facingDir.z);
    scene.add(beam);
    
    // 快速淡出
    let fadeStep = 0;
    const fadeOut = () => {
        fadeStep++;
        slashMat.opacity -= 0.18;
        beamMat.opacity -= 0.18;
        if (slashMat.opacity > 0) {
            requestAnimationFrame(fadeOut);
        } else {
            scene.remove(slash);
            scene.remove(beam);
        }
    };
    requestAnimationFrame(fadeOut);
}

// ============================================
// 躲藏系统
// ============================================
function toggleHide() {
    if (gameState.isHiding) {
        // 从躲藏点出来
        gameState.isHiding = false;
        playerMesh.visible = true;
        // 恢复到进入前的位置
        if (gameState.preHidePosition) {
            playerMesh.position.set(gameState.preHidePosition.x, 0, gameState.preHidePosition.z);
            gameState.preHidePosition = null;
        }
        if (gameState.flashlightLight) {
            gameState.flashlightLight.intensity = gameState.flashlightOn && gameState.battery > 0 ? 2250 : 0;
        }
        gameState.hideSpot = null;
        // 隐藏躲藏指示器
        const indicator = document.getElementById('hiding-indicator');
        if (indicator) indicator.style.display = 'none';
        return;
    }
    // 尝试进入最近的躲藏点
    if (gameState.nearHideSpot) {
        gameState.isHiding = true;
        gameState.hideSpot = gameState.nearHideSpot;
        // 保存进入前的位置
        gameState.preHidePosition = { x: playerMesh.position.x, z: playerMesh.position.z };
        // 传送到躲藏点位置
        playerMesh.position.set(gameState.hideSpot.position.x, 0, gameState.hideSpot.position.z);
        playerMesh.visible = false;
        // 关灯
        if (gameState.flashlightLight) {
            gameState.flashlightLight.intensity = 0;
        }
        // 显示躲藏指示器
        const indicator = document.getElementById('hiding-indicator');
        if (indicator) indicator.style.display = 'block';
    }
}

function updateHidePrompt() {
    // 检测最近躲藏点
    let nearest = null;
    let nearestDist = 3.0; // 3米内提示
    gameState.hideSpots.forEach((spot) => {
        const dist = playerMesh.position.distanceTo(spot.position);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = spot;
        }
    });
    gameState.nearHideSpot = nearest;
    
    // 更新UI提示
    const prompt = document.getElementById('hide-prompt');
    if (prompt) {
        if (nearest && !gameState.isHiding) {
            prompt.style.display = 'block';
        } else {
            prompt.style.display = 'none';
        }
    }
}

function updateFlashlightDirection() {
    if (!playerMesh || !gameState.flashlightTarget || !camera) return;
    
    // 不再使用鼠标控制电筒方向
    // PC端：电筒跟随移动方向；手机端：由右摇杆控制（在updatePlayer中处理）
    
    // 物理光圈：根据手电筒到目标的距离动态调整锥角
    if (gameState.flashlightLight) {
        const lightPos = gameState.flashlightLight.position;
        const targetPos = gameState.flashlightTarget.position;
        const dist = lightPos.distanceTo(targetPos);
        const minAngle = 0.12;
        const maxAngle = 0.5;
        const minDist = 3;
        const maxDist = 45;
        const t2 = Math.max(0, Math.min(1, (dist - minDist) / (maxDist - minDist)));
        gameState.flashlightLight.angle = maxAngle - (maxAngle - minAngle) * t2;
    }
}

// ============================================
// 碰撞检测
// ============================================

// 敌人移动碰撞检测：尝试移动，如果碰撞则尝试分轴滑动
function tryEnemyMove(currentX, currentZ, desiredX, desiredZ, radius) {
    let finalX = desiredX;
    let finalZ = desiredZ;
    let blocked = false;
    
    for (const collider of gameState.colliders) {
        const halfW = collider.width / 2 + radius;
        const halfD = collider.depth / 2 + radius;
        
        // 检查目标位置是否碰撞
        if (finalX > collider.position.x - halfW && finalX < collider.position.x + halfW &&
            finalZ > collider.position.z - halfD && finalZ < collider.position.z + halfD) {
            blocked = true;
            
            // 尝试只沿X轴移动
            const xOnly = (currentZ > collider.position.z - halfD && currentZ < collider.position.z + halfD);
            // 尝试只沿Z轴移动
            const zOnly = (currentX > collider.position.x - halfW && currentX < collider.position.x + halfW);
            
            if (!xOnly) {
                // 可以沿X滑行
                finalZ = currentZ;
            } else if (!zOnly) {
                // 可以沿Z滑行
                finalX = currentX;
            } else {
                // 完全卡住，不动
                finalX = currentX;
                finalZ = currentZ;
            }
        }
    }
    
    return { x: finalX, z: finalZ, blocked };
}
function checkCollision(x, z, radius, collider) {
    // 简化的 AABB 碰撞检测
    const halfW = collider.width / 2 + radius;
    const halfD = collider.depth / 2 + radius;
    
    return (x > collider.position.x - halfW && x < collider.position.x + halfW &&
            z > collider.position.z - halfD && z < collider.position.z + halfD);
}

// ============================================
// 射线遮挡检测 — 检查从from到to的线段是否被碰撞体遮挡
// ============================================
function isLineOfSightBlocked(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const totalDist = Math.sqrt(dx * dx + dz * dz);
    if (totalDist < 0.1) return false;
    
    // 沿射线方向步进，检查每个点是否在某个碰撞体内
    const steps = Math.ceil(totalDist / 0.5); // 每0.5米检查一次
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = from.x + dx * t;
        const pz = from.z + dz * t;
        
        for (const collider of gameState.colliders) {
            // 检查射线点是否在碰撞体内部（用小半径）
            const halfW = collider.width / 2;
            const halfD = collider.depth / 2;
            if (px > collider.position.x - halfW && px < collider.position.x + halfW &&
                pz > collider.position.z - halfD && pz < collider.position.z + halfD) {
                return true; // 被遮挡
            }
        }
    }
    return false; // 没有遮挡
}

// ============================================
// 游戏更新逻辑
// ============================================
function update(deltaTime) {
    if (!gameState.isPlaying) return;
    
    updatePlayer(deltaTime);
    updateZombies(deltaTime);
    updateJumpers(deltaTime);
    updateSpitters(deltaTime);
    updateProjectiles(deltaTime);
    updatePoison(deltaTime);
    updateGhosts(deltaTime);
    updateDeathAnimations(deltaTime);
    updateKeys(deltaTime);
    updateBandages(deltaTime);
    updateFlickerLights(deltaTime);
    updateEnemyVisibility();  // 视线遮挡机制
    updateFogByCamera();  // 动态雾距补偿
    checkCollisions();
    updateUI();
    updateAtmosphereShake();
}

// 动态雾距补偿：确保玩家周围始终清晰，远处逐渐变黑
function updateFogByCamera() {
    if (!scene.fog || !playerMesh) return;
    const camDist = camera.position.distanceTo(playerMesh.position);
    // near = 相机到玩家距离 + 缓冲区（玩家周围始终无雾）
    const clearZone = 20; // 玩家身边20米内完全无雾
    scene.fog.near = Math.max(1, camDist - clearZone);
    // far = near + 渐变区长度
    scene.fog.far = scene.fog.near + 45;
}

// 视线遮挡机制：用裁剪平面切割被墙挡住的部分，完全不可见
function updateEnemyVisibility() {
    if (!playerMesh) return;
    const playerPos = playerMesh.position;
    
    // 获取从玩家到目标之间最近的遮挡点和法线
    function getClipPlane(from, to) {
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const totalDist = Math.sqrt(dx * dx + dz * dz);
        if (totalDist < 0.1) return null;
        
        const dirX = dx / totalDist;
        const dirZ = dz / totalDist;
        
        // 沿射线步进，找到第一个遮挡点
        const steps = Math.ceil(totalDist / 0.5);
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const px = from.x + dx * t;
            const pz = from.z + dz * t;
            
            for (const collider of gameState.colliders) {
                const halfW = collider.width / 2;
                const halfD = collider.depth / 2;
                if (px > collider.position.x - halfW && px < collider.position.x + halfW &&
                    pz > collider.position.z - halfD && pz < collider.position.z + halfD) {
                    // 找到遮挡点，在此处放置裁剪平面
                    // 法线朝向玩家（挡住的部分=远离玩家的部分被切掉）
                    const clipX = px - dirX * 0.1; // 稍微往玩家方向偏移一点避免z-fighting
                    const clipZ = pz - dirZ * 0.1;
                    const plane = new THREE.Plane(
                        new THREE.Vector3(-dirX, 0, -dirZ), // 法线朝向玩家
                        0
                    );
                    plane.constant = -(clipX * (-dirX) + clipZ * (-dirZ));
                    return plane;
                }
            }
        }
        return null; // 无遮挡
    }
    
    // 给敌人设置裁剪平面
    function applyClipPlane(mesh, plane) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                        mat.clippingPlanes = plane ? [plane] : [];
                        mat.clipShadows = true;
                        mat.needsUpdate = true;
                    });
                } else {
                    child.material.clippingPlanes = plane ? [plane] : [];
                    child.material.clipShadows = true;
                    child.material.needsUpdate = true;
                }
            }
        });
    }
    
    // 僵尸
    gameState.zombies.forEach((zombie) => {
        if (zombie.dead) return;
        const plane = getClipPlane(playerPos, zombie.mesh.position);
        applyClipPlane(zombie.mesh, plane);
    });
    
    // 跳跃者
    gameState.jumpers.forEach((jumper) => {
        if (jumper.dead) return;
        const plane = getClipPlane(playerPos, jumper.mesh.position);
        applyClipPlane(jumper.mesh, plane);
    });
    
    // 喷毒者
    gameState.spitters.forEach((spitter) => {
        if (spitter.dead) return;
        const plane = getClipPlane(playerPos, spitter.mesh.position);
        applyClipPlane(spitter.mesh, plane);
    });
    
    // 幽灵不受视线遮挡影响
}

// 低血量心跳节奏抖动
let heartbeatShakeTimer = 0;
function updateAtmosphereShake() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas || !playerMesh) return;
    
    // 受伤抖动优先
    if (canvas.classList.contains('heavy-shake') || canvas.classList.contains('shaking')) return;
    
    const hpRatio = gameState.playerHP / gameState.maxPlayerHP;
    
    // 只有血量低于20%才有心跳抖动
    if (hpRatio >= 0.2) {
        canvas.classList.remove('shaking');
        heartbeatShakeTimer = 0;
        return;
    }
    
    // 心跳节奏：每3秒一个心跳周期（咚-咚..............咚-咚..............）
    heartbeatShakeTimer += 1 / 60;
    const beatInterval = 3.0;
    const beatPhase = heartbeatShakeTimer % beatInterval;
    
    // 心跳双击：0~0.12s 第一跳，0.2~0.32s 第二跳，中间长停顿
    if ((beatPhase < 0.12) || (beatPhase > 0.2 && beatPhase < 0.32)) {
        canvas.classList.add('shaking');
    } else {
        canvas.classList.remove('shaking');
    }
}

function updatePlayer(deltaTime) {
    if (!playerMesh) return;
    
    // 躲藏中不允许移动
    if (gameState.isHiding) {
        updateHidePrompt();
        // 躲藏中缓慢恢复电量
        gameState.battery = Math.min(GAME_CONFIG.player.maxBattery, gameState.battery + GAME_CONFIG.player.batteryRechargeRate * deltaTime * 2);
        // 相机跟随躲藏点
        if (gameState.hideSpot) {
            camera.position.x = gameState.hideSpot.position.x + Math.sin(cameraAngle) * GAME_CONFIG.camera.distance;
            camera.position.z = gameState.hideSpot.position.z + Math.cos(cameraAngle) * GAME_CONFIG.camera.distance;
            camera.lookAt(gameState.hideSpot.position.x, 0, gameState.hideSpot.position.z);
        }
        return;
    }
    
    const moveSpeed = gameState.isRunning ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.speed;
    const moveDir = new THREE.Vector3(0, 0, 0);

    // 手机虚拟摇杆输入
    if (window._mobileJoystick && window._mobileJoystick.active) {
        moveDir.x += window._mobileJoystick.x;
        moveDir.z += window._mobileJoystick.y;
    }
    
    // 提前计算旋转后的移动方向（电筒回位逻辑和位移都需要）
    let rotatedX = 0, rotatedZ = 0;
    if (moveDir.length() > 0) {
        moveDir.normalize();
        const cosA = Math.cos(cameraAngle);
        const sinA = Math.sin(cameraAngle);
        rotatedX = moveDir.x * cosA + moveDir.z * sinA;
        rotatedZ = -moveDir.x * sinA + moveDir.z * cosA;
    }
    
    // 手机电筒方向摇杆 → 绝对角度控制电筒方向
    if (window._mobileAim && window._mobileAim.active) {
        // 右摇杆激活时：直接用摇杆的绝对角度设置电筒方向
        const aimAngle = window._mobileAim.angle;
        if (gameState.flashlightTarget) {
            const dist = 10;  // 目标距离
            // aimAngle: 摇杆相对屏幕的角度（0=上, PI/2=右, PI=下, -PI/2=左）
            // 需要转为世界坐标：屏幕上方=相机前方，cameraAngle是相机位置角度，前方=cameraAngle+PI
            const worldAngle = -aimAngle + cameraAngle + Math.PI;
            gameState.flashlightTarget.position.set(
                playerMesh.position.x + Math.sin(worldAngle) * dist,
                0,
                playerMesh.position.z + Math.cos(worldAngle) * dist
            );
        }
    }
    
    if (moveDir.length() > 0) {
        // 计算新位置（rotatedX/rotatedZ 已在前面计算）
        const newX = playerMesh.position.x + rotatedX * moveSpeed * deltaTime;
        const newZ = playerMesh.position.z + rotatedZ * moveSpeed * deltaTime;
        
        // 检查碰撞
        const playerRadius = 0.8;
        let canMove = true;
        
        for (const collider of gameState.colliders) {
            if (checkCollision(newX, newZ, playerRadius, collider)) {
                canMove = false;
                break;
            }
        }
        
        if (canMove) {
            playerMesh.position.x = newX;
            playerMesh.position.z = newZ;
        }
        
        gameState.isMoving = true;
        const animSpeed = gameState.isRunning ? 12 : 8;
        gameState.playerAnimTime += deltaTime * animSpeed;
    } else {
        gameState.isMoving = false;
    }
    
    // 玩家走路动画
    if (gameState.usingGLBPlayer && gameState.glbBones) {
        // GLB模型：直接驱动Mixamo骨骼
        const bones = gameState.glbBones;
        const t = gameState.playerAnimTime;
        const moveAmount = gameState.isMoving ? 1 : 0;
        const runMult = gameState.isRunning ? 1.6 : 1.0;
        const blend = Math.min(moveAmount * 5 * deltaTime * 60, 1); // 平滑过渡到走路
        
        // 站立姿态（含呼吸微动）— 覆盖所有主要骨骼
        const breathT = performance.now() * 0.001; // 用真实时间做呼吸，不受移动影响
        const breathCycle = Math.sin(breathT * 1.5) * 0.5 + 0.5; // 0~1 缓慢呼吸
        const idle = {
            Hips: {x:0, y:0, z:0},
            Spine: {x: breathCycle * 0.01, y:0, z:0}, Spine1: {x: breathCycle * 0.015, y:0, z:0}, Spine2: {x: breathCycle * 0.01, y:0, z:0},
            Neck: {x: -breathCycle * 0.008, y:0, z:0}, Head: {x: breathCycle * 0.005, y:0, z:0},
            LeftShoulder: {x:0, y:0, z:0}, RightShoulder: {x:0, y:0, z:0},
            LeftUpLeg: {x:0, y:0, z:0.05}, RightUpLeg: {x:0, y:0, z:-0.05},
            LeftLeg: {x:0, y:0, z:0}, RightLeg: {x:0, y:0, z:0},
            LeftArm: {x: breathCycle * 0.02, y:0, z:0.15}, RightArm: {x: breathCycle * 0.02, y:0, z:-0.15},
            LeftForeArm: {x:-0.3, y:0, z:0}, RightForeArm: {x:-0.3, y:0, z:0},
            LeftHand: {x:0, y:0, z:0}, RightHand: {x:0, y:0, z:0},
            LeftToeBase: {x:0, y:0, z:0}, RightToeBase: {x:0, y:0, z:0},
        };
        
        // 走路动画值
        const walk = {};
        if (bones.LeftUpLeg) {
            const legSwing = Math.sin(t) * 0.5 * runMult;
            const armSwing = Math.sin(t) * 0.4 * runMult;
            walk.LeftUpLeg = {x: legSwing, y:0, z:0.05};
            walk.RightUpLeg = {x: -legSwing, y:0, z:-0.05};
            walk.LeftLeg = {x: Math.max(0, -legSwing)*0.6 + Math.abs(legSwing)*0.1, y:0, z:0};
            walk.RightLeg = {x: Math.max(0, legSwing)*0.6 + Math.abs(legSwing)*0.1, y:0, z:0};
            walk.LeftArm = {x: -armSwing, y:0, z:0.15};
            walk.RightArm = {x: armSwing, y:0, z:-0.15};
            walk.LeftForeArm = {x: Math.max(0, armSwing)*0.5 + 0.08, y:0, z:0};
            walk.RightForeArm = {x: Math.max(0, -armSwing)*0.5 + 0.08, y:0, z:0};
        }
        if (bones.Spine1) walk.Spine1 = {x:0, y: Math.sin(t)*0.03, z:0};
        if (bones.Spine2) walk.Spine2 = {x:0, y: Math.sin(t)*0.02, z:0};
        walk.Head = {x: Math.sin(t*2)*0.02, y:0, z:0};
        walk.Hips = {x:0, y:0, z:0};
        walk.Spine = {x:0, y:0, z:0};
        
        // 混合站立和走路
        const lerpVal = (a, b, t) => a + (b - a) * t;
        Object.keys(idle).forEach(name => {
            if (!bones[name]) return;
            const i = idle[name], w = walk[name] || i;
            bones[name].rotation.x = lerpVal(i.x, w.x, blend);
            bones[name].rotation.y = lerpVal(i.y, w.y, blend);
            bones[name].rotation.z = lerpVal(i.z, w.z, blend);
        });
        
        // Hips上下起伏（走路+呼吸）
        if (bones.Hips) {
            const walkBounce = Math.abs(Math.sin(t * 2)) * 0.03 * blend * runMult;
            const breathBounce = breathCycle * 0.005 * (1 - blend); // 站立时呼吸起伏
            bones.Hips.position.y = gameState.glbOrigHipsY + walkBounce + breathBounce;
        }
        
    } else if (gameState.playerParts) {
        // 原始程序化模型动画
        const parts = gameState.playerParts;
        const t = gameState.playerAnimTime;
        const moveAmount = gameState.isMoving ? 1 : 0;
        
        // 腿摆动
        const legSwing = Math.sin(t) * 0.5 * moveAmount;
        parts.leftLeg.rotation.x = legSwing;
        parts.rightLeg.rotation.x = -legSwing;
        
        // 手臂反向摆动
        parts.leftArm.rotation.x = -legSwing * 0.6;
        parts.rightArm.rotation.x = legSwing * 0.6;
        
        // 身体上下微动（行走时的重心起伏）
        parts.body.position.y = 1.15 + Math.abs(Math.sin(t * 2)) * 0.03 * moveAmount;
    }
    
    const boundary = GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 - 2;
    playerMesh.position.x = Math.max(-boundary, Math.min(boundary, playerMesh.position.x));
    playerMesh.position.z = Math.max(-boundary, Math.min(boundary, playerMesh.position.z));
    
    camera.position.x = playerMesh.position.x + Math.sin(cameraAngle) * GAME_CONFIG.camera.distance;
    camera.position.z = playerMesh.position.z + Math.cos(cameraAngle) * GAME_CONFIG.camera.distance;
    camera.lookAt(playerMesh.position.x, 0.3, playerMesh.position.z);
    
    // 更新手电筒位置跟随玩家（不旋转）
    if (gameState.flashlightLight) {
        gameState.flashlightLight.position.set(
            playerMesh.position.x,
            0.3,
            playerMesh.position.z
        );
    }
    
    // 更新玩家附近微光跟随
    if (gameState.playerGlow) {
        gameState.playerGlow.position.set(
            playerMesh.position.x,
            0.3,
            playerMesh.position.z
        );
        // 手电筒开关同步：关灯时微光也变暗
        gameState.playerGlow.intensity = (gameState.flashlightOn && gameState.battery > 0) ? 15 : 0.5;
    }
    
    // 人物朝向：移动时跟移动方向
    if (gameState.isMoving && (rotatedX !== 0 || rotatedZ !== 0)) {
        const moveAngle = Math.atan2(rotatedX, rotatedZ);
        let diff = moveAngle - playerMesh.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        playerMesh.rotation.y += diff * Math.min(10 * deltaTime, 1);
    }
    
    // 灯光方向：跟随身体方向（稍快），偏移限制±60度，停步后回位
    if (gameState.flashlightTarget) {
        const bodyAngle = playerMesh.rotation.y;
        const toTarget = new THREE.Vector3().subVectors(gameState.flashlightTarget.position, playerMesh.position);
        toTarget.y = 0;
        let flashAngle = toTarget.length() > 0.5 ? Math.atan2(toTarget.x, toTarget.z) : bodyAngle;
        
        // 计算灯光与身体的偏移
        let offset = flashAngle - bodyAngle;
        while (offset > Math.PI) offset -= Math.PI * 2;
        while (offset < -Math.PI) offset += Math.PI * 2;
        
        // 限制偏移在±60度(PI/3)以内
        const maxOffset = Math.PI / 3;
        if (offset > maxOffset) offset = maxOffset;
        if (offset < -maxOffset) offset = -maxOffset;
        
        // 停步时灯光缓慢回位到身体朝向（1.5弧度/秒）
        if (!gameState.isMoving) {
            offset *= Math.max(0, 1 - 1.5 * deltaTime);
        }
        
        // 灯光目标角度 = 身体角度 + 限制后的偏移
        const targetFlashAngle = bodyAngle + offset;
        const dist = Math.max(toTarget.length(), 10);
        gameState.flashlightTarget.position.set(
            playerMesh.position.x + Math.sin(targetFlashAngle) * dist,
            0,
            playerMesh.position.z + Math.cos(targetFlashAngle) * dist
        );
    }
    
    updateFlashlightDirection();
    
    if (gameState.flashlightOn && gameState.isRunning) {
        gameState.battery = Math.max(0, gameState.battery - GAME_CONFIG.player.batteryDrainRate * deltaTime * 2);
    } else if (gameState.flashlightOn) {
        gameState.battery = Math.max(0, gameState.battery - GAME_CONFIG.player.batteryDrainRate * deltaTime);
    } else {
        gameState.battery = Math.min(GAME_CONFIG.player.maxBattery, gameState.battery + GAME_CONFIG.player.batteryRechargeRate * deltaTime);
    }
    
    if (gameState.flashlightLight) {
        gameState.flashlightLight.intensity = gameState.flashlightOn && gameState.battery > 0 ? 2250 : 0;
    }
    
    // 更新躲藏提示
    updateHidePrompt();
    
    // 更新攻击冷却
    if (gameState.attackCooldown > 0) {
        gameState.attackCooldown -= deltaTime;
    }
    if (gameState.isAttacking && gameState.attackCooldown <= 0.3) {
        gameState.isAttacking = false;
    }
    
    // 更新跳跃
    updateJump(deltaTime);
    
    // 更新翻越
    updateVault(deltaTime);
    
    // 更新受伤无敌帧
    if (gameState.damageCooldown > 0) {
        gameState.damageCooldown -= deltaTime;
        // 无敌闪烁
        if (playerMesh) playerMesh.visible = Math.floor(gameState.damageCooldown * 10) % 2 === 0;
    } else {
        if (playerMesh && !gameState.isHiding) playerMesh.visible = true;
    }
    
    // 更新翻越提示
    updateVaultPrompt();
}

function updateZombies(deltaTime) {
    gameState.zombies.forEach((zombie) => {
        if (zombie.dead) return;
        const zombiePos = zombie.mesh.position;
        const distanceToPlayer = zombiePos.distanceTo(playerMesh.position);
        const zcfg = GAME_CONFIG.enemies.zombie;
        
        // ---- 获取僵尸面朝方向 ----
        const facing = new THREE.Vector3(
            Math.sin(zombie.facingAngle),
            0,
            Math.cos(zombie.facingAngle)
        ).normalize();
        
        // ---- 检查是否在视野锥内 ----
        function isInVision(targetPos) {
            const dist = zombiePos.distanceTo(targetPos);
            if (dist > zcfg.visionRange) return false;
            const toTarget = new THREE.Vector3().subVectors(targetPos, zombiePos).normalize();
            toTarget.y = 0;
            const angle = facing.angleTo(toTarget);
            return angle < zcfg.visionAngle / 2;
        }
        
        // ---- 检查正面是否被手电筒照射 ----
        let isFlashlightOnFace = false;
        if (distanceToPlayer < zcfg.lightDetectionRange &&
            gameState.flashlightOn && gameState.battery > 0 && gameState.flashlightLight) {
            // 光从玩家照向僵尸方向
            const flashlightPos = new THREE.Vector3();
            flashlightPos.setFromMatrixPosition(gameState.flashlightLight.matrixWorld);
            const lightToZombie = new THREE.Vector3().subVectors(zombiePos, flashlightPos).normalize();
            lightToZombie.y = 0;
            const flashlightDir = new THREE.Vector3();
            gameState.flashlightLight.getWorldDirection(flashlightDir);
            flashlightDir.y = 0;
            flashlightDir.normalize();
            const lightAngle = flashlightDir.angleTo(lightToZombie);
            
            // 光照到了僵尸
            if (lightAngle < zcfg.lightDetectionAngle / 2) {
                // 检查光线是否被墙遮挡
                if (!isLineOfSightBlocked(flashlightPos, zombiePos)) {
                    // 光没被挡，检查光是正面照过来（光的来源方向在僵尸前方视野锥内）
                    const lightSourceDir = new THREE.Vector3().subVectors(flashlightPos, zombiePos).normalize();
                    lightSourceDir.y = 0;
                    const faceAngle = facing.angleTo(lightSourceDir);
                    if (faceAngle < zcfg.visionAngle / 2) {
                        isFlashlightOnFace = true;
                    }
                }
            }
        }
        
        // ---- 检查是否在固定灯光区域 ----
        let isZombieInLitArea = false;
        gameState.lights.forEach((light) => {
            if (zombiePos.distanceTo(light.position) < light.radius) {
                isZombieInLitArea = true;
            }
        });
        let isPlayerInLitArea = false;
        gameState.lights.forEach((light) => {
            if (playerMesh.position.distanceTo(light.position) < light.radius) {
                isPlayerInLitArea = true;
            }
        });
        
        // ---- 确定追击目标 ----
        let shouldChase = false;
        let chaseTarget = playerMesh.position;
        
        // 优先级0: 奔跑噪音 - 吸引附近僵尸转向噪音方向（但不直接追到玩家）
        let isAttractedByNoise = false;
        if (gameState.isRunning && gameState.isMoving && !gameState.isHiding) {
            const noiseRange = zcfg.noiseDetectionRange;
            if (distanceToPlayer < noiseRange) {
                isAttractedByNoise = true;
            }
        }
        
        // 优先级1: 正面被手电筒照到 → 追光源
        if (isFlashlightOnFace) {
            zombie.attractedToLight = 'flashlight';
            zombie.lightTarget.set(
                gameState.flashlightLight.position.x,
                0,
                gameState.flashlightLight.position.z
            );
            shouldChase = true;
            chaseTarget = zombie.lightTarget;
        }
        // 优先级2: 看见玩家（视野锥内）+ 无遮挡
        else if (isInVision(playerMesh.position) && !gameState.isHiding && !isLineOfSightBlocked(zombiePos, playerMesh.position)) {
            zombie.attractedToLight = null;
            shouldChase = true;
            chaseTarget = playerMesh.position;
        }
        // 优先级3: 玩家在固定灯光区域（光暴露了玩家位置）
        else if (isPlayerInLitArea && distanceToPlayer < 30 && !gameState.isHiding) {
            zombie.attractedToLight = null;
            shouldChase = true;
            chaseTarget = playerMesh.position;
        }
        // 优先级4: 僵尸在固定灯光中且玩家近
        else if (isZombieInLitArea && distanceToPlayer < 20 && !gameState.isHiding) {
            zombie.attractedToLight = null;
            shouldChase = true;
        }
        
        // 噪音：如果在噪音范围但没被其他条件触发，转向噪音方向
        if (isAttractedByNoise && !shouldChase && !gameState.isHiding) {
            const noiseDir = new THREE.Vector3().subVectors(playerMesh.position, zombiePos).normalize();
            const noiseAngle = Math.atan2(noiseDir.x, noiseDir.z);
            // 转向噪音方向（但不会直接追到玩家）
            zombie.facingAngle = lerpAngle(zombie.facingAngle, noiseAngle, zombie.turningSpeed * 0.5 * deltaTime);
            zombie.mesh.rotation.y = zombie.facingAngle;
        }
        
        if (shouldChase) {
            // 检查追击锁定范围——超出则丢失目标（战斗锁定期间不丢失）
            const actualChaseDist = zombiePos.distanceTo(chaseTarget);
            if (actualChaseDist > zcfg.chaseRange && !isFlashlightOnFace && zombie.combatLockTimer <= 0) {
                // 超出锁定范围，丢失目标
                shouldChase = false;
                zombie.attractedToLight = null;
            }
        }
        
        // 战斗锁定期间，即使视野/检测丢失也强制追击玩家
        if (!shouldChase && zombie.combatLockTimer > 0 && !gameState.isHiding) {
            shouldChase = true;
            chaseTarget = playerMesh.position;
        }
        
        if (shouldChase) {
            zombie.state = 'chase';
            const direction = new THREE.Vector3().subVectors(chaseTarget, zombiePos).normalize();
            const moveVec = direction.clone().multiplyScalar(zombie.runSpeed * deltaTime);
            const newX = zombiePos.x + moveVec.x;
            const newZ = zombiePos.z + moveVec.z;
            const result = tryEnemyMove(zombiePos.x, zombiePos.z, newX, newZ, 0.4);
            zombie.mesh.position.x = result.x;
            zombie.mesh.position.z = result.z;
            
            // 平滑转向目标
            const targetAngle = Math.atan2(direction.x, direction.z);
            zombie.facingAngle = lerpAngle(zombie.facingAngle, targetAngle, zombie.turningSpeed * deltaTime);
            zombie.mesh.rotation.y = zombie.facingAngle;
            
            // 追击动画（快速摆动）
            zombie.animTime += deltaTime * 10;
        } else {
            zombie.state = 'wander';
            zombie.attractedToLight = null;
            zombie.wanderTimer -= deltaTime;
            if (zombie.wanderTimer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const distance = 5 + Math.random() * 10;
                zombie.wanderTarget.set(
                    zombie.originalPos.x + Math.cos(angle) * distance,
                    0,
                    zombie.originalPos.z + Math.sin(angle) * distance
                );
                zombie.wanderTimer = 3 + Math.random() * 5;
            }
            
            const direction = new THREE.Vector3().subVectors(zombie.wanderTarget, zombiePos).normalize();
            const moveVec = direction.clone().multiplyScalar(zcfg.wanderSpeed * deltaTime);
            const result = tryEnemyMove(zombiePos.x, zombiePos.z, zombiePos.x + moveVec.x, zombiePos.z + moveVec.z, 0.4);
            zombie.mesh.position.x = result.x;
            zombie.mesh.position.z = result.z;
            
            const targetAngle = Math.atan2(direction.x, direction.z);
            zombie.facingAngle = lerpAngle(zombie.facingAngle, targetAngle, 1.0 * deltaTime);
            zombie.mesh.rotation.y = zombie.facingAngle;
            
            // 漫游动画（缓慢拖沓）
            zombie.animTime += deltaTime * 4;
        }
        
        // 僵尸走路动画
        if (zombie.usingGLB) {
            // GLB模型：AnimationMixer + 手动骨骼叠加僵尸姿态
            if (zombie.mixer) zombie.mixer.update(deltaTime);
            const zt = zombie.animTime;
            const chaseMult = zombie.state === 'chase' ? 1.5 : 1;
            const bones = zombie.bones;
            if (bones) {
                // 手臂前伸叠加（僵尸特有姿态）
                if (bones['BipTrump L UpperArm_011']) {
                    bones['BipTrump L UpperArm_011'].rotation.x += -0.8 + Math.sin(zt + Math.PI) * 0.15 * chaseMult;
                    bones['BipTrump L UpperArm_011'].rotation.z += 0.1;
                }
                if (bones['BipTrump R UpperArm_023']) {
                    bones['BipTrump R UpperArm_023'].rotation.x += -0.9 + Math.sin(zt) * 0.15 * chaseMult;
                    bones['BipTrump R UpperArm_023'].rotation.z += -0.1;
                }
                // 身体前倾
                if (bones['BipTrump Spine1_025']) {
                    bones['BipTrump Spine1_025'].rotation.x += 0.15 + (zombie.state === 'chase' ? 0.1 : 0);
                    bones['BipTrump Spine1_025'].rotation.z += Math.sin(zt * 0.5) * 0.05;
                }
                // 头部左右摆
                if (bones['BipTrump Head_01']) {
                    bones['BipTrump Head_01'].rotation.z += Math.sin(zt * 0.3) * 0.08;
                }
            }
        } else {
            // 原始模型：手动骨骼动画
            const zt = zombie.animTime;
            const p = zombie.parts;
            const chaseMult = zombie.state === 'chase' ? 1.5 : 1;
            
            // 腿拖沓摆动
            p.leftLeg.rotation.x = Math.sin(zt) * 0.4 * chaseMult;
            p.rightLeg.rotation.x = Math.sin(zt + Math.PI) * 0.4 * chaseMult;
            
            // 手臂前伸摆动（僵尸特有：僵硬前伸+微摆）
            p.leftArm.rotation.x = -0.8 + Math.sin(zt + Math.PI) * 0.15 * chaseMult;
            p.rightArm.rotation.x = -0.9 + Math.sin(zt) * 0.15 * chaseMult;
            
            // 身体微微摇晃
            p.torso.rotation.z = Math.sin(zt * 0.5) * 0.05;
            // 驼背追击时前倾更多
            p.torso.rotation.x = 0.15 + (zombie.state === 'chase' ? 0.1 : 0);
            
            // 头部微微左右摆
            p.head.rotation.z = Math.sin(zt * 0.3) * 0.08;
        }
        
        if (distanceToPlayer < 1.5) {
            takeDamage(20);
            zombie.combatLockTimer = 8; // 攻击命中后8秒战斗锁定，不丢失目标
        }
        
        // 战斗锁定计时器递减
        if (zombie.combatLockTimer > 0) {
            zombie.combatLockTimer -= deltaTime;
        }
    });
}

// 角度插值辅助函数
function lerpAngle(from, to, speed) {
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * Math.min(speed, 1);
}

// ============================================
// 跳跃僵尸更新
// ============================================
function updateJumpers(deltaTime) {
    const jcfg = GAME_CONFIG.enemies.jumper;
    
    gameState.jumpers.forEach((jumper) => {
        if (jumper.dead) return;
        const jumperPos = jumper.mesh.position;
        const distanceToPlayer = jumperPos.distanceTo(playerMesh.position);
        
        // 获取面朝方向
        const facing = new THREE.Vector3(
            Math.sin(jumper.facingAngle),
            0,
            Math.cos(jumper.facingAngle)
        ).normalize();
        
        // 视野锥检测
        function isInVision(targetPos) {
            const dist = jumperPos.distanceTo(targetPos);
            if (dist > jcfg.visionRange) return false;
            const toTarget = new THREE.Vector3().subVectors(targetPos, jumperPos).normalize();
            toTarget.y = 0;
            const angle = facing.angleTo(toTarget);
            return angle < jcfg.visionAngle / 2;
        }
        
        // 跳跃冷却
        if (jumper.jumpCooldownTimer > 0) {
            jumper.jumpCooldownTimer -= deltaTime;
        }
        
        // 战斗锁定计时器递减
        if (jumper.combatLockTimer > 0) {
            jumper.combatLockTimer -= deltaTime;
        }
        
        // ---- 状态机 ----
        switch (jumper.state) {
            case 'wander': {
                jumper.wanderTimer -= deltaTime;
                if (jumper.wanderTimer <= 0) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 3 + Math.random() * 8;
                    jumper.wanderTarget.set(
                        jumper.originalPos.x + Math.cos(angle) * dist,
                        0,
                        jumper.originalPos.z + Math.sin(angle) * dist
                    );
                    jumper.wanderTimer = 2 + Math.random() * 4;
                }
                const dir = new THREE.Vector3().subVectors(jumper.wanderTarget, jumperPos).normalize();
                const moveVec = dir.clone().multiplyScalar(jcfg.wanderSpeed * deltaTime);
                const result = tryEnemyMove(jumperPos.x, jumperPos.z, jumperPos.x + moveVec.x, jumperPos.z + moveVec.z, 0.3);
                jumper.mesh.position.x = result.x;
                jumper.mesh.position.z = result.z;
                const targetAngle = Math.atan2(dir.x, dir.z);
                jumper.facingAngle = lerpAngle(jumper.facingAngle, targetAngle, 1.5 * deltaTime);
                jumper.mesh.rotation.y = jumper.facingAngle;
                
                // 看见玩家 → 锁定（需要无遮挡）
                if (isInVision(playerMesh.position) && distanceToPlayer < jcfg.detectionRange && jumper.jumpCooldownTimer <= 0 && !gameState.isHiding && !isLineOfSightBlocked(jumperPos, playerMesh.position)) {
                    jumper.state = 'lock';
                    jumper.jumpTarget.copy(playerMesh.position);
                    jumper.jumpOrigin.copy(jumperPos);
                    jumper.jumpChargeTimer = jcfg.jumpChargeTime;
                    
                    // 蓄力动画：蹲下
                    jumper.mesh.scale.y = 0.6;
                    // 眼睛变红
                    jumper.mesh.children.forEach(child => {
                        if (child.material && child.material.color && child.material.color.r > 0.8) {
                            child.material.color.setHex(0xff0000);
                        }
                    });
                }
                // 奔跑噪音 → 转向噪音方向
                else if (gameState.isRunning && gameState.isMoving && distanceToPlayer < jcfg.noiseDetectionRange && !gameState.isHiding) {
                    const noiseDir = new THREE.Vector3().subVectors(playerMesh.position, jumperPos).normalize();
                    const noiseAngle = Math.atan2(noiseDir.x, noiseDir.z);
                    jumper.facingAngle = lerpAngle(jumper.facingAngle, noiseAngle, 2.0 * deltaTime);
                    jumper.mesh.rotation.y = jumper.facingAngle;
                }
                break;
            }
            
            case 'lock': {
                // 检查玩家是否超出追击锁定范围（战斗锁定期间不丢失）
                if ((distanceToPlayer > jcfg.chaseRange && jumper.combatLockTimer <= 0) || gameState.isHiding) {
                    // 超出范围或玩家躲藏，丢失目标
                    jumper.state = 'wander';
                    jumper.mesh.scale.y = 1;
                    // 恢复眼睛颜色
                    jumper.mesh.children.forEach(child => {
                        if (child.material && child.material.color && child.material.color.r > 0.95) {
                            child.material.color.setHex(0xffcc00);
                        }
                    });
                    break;
                }
                
                // 蓄力阶段：持续锁定玩家当前位置
                jumper.jumpTarget.copy(playerMesh.position);
                
                // 面朝玩家
                const toPlayer = new THREE.Vector3().subVectors(playerMesh.position, jumperPos).normalize();
                const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
                jumper.facingAngle = lerpAngle(jumper.facingAngle, targetAngle, 5 * deltaTime);
                jumper.mesh.rotation.y = jumper.facingAngle;
                
                // 蓄力抖动
                jumper.mesh.position.x += (Math.random() - 0.5) * 0.05;
                jumper.mesh.position.z += (Math.random() - 0.5) * 0.05;
                
                jumper.jumpChargeTimer -= deltaTime;
                if (jumper.jumpChargeTimer <= 0) {
                    // 发起跳跃！
                    jumper.state = 'jump';
                    jumper.jumpProgress = 0;
                    jumper.jumpOrigin.copy(jumperPos);
                }
                break;
            }
            
            case 'jump': {
                // 弹跳到锁定位置
                jumper.jumpProgress += deltaTime * 1.5; // ~0.67秒完成跳跃
                
                if (jumper.jumpProgress >= 1) {
                    // 先检查落地碰撞（在覆盖位置之前！）
                    const landingPos = jumper.jumpTarget;
                    const distToPlayerAtLanding = playerMesh.position.distanceTo(landingPos);
                    const hitRadius = 0.8; // 只有真正砸到才死
                    
                    // 落地
                    jumper.mesh.position.copy(landingPos);
                    jumper.mesh.position.y = 0;
                    jumper.mesh.scale.set(1, 1, 1);
                    jumper.state = 'cooldown';
                    jumper.jumpCooldownTimer = jcfg.jumpCooldown;
                    
                    // 恢复眼睛颜色
                    jumper.mesh.children.forEach(child => {
                        if (child.material && child.material.color && child.material.color.r > 0.95) {
                            child.material.color.setHex(0xffcc00);
                        }
                    });
                    
                    // 只有真正砸到玩家才伤
                    if (distToPlayerAtLanding < hitRadius) {
                        takeDamage(30);
                    }
                } else {
                    // 抛物线跳跃
                    const t = jumper.jumpProgress;
                    jumper.mesh.position.lerpVectors(jumper.jumpOrigin, jumper.jumpTarget, t);
                    // 高度：抛物线 h = 4 * jumpHeight * t * (1-t)
                    jumper.mesh.position.y = 4 * 3 * t * (1 - t);
                    // 跳跃中缩放拉伸
                    jumper.mesh.scale.set(1 - 0.3 * t, 0.6 + 0.8 * Math.sin(t * Math.PI), 1 - 0.3 * t);
                }
                break;
            }
            
            case 'cooldown': {
                // 落地后短暂停留
                jumper.jumpCooldownTimer -= deltaTime;
                if (jumper.jumpCooldownTimer <= 0) {
                    jumper.state = 'wander';
                    jumper.mesh.scale.y = 1;
                }
                break;
            }
        }
        
        // 普通近距离检测（非跳跃状态）
        if (jumper.state !== 'jump' && distanceToPlayer < 1.0) {
            takeDamage(25);
            jumper.combatLockTimer = 8; // 攻击命中后战斗锁定
        }
        
        // ---- 爬行僵尸移动动画 ----
        const jp = jumper.parts;
        const jt = jumper.animTime;
        
        if (jumper.state === 'wander') {
            // 漫游：缓慢爬行，四肢交替
            jumper.animTime += deltaTime * 4;
            // 前肢交替前伸/后拉
            if (jp.leftArm) jp.leftArm.rotation.z = Math.sin(jt) * 0.35;
            if (jp.rightArm) jp.rightArm.rotation.z = Math.sin(jt + Math.PI) * 0.35;
            // 后肢交替蹬地
            if (jp.leftLeg) jp.leftLeg.rotation.z = Math.sin(jt + Math.PI) * 0.3;
            if (jp.rightLeg) jp.rightLeg.rotation.z = Math.sin(jt) * 0.3;
            // 身体微微起伏（爬行时重心波动）
            if (jp.torso) {
                jp.torso.position.y = 0.25 + Math.sin(jt * 2) * 0.02;
                jp.torso.rotation.x = Math.sin(jt * 2) * 0.03;
            }
            // 头部微微左右摆（嗅探状）
            if (jp.head) jp.head.rotation.y = Math.sin(jt * 0.7) * 0.1;
        } else if (jumper.state === 'lock') {
            // 蓄力：身体弓起、抖动
            jumper.animTime += deltaTime * 15;
            if (jp.torso) {
                jp.torso.position.y = 0.25 + Math.sin(jt * 3) * 0.03;
                jp.torso.rotation.x = -0.15 + Math.sin(jt * 3) * 0.05;
            }
            // 前肢缩回蓄力
            if (jp.leftArm) jp.leftArm.rotation.z = -0.4 + Math.sin(jt) * 0.1;
            if (jp.rightArm) jp.rightArm.rotation.z = 0.4 + Math.sin(jt) * 0.1;
            // 后肢紧缩
            if (jp.leftLeg) jp.leftLeg.rotation.z = 0.3;
            if (jp.rightLeg) jp.rightLeg.rotation.z = -0.3;
            if (jp.head) jp.head.rotation.y = Math.sin(jt * 5) * 0.15;
        } else if (jumper.state === 'cooldown') {
            // 落地恢复：缓慢恢复爬行姿态
            jumper.animTime += deltaTime * 6;
            if (jp.torso) {
                jp.torso.position.y = 0.25 + Math.sin(jt * 2) * 0.03;
            }
            if (jp.leftArm) jp.leftArm.rotation.z = Math.sin(jt) * 0.2;
            if (jp.rightArm) jp.rightArm.rotation.z = Math.sin(jt + Math.PI) * 0.2;
        }
    });
}

function updateGhosts(deltaTime) {
    gameState.ghosts.forEach((ghost) => {
        const distanceToPlayer = ghost.mesh.position.distanceTo(playerMesh.position);
        
        let isScared = false;
        if (gameState.flashlightOn && gameState.battery > 0 && distanceToPlayer < GAME_CONFIG.player.flashlightRange) {
            const playerDir = new THREE.Vector3();
            playerMesh.getWorldDirection(playerDir);
            const ghostDir = new THREE.Vector3().subVectors(ghost.mesh.position, playerMesh.position).normalize();
            const angle = playerDir.angleTo(ghostDir);
            
            if (angle < GAME_CONFIG.player.flashlightAngle) {
                isScared = true;
            }
        }
        
        ghost.isScared = isScared;
        
        if (isScared) {
            const escapeDir = new THREE.Vector3().subVectors(ghost.mesh.position, playerMesh.position).normalize();
            ghost.mesh.position.add(escapeDir.multiplyScalar(ghost.speed * 2 * deltaTime));
            ghost.mesh.children.forEach(child => {
                if (child.material && child.material.emissive) {
                    child.material.emissive.setHex(0x0000ff);
                }
            });
        } else {
            ghost.wanderTimer -= deltaTime;
            if (ghost.wanderTimer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * GAME_CONFIG.enemies.ghost.wanderRange;
                ghost.wanderTarget.set(
                    ghost.mesh.position.x + Math.cos(angle) * distance,
                    0,
                    ghost.mesh.position.z + Math.sin(angle) * distance
                );
                ghost.wanderTimer = 2 + Math.random() * 3;
            }
            
            const direction = new THREE.Vector3().subVectors(ghost.wanderTarget, ghost.mesh.position).normalize();
            ghost.mesh.position.add(direction.multiplyScalar(ghost.speed * deltaTime));
            
            ghost.mesh.children.forEach(child => {
                if (child.material && child.material.emissive) {
                    child.material.emissive.setHex(0x222222);
                }
            });
        }
        
        ghost.mesh.position.y = Math.sin(Date.now() * 0.002 + ghost.mesh.id) * 0.3 + 1.5;
    });
}

// ============================================
// 死亡动画更新
// ============================================
function updateDeathAnimations(deltaTime) {
    gameState.corpses.forEach((enemy) => {
        if (enemy.deathAnim && enemy.deathAnim.progress < 1) {
            enemy.deathAnim.progress += deltaTime * 2.5; // 0.4秒完成
            const t = Math.min(enemy.deathAnim.progress, 1);
            const mesh = enemy.mesh;
            
            if (enemy.deathAnim.type === 'walker') {
                // 站立僵尸：向前倒地
                mesh.rotation.x = -Math.PI / 2 * t;
                mesh.position.y = -0.5 * t;
                // 压扁一点
                mesh.scale.set(1, 1 - 0.3 * t, 1 + 0.1 * t);
            } else {
                // 爬行/喷毒僵尸：侧翻倒
                mesh.rotation.z = Math.PI / 2 * t;
                mesh.position.y = -0.2 * t;
                mesh.scale.set(1, 1 - 0.2 * t, 1);
            }
        }
    });
}

// ============================================
// 毒液伤害更新
// ============================================
function updatePoison(deltaTime) {
    if (gameState.poisonTimer > 0) {
        gameState.poisonTimer -= deltaTime;
        gameState.poisonDamageCD -= deltaTime;
        
        if (gameState.poisonDamageCD <= 0) {
            gameState.poisonDamageCD = 0.8; // 每0.8秒毒伤一次
            takeDamage(5); // 毒伤5
        }
        
        // 毒液屏幕绿色闪烁
        const indicator = document.getElementById('poison-indicator');
        if (indicator) indicator.style.display = 'block';
    } else {
        const indicator = document.getElementById('poison-indicator');
        if (indicator) indicator.style.display = 'none';
    }
}

// ============================================
// 玩家受伤
// ============================================
function takeDamage(amount) {
    if (gameState.damageCooldown > 0) return;
    gameState.playerHP -= amount;
    gameState.damageCooldown = 0.5; // 0.5秒无敌
    
    // 红色闪烁
    const overlay = document.createElement('div');
    overlay.className = 'damage-overlay';
    document.getElementById('game-container').appendChild(overlay);
    setTimeout(() => overlay.remove(), 300);
    
    // 画面抖动——受伤越重抖动越剧烈
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        if (amount >= 25) {
            canvas.classList.add('heavy-shake');
            setTimeout(() => canvas.classList.remove('heavy-shake'), 400);
        } else {
            canvas.classList.add('shaking');
            setTimeout(() => canvas.classList.remove('shaking'), 250);
        }
    }
    
    if (gameState.playerHP <= 0) {
        gameState.playerHP = 0;
        gameOver(false);
    }
}

// ============================================
// 毒液僵尸（Spitter）
// ============================================
function createSpitters() {
    const spitterCount = 2;
    const positions = [
        { x: -40, z: 0 },    // 走廊西段
        { x: 30, z: 14 },    // 南侧教室
    ];
    
    const spitterCfg = GAME_CONFIG.enemies.spitter;
    
    for (let i = 0; i < spitterCount; i++) {
        const spitterGroup = new THREE.Group();
        const skinColor = 0x4a6a3a; // 暗绿皮肤
        const clothColor = 0x3a3a2a;
        const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.9 });
        const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 1 });
        
        // 身体 - 驼背站立
        const torsoGeo = new THREE.CylinderGeometry(0.3, 0.25, 0.8, 6);
        const torso = new THREE.Mesh(torsoGeo, clothMat);
        torso.position.y = 1.0;
        torso.rotation.x = 0.2;
        torso.castShadow = true;
        spitterGroup.add(torso);
        
        // 腹部 - 鼓胀（存毒液）
        const bellyGeo = new THREE.SphereGeometry(0.35, 8, 8);
        const bellyMat = new THREE.MeshStandardMaterial({ color: 0x3a5a2a, roughness: 0.7 });
        const belly = new THREE.Mesh(bellyGeo, bellyMat);
        belly.position.set(0, 0.85, 0.15);
        belly.castShadow = true;
        spitterGroup.add(belly);
        
        // 头 - 扁平，大嘴
        const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
        headGeo.scale(1.2, 0.8, 1);
        const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 1 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.55;
        head.castShadow = true;
        spitterGroup.add(head);
        
        // 发光绿眼
        const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ff44 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 1.58, 0.2);
        spitterGroup.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 1.58, 0.2);
        spitterGroup.add(rightEye);
        
        // 大嘴
        const mouthGeo = new THREE.BoxGeometry(0.2, 0.08, 0.08);
        const mouthMat = new THREE.MeshBasicMaterial({ color: 0x224400 });
        const mouth = new THREE.Mesh(mouthGeo, mouthMat);
        mouth.position.set(0, 1.45, 0.22);
        spitterGroup.add(mouth);
        
        // 腿
        const leftLegGroup = new THREE.Group();
        leftLegGroup.position.set(-0.16, 0.6, 0);
        const legGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.6, 6);
        const leftLeg = new THREE.Mesh(legGeo, clothMat);
        leftLeg.position.y = -0.3;
        leftLeg.castShadow = true;
        leftLegGroup.add(leftLeg);
        spitterGroup.add(leftLegGroup);
        
        const rightLegGroup = new THREE.Group();
        rightLegGroup.position.set(0.16, 0.6, 0);
        const rightLeg = new THREE.Mesh(legGeo, clothMat);
        rightLeg.position.y = -0.3;
        rightLeg.castShadow = true;
        rightLegGroup.add(rightLeg);
        spitterGroup.add(rightLegGroup);
        
        // 手臂 - 前伸
        const leftArmGroup = new THREE.Group();
        leftArmGroup.position.set(-0.3, 1.2, 0);
        const armGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6);
        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(0, -0.25, 0.1);
        leftArm.rotation.x = -0.8;
        leftArm.castShadow = true;
        leftArmGroup.add(leftArm);
        spitterGroup.add(leftArmGroup);
        
        const rightArmGroup = new THREE.Group();
        rightArmGroup.position.set(0.3, 1.2, 0);
        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(0, -0.25, 0.1);
        rightArm.rotation.x = -0.8;
        rightArm.castShadow = true;
        rightArmGroup.add(rightArm);
        spitterGroup.add(rightArmGroup);
        
        // 身上毒液痕迹
        for (let d = 0; d < 3; d++) {
            const dripGeo = new THREE.SphereGeometry(0.04 + Math.random() * 0.04, 4, 4);
            const dripMat = new THREE.MeshBasicMaterial({ color: 0x44cc00 });
            const drip = new THREE.Mesh(dripGeo, dripMat);
            drip.position.set(
                (Math.random() - 0.5) * 0.5,
                0.5 + Math.random() * 0.8,
                (Math.random() - 0.5) * 0.3 + 0.2
            );
            spitterGroup.add(drip);
        }
        
        const pos = positions[i];
        spitterGroup.position.set(pos.x, 0, pos.z);
        spitterGroup.userData.facingAngle = Math.random() * Math.PI * 2;
        spitterGroup.rotation.y = spitterGroup.userData.facingAngle;
        
        gameState.spitters.push({
            type: 'spitter',
            mesh: spitterGroup,
            state: 'wander',
            hp: 60,
            dead: false,
            speed: spitterCfg.speed,
            runSpeed: spitterCfg.runSpeed,
            wanderTarget: new THREE.Vector3(),
            wanderTimer: 0,
            originalPos: new THREE.Vector3(pos.x, 0, pos.z),
            facingAngle: spitterGroup.userData.facingAngle,
            spitCooldown: 0,
            animTime: Math.random() * Math.PI * 2,
            turningSpeed: 2.0,
            combatLockTimer: 0,
            parts: {
                leftLeg: leftLegGroup,
                rightLeg: rightLegGroup,
                leftArm: leftArmGroup,
                rightArm: rightArmGroup,
                torso: torso,
                head: head,
                belly: belly,
            },
        });
        
        scene.add(spitterGroup);
    }
}

function updateSpitters(deltaTime) {
    const scfg = GAME_CONFIG.enemies.spitter;
    
    gameState.spitters.forEach((spitter) => {
        if (spitter.dead) return;
        const sPos = spitter.mesh.position;
        const distToPlayer = sPos.distanceTo(playerMesh.position);
        
        const facing = new THREE.Vector3(
            Math.sin(spitter.facingAngle), 0, Math.cos(spitter.facingAngle)
        ).normalize();
        
        // 冷却
        if (spitter.spitCooldown > 0) spitter.spitCooldown -= deltaTime;
        
        // 视野检测
        function isInVision(targetPos) {
            const dist = sPos.distanceTo(targetPos);
            if (dist > scfg.visionRange) return false;
            const toTarget = new THREE.Vector3().subVectors(targetPos, sPos).normalize();
            toTarget.y = 0;
            return facing.angleTo(toTarget) < scfg.visionAngle / 2;
        }
        
        let shouldChase = false;
        let shouldSpit = false;
        
        // 看见玩家且无遮挡
        if (isInVision(playerMesh.position) && !gameState.isHiding && !isLineOfSightBlocked(sPos, playerMesh.position)) {
            if (distToPlayer < 15 && distToPlayer > 4 && spitter.spitCooldown <= 0) {
                shouldSpit = true;
            } else if (distToPlayer <= 4) {
                shouldChase = true; // 近了就追
            } else if (distToPlayer < scfg.chaseRange) {
                shouldChase = true;
            }
        }
        
        if (shouldSpit) {
            // 喷毒！
            spitter.spitCooldown = scfg.spitCooldown;
            spawnProjectile(sPos, playerMesh.position);
            
            // 喷毒动画：腹部收缩
            if (spitter.parts.belly) {
                spitter.parts.belly.scale.set(0.6, 0.6, 0.6);
                setTimeout(() => {
                    if (spitter.parts.belly) spitter.parts.belly.scale.set(1, 1, 1);
                }, 300);
            }
            // 头部前倾
            if (spitter.parts.head) {
                spitter.parts.head.rotation.x = 0.3;
                setTimeout(() => {
                    if (spitter.parts.head) spitter.parts.head.rotation.x = 0;
                }, 200);
            }
        }
        
        if (shouldChase) {
            spitter.state = 'chase';
            const dir = new THREE.Vector3().subVectors(playerMesh.position, sPos).normalize();
            const moveVec = dir.clone().multiplyScalar(spitter.runSpeed * deltaTime);
            const result = tryEnemyMove(sPos.x, sPos.z, sPos.x + moveVec.x, sPos.z + moveVec.z, 0.4);
            spitter.mesh.position.x = result.x;
            spitter.mesh.position.z = result.z;
            const targetAngle = Math.atan2(dir.x, dir.z);
            spitter.facingAngle = lerpAngle(spitter.facingAngle, targetAngle, spitter.turningSpeed * deltaTime);
            spitter.mesh.rotation.y = spitter.facingAngle;
            spitter.animTime += deltaTime * 10;
        } else {
            spitter.state = 'wander';
            spitter.wanderTimer -= deltaTime;
            if (spitter.wanderTimer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const distance = 5 + Math.random() * 8;
                spitter.wanderTarget.set(
                    spitter.originalPos.x + Math.cos(angle) * distance, 0,
                    spitter.originalPos.z + Math.sin(angle) * distance
                );
                spitter.wanderTimer = 3 + Math.random() * 5;
            }
            const dir = new THREE.Vector3().subVectors(spitter.wanderTarget, sPos).normalize();
            const moveVec = dir.clone().multiplyScalar(scfg.wanderSpeed * deltaTime);
            const result = tryEnemyMove(sPos.x, sPos.z, sPos.x + moveVec.x, sPos.z + moveVec.z, 0.4);
            spitter.mesh.position.x = result.x;
            spitter.mesh.position.z = result.z;
            const targetAngle = Math.atan2(dir.x, dir.z);
            spitter.facingAngle = lerpAngle(spitter.facingAngle, targetAngle, 1.0 * deltaTime);
            spitter.mesh.rotation.y = spitter.facingAngle;
            spitter.animTime += deltaTime * 4;
        }
        
        // 动画
        const p = spitter.parts;
        const t = spitter.animTime;
        const cm = spitter.state === 'chase' ? 1.5 : 1;
        p.leftLeg.rotation.x = Math.sin(t) * 0.35 * cm;
        p.rightLeg.rotation.x = Math.sin(t + Math.PI) * 0.35 * cm;
        p.leftArm.rotation.x = -0.6 + Math.sin(t + Math.PI) * 0.1 * cm;
        p.rightArm.rotation.x = -0.6 + Math.sin(t) * 0.1 * cm;
        p.torso.rotation.z = Math.sin(t * 0.5) * 0.04;
        p.head.rotation.z = Math.sin(t * 0.3) * 0.06;
        // 腹部脉动
        if (p.belly) {
            p.belly.scale.y = 1 + Math.sin(t * 2) * 0.05;
        }
        
        // 近距离伤害
        if (distToPlayer < 1.2) {
            takeDamage(15);
            spitter.combatLockTimer = 8; // 攻击命中后战斗锁定
        }
        
        // 战斗锁定计时器递减
        if (spitter.combatLockTimer > 0) {
            spitter.combatLockTimer -= deltaTime;
        }
        
        // 战斗锁定期间，即使超出视野也追击玩家
        if (spitter.combatLockTimer > 0 && !shouldChase && !gameState.isHiding) {
            shouldChase = true;
        }
    });
}

// ============================================
// 毒液投射物
// ============================================
function spawnProjectile(from, to) {
    const projGeo = new THREE.SphereGeometry(0.15, 6, 6);
    const projMat = new THREE.MeshBasicMaterial({ color: 0x44ff00 });
    const projMesh = new THREE.Mesh(projGeo, projMat);
    projMesh.position.copy(from);
    projMesh.position.y = 1.2;
    scene.add(projMesh);
    
    // 抛物线弹道：落点是发射时玩家位置（to），不再追踪
    const targetPos = to.clone();
    targetPos.y = 0; // 落地高度
    const startPos = from.clone();
    startPos.y = 1.2;
    
    // 计算水平距离
    const dx = targetPos.x - startPos.x;
    const dz = targetPos.z - startPos.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    
    // 水平方向
    const dir = new THREE.Vector3(dx, 0, dz);
    if (dir.length() > 0.01) dir.normalize();
    
    // 飞行时间（距离越远越久，但限制最大3秒）
    const flightTime = Math.min(horizontalDist / 8, 3.0);
    
    // 初始垂直速度：考虑抛物线 v0 = (targetY - startY + 0.5*g*t^2) / t
    // 想要毒液先上升再下落，增加一个最小抛高
    const gravity = 9.8;
    const netDrop = startPos.y - targetPos.y; // 正值=需要下落
    const v0y = (netDrop + 0.5 * gravity * flightTime * flightTime) / flightTime;
    // 确保有一定抛高（至少2米高）
    const minVy = 3.0;
    const initialVy = Math.max(v0y, minVy);
    
    // 毒液拖尾光
    const projLight = new THREE.PointLight(0x44ff00, 2, 5);
    projMesh.add(projLight);
    
    gameState.projectiles.push({
        mesh: projMesh,
        direction: dir,
        horizontalSpeed: horizontalDist / flightTime, // 水平速度
        verticalVelocity: initialVy, // 初始垂直速度
        lifetime: flightTime + 1.0, // 额外1秒容错
        gravity: gravity,
        targetPos: targetPos.clone(), // 记录目标位置
        isParabolic: true, // 标记为抛物线弹道
    });
}

function updateProjectiles(deltaTime) {
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const proj = gameState.projectiles[i];
        
        if (proj.isParabolic) {
            // === 抛物线弹道：不追踪，落点=发射时玩家位置 ===
            // 水平移动
            proj.mesh.position.x += proj.direction.x * proj.horizontalSpeed * deltaTime;
            proj.mesh.position.z += proj.direction.z * proj.horizontalSpeed * deltaTime;
            
            // 垂直运动（抛物线）
            proj.verticalVelocity -= proj.gravity * deltaTime;
            proj.mesh.position.y += proj.verticalVelocity * deltaTime;
            
            proj.lifetime -= deltaTime;
            
            // 检测命中玩家（球体范围内）
            const distToPlayer = proj.mesh.position.distanceTo(playerMesh.position);
            if (distToPlayer < 1.2) {
                // 命中！造成毒伤
                takeDamage(10);
                gameState.poisonTimer = 4; // 中毒4秒
                gameState.poisonDamageCD = 0;
                
                // 地面毒液残留
                createPoisonPool(proj.mesh.position);
                
                scene.remove(proj.mesh);
                gameState.projectiles.splice(i, 1);
                continue;
            }
            
            // 碰撞体检测 - 毒液不能穿墙
            let hitWall = false;
            const px = proj.mesh.position.x;
            const pz = proj.mesh.position.z;
            for (const collider of gameState.colliders) {
                const halfW = collider.width / 2 + 0.15;
                const halfD = collider.depth / 2 + 0.15;
                if (px > collider.position.x - halfW && px < collider.position.x + halfW &&
                    pz > collider.position.z - halfD && pz < collider.position.z + halfD) {
                    hitWall = true;
                    break;
                }
            }
            
            // 落地、碰墙、超时
            if (proj.mesh.position.y <= 0.05 || hitWall || proj.lifetime <= 0) {
                createPoisonPool(proj.mesh.position);
                scene.remove(proj.mesh);
                gameState.projectiles.splice(i, 1);
                continue;
            }
        } else {
            // === 旧直线追踪弹道（兼容） ===
            const toPlayer = new THREE.Vector3().subVectors(playerMesh.position, proj.mesh.position);
            toPlayer.y = 0;
            const distToTarget = toPlayer.length();
            
            if (distToTarget > 0.1) {
                const trackDir = toPlayer.normalize();
                proj.direction.lerp(trackDir, 0.15);
                proj.direction.normalize();
            }
            
            proj.mesh.position.add(proj.direction.clone().multiplyScalar(proj.speed * deltaTime));
            proj.lifetime -= deltaTime;
            
            const distToPlayer = proj.mesh.position.distanceTo(playerMesh.position);
            if (distToPlayer < 1.0) {
                takeDamage(10);
                gameState.poisonTimer = 4;
                gameState.poisonDamageCD = 0;
                createPoisonPool(proj.mesh.position);
                scene.remove(proj.mesh);
                gameState.projectiles.splice(i, 1);
                continue;
            }
            
            let hitWall = false;
            const px = proj.mesh.position.x;
            const pz = proj.mesh.position.z;
            for (const collider of gameState.colliders) {
                const halfW = collider.width / 2 + 0.15;
                const halfD = collider.depth / 2 + 0.15;
                if (px > collider.position.x - halfW && px < collider.position.x + halfW &&
                    pz > collider.position.z - halfD && pz < collider.position.z + halfD) {
                    hitWall = true;
                    break;
                }
            }
            
            if (hitWall || proj.lifetime <= 0 || proj.mesh.position.y < 0) {
                createPoisonPool(proj.mesh.position);
                scene.remove(proj.mesh);
                gameState.projectiles.splice(i, 1);
                continue;
            }
        }
    }
}

function createPoisonPool(position) {
    const poolGeo = new THREE.CircleGeometry(0.6, 8);
    const poolMat = new THREE.MeshBasicMaterial({ 
        color: 0x22aa00, transparent: true, opacity: 0.7, side: THREE.DoubleSide 
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(position.x, 0.02, position.z);
    scene.add(pool);
    
    // 毒雾光
    const fogLight = new THREE.PointLight(0x22aa00, 1, 3);
    fogLight.position.set(position.x, 0.5, position.z);
    scene.add(fogLight);
    
    // 8秒后消失
    setTimeout(() => {
        scene.remove(pool);
        scene.remove(fogLight);
    }, 8000);
}

function updateKeys(deltaTime) {
    gameState.keys.forEach((key) => {
        if (key.collected) return;
        
        const floatY = Math.sin(Date.now() * 0.003 + key.floatOffset) * 0.2;
        key.mesh.position.y = key.baseY + floatY;
        key.mesh.rotation.y += deltaTime * 0.5;
    });
}

// 更新绷带浮动动画
function updateBandages(deltaTime) {
    gameState.bandages.forEach((bandage) => {
        if (bandage.collected) return;
        
        const floatY = Math.sin(Date.now() * 0.002 + bandage.floatOffset) * 0.15;
        bandage.mesh.position.y = bandage.baseY + floatY;
        bandage.mesh.rotation.y += deltaTime * 0.8;
    });
}

// ============================================
// 更新破旧日光灯闪烁效果
// ============================================
function updateFlickerLights(deltaTime) {
    gameState.lights.forEach((lightData) => {
        if (!lightData.isFlicker) return;
        
        lightData.flickerPhase += deltaTime;
        
        // ---- 熄灭倒计时 ----
        lightData.deadCountdown -= deltaTime;
        if (lightData.deadCountdown <= 0 && !lightData.isDead) {
            // 触发熄灭
            lightData.isDead = true;
            lightData.deadDuration = 2 + Math.random() * 4;  // 熄灭2~6秒
            lightData.deadTimer = 0;
        }
        
        if (lightData.isDead) {
            lightData.deadTimer += deltaTime;
            if (lightData.deadTimer >= lightData.deadDuration) {
                // 恢复
                lightData.isDead = false;
                lightData.deadCountdown = 8 + Math.random() * 15;  // 下次8~23秒后熄灭
                lightData.flickerPhase = 0; // 重置闪烁相位，恢复时有个重新点亮的过程
            }
        }
        
        // ---- 计算闪烁亮度 ----
        let intensity;
        let emissiveIntensity;
        let spotOpacity;
        
        if (lightData.isDead) {
            // 熄灭状态：极微弱残余（偶尔闪一下模拟接触不良）
            const ghostFlash = Math.random() > 0.97 ? 0.8 : 0;
            intensity = ghostFlash;
            emissiveIntensity = ghostFlash * 0.3;
            spotOpacity = ghostFlash * 0.05;
        } else {
            // 正常闪烁：基础亮度 + 高频噪声
            const noise = Math.sin(lightData.flickerPhase * lightData.flickerSpeed) 
                        * Math.sin(lightData.flickerPhase * lightData.flickerSpeed * 2.7)
                        * Math.sin(lightData.flickerPhase * lightData.flickerSpeed * 0.3);
            // 偶尔剧烈闪烁（模拟接触不良）
            const harshFlicker = Math.random() > 0.98 ? (Math.random() * 0.7) : 0;
            const baseIntensity = 3.0;
            intensity = baseIntensity * (0.7 + 0.3 * noise) - harshFlicker * baseIntensity;
            intensity = Math.max(0.2, Math.min(4.0, intensity));
            emissiveIntensity = intensity / baseIntensity;
            spotOpacity = 0.1 + 0.08 * (intensity / baseIntensity);
        }
        
        // 应用到灯光和灯管
        lightData.light.intensity = intensity;
        if (lightData.tubeMat) {
            lightData.tubeMat.emissiveIntensity = emissiveIntensity;
        }
        if (lightData.indicator && lightData.indicator.material) {
            lightData.indicator.material.opacity = spotOpacity;
        }
    });
}

function checkCollisions() {
    gameState.keys.forEach((key) => {
        if (key.collected) return;
        
        const distance = playerMesh.position.distanceTo(key.mesh.position);
        if (distance < 1.5) {
            key.collected = true;
            gameState.keysCollected++;
            key.mesh.visible = false;
            
            if (gameState.keysCollected >= GAME_CONFIG.game.totalKeys) {
                unlockExitDoor();
            }
        }
    });
    
    // 绷带拾取
    gameState.bandages.forEach((bandage) => {
        if (bandage.collected) return;
        
        const distance = playerMesh.position.distanceTo(bandage.mesh.position);
        if (distance < 1.5) {
            bandage.collected = true;
            bandage.mesh.visible = false;
            
            // 回血
            gameState.playerHP = Math.min(gameState.maxPlayerHP, gameState.playerHP + bandage.healAmount);
        }
    });
    
    // 出口门检测
    if (gameState.exitDoor && !gameState.exitDoor.locked) {
        const doorPos = gameState.exitDoor.mesh.position;
        const dist = playerMesh.position.distanceTo(doorPos);
        if (dist < 3) {
            gameOver(true);
        }
    }
}

function unlockExitDoor() {
    if (gameState.exitDoor && gameState.exitDoor.locked) {
        gameState.exitDoor.locked = false;
        gameState.exitDoor.lockMesh.material.color.setHex(0x00ff00);
        gameState.exitDoor.lockMesh.material.emissive.setHex(0x003300);
    }
}

function updateUI() {
    document.getElementById('key-count').textContent = `${gameState.keysCollected} / ${GAME_CONFIG.game.totalKeys}`;
    document.getElementById('zombie-count').textContent = gameState.zombies.length + gameState.jumpers.length + gameState.spitters.length;
    document.getElementById('ghost-count').textContent = gameState.ghosts.length;
    
    const batteryElement = document.getElementById('battery-level');
    batteryElement.textContent = `${Math.floor(gameState.battery)}%`;
    
    if (gameState.battery < 20) {
        batteryElement.style.color = '#ff0000';
    } else if (gameState.battery < 50) {
        batteryElement.style.color = '#ffa500';
    } else {
        batteryElement.style.color = '#fff';
    }
    
    // 血条更新
    const healthBar = document.getElementById('health-bar');
    const healthText = document.getElementById('health-text');
    if (healthBar) {
        const hpPercent = Math.max(0, gameState.playerHP / gameState.maxPlayerHP * 100);
        healthBar.style.width = hpPercent + '%';
        // 血量颜色变化
        if (hpPercent < 25) {
            healthBar.style.background = 'linear-gradient(180deg, #ff2222 0%, #aa0000 50%, #660000 100%)';
        } else if (hpPercent < 50) {
            healthBar.style.background = 'linear-gradient(180deg, #ff8833 0%, #cc5500 50%, #883300 100%)';
        } else {
            healthBar.style.background = 'linear-gradient(180deg, #ff3333 0%, #cc0000 50%, #990000 100%)';
        }
    }
    if (healthText) {
        healthText.textContent = `${Math.max(0, Math.ceil(gameState.playerHP))} / ${gameState.maxPlayerHP}`;
    }
    
    // ---- 恐怖氛围后处理效果 ----
    const hpRatio = gameState.playerHP / gameState.maxPlayerHP;
    const vignette = document.getElementById('vignette-overlay');
    const desat = document.getElementById('desaturation-overlay');
    
    if (vignette) {
        // 血量越低，暗角越重、红色越深
        if (hpRatio < 0.25) {
            vignette.className = 'damage-pulse';
        } else if (hpRatio < 0.5) {
            vignette.className = '';
            vignette.style.opacity = 1.3 - hpRatio;
        } else {
            vignette.className = '';
            vignette.style.opacity = 1.0 - hpRatio * 0.5;
        }
    }
    
    if (desat) {
        // 低血量变灰：用半透明灰色覆盖降低饱和度
        const grayAmount = Math.max(0, (0.5 - hpRatio) * 2); // 0~1
        desat.style.background = `rgba(80, 80, 80, ${grayAmount * 0.5})`;
    }
}

function gameOver(victory) {
    gameState.isPlaying = false;
    
    // 停止所有抖动效果
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        canvas.classList.remove('shaking');
        canvas.classList.remove('heavy-shake');
    }
    heartbeatShakeTimer = 0;
    
    const screen = document.getElementById('game-over-screen');
    const title = document.getElementById('game-over-title');
    const message = document.getElementById('game-over-message');
    
    screen.style.display = 'flex';
    
    if (victory) {
        screen.classList.add('victory');
        title.textContent = '🎉 逃脱成功！';
        message.textContent = '你成功找到了所有钥匙，逃出了恐怖的教学楼！';
    } else {
        screen.classList.remove('victory');
        title.textContent = '💀 游戏结束';
        message.textContent = '你被怪物抓住了...';
        
        const jumpScare = document.getElementById('jump-scare');
        jumpScare.style.display = 'block';
        setTimeout(() => {
            jumpScare.style.display = 'none';
        }, 500);
    }
}

function restartGame() {
    // 清除抖动状态
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
        canvas.classList.remove('shaking');
        canvas.classList.remove('heavy-shake');
    }
    heartbeatShakeTimer = 0;
    
    gameState.keysCollected = 0;
    gameState.battery = 100;
    gameState.flashlightOn = true;
    gameState.isPlaying = true;
    gameState.isHiding = false;
    gameState.hideSpot = null;
    gameState.nearHideSpot = null;
    gameState.playerHP = gameState.maxPlayerHP;
    gameState.damageCooldown = 0;
    gameState.isJumping = false;
    gameState.isVaulting = false;
    gameState.jumpVelocity = 0;
    gameState.playerY = 0;
    gameState.poisonTimer = 0;
    gameState.poisonDamageCD = 0;
    
    // 清除毒液投射物
    gameState.projectiles.forEach(p => scene.remove(p.mesh));
    gameState.projectiles = [];
    
    // 清除尸体
    gameState.corpses.forEach(c => scene.remove(c.mesh));
    gameState.corpses = [];
    
    playerMesh.visible = true;
    // 重生在走廊西端
    playerMesh.position.set(-GAME_CONFIG.scene.gridWidth * GAME_CONFIG.scene.tileSize / 2 + 8, 0, 0);
    
    // 重置相机角度和电筒方向
    cameraAngle = -Math.PI * 0.5;
    aimJoystickEverUsed = false;
    if (gameState.flashlightTarget) {
        gameState.flashlightTarget.position.set(
            playerMesh.position.x + 10,
            0,
            0
        );
    }
    
    gameState.keys.forEach((key) => {
        key.collected = false;
        key.mesh.visible = true;
    });
    
    // 重置绷带：移除旧的，重新创建
    gameState.bandages.forEach(b => scene.remove(b.mesh));
    gameState.bandages = [];
    createBandages();
    
    if (gameState.exitDoor) {
        gameState.exitDoor.locked = true;
        gameState.exitDoor.lockMesh.material.color.setHex(0xff0000);
        gameState.exitDoor.lockMesh.material.emissive.setHex(0x550000);
    }
    
    const zombiePositions = [
        { x: -15, z: -14 },
        { x: 25, z: -14 },
        { x: -20, z: 14 },
    ];
    gameState.zombies.forEach((zombie, i) => {
        zombie.mesh.position.set(zombiePositions[i].x, 0, zombiePositions[i].z);
        zombie.state = 'wander';
        zombie.attractedToLight = null;
    });
    
    const jumperPositions = [
        { x: 0, z: -14 },
        { x: -50, z: 14 },
        { x: 50, z: 0 },
    ];
    gameState.jumpers.forEach((jumper, i) => {
        jumper.mesh.position.set(jumperPositions[i].x, 0, jumperPositions[i].z);
        jumper.mesh.position.y = 0;
        jumper.mesh.scale.set(1, 1, 1);
        jumper.state = 'wander';
        jumper.jumpCooldownTimer = 0;
    });
    
    const ghostPositions = [
        { x: -20, z: 0 },     // 走廊
        { x: 20, z: 0 },      // 走廊
        { x: 0, z: -14 },     // 北侧教室
    ];
    gameState.ghosts.forEach((ghost, i) => {
        ghost.mesh.position.set(ghostPositions[i].x, 0, ghostPositions[i].z);
    });
    
    document.getElementById('game-over-screen').style.display = 'none';
    
    const hideIndicator = document.getElementById('hiding-indicator');
    if (hideIndicator) hideIndicator.style.display = 'none';
}

function animate() {
    requestAnimationFrame(animate);
    
    deltaTime = clock.getDelta();
    
    update(deltaTime);
    
    renderer.render(scene, camera);
}

window.addEventListener('load', init);
