// ==== КОНФИГ КЛИЕНТА ====
const API_BASE = 'http://localhost:4000'; // адрес твоего Node-сервера

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const statusEl = document.getElementById('status');
const authBtn = document.getElementById('authBtn');
const matchBtn = document.getElementById('matchBtn');

// ==== Константы карты (должны совпадать с сервером) ====
const TILE_SIZE = 32;
const MAP_W = 13;
const MAP_H = 13;

const TILE_EMPTY = 0;
const TILE_BRICK = 1;
const TILE_STEEL = 2;
const TILE_WATER = 3;
const TILE_GRASS = 4;
const TILE_EAGLE = 5;

const COLORS = {
  [TILE_EMPTY]: '#111',
  [TILE_BRICK]: '#b55239',
  [TILE_STEEL]: '#777',
  [TILE_WATER]: '#204b8f',
  [TILE_GRASS]: '#224422',
  [TILE_EAGLE]: '#daa520'
};

// ==== Сетевое состояние ====
let socket = null;
let jwtToken = null;
let authedUser = null;

let inMatch = false;
let matchId = null;
let role = null;      // 'p1' или 'p2'
let lastInput = { up:false,down:false,left:false,right:false,fire:false };

// Состояние, приходящее с сервера
let serverState = {
  map: null,
  players: {
    p1: { x:0, y:0, dirX:0, dirY:0, lives:3, active:true },
    p2: { x:0, y:0, dirX:0, dirY:0, lives:3, active:true }
  },
  bullets: { p1:null, p2:null },
  finished: false,
  winner: null
};

// ==== Вспомогательное: лог в статус ====
function setStatus(text) {
  statusEl.textContent = `Статус: ${text}`;
}

// ==== 1. Авторизация через Telegram (/auth/telegram) ====
// Для теста вне Telegram делаем фейковый initData
function getInitData() {
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
    return window.Telegram.WebApp.initData;
  }
  // Эмуляция при запуске в обычном браузере
  const fake = new URLSearchParams({
    user: JSON.stringify({
      id: 123456,
      username: 'test_user',
      first_name: 'Test'
    }),
    auth_date: Math.floor(Date.now() / 1000).toString(),
    hash: 'fake_hash' // сервер validate всё равно будет ругаться, если включена реальная проверка
  });
  return fake.toString();
}

async function authTelegram() {
  setStatus('авторизация...');
  authBtn.disabled = true;

  try {
    const initData = getInitData();

    const res = await fetch(`${API_BASE}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData })
    });

    if (!res.ok) {
      throw new Error('auth failed ' + res.status);
    }

    const data = await res.json();
    jwtToken = data.token;
    authedUser = data.user;

    setStatus(`авторизован как ${authedUser.username || authedUser.tid}`);
    matchBtn.disabled = false;

    connectSocket();
  } catch (e) {
    console.error(e);
    setStatus('ошибка авторизации');
    authBtn.disabled = false;
  }
}

// ==== 2. Подключение Socket.IO ====
function connectSocket() {
  if (!jwtToken) return;

  socket = io(API_BASE, {
    auth: { token: jwtToken }
  });

  socket.on('connect', () => {
    console.log('socket connected', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected');
    setStatus('соединение потеряно');
    inMatch = false;
    matchId = null;
    role = null;
  });

  socket.on('match_start', (payload) => {
    matchId = payload.matchId;
    role = payload.youAre[socket.id]; // 'p1' или 'p2'
    inMatch = true;
    serverState.finished = false;
    serverState.winner = null;
    setStatus(`матч найден, ты: ${role.toUpperCase()}`);
  });

  socket.on('state', (state) => {
    // Полное состояние матча
    serverState.map = state.map;
    serverState.players.p1 = state.players.p1;
    serverState.players.p2 = state.players.p2;
    serverState.bullets = state.bullets;
    serverState.finished = state.finished;
    serverState.winner = state.winner;
  });

  socket.on('match_end', ({ winner }) => {
    serverState.finished = true;
    serverState.winner = winner;
  });
}

// ==== 3. Поиск матча ====
function findMatch() {
  if (!socket || !socket.connected) {
    setStatus('нет соединения с сервером');
    return;
  }
  setStatus('поиск матча...');
  socket.emit('find_match', { mmr: 1000 });
}

// ==== 4. Ввод с клавиатуры и отправка на сервер ====
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();

  let changed = false;

  if (key === 'w' || key === 'arrowup') {
    lastInput.up = true; changed = true;
  } else if (key === 's' || key === 'arrowdown') {
    lastInput.down = true; changed = true;
  } else if (key === 'a' || key === 'arrowleft') {
    lastInput.left = true; changed = true;
  } else if (key === 'd' || key === 'arrowright') {
    lastInput.right = true; changed = true;
  } else if (key === ' ' || key === 'space') {
    lastInput.fire = true; changed = true;
  }

  if (changed) sendInput();
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();

  let changed = false;

  if (key === 'w' || key === 'arrowup') {
    lastInput.up = false; changed = true;
  } else if (key === 's' || key === 'arrowdown') {
    lastInput.down = false; changed = true;
  } else if (key === 'a' || key === 'arrowleft') {
    lastInput.left = false; changed = true;
  } else if (key === 'd' || key === 'arrowright') {
    lastInput.right = false; changed = true;
  } else if (key === ' ' || key === 'space') {
    lastInput.fire = false; changed = true;
  }

  if (changed) sendInput();
});

function sendInput() {
  if (!socket || !socket.connected || !inMatch || !matchId || !role) return;
  socket.emit('input', {
    matchId,
    role,
    input: lastInput
  });
}

// ==== 5. Отрисовка ====
function drawMap() {
  const map = serverState.map;
  if (!map) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.fillText('Ожидание матча...', 90, 200);
    return;
  }

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const tile = map[y][x];
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      ctx.fillStyle = COLORS[tile] || '#111';
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      ctx.strokeStyle = '#222';
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

      if (tile === TILE_EAGLE) {
        ctx.fillStyle = '#fff';
        ctx.font = '20px monospace';
        ctx.fillText('^', px + 10, py + 24);
      }
    }
  }
}

function drawTank(p, color) {
  if (!p || !p.active) return;
  const size = 24;
  const half = size / 2;
  const x = p.x;
  const y = p.y;

  ctx.fillStyle = color;
  ctx.fillRect(x - half, y - half, size, size);

  ctx.fillStyle = '#ddd';
  const barrelLength = size / 2 + 4;
  const barrelWidth = 6;

  if (p.dirX === 0 && p.dirY === -1) {
    ctx.fillRect(x - barrelWidth/2, y - half - barrelLength, barrelWidth, barrelLength);
  } else if (p.dirX === 0 && p.dirY === 1) {
    ctx.fillRect(x - barrelWidth/2, y + half, barrelWidth, barrelLength);
  } else if (p.dirX === -1 && p.dirY === 0) {
    ctx.fillRect(x - half - barrelLength, y - barrelWidth/2, barrelLength, barrelWidth);
  } else if (p.dirX === 1 && p.dirY === 0) {
    ctx.fillRect(x + half, y - barrelWidth/2, barrelLength, barrelWidth);
  }
}

function drawBullets() {
  ctx.fillStyle = '#ffeb3b';
  const b1 = serverState.bullets.p1;
  const b2 = serverState.bullets.p2;

  if (b1) {
    const s = b1.size || 6;
    ctx.fillRect(b1.x - s/2, b1.y - s/2, s, s);
  }
  if (b2) {
    const s = b2.size || 6;
    ctx.fillRect(b2.x - s/2, b2.y - s/2, s, s);
  }
}

function drawHUD() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, 24);
  ctx.fillStyle = '#fff';
  ctx.font = '13px monospace';

  const p1 = serverState.players.p1;
  const p2 = serverState.players.p2;

  ctx.fillText(`P1: ${p1.lives}L ${p1.active ? '' : '(OUT)'}`, 8, 16);
  ctx.fillText(`P2: ${p2.lives}L ${p2.active ? '' : '(OUT)'}`, 210, 16);

  if (serverState.finished) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';

    let text = 'Конец матча';
    if (serverState.winner === 'p1') text = 'Победил Игрок 1';
    else if (serverState.winner === 'p2') text = 'Победил Игрок 2';

    ctx.fillText(text, 90, 210);
  }
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMap();
  drawTank(serverState.players.p1, '#4caf50');
  drawTank(serverState.players.p2, '#ff9800');
  drawBullets();
  drawHUD();
  requestAnimationFrame(loop);
}
loop();

// ==== 6. Кнопки ====
authBtn.addEventListener('click', () => {
  authTelegram();
});

matchBtn.addEventListener('click', () => {
  findMatch();
});