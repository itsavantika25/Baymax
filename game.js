
// Assets
const ASSETS = {
  baymax_high:  'assets/game assets/baymax high hp.svg',
  baymax_mid:   'assets/game assets/baymax mid hp.svg',
  baymax_low:   'assets/game assets/baymax low hp.svg',
  debris1:      'assets/game assets/debris 1 full.svg',
  debris1b:     'assets/game assets/debris 1 broken.svg',
  debris2:      'assets/game assets/debris 2 full.svg',
  debris2b:     'assets/game assets/debris 2 broken.svg',
  portal:       'assets/Portal.PNG',
  bg:           'assets/game assets/portal dimension svg.svg',
  boss:         'assets/game assets/Transparentbgmonstie.GIF',
  boss_icon:    'assets/game assets/Monster hp icon.PNG',
};

const images = {};
const assetKeys = Object.keys(ASSETS);
function loadImages(done) {
  let remaining = assetKeys.length;
  assetKeys.forEach(key => {
    const image = new Image();
    image.onload = () => {
      remaining--;
      if (remaining === 0) done();
    };
    image.onerror = () => {
      if (key === 'portal' && !image._fallback) {
        image._fallback = true;
        image.src = image.src.endsWith('.PNG') ? 'assets/Portal.png' : 'assets/Portal.PNG';
        return;
      }
      remaining--;
      if (remaining === 0) done();
    };
    image.src = ASSETS[key];
    images[key] = image;
  });
}
function imgOk(image) {
  return !!image && image.complete && image.naturalWidth > 0;
}

// Canvas
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let S = 1;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  S = Math.max(0.7, Math.min(1.35, canvas.height / 900));
  initStars();
}
window.addEventListener('resize', resizeCanvas);

// SETTINGS
const MAX_HP = 5;
const LEVEL_TIME = 45000;       
const MAX_LEVEL = 4;             
const SHOT_COOLDOWN = 250;
const RAPID_COOLDOWN = 130;
const INVINCIBLE_MS = 1100;
const PICKUP_DURATION = 8000;

function gameSpeed() {
  return 7.2 + (level - 1) * 2.2;
}
// Game state
let gameState = 'start';
let score = 0;
let level = 1;
let runTime = 0;
let animId = null;
let lastTime = 0;
let bgScroll = 0;
let shake = 0;
let hitFlash = 0;
let spawnTimer = 1200;
let hudTimer = 0;
let levelUpAnimTimer = 0;
let portalNoticeTimer = 0;
let muted = false;
let audioCtx = null;

// Audio
function tone(startFreq, endFreq, duration, type = 'sine', volume = 0.035) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFreq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch (_) {
    // audio is optional
  }
}
const sfx = {
  shoot: () => tone(760, 330, 0.06, 'square', 0.015),
  hit: () => tone(220, 55, 0.28, 'sawtooth', 0.07),
  break: () => tone(170, 45, 0.18, 'triangle', 0.045),
  pickup: () => tone(520, 1100, 0.16, 'sine', 0.05),
  bossRoar: () => tone(130, 40, 0.55, 'sawtooth', 0.09),
  level: () => {
    tone(440, 660, 0.12, 'triangle', 0.045);
    setTimeout(() => tone(660, 880, 0.13, 'triangle', 0.04), 100);
  },
};

// Input
const held = new Set();
const BLOCKED_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
const isDown = (...codes) => codes.some(code => held.has(code));

window.addEventListener('keydown', event => {
  if (BLOCKED_KEYS.includes(event.code)) event.preventDefault();
  held.add(event.code);
  if (event.code === 'KeyM' && !event.repeat) muted = !muted;
});
window.addEventListener('keyup', event => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

// Baymax (player)
const player = {
  x: 0, y: 0, w: 118, h: 118,
  vy: 0,
  hp: MAX_HP,
  invincible: false, invTimer: 0,
  shotTimer: 0,
  shield: 0, rapid: 0, triple: 0,
  approaching: false,
};

function resetPlayer() {
  player.w = 118 * S;
  player.h = 118 * S;
  player.x = canvas.width * 0.12;
  player.y = canvas.height * 0.45;
  player.vy = 0;
  player.hp = MAX_HP;
  player.invincible = false;
  player.invTimer = 0;
  player.shotTimer = 0;
  player.shield = player.rapid = player.triple = 0;
  player.approaching = false;
}

// World objects
const asteroids = [];
const lasers = [];
const pickups = [];
const particles = [];
const floaters = [];
const stars = [];

const ROCK_KINDS = {
  tiny:   { min: 24,  max: 34,  hp: 1, speed: 1.45, points: 35 },
  small:  { min: 38,  max: 50,  hp: 1, speed: 1.20, points: 25 },
  medium: { min: 56,  max: 76,  hp: 2, speed: 0.95, points: 20 },
  large:  { min: 86,  max: 110, hp: 3, speed: 0.72, points: 50 },
  huge:   { min: 120, max: 155, hp: 4, speed: 0.55, points: 80 },
};
const rand = (min, max) => min + Math.random() * (max - min);

function bounds() {
  return { top: canvas.height * 0.07, bottom: canvas.height * 0.93 };
}

function makeAsteroid(kind, x, y, speedMultiplier = 1) {
  const def = ROCK_KINDS[kind];
  const size = rand(def.min, def.max) * S;
  return {
    kind, x, y, w: size, h: size,
    hp: def.hp, maxHp: def.hp,
    speed: def.speed * speedMultiplier * 1.3,
    vy: rand(-0.45, 0.45),
    points: def.points,
    sprite: Math.random() < 0.5 ? 1 : 2,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: rand(-0.025, 0.025),
    flash: 0,
  };
}

function spawnAsteroid(offsetX = 0, targetY = null) {
  const { top, bottom } = bounds();
  const roll = Math.random();
  let kind;

  if (roll < 0.22) {
    kind = 'tiny';
  } else if (roll < 0.48) {
    kind = 'small';
  } else if (roll < 0.76) {
    kind = 'medium';
  } else if (roll < 0.92) {
    kind = 'large';
  } else {
    kind = 'huge';
  }

  const yPos = targetY !== null ? targetY : rand(top, bottom - 70 * S);
  asteroids.push(makeAsteroid(
    kind,
    canvas.width + rand(20, 80) + offsetX,
    yPos,
    1 + (level - 1) * 0.06
  ));
}

function spawnBoulderPattern() {
  const { top, bottom } = bounds();
  const y = rand(top + 80 * S, bottom - 120 * S);
  // big rock flanked by two fast ones
  asteroids.push(makeAsteroid('huge', canvas.width + 60, y));
  asteroids.push(makeAsteroid('tiny', canvas.width + 160, y - 85 * S, 1.1));
  asteroids.push(makeAsteroid('tiny', canvas.width + 180, y + 95 * S, 1.1));
}

function spawnDoublePattern() {
  const { top, bottom } = bounds();
  const usable = bottom - top;
  const y1 = top + rand(0, usable * 0.35);
  const y2 = top + rand(usable * 0.55, usable - 60 * S);
  spawnAsteroid(0, y1);
  spawnAsteroid(rand(60, 140), y2);
}

function spawnPattern() {
  const roll = Math.random();

  if (level === 1) {
    if (roll < 0.72) spawnAsteroid();
    else             spawnDoublePattern();
  } else if (level === 2) {
    if (roll < 0.45)      spawnAsteroid();
    else if (roll < 0.85) spawnDoublePattern();
    else                  spawnBoulderPattern();
  } else {
    if (roll < 0.28)      spawnAsteroid();
    else if (roll < 0.68) spawnDoublePattern();
    else                  spawnBoulderPattern();
  }
}

// Pickups
const PICKUPS = {
  repair: { color: '#00ff99', label: '+', name: 'HEAL' },
  shield: { color: '#00eaff', label: 'S', name: 'SHIELD' },
  rapid:  { color: '#ffd84d', label: 'R', name: 'RAPID FIRE' },
  triple: { color: '#ff65bd', label: '3', name: 'TRIPLE SHOT' },
};

function spawnPickup(x, y, forcedType = null) {
  let type = forcedType;
  if (!type) {
    const roll = Math.random();
    if (player.hp < MAX_HP && roll < 0.34) type = 'repair';
    else if (roll < 0.60) type = 'shield';
    else if (roll < 0.81) type = 'rapid';
    else type = 'triple';
  }
  pickups.push({ x, y, type, radius: 17 * S, phase: Math.random() * 6 });
}

function collectPickup(pickup) {
  const def = PICKUPS[pickup.type];
  createParticles(pickup.x, pickup.y, def.color, 12);
  sfx.pickup();
  let message = '';

  if (pickup.type === 'repair') {
    player.hp = Math.min(MAX_HP, player.hp + 1);
    message = '+1 HEALTH';
    updateHPBar();
  } else if (pickup.type === 'shield') {
    player.shield = PICKUP_DURATION;
    message = 'SHIELD ON';
  } else if (pickup.type === 'rapid') {
    player.rapid = PICKUP_DURATION;
    message = 'RAPID FIRE';
  } else if (pickup.type === 'triple') {
    player.triple = PICKUP_DURATION;
    message = 'TRIPLE SHOT';
  }
  addFloater(player.x + player.w / 2, player.y - 10, message, def.color);
}

// Monstie
const BOSS_MAX_HP = 40;
const boss = {
  active: false,
  spawned: false,
  x: 0, y: 0,
  w: 280, h: 280,
  hp: BOSS_MAX_HP,
  maxHp: BOSS_MAX_HP,
  targetX: 0,
  vy: 2.4,
  attackTimer: 1000,
  attackPattern: 0,
  beamChargeTimer: 0,
  beamFiringTimer: 0,
  beamY: 0,
  beamTilt: 0,
  flash: 0,
  defeated: false,
};
const bossProjectiles = [];

function spawnBoss() {
  if (boss.active || boss.defeated) return;
  boss.w = 280 * S;
  boss.h = 280 * S;
  boss.active = true;
  boss.spawned = true;
  boss.defeated = false;
  boss.hp = BOSS_MAX_HP;
  boss.maxHp = BOSS_MAX_HP;
  boss.x = canvas.width + 150;
  boss.y = canvas.height * 0.32;
  boss.targetX = canvas.width - boss.w - 25;
  boss.vy = 2.6;
  boss.attackTimer = 1200;
  boss.attackPattern = 0;
  boss.beamChargeTimer = 0;
  boss.beamFiringTimer = 0;
  boss.beamTilt = 0;
  boss.flash = 0;
  bossProjectiles.length = 0;

  //bye bye rocks
  asteroids.length = 0;
  sfx.bossRoar();
  shake = 15;

  const bossSprite = document.getElementById('boss-sprite');
  if (bossSprite) {
    bossSprite.style.display = 'block';
    bossSprite.classList.remove('poof');
    bossSprite.style.left = `${boss.x}px`;
    bossSprite.style.top = `${boss.y}px`;
    bossSprite.style.width = `${boss.w}px`;
    bossSprite.style.height = `${boss.h}px`;
  }

  const bossHud = document.getElementById('boss-hp-container');
  if (bossHud) bossHud.classList.add('active');
  updateBossHPBar();
  addFloater(canvas.width / 2, canvas.height * 0.3, 'WARNING: TENTACLE MONSTER APPROACHING!', '#ff3366');
}

function updateBossHPBar() {
  const fill = document.getElementById('boss-hp-fill');
  if (!fill) return;
  const pct = Math.max(0, boss.hp / boss.maxHp) * 100;
  fill.style.width = pct + '%';
}

function damageBoss(dmg = 1) {
  if (!boss.active || boss.defeated) return;
  boss.hp -= dmg;
  boss.flash = 1;
  updateBossHPBar();
  sfx.hit();
  createParticles(boss.x + boss.w * 0.35, boss.y + boss.h * 0.5, '#ff4088', 8);

  if (boss.hp <= 0) {
    defeatBoss();
  }
}

function defeatBoss() {
  boss.defeated = true;
  boss.active = false;
  shake = 22;
  score += 2000;

  const bossSprite = document.getElementById('boss-sprite');
  if (bossSprite) {
    bossSprite.classList.add('poof');
    setTimeout(() => {
      bossSprite.style.display = 'none';
      bossSprite.classList.remove('poof');
    }, 450);
  }

  addFloater(boss.x + boss.w / 2, boss.y + boss.h / 2, 'BOSS DEFEATED! +2000', '#ffd700');
  createParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ff3366', 45);
  createParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ffd700', 30);
  createParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ffffff', 25);

  const bossHud = document.getElementById('boss-hp-container');
  if (bossHud) bossHud.classList.remove('active');


  player.approaching = true;

  setTimeout(() => {
    spawnPortal();
  }, 1000);
}

// Portal magic :)
const portal = {
  active: false, x: 0, y: 0, w: 360, h: 360,
  targetX: 0, stopped: false,
};

function spawnPortal() {
  const size = 360 * S;
  portal.w = size;
  portal.h = size;
  portal.active = true;
  portal.stopped = false;
  portal.x = canvas.width + 150;
  portal.y = canvas.height / 2 - portal.h / 2;
  portal.targetX = canvas.width - portal.w - 20;
  portalNoticeTimer = 4500;
  asteroids.length = 0;
  pickups.length = 0;
  bossProjectiles.length = 0;
  addFloater(canvas.width / 2, canvas.height * 0.25, 'PORTAL OPEN! ENTERING DIMENSION...', '#00f5ff');
}

// Effects
function createParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = rand(1, 4);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: rand(0.035, 0.065),
      radius: rand(2, 4) * S,
      color,
    });
  }
}

function addFloater(x, y, text, color = '#ffffff') {
  floaters.push({ x, y, text, color, life: 1 });
}

function initStars() {
  stars.length = 0;
  for (let i = 0; i < 130; i++) {
    stars.push({
      x: Math.random() * (canvas ? canvas.width : window.innerWidth),
      y: Math.random() * (canvas ? canvas.height : window.innerHeight),
      radius: rand(0.5, 1.8),
      speed: rand(0.35, 1.4),
      alpha: rand(0.25, 0.85),
    });
  }
}

function buildMenuStars() {
  const container = document.getElementById('menu-stars');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 90; i++) {
    const star = document.createElement('div');
    star.style.cssText = `
      position:absolute; left:${Math.random() * 100}%; top:${Math.random() * 100}%;
      width:${rand(1, 3)}px; height:${rand(1, 3)}px; border-radius:50%;
      background:rgba(255,255,255,${rand(0.3, 0.9)});
      animation:baymaxTwinkle ${rand(2, 5)}s ${rand(0, 4)}s ease-in-out infinite alternate;
    `;
    container.appendChild(star);
  }
}
if (!document.getElementById('baymax-twinkle-style')) {
  const style = document.createElement('style');
  style.id = 'baymax-twinkle-style';
  style.textContent = '@keyframes baymaxTwinkle{from{opacity:.2}to{opacity:1}}';
  document.head.appendChild(style);
}

// Collision
function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Reset
function initGame() {
  score = 0;
  level = 1;
  runTime = 0;
  bgScroll = 0;
  shake = 0;
  hitFlash = 0;
  spawnTimer = 1200;
  hudTimer = 0;
  levelUpAnimTimer = 0;
  portalNoticeTimer = 0;

  asteroids.length = 0;
  lasers.length = 0;
  pickups.length = 0;
  particles.length = 0;
  floaters.length = 0;

  portal.active = false;
  portal.stopped = false;
  boss.active = false;
  boss.spawned = false;
  boss.defeated = false;
  boss.beamTilt = 0;
  bossProjectiles.length = 0;
  const bossSprite = document.getElementById('boss-sprite');
  if (bossSprite) {
    bossSprite.style.display = 'none';
    bossSprite.classList.remove('poof');
  }
  const bossHud = document.getElementById('boss-hp-container');
  if (bossHud) bossHud.classList.remove('active');

  held.clear();
  resetPlayer();
  initStars();
  updateHUD();
}

// Health / damage
function hurtPlayer() {
  if (player.shield > 0) {
    player.shield = 0;
    player.invincible = true;
    player.invTimer = 700;
    createParticles(player.x + player.w / 2, player.y + player.h / 2, '#00eaff', 16);
    addFloater(player.x + player.w / 2, player.y, 'SHIELD BLOCKED IT', '#00eaff');
    sfx.pickup();
    return;
  }

  player.hp--;
  player.invincible = true;
  player.invTimer = INVINCIBLE_MS;
  shake = 7;
  hitFlash = 1;
  createParticles(player.x + player.w / 2, player.y + player.h / 2, '#ff65bd', 14);
  sfx.hit();
  updateHPBar();

  if (player.hp <= 0) endGame('gameover');
}

function damageAsteroid(asteroid, damage = 1) {
  asteroid.hp -= damage;
  asteroid.flash = 1;
  if (asteroid.hp > 0) {
    createParticles(asteroid.x + asteroid.w / 2, asteroid.y + asteroid.h / 2, '#9eb5c8', 5);
    return false;
  }

  const cx = asteroid.x + asteroid.w / 2;
  const cy = asteroid.y + asteroid.h / 2;
  createParticles(cx, cy, '#9eb5c8', asteroid.kind === 'large' ? 18 : 9);
  if (asteroid.kind === 'large') createParticles(cx, cy, '#ffd84d', 8);
  score += asteroid.points;
  addFloater(cx, cy, '+' + asteroid.points, '#ffffff');
  sfx.break();

  if (Math.random() < 0.12) spawnPickup(cx, cy);
  updateHUD();
  return true;
}

// Shooting
function fireLaser() {
  const x = player.x + player.w * 0.90;
  const y = player.y + player.h * 0.5;
  lasers.push({ x, y, vy: 0 });

  if (player.triple > 0) {
    lasers.push({ x, y, vy: -2.4 });
    lasers.push({ x, y, vy: 2.4 });
  }
  // muzzle flash
  createParticles(x, y, '#00f5ff', 4);
  createParticles(x + 4, y, '#ffffff', 2);
  sfx.shoot();
}

// Level-up UI
function triggerLevelUp() {
  levelUpAnimTimer = 1800;
  const overlay = document.getElementById('levelup-overlay');
  if (!overlay) return;

  overlay.style.transition = 'opacity 0.25s ease';
  overlay.style.opacity = '1';
  const text = overlay.querySelector('.levelup-text');
  if (text) {
    text.textContent = `LEVEL ${level}`;
    text.style.animation = 'none';
    void text.offsetHeight;
    text.style.animation = 'baymaxLevelPop 0.4s ease-out forwards';
  }

  if (!document.getElementById('baymax-level-style')) {
    const style = document.createElement('style');
    style.id = 'baymax-level-style';
    style.textContent = '@keyframes baymaxLevelPop{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}';
    document.head.appendChild(style);
  }
}

// Update loop
function update(dt) {
  const W = canvas.width;
  const H = canvas.height;
  const k = dt / 16.667;
  const speed = gameSpeed() * k;

  runTime += dt;
  bgScroll += speed * 0.25;

  if (levelUpAnimTimer > 0) {
    levelUpAnimTimer -= dt;
    if (levelUpAnimTimer <= 0) {
      const overlay = document.getElementById('levelup-overlay');
      if (overlay) overlay.style.opacity = '0';
    }
  }
  portalNoticeTimer = Math.max(0, portalNoticeTimer - dt);

  if (!portal.active) score += dt / 1000 * 2;

  // level progression
  const targetLevel = Math.min(MAX_LEVEL, 1 + Math.floor(runTime / LEVEL_TIME));
  if (targetLevel > level && !boss.active && !portal.active) {
    level = targetLevel;
    if (player.hp < MAX_HP) {
      player.hp++;
      updateHPBar();
    }
    triggerLevelUp();
    if (level === MAX_LEVEL && !boss.spawned) {
      addFloater(W / 2, H * 0.34, 'FINAL SECTOR: BOSS APPROACHING!', '#ff3366');
      spawnBoss();
    } else {
      addFloater(W / 2, H * 0.34, 'THREATS INCREASING', '#c9b6ff');
    }
    sfx.level();
  }

  // fallback in case monstie didn't spawn on level-up
  if (level >= MAX_LEVEL && !boss.active && !boss.spawned && !boss.defeated && !portal.active) {
    spawnBoss();
  }

  // player movement
  if (player.approaching) {

    const targetY = canvas.height / 2 - player.h / 2;
    player.y += (targetY - player.y) * 0.05 * k;
    player.vy = 0;

    if (portal.active && portal.stopped) {
      player.x += 3.6 * k;
    }
  } else {
    const iy = (isDown('ArrowDown', 'KeyS') ? 1 : 0) - (isDown('ArrowUp', 'KeyW') ? 1 : 0);
    const accel = (1.1 + level * 0.05) * k;

    player.vy += iy * accel;
    const damping = Math.pow(0.83, k);
    player.vy *= damping;
    player.y += player.vy * k;

    player.x = canvas.width * 0.12;
    player.y = Math.max(H * 0.04, Math.min(H * 0.94 - player.h, player.y));
  }

  // engine trail
  particles.push({
    x: player.x + 5,
    y: player.y + player.h / 2 + rand(-7, 7),
    vx: -1.5 - Math.random() * 1.5,
    vy: rand(-0.25, 0.25),
    life: 1, decay: 0.075, radius: rand(2, 3) * S, color: '#ff65bd',
  });

  // shooting
  player.shotTimer -= dt;
  if (isDown('Space') && player.shotTimer <= 0) {
    fireLaser();
    player.shotTimer = player.rapid > 0 ? RAPID_COOLDOWN : SHOT_COOLDOWN;
  }

  // timers
  if (player.invincible) {
    player.invTimer -= dt;
    if (player.invTimer <= 0) player.invincible = false;
  }
  player.shield = Math.max(0, player.shield - dt);
  player.rapid = Math.max(0, player.rapid - dt);
  player.triple = Math.max(0, player.triple - dt);
  shake *= Math.pow(0.88, k);
  if (shake < 0.25) shake = 0;
  hitFlash = Math.max(0, hitFlash - dt / 500);

  // cool ass lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];
    laser.x += 14 * k;
    laser.y += laser.vy * k;
    if (laser.x > W + 50 || laser.y < -20 || laser.y > H + 20) lasers.splice(i, 1);
  }

  // asteroid spawning
  if (!portal.active && !boss.active) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPattern();
      const baseCadence = Math.max(360, 880 - (level - 1) * 165);
      spawnTimer = baseCadence * rand(0.9, 1.15);
    }
  }

  // Monstie update
  if (boss.active && !boss.defeated) {
    const bTop = H * 0.07;
    const bBot = H * 0.89 - boss.h;

    // slide in from the right
    if (boss.x > boss.targetX) {
      boss.x -= 3.2 * k;
    } else {
      const isChargingOrFiringBeam = (boss.beamChargeTimer > 0 || boss.beamFiringTimer > 0);

      if (!isChargingOrFiringBeam) {
        // dodge said cool ass lasers
        let avoidDir = 0;
        const bCenterY = boss.y + boss.h / 2;
        for (let j = 0; j < lasers.length; j++) {
          const l = lasers[j];
          if (l.x > boss.x - 380 && l.x < boss.x + boss.w) {
            if (Math.abs(l.y - bCenterY) < boss.h * 0.55) {
              avoidDir = l.y < bCenterY ? 1 : -1;
              break;
            }
          }
        }

        if (avoidDir !== 0) {
          boss.y += avoidDir * 4.8 * k;
        } else {
          boss.y += boss.vy * k;
        }

        if (boss.y < bTop) { boss.y = bTop; boss.vy = Math.abs(boss.vy); }
        if (boss.y > bBot) { boss.y = bBot; boss.vy = -Math.abs(boss.vy); }
      }

      // attack patterns
      boss.attackTimer -= dt;
      if (boss.attackTimer <= 0) {
        boss.attackPattern = (boss.attackPattern + 1) % 4;
        const originX = boss.x + boss.w * 0.16;
        const originY = boss.y + boss.h * 0.5;
        const targetCy = player.y + player.h * 0.5;

        if (boss.attackPattern === 0) {
          // torpedos idk how to spell
          boss.attackTimer = 850;
          const angle = Math.atan2(targetCy - originY, player.x - originX);
          bossProjectiles.push({
            x: originX, y: originY - 24,
            vx: Math.cos(angle) * 7.8, vy: Math.sin(angle) * 7.8,
            radius: 12 * S, color: '#ff2a70', oneShot: false, kind: 'torpedo',
          });
          bossProjectiles.push({
            x: originX, y: originY + 24,
            vx: Math.cos(angle) * 7.8, vy: Math.sin(angle) * 7.8,
            radius: 12 * S, color: '#ff2a70', oneShot: false, kind: 'torpedo',
          });
          sfx.shoot();
        } else if (boss.attackPattern === 1) {
          // 3 attack thingy
          boss.attackTimer = 1100;
          const baseAngle = Math.atan2(targetCy - originY, player.x - originX);
          [-0.28, 0, 0.28].forEach(spread => {
            const a = baseAngle + spread;
            bossProjectiles.push({
              x: originX, y: originY,
              vx: Math.cos(a) * 6.4, vy: Math.sin(a) * 6.4,
              radius: 13 * S, color: '#c000ff', oneShot: false, kind: 'spread',
            });
          });
          sfx.shoot();
        } else if (boss.attackPattern === 2) {
          // one shot orb thingy
          boss.attackTimer = 1700;
          const angle = Math.atan2(targetCy - originY, player.x - originX);
          bossProjectiles.push({
            x: originX, y: originY,
            vx: Math.cos(angle) * 5.2, vy: Math.sin(angle) * 5.2,
            radius: 26 * S, color: '#e60c37e6', oneShot: true, kind: 'doom',
          });
          shake = 8;
          sfx.bossRoar();
          addFloater(boss.x, boss.y - 14, 'ONE-SHOT VOID EYE!', '#ff0033');
        } else {
          // death beam XX
          boss.attackTimer = 2200;
          boss.beamChargeTimer = 750;
          boss.beamY = boss.y + boss.h * 0.5;
          const pCy = player.y + player.h * 0.5;
          const pCx = player.x + player.w * 0.5;
          const fullAngle = Math.atan2(pCy - boss.beamY, Math.max(100, (boss.x + 40) - pCx));
          boss.beamTilt = Math.max(-0.25, Math.min(0.25, fullAngle * 0.45));
          addFloater(canvas.width * 0.5, boss.beamY - 14, '! DEATH BEAM CHARGING !', '#ff0033');
        }
      }

      // death beam charge
      if (boss.beamChargeTimer > 0) {
        boss.beamChargeTimer -= dt;
        boss.beamY = boss.y + boss.h * 0.5;
        const pCy = player.y + player.h * 0.5;
        const pCx = player.x + player.w * 0.5;
        const fullAngle = Math.atan2(pCy - boss.beamY, Math.max(100, (boss.x + 40) - pCx));
        boss.beamTilt = Math.max(-0.25, Math.min(0.25, fullAngle * 0.45));
        if (boss.beamChargeTimer <= 0) {
          boss.beamFiringTimer = 850;
          shake = 14;
          sfx.bossRoar();
        }
      }
      if (boss.beamFiringTimer > 0) {
        boss.beamFiringTimer -= dt;
        boss.beamY = boss.y + boss.h * 0.5;
        const pCy = player.y + player.h * 0.5;
        const pCx = player.x + player.w * 0.5;
        const fullAngle = Math.atan2(pCy - boss.beamY, Math.max(100, (boss.x + 40) - pCx));
        boss.beamTilt = Math.max(-0.25, Math.min(0.25, fullAngle * 0.45));
        const bHalf = 32 * S;
        const beamX = boss.x + 40;
        const beamYAtPlayer = boss.beamY + (beamX - pCx) * Math.sin(boss.beamTilt);
        if (player.y + player.h > beamYAtPlayer - bHalf && player.y < beamYAtPlayer + bHalf) {
          if (!player.invincible) {
            hurtPlayer();
            if (player.hp > 0 && !player.shield) hurtPlayer();
          }
        }
      }
    }

    boss.flash = Math.max(0, boss.flash - dt / 150);

    const bossSprite = document.getElementById('boss-sprite');
    if (bossSprite) {
      bossSprite.style.left = `${boss.x}px`;
      bossSprite.style.top = `${boss.y}px`;
      bossSprite.style.width = `${boss.w}px`;
      bossSprite.style.height = `${boss.h}px`;
      if (boss.flash > 0) {
        bossSprite.classList.add('flash');
      } else {
        bossSprite.classList.remove('flash');
      }
    }

    //boss v lazer
    for (let j = lasers.length - 1; j >= 0; j--) {
      const laser = lasers[j];
      if (rectOverlap(laser.x, laser.y - 5, 30, 10, boss.x + 20, boss.y + 20, boss.w - 40, boss.h - 40)) {
        lasers.splice(j, 1);
        damageBoss(1);
      }
    }

    const pInset = 20 * S;
    if (rectOverlap(
      player.x + pInset, player.y + pInset, player.w - pInset * 2, player.h - pInset * 2,
      boss.x + 30, boss.y + 30, boss.w - 60, boss.h - 60
    )) {
      if (!player.invincible) hurtPlayer();
    }
  }

  // boss projectile
  for (let i = bossProjectiles.length - 1; i >= 0; i--) {
    const bp = bossProjectiles[i];
    bp.x += bp.vx * k;
    bp.y += bp.vy * k;

    // hit Baymax
    const pInset = 16 * S;
    if (rectOverlap(
      player.x + pInset, player.y + pInset, player.w - pInset * 2, player.h - pInset * 2,
      bp.x - bp.radius, bp.y - bp.radius, bp.radius * 2, bp.radius * 2
    )) {
      bossProjectiles.splice(i, 1);
      createParticles(bp.x, bp.y, bp.color, 12);
      if (bp.oneShot) {
        hurtPlayer();
        if (player.hp > 0 && !player.shield) player.hp = 0;
        updateHPBar();
        if (player.hp <= 0) endGame('gameover');
      } else {
        hurtPlayer();
      }
      continue;
    }

    // shot hit by laser
    for (let j = lasers.length - 1; j >= 0; j--) {
      const laser = lasers[j];
      if (rectOverlap(laser.x, laser.y - 5, 25, 10, bp.x - bp.radius, bp.y - bp.radius, bp.radius * 2, bp.radius * 2)) {
        lasers.splice(j, 1);
        if (!bp.oneShot) {
          bossProjectiles.splice(i, 1);
          createParticles(bp.x, bp.y, bp.color, 8);
        }
        break;
      }
    }

    if (bp.x < -60 || bp.y < -60 || bp.y > H + 60) {
      bossProjectiles.splice(i, 1);
    }
  }

  // asteroids hehe
  const area = bounds();
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const asteroid = asteroids[i];
    asteroid.x -= speed * asteroid.speed;
    asteroid.y += asteroid.vy * k;
    asteroid.rotation += asteroid.rotationSpeed * k;
    asteroid.flash = Math.max(0, asteroid.flash - dt / 140);

    if (asteroid.y < area.top || asteroid.y + asteroid.h > area.bottom) asteroid.vy *= -1;
    if (asteroid.x + asteroid.w < -60) {
      asteroids.splice(i, 1);
      continue;
    }

    let destroyed = false;
    for (let j = lasers.length - 1; j >= 0; j--) {
      const laser = lasers[j];
      if (rectOverlap(laser.x - 8, laser.y - 5, 34, 12, asteroid.x, asteroid.y, asteroid.w, asteroid.h)) {
        lasers.splice(j, 1);
        if (damageAsteroid(asteroid)) {
          asteroids.splice(i, 1);
          destroyed = true;
        }
        break;
      }
    }
    if (destroyed) continue;

    const inset = 18 * S;
    if (rectOverlap(
      player.x + inset, player.y + inset, player.w - inset * 2, player.h - inset * 2,
      asteroid.x + asteroid.w * 0.13, asteroid.y + asteroid.h * 0.13,
      asteroid.w * 0.74, asteroid.h * 0.74
    )) {
      if (!player.invincible) {
        createParticles(asteroid.x + asteroid.w / 2, asteroid.y + asteroid.h / 2, '#9eb5c8', 8);
        asteroids.splice(i, 1);
        hurtPlayer();
        if (gameState !== 'playing') return;
      }
    }
  }

  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pickup = pickups[i];
    pickup.x -= speed * 0.5;
    pickup.phase += dt / 320;
    const py = pickup.y + Math.sin(pickup.phase) * 5;
    if (pickup.x < -40) {
      pickups.splice(i, 1);
      continue;
    }
    if (rectOverlap(
      player.x, player.y, player.w, player.h,
      pickup.x - pickup.radius, py - pickup.radius, pickup.radius * 2, pickup.radius * 2
    )) {
      collectPickup(pickup);
      pickups.splice(i, 1);
    }
  }

 
  if (portal.active && !portal.stopped) {
    portal.x -= 4.2 * k;
    if (portal.x <= portal.targetX) {
      portal.x = portal.targetX;
      portal.stopped = true;
      player.approaching = true;
      player.vx = player.vy = 0;
    }
  }
  if (portal.active && portal.stopped) {
    const playerCx = player.x + player.w / 2;
    const playerCy = player.y + player.h / 2;
    const portalCx = portal.x + portal.w / 2;
    const portalCy = portal.y + portal.h / 2;
    if (Math.abs(playerCx - portalCx) < portal.w * 0.38 &&
        Math.abs(playerCy - portalCy) < portal.h * 0.45) {
      endGame('win');
      return;
    }
  }

  // particles and floaters
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.x += particle.vx * k;
    particle.y += particle.vy * k;
    particle.life -= particle.decay * k;
    if (particle.life <= 0) particles.splice(i, 1);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const floater = floaters[i];
    floater.y -= 0.55 * k;
    floater.life -= dt / 1000;
    if (floater.life <= 0) floaters.splice(i, 1);
  }

  // background stars
  stars.forEach(star => {
    star.x -= star.speed * k;
    if (star.x < 0) {
      star.x = W;
      star.y = Math.random() * H;
    }
  });

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 120;
    updateHUD();
  }
}

//bg
function drawBackground(W, H) {
  const bg = images.bg;
  if (imgOk(bg)) {
    const sc = bgScroll % (W * 2);
    for (let k = 0; k <= 3; k++) {
      const x = k * W - sc;
      if (x >= W || x + W <= 0) continue;
      if (k % 2 === 0) {
        ctx.drawImage(bg, x, 0, W, H);
      } else {
        ctx.save();
        ctx.translate(x + W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.restore();
      }
    }
  } else {
    ctx.fillStyle = '#0d0010';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(4, 0, 14, 0.45)';
  ctx.fillRect(0, 0, W, H);
 
  stars.forEach(s => {
    ctx.globalAlpha = s.alpha * 0.65;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}


function draw() {
  const W = canvas.width;
  const H = canvas.height;
  drawBackground(W, H);

  if (gameState === 'start') return;

  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));

  drawPortal();
  drawBoss();
  drawBossProjectiles();
  drawPickups();
  drawAsteroids();
  drawLasers();
  drawParticles();
  drawPlayer();
  drawFloaters();

  ctx.restore();
  drawHUDLayer(W, H);

  if (hitFlash > 0) {
    ctx.fillStyle = `rgba(255,0,60,${hitFlash * 0.13})`;
    ctx.fillRect(0, 0, W, H);
  }
}

//tentacle beam effects and telegraphs
function drawBoss() {
  if (!boss.active || boss.defeated) return;

  const W = canvas.width;
  const now = performance.now();
  ctx.save();

  if (boss.beamChargeTimer > 0) {
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 55));
    const beamX = boss.x + 30;
    const bY    = boss.beamY;
    const tilt  = -(boss.beamTilt || 0);
    const startX = -200 * S;
    const beamLen = beamX - startX;

    ctx.save();
    ctx.translate(beamX, bY);
    ctx.rotate(tilt);
    ctx.translate(-beamX, -bY);

    ctx.save();
    ctx.globalAlpha = pulse * 0.18;
    ctx.fillStyle = '#ff0033';
    ctx.fillRect(startX, bY - 40 * S, beamLen, 80 * S);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = `hsl(${(now / 6) % 40}, 100%, 55%)`;
    ctx.lineWidth = 3.5 * S;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -(now / 12) % 24;
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ff2200';
    ctx.beginPath();
    ctx.moveTo(startX, bY);
    ctx.lineTo(beamX, bY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.restore();
  }

  if (boss.beamFiringTimer > 0) {
    const beamX = boss.x + 40;
    const bY    = boss.beamY;
    const tick  = now / 40;
    const tilt  = -(boss.beamTilt || 0);
    const startX = -200 * S;
    const beamLen = beamX - startX;

    ctx.save();
    ctx.translate(beamX, bY);
    ctx.rotate(tilt);
    ctx.translate(-beamX, -bY);

    // outer glow
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.12 * Math.sin(tick * 1.7);
    const outerH = 120 * S;
    const outerG = ctx.createLinearGradient(0, bY - outerH, 0, bY + outerH);
    outerG.addColorStop(0,    'rgba(0,0,0,0)');
    outerG.addColorStop(0.3,  'rgba(180,0,60,0.6)');
    outerG.addColorStop(0.5,  'rgba(255,0,80,0.8)');
    outerG.addColorStop(0.7,  'rgba(180,0,60,0.6)');
    outerG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = outerG;
    ctx.fillRect(startX, bY - outerH, beamLen, outerH * 2);
    ctx.restore();

    ctx.save();
    const midH = 36 * S;
    ctx.shadowBlur = 40;
    ctx.shadowColor = '#ff0044';
    const midG = ctx.createLinearGradient(0, bY - midH, 0, bY + midH);
    midG.addColorStop(0,    'rgba(255,0,60,0)');
    midG.addColorStop(0.2,  '#cc0033');
    midG.addColorStop(0.5,  '#ff2255');
    midG.addColorStop(0.8,  '#cc0033');
    midG.addColorStop(1,    'rgba(255,0,60,0)');
    ctx.fillStyle = midG;
    ctx.fillRect(startX, bY - midH, beamLen, midH * 2);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.28;
    const fringeH = 14 * S;
    ctx.fillStyle = '#6600ff';
    ctx.fillRect(startX, bY - fringeH - 18 * S, beamLen, fringeH);
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(startX, bY + 18 * S,            beamLen, fringeH);
    ctx.restore();

  
    ctx.save();
    const coreH = 10 * S;
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#ffffff';
    const coreG = ctx.createLinearGradient(0, bY - coreH, 0, bY + coreH);
    coreG.addColorStop(0,   'rgba(255,200,200,0)');
    coreG.addColorStop(0.2, '#ff8899');
    coreG.addColorStop(0.5, '#ffffff');
    coreG.addColorStop(0.8, '#ff8899');
    coreG.addColorStop(1,   'rgba(255,200,200,0)');
    ctx.fillStyle = coreG;
    ctx.fillRect(startX, bY - coreH, beamLen, coreH * 2);
    ctx.restore();

 
    ctx.save();
    ctx.strokeStyle = '#ff88aa';
    ctx.lineWidth = 1.8 * S;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ff0044';
    ctx.globalAlpha = 0.75;
    const arcCount = 4;
    for (let a = 0; a < arcCount; a++) {
      const side = a % 2 === 0 ? -1 : 1;
      const spread = (22 + a * 14) * S;
      ctx.beginPath();
      let ax = startX;
      ctx.moveTo(ax, bY);
      while (ax < beamX) {
        const step = 28 + Math.random() * 22;
        ax = Math.min(ax + step, beamX);
        const jitter = (Math.random() - 0.5) * spread * 2;
        ctx.lineTo(ax, bY + side * spread + jitter);
      }
      ctx.stroke();
    }
    ctx.restore();


    ctx.save();
    const scanY = bY + Math.sin(tick * 3.5) * 18 * S;
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(tick * 5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * S;
    ctx.beginPath();
    ctx.moveTo(startX, scanY);
    ctx.lineTo(beamX, scanY);
    ctx.stroke();
    ctx.restore();


    ctx.save();
    const bloomR = 38 * S + 12 * S * Math.sin(tick * 4);
    const bloomG = ctx.createRadialGradient(beamX, bY, 3, beamX, bY, bloomR);
    bloomG.addColorStop(0,   '#ffffff');
    bloomG.addColorStop(0.25,'#ff3366');
    bloomG.addColorStop(0.6, 'rgba(200,0,80,0.4)');
    bloomG.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = bloomG;
    ctx.beginPath();
    ctx.arc(beamX, bY, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  ctx.restore();
}


function drawBossProjectiles() {
  const time = performance.now() / 100;
  bossProjectiles.forEach(bp => {
    ctx.save();

    const auraR = bp.radius * (bp.oneShot ? 1.6 : 1.4);
    const aura = ctx.createRadialGradient(bp.x, bp.y, bp.radius * 0.3, bp.x, bp.y, auraR);
    if (bp.oneShot) {
      aura.addColorStop(0, 'rgba(255, 0, 50, 0.7)');
      aura.addColorStop(0.5, 'rgba(150, 0, 80, 0.35)');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else if (bp.kind === 'spread') {
      aura.addColorStop(0, 'rgba(192, 0, 255, 0.7)');
      aura.addColorStop(0.5, 'rgba(90, 0, 160, 0.35)');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      aura.addColorStop(0, 'rgba(255, 42, 112, 0.7)');
      aura.addColorStop(0.5, 'rgba(130, 0, 70, 0.35)');
      aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, auraR, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = bp.oneShot ? 22 : 14;
    ctx.shadowColor = bp.color;

    const coreGrad = ctx.createRadialGradient(bp.x - bp.radius * 0.3, bp.y - bp.radius * 0.3, 1, bp.x, bp.y, bp.radius);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.35, bp.color);
    coreGrad.addColorStop(0.85, '#12001e');
    coreGrad.addColorStop(1, '#05000a');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(bp.x, bp.y, bp.radius, 0, Math.PI * 2);
    ctx.fill();

 
    const sparks = bp.oneShot ? 5 : 3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (let s = 0; s < sparks; s++) {
      const angle = time + (s * (Math.PI * 2 / sparks));
      const dist = bp.radius * 1.15;
      const sx = bp.x + Math.cos(angle) * dist;
      const sy = bp.y + Math.sin(angle) * dist;
      ctx.fillStyle = bp.oneShot ? '#ff2a70' : '#ffffff';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5 * S, 0, Math.PI * 2);
      ctx.fill();
    }

    if (bp.oneShot) {

      ctx.strokeStyle = '#ff3366';
      ctx.lineWidth = 2.5 * S;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = time * 0.7 + (i * Math.PI / 4);
        const r1 = bp.radius * 0.95;
        const r2 = bp.radius * 1.45;
        ctx.moveTo(bp.x + Math.cos(a) * r1, bp.y + Math.sin(a) * r1);
        ctx.lineTo(bp.x + Math.cos(a) * r2, bp.y + Math.sin(a) * r2);
      }
      ctx.stroke();
    }

    ctx.restore();
  });
}

function drawPortal() {
  if (!portal.active) return;

  const cx = portal.x + portal.w / 2;
  const cy = portal.y + portal.h / 2;
  ctx.save();

  const halo = ctx.createRadialGradient(cx, cy, 15, cx, cy, portal.w * 0.55);
  halo.addColorStop(0, 'rgba(150, 60, 220, 0.35)');
  halo.addColorStop(0.5, 'rgba(255, 200, 50, 0.15)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, portal.w * 0.55, 0, Math.PI * 2);
  ctx.fill();

  if (imgOk(images.portal)) {
    ctx.drawImage(images.portal, portal.x, portal.y, portal.w, portal.h);
  }

  ctx.restore();

  if (portal.stopped) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${Math.max(10, Math.round(11 * S))}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#00eaff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#00eaff';
    ctx.fillText('ENTERING PORTAL...', cx, portal.y - 15);
    ctx.restore();
  }
}


function drawPickups() {
  pickups.forEach(pickup => {
    const def = PICKUPS[pickup.type];
    const y = pickup.y + Math.sin(pickup.phase) * 5;
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = def.color;
    ctx.fillStyle = 'rgba(10,0,25,0.9)';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pickup.x, y, pickup.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = def.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(12 * S)}px "Press Start 2P", monospace`;
    ctx.fillText(def.label, pickup.x, y);
    ctx.restore();
  });
}


function drawAsteroids() {
  asteroids.forEach(asteroid => {
    const damaged = asteroid.hp < asteroid.maxHp;
    const key = damaged
      ? (asteroid.sprite === 1 ? 'debris1b' : 'debris2b')
      : (asteroid.sprite === 1 ? 'debris1' : 'debris2');

    ctx.save();
    ctx.translate(asteroid.x + asteroid.w / 2, asteroid.y + asteroid.h / 2);
    ctx.rotate(asteroid.rotation);
    if (imgOk(images[key])) {
      ctx.drawImage(images[key], -asteroid.w / 2, -asteroid.h / 2, asteroid.w, asteroid.h);
      if (asteroid.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = asteroid.flash * 0.6;
        ctx.drawImage(images[key], -asteroid.w / 2, -asteroid.h / 2, asteroid.w, asteroid.h);
      }
    } else {
      ctx.fillStyle = '#7a86a8';
      ctx.fillRect(-asteroid.w / 2, -asteroid.h / 2, asteroid.w, asteroid.h);
    }
    ctx.restore();
  });
}


function drawLasers() {
  const time = performance.now() / 60;
  lasers.forEach(laser => {
    ctx.save();
    ctx.translate(laser.x, laser.y);
    const angle = Math.atan2(laser.vy, 14);
    ctx.rotate(angle);

    const length = 44 * S;
    const coreHeight = 5.5 * S;
    const glowHeight = 16 * S;

    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#00f5ff';
    const outerGlow = ctx.createLinearGradient(-length * 0.4, 0, length, 0);
    outerGlow.addColorStop(0, 'rgba(0, 245, 255, 0)');
    outerGlow.addColorStop(0.3, 'rgba(0, 220, 255, 0.45)');
    outerGlow.addColorStop(0.85, 'rgba(255, 77, 184, 0.7)');
    outerGlow.addColorStop(1, 'rgba(255, 255, 255, 0.9)');
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.ellipse(length * 0.45, 0, length * 0.55, glowHeight * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

  
    const beamGrad = ctx.createLinearGradient(-12, 0, length, 0);
    beamGrad.addColorStop(0, 'rgba(0, 245, 255, 0)');
    beamGrad.addColorStop(0.2, '#00c8ff');
    beamGrad.addColorStop(0.7, '#00f5ff');
    beamGrad.addColorStop(1, '#ffffff');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(-4, -coreHeight / 2, length + 4, coreHeight);

 
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ffffff';
    ctx.fillRect(8, -coreHeight * 0.28, length - 8, coreHeight * 0.56);


    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(length + 6, 0);
    ctx.lineTo(length - 3, -coreHeight * 0.7);
    ctx.lineTo(length - 1, 0);
    ctx.lineTo(length - 3, coreHeight * 0.7);
    ctx.closePath();
    ctx.fill();

   
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.6)';
    ctx.lineWidth = 1.5;
    const ringX = -10 + (time % 8);
    ctx.beginPath();
    ctx.arc(ringX, 0, coreHeight * 0.8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  });
}


function drawParticles() {
  particles.forEach(particle => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, particle.life) * 0.8;
    ctx.fillStyle = particle.color;
    ctx.shadowBlur = 5;
    ctx.shadowColor = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, Math.max(0.2, particle.radius * particle.life), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawPlayer() {
  const blinking = player.invincible && Math.floor(Date.now() / 100) % 2 === 0;
  if (blinking) return;

  let key = 'baymax_high';
  if (player.hp <= 1) key = 'baymax_low';
  else if (player.hp <= 3) key = 'baymax_mid';

  ctx.save();
  const cy = player.y + player.h / 2;
  const glowRadius = 34;
  const glow = ctx.createRadialGradient(player.x, cy, 2, player.x, cy, glowRadius);
  glow.addColorStop(0, 'rgba(255,90,200,0.45)');
  glow.addColorStop(1, 'rgba(255,90,200,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(player.x, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  if (imgOk(images[key])) {
    ctx.drawImage(images[key], player.x, player.y, player.w, player.h);
  } else {
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }
  ctx.globalAlpha = 1;

  if (player.shield > 0) {
    ctx.strokeStyle = 'rgba(0,234,255,0.85)';
    ctx.fillStyle = 'rgba(0,234,255,0.1)';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#00eaff';
    ctx.beginPath();
    ctx.arc(player.x + player.w / 2, cy, player.w * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloaters() {
  floaters.forEach(floater => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, floater.life));
    ctx.font = `${Math.max(9, Math.round(10 * S))}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = floater.color;
    ctx.shadowBlur = 5;
    ctx.shadowColor = floater.color;
    ctx.fillText(floater.text, floater.x, floater.y);
    ctx.restore();
  });
}


function drawHUDLayer(W, H) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.max(8, Math.round(9 * S))}px "Press Start 2P", monospace`;

  if (!portal.active) {
    if (boss.active && !boss.defeated) {
      ctx.fillStyle = '#ff3366';
      ctx.fillText('DEFEAT THE TENTACLE MONSTER TO OPEN PORTAL!', W / 2, 18);
    } else {
      const bossUnlockTime = LEVEL_TIME * (MAX_LEVEL - 1);
      const progress = Math.min(1, runTime / bossUnlockTime);
      ctx.fillStyle = '#d7caff';
      ctx.fillText('BOSS ENCOUNTER IN ' + formatTime(Math.max(0, bossUnlockTime - runTime)), W / 2, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(W / 2 - 115, 26, 230, 6);
      ctx.fillStyle = '#9b6bff';
      ctx.fillRect(W / 2 - 115, 26, 230 * progress, 6);
    }
  }


  if (portalNoticeTimer > 0 && portal.active) {
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(performance.now() / 130);
    ctx.font = `${Math.max(12, Math.round(15 * S))}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#00eaff';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#00eaff';
    ctx.fillText('PORTAL OPEN!', W / 2, H * 0.17);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  const active = [
    ['SHIELD', player.shield, '#00eaff'],
    ['RAPID FIRE', player.rapid, '#ffd84d'],
    ['TRIPLE SHOT', player.triple, '#ff65bd'],
  ].filter(item => item[1] > 0);

  ctx.textAlign = 'left';
  ctx.font = `${Math.max(8, Math.round(8 * S))}px "Press Start 2P", monospace`;
  active.forEach((item, index) => {
    const y = H - 28 - index * 19;
    ctx.fillStyle = item[2];
    ctx.fillText(item[0], 20, y);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(130, y - 8, 90, 6);
    ctx.fillStyle = item[2];
    ctx.fillRect(130, y - 8, 90 * Math.min(1, item[1] / PICKUP_DURATION), 6);
  });

  if (runTime < 8000 && !portal.active) {
    ctx.globalAlpha = Math.min(1, (8000 - runTime) / 1800);
    ctx.font = `${Math.max(8, Math.round(9 * S))}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('MOVE: ↑ / ↓  or  W / S     FIRE: SPACE', W / 2, H * 0.85);
    ctx.font = `${Math.max(8, Math.round(8 * S))}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#d7caff';
    ctx.fillText('DODGE ASTEROIDS. SURVIVE UNTIL THE PORTAL OPENS.', W / 2, H * 0.85 + 23);
  }

  ctx.restore();
}

function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// DOM HUD
function updateHUD() {
  const scoreElement = document.getElementById('score-val');
  const levelElement = document.getElementById('level-val');
  if (scoreElement) scoreElement.textContent = Math.floor(score);
  if (levelElement) levelElement.textContent = level;
  updateHPBar();
}

// Baymax HP bar
function updateHPBar() {
  const fill = document.getElementById('hp-fill');
  if (!fill) return;
  const percent = Math.max(0, player.hp / MAX_HP) * 100;
  fill.style.width = percent + '%';

  if (percent > 60) {
    fill.style.background = 'linear-gradient(90deg, #00ff99, #00dd77)';
    fill.style.animation = 'none';
  } else if (percent > 30) {
    fill.style.background = 'linear-gradient(90deg, #ffd700, #ffaa00)';
    fill.style.animation = 'none';
  } else {
    fill.style.background = 'linear-gradient(90deg, #ff3333, #ff6666)';
    fill.style.animation = 'baymaxHpFlash 0.55s ease-in-out infinite alternate';
  }
}
if (!document.getElementById('baymax-hp-style')) {
  const style = document.createElement('style');
  style.id = 'baymax-hp-style';
  style.textContent = '@keyframes baymaxHpFlash{from{filter:brightness(1)}to{filter:brightness(1.6)}}';
  document.head.appendChild(style);
}

// End game
function endGame(result) {
  if (gameState !== 'playing') return;
  gameState = result;
  cancelAnimationFrame(animId);

  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '0';

  if (result === 'gameover') {
    const scoreEl = document.getElementById('go-score-val');
    const levelEl = document.getElementById('go-level-val');
    if (scoreEl) scoreEl.textContent = Math.floor(score);
    if (levelEl) levelEl.textContent = level;
    showOverlay('gameover-screen');
  } else if (result === 'win') {
    score += player.hp * 100;
    const scoreEl = document.getElementById('win-score-val');
    if (scoreEl) scoreEl.textContent = Math.floor(score);
    showOverlay('win-screen');
    celebrateWin();
  }
}

function celebrateWin() {
  let count = 0;
  const celebration = setInterval(() => {
    createParticles(
      rand(canvas.width * 0.12, canvas.width * 0.88),
      rand(canvas.height * 0.12, canvas.height * 0.88),
      count % 2 === 0 ? '#ffd84d' : '#ff65bd',
      12
    );
    draw();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
    count++;
    if (count >= 18) clearInterval(celebration);
  }, 160);
}

function showOverlay(id) {
  document.querySelectorAll('.overlay').forEach(overlay => overlay.classList.remove('active'));
  const element = document.getElementById(id);
  if (element) element.classList.add('active');
}

function hideAllOverlays() {
  document.querySelectorAll('.overlay').forEach(overlay => overlay.classList.remove('active'));
  const levelOverlay = document.getElementById('levelup-overlay');
  if (levelOverlay) levelOverlay.style.opacity = '0';
}

// Game loop
function loop(timestamp) {
  const dt = lastTime ? Math.min(timestamp - lastTime, 34) : 16.667;
  lastTime = timestamp;
  if (gameState === 'playing') {
    update(dt);
    draw();
    if (gameState === 'playing') animId = requestAnimationFrame(loop);
  }
}

// Entry points
function startGame() {
  cancelAnimationFrame(animId);
  hideAllOverlays();
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '1';
  initGame();
  gameState = 'playing';
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function restartGame() {
  startGame();
}

// Boot
resizeCanvas();
loadImages(() => {
  buildMenuStars();
  initStars();
  showOverlay('start-screen');
  gameState = 'start';

  function menuLoop() {
    if (gameState !== 'start') return;
    bgScroll += 0.5;
    draw();
    stars.forEach(star => {
      star.x -= star.speed * 0.35;
      if (star.x < 0) {
        star.x = canvas.width;
        star.y = Math.random() * canvas.height;
      }
    });
    requestAnimationFrame(menuLoop);
  }
  requestAnimationFrame(menuLoop);
});
