// ── State ─────────────────────────────────────────────────────
let paused        = false;
let gameRunning   = false;
let money         = 250;
let tips          = 0;
let elapsedSecs   = 0;
let gameTimerID   = null;
let lostCustomers = 0;
let bgMusic        = new Audio();
bgMusic.loop       = true;
let currentMusicSrc = "";

// ── Sound Effects ─────────────────────────────────────────────
// To add your own sounds, replace the empty string in each src with your
// audio file path, e.g.:  sfx.unlock.src = "sounds/unlock.mp3";
// Supported formats: mp3, ogg, wav. All files should be in the same
// directory as bakery.html unless you specify a subfolder path.

const sfx = {
  // Fired when a treat is unlocked for the first time (spend money to unlock)
  unlock:     createSfx(/* e.g. "sounds/unlock.mp3" */ "sounds/unlock.mp3"),

  // Fired when a treat is successfully crafted from ingredients
  make:       createSfx(/* e.g. "sounds/make.mp3"   */ "sounds/make.mp3"),

  // Fired when an ingredient is purchased from the shop
  buy:        createSfx(/* e.g. "sounds/buy.mp3"    */ "sounds/buy.mp3"),

  // Fired when a customer is served successfully
  serve:      createSfx(/* e.g. "sounds/serve.mp3"  */ "sounds/serve.mp3"),

  // Fired when a tip is earned on top of a sale
  tip:        createSfx(/* e.g. "sounds/tip.mp3"    */ "sounds/tip.mp3"),

  // Fired when the game moves to a new level (levels 2, 3, 4)
  levelUp:    createSfx(/* e.g. "sounds/levelup.mp3"*/ "sounds/levelUp.mp3"),

  // Fired in level 4 each time the speed escalates every 30 seconds
  speedUp:    createSfx(/* e.g. "sounds/speedup.mp3"*/ "sounds/speedUp.mp3"),
};

// Creates a reusable Audio node; playing while already playing restarts from 0
function createSfx(src) {
  const a = new Audio();
  if (src) a.src = src;
  return a;
}

// Safe play: only fires if a src is actually set, rewinds first so rapid
// repeated calls (e.g. buying multiple ingredients) always play fully
function playSfx(sfxNode) {
  if (!sfxNode.src || sfxNode.src === window.location.href) return;
  sfxNode.currentTime = 0;
  sfxNode.play().catch(() => {});
}

// ── Inventory ─────────────────────────────────────────────────
const inventory = {
  sugar: 0, cocoa: 0, flour: 0,
  milk: 0, butter: 0, egg: 0, strawberry: 0
};

// ── Treats ────────────────────────────────────────────────────
const treats = {
  candy:         { unlocked: false, cost: 5,   count: 0, ingredients: { sugar: 1 },                                    sell: 8,   emoji: "🍬" },
  lolipop:       { unlocked: false, cost: 25,  count: 0, ingredients: { sugar: 1, candy: 1 },                          sell: 18,  emoji: "🍭" },
  icecream:      { unlocked: false, cost: 50,  count: 0, ingredients: { sugar: 1, milk: 1, strawberry: 1 },            sell: 30,  emoji: "🍦" },
  milkchocolate: { unlocked: false, cost: 100, count: 0, ingredients: { sugar: 1, cocoa: 1, milk: 1 },                 sell: 55,  emoji: "🍫" },
  crispycookie:  { unlocked: false, cost: 250, count: 0, ingredients: { milk: 1, butter: 1, milkchocolate: 1 },        sell: 130, emoji: "🍪" },
  chocolutzcake: { unlocked: false, cost: 500, count: 0, ingredients: { egg: 1, flour: 1, milkchocolate: 1, strawberry: 1 }, sell: 300, emoji: "🎂" },
};

// ── Ingredient Prices ─────────────────────────────────────────
const ingredientPrices = {
  sugar: 10, cocoa: 25, flour: 35, strawberry: 45,
  milk: 55, butter: 65, egg: 75
};

// ── Level Config ──────────────────────────────────────────────
// Level durations in seconds: L1=60, L2=60, L3=45, L4=infinite
const LEVEL_START_TIMES = { 1: 0, 2: 60, 3: 120, 4: 165 };

const LEVEL_POOLS = {
  1: ["candy", "lolipop"],
  2: ["candy", "lolipop", "icecream", "milkchocolate"],
  3: ["candy", "lolipop", "icecream", "milkchocolate", "crispycookie"],
  4: ["candy", "lolipop", "icecream", "milkchocolate", "crispycookie", "chocolutzcake"],
};

// [min, max] treats per order
const LEVEL_ORDER_RANGE = { 1: [1, 2], 2: [1, 3], 3: [1, 3], 4: [1, 4] };

// Base serve timers (seconds)
const LEVEL_BASE_TIMERS = { 1: 45, 2: 40, 3: 35, 4: 30 };

// Tip chance per level
const TIP_CHANCE = { 1: 0.5, 2: 0.35, 3: 0.25, 4: 0.2 };

// Music playback rates per level
const LEVEL_MUSIC_RATE = { 1: 1.0, 2: 1.25, 3: 1.5, 4: 1.0 };

// Level 4 escalation tracking
let level4Intervals = 0; // how many 30-second intervals have passed in level 4

const CUSTOMER_NAMES = [
  "Hailey","Audrina","Rylan","Nicholas","Eileen","Roger",
  "Priya","Sam","Luna","Finn","Zara","Marco"
];

// ── Customer Slots ────────────────────────────────────────────
const customerSlots = [
  { occupied: false, timerID: null, secondsLeft: 0, maxSecs: 0, order: [], name: "" },
  { occupied: false, timerID: null, secondsLeft: 0, maxSecs: 0, order: [], name: "" },
];

let currentLevel    = 1;
let spawnIntervalID = null;

// ── Serve Timer Calc ──────────────────────────────────────────
function getServeTimer() {
  const base = LEVEL_BASE_TIMERS[currentLevel];
  if (currentLevel < 4) return base;
  // Level 4: reduce by 1s every 30 seconds survived, floor at 5s
  return Math.max(5, base - level4Intervals);
}

// ── Level Progression ─────────────────────────────────────────
function checkLevelProgression() {
  const prevLevel = currentLevel;

  if (elapsedSecs >= LEVEL_START_TIMES[4] && currentLevel < 4) {
    currentLevel  = 4;
    level4Intervals = 0;
    applyMusicForLevel();
    playSfx(sfx.levelUp);
    showFlash("🔥 Level 4 — CHAOS MODE!", "warn");
  } else if (elapsedSecs >= LEVEL_START_TIMES[3] && currentLevel < 3) {
    currentLevel = 3;
    applyMusicForLevel();
    playSfx(sfx.levelUp);
    showFlash("⚡ Level 3 — Hard Mode!", "warn");
  } else if (elapsedSecs >= LEVEL_START_TIMES[2] && currentLevel < 2) {
    currentLevel = 2;
    applyMusicForLevel();
    playSfx(sfx.levelUp);
    showFlash("⬆ Level 2 — Medium Mode!", "good");
  }

  // Level 4 escalation: every 30s reduce timer and speed up music
  if (currentLevel === 4) {
    const secsInL4  = elapsedSecs - LEVEL_START_TIMES[4];
    const intervals = Math.floor(secsInL4 / 30);
    if (intervals > level4Intervals) {
      level4Intervals = intervals;
      bgMusic.playbackRate = Math.min(3.0, 1.0 + level4Intervals * 0.125);
      const newTimer = getServeTimer();
      playSfx(sfx.speedUp);
      showFlash(`⚡ Pressure rising! Customers wait only ${newTimer}s`, "warn");
    }
  }
}

// ── DOM Helpers ───────────────────────────────────────────────
function getCustomerBoxes() {
  return document.querySelectorAll(".customer-box");
}

function renderCustomerSlot(index) {
  const boxes = getCustomerBoxes();
  if (!boxes[index]) return;
  const box  = boxes[index];
  const slot = customerSlots[index];

  const iconEl   = box.querySelector("[id='customer-icon']");
  const tray     = box.querySelector("[id='customer-tray']");
  const serveBtn = box.querySelector("[id='serve']");

  // Build timer bar wrapper once
  let timerWrap = box.querySelector(".timer-wrap");
  if (!timerWrap) {
    const oldTimer = box.querySelector("[id='timer']");
    timerWrap = document.createElement("div");
    timerWrap.className = "timer-wrap";
    Object.assign(timerWrap.style, {
      width: "100%", height: "14px", borderRadius: "50px",
      background: "rgba(0,0,0,0.15)", overflow: "hidden", margin: "8px 0"
    });
    const bar = document.createElement("div");
    bar.className = "timer-bar";
    Object.assign(bar.style, {
      height: "100%", width: "100%", borderRadius: "50px",
      background: "rgb(159,239,150)",
      transition: "width 1s linear, background 1s"
    });
    timerWrap.appendChild(bar);
    if (oldTimer) oldTimer.replaceWith(timerWrap);
    else tray.insertAdjacentElement("afterend", timerWrap);
  }
  const timerBar = timerWrap.querySelector(".timer-bar");

  if (!slot.occupied) {
    iconEl.textContent        = "🪑";
    tray.innerHTML            = "<div>Waiting for customer…</div>";
    timerBar.style.width      = "0%";
    timerBar.style.background = "rgb(159,239,150)";
    serveBtn.disabled         = true;
    serveBtn.style.opacity    = "0.5";
    return;
  }

  iconEl.textContent = "🧑";

  const orderEmojis = slot.order
    .map(k => treats[k] ? treats[k].emoji : "❓")
    .join(" ");

  tray.innerHTML = `
    <div><strong>${slot.name}</strong></div>
    <div>I would like…</div>
    <div style="font-size:28px; letter-spacing:4px;">${orderEmojis}</div>
  `;

  const pct = Math.max(0, (slot.secondsLeft / slot.maxSecs) * 100);
  timerBar.style.width = pct + "%";
  if (pct > 60)      timerBar.style.background = "rgb(159,239,150)";
  else if (pct > 30) timerBar.style.background = "rgb(255,220,100)";
  else               timerBar.style.background = "rgb(239,100,100)";

  serveBtn.disabled      = false;
  serveBtn.style.opacity = "1";
}

// ── Lost Customer / Game Over ─────────────────────────────────
function customerLeft() {
  lostCustomers++;
  const remaining = 3 - lostCustomers;
  if (lostCustomers >= 3) {
    showFlash("💔 3 customers lost — GAME OVER!", "warn");
    setTimeout(gameOver, 1500);
  } else {
    showFlash(`⏰ Customer left! ${remaining} chance${remaining === 1 ? "" : "s"} remaining!`, "warn");
  }
}

function gameOver() {
  gameRunning = false;
  paused      = false;
  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);
  customerSlots.forEach((slot, i) => {
    clearInterval(slot.timerID);
    slot.timerID  = null;
    slot.occupied = false;
    renderCustomerSlot(i);
  });
  stopMusic();
  document.getElementById("stop-btn").style.display  = "none";
  document.getElementById("play-btn").style.display  = "";
  document.getElementById("pause-btn").style.display = "";

  let overlay = document.getElementById("game-over-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "game-over-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0",
      background: "rgba(0,0,0,0.6)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      zIndex: "10000", fontFamily: "'Cherry Bomb One', system-ui",
    });
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:rgb(219,96,114);padding:40px 60px;border-radius:20px;text-align:center;border:5px solid rgb(207,91,108);">
      <div style="font-size:60px;">💔</div>
      <div style="font-size:36px;color:rgb(247,186,195);letter-spacing:2px;">Game Over!</div>
      <div style="font-size:20px;color:rgb(247,186,195);margin:10px 0;">You lost 3 customers</div>
      <div style="font-size:22px;color:rgb(247,186,195);margin:10px 0;">
        💵 $${money} earned &nbsp;|&nbsp; 🫙 $${tips} in tips
      </div>
      <button id="restart-btn" style="margin-top:20px;padding:10px 30px;font-size:20px;border-radius:10px;
        color:rgb(247,186,195);background:rgb(65,117,206);border:3px solid rgb(56,98,170);
        font-family:'Cherry Bomb One',system-ui;letter-spacing:2px;cursor:pointer;">
        Play Again
      </button>
    </div>
  `;
  document.getElementById("restart-btn").addEventListener("click", () => {
    overlay.remove();
    resetGame();
  });
}

function resetGame() {
  money           = 250;
  tips            = 0;
  elapsedSecs     = 0;
  lostCustomers   = 0;
  currentLevel    = 1;
  level4Intervals = 0;
  Object.values(treats).forEach(t => { t.count = 0; });
  Object.keys(inventory).forEach(k => { inventory[k] = 0; });
  updateUI();
}

// ── Spawn Customers ───────────────────────────────────────────
function fillSlot(slotIndex) {
  const slot = customerSlots[slotIndex];
  const pool = LEVEL_POOLS[currentLevel];
  const [minSize, maxSize] = LEVEL_ORDER_RANGE[currentLevel];
  const size    = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
  const maxSecs = getServeTimer();

  const availableTreats = pool.filter(k => treats[k]);
  if (availableTreats.length === 0) return;

  slot.name        = CUSTOMER_NAMES[Math.floor(Math.random() * CUSTOMER_NAMES.length)];
  slot.order       = [];
  slot.secondsLeft = maxSecs;
  slot.maxSecs     = maxSecs;
  slot.occupied    = true;

  for (let i = 0; i < size; i++) {
    slot.order.push(availableTreats[Math.floor(Math.random() * availableTreats.length)]);
  }

  renderCustomerSlot(slotIndex);

  slot.timerID = setInterval(() => {
    if (!gameRunning) return;
    slot.secondsLeft--;
    renderCustomerSlot(slotIndex);
    if (slot.secondsLeft <= 0) {
      clearInterval(slot.timerID);
      slot.timerID  = null;
      slot.occupied = false;
      renderCustomerSlot(slotIndex);
      customerLeft();
    }
  }, 1000);
}

function spawnCustomers() {
  if (!gameRunning) return;
  customerSlots.forEach((slot, i) => {
    if (!slot.occupied) fillSlot(i);
  });
}

// ── Serve Customer ────────────────────────────────────────────
function serveCustomer(index) {
  if (!gameRunning) return;
  const slot = customerSlots[index];
  if (!slot.occupied) return;

  const needed = {};
  for (const key of slot.order) needed[key] = (needed[key] || 0) + 1;

  for (const [key, qty] of Object.entries(needed)) {
    const t = treats[key];
    if (!t || !t.unlocked || t.count < qty) {
      showFlash(`❌ Not enough ${t?.emoji ?? key}!`, "warn");
      return;
    }
  }

  for (const [key, qty] of Object.entries(needed)) treats[key].count -= qty;

  let earned = 0;
  for (const key of slot.order) earned += treats[key].sell;
  earned = Math.floor(earned * 4);
  money += earned;

  if (Math.random() < TIP_CHANCE[currentLevel]) {
    const tipAmount = Math.floor(earned * 0.15) + Math.floor(Math.random() * 5) + 1;
    tips  += tipAmount;
    money += tipAmount;
    playSfx(sfx.tip);
    showFlash(`💰 +$${earned} earned  +$${tipAmount} tip!`, "good");
  } else {
    playSfx(sfx.serve);
    showFlash(`💵 +$${earned} earned!`, "good");
  }

  clearInterval(slot.timerID);
  slot.timerID  = null;
  slot.occupied = false;

  updateUI();
  renderCustomerSlot(index);
}

// ── Treats ────────────────────────────────────────────────────
function setupTreatButtons() {
  const treatBoxes = document.querySelectorAll(".treat-box");
  const treatKeys  = Object.keys(treats);
  treatBoxes.forEach((box, i) => {
    const key = treatKeys[i];
    if (!key) return;
    box.dataset.treat = key;
    const btn = box.querySelector(".treat-button");
    btn.addEventListener("click", () => {
      if (!gameRunning) { showFlash("▶ Start the game first!", "warn"); return; }
      if (!treats[key].unlocked) unlockTreat(key);
      else makeTreat(key);
    });
  });
}

function unlockTreat(key) {
  const t = treats[key];
  if (money < t.cost) { showFlash(`❌ Need $${t.cost} to unlock ${t.emoji}`, "warn"); return; }
  money -= t.cost;
  t.unlocked = true;
  playSfx(sfx.unlock);
  updateUI();
  showFlash(`🔓 ${t.emoji} unlocked!`, "good");
}

function makeTreat(key) {
  const t = treats[key];
  for (const [req, qty] of Object.entries(t.ingredients)) {
    if (inventory[req] !== undefined && inventory[req] < qty) {
      showFlash(`❌ Need ${qty} ${req}`, "warn"); return;
    }
    if (treats[req] !== undefined && treats[req].count < qty) {
      showFlash(`❌ Need ${qty} ${treats[req].emoji}`, "warn"); return;
    }
  }
  for (const [req, qty] of Object.entries(t.ingredients)) {
    if (inventory[req] !== undefined) inventory[req] -= qty;
    else if (treats[req] !== undefined) treats[req].count -= qty;
  }
  t.count++;
  playSfx(sfx.make);
  updateUI();
  showFlash(`✅ Made a ${t.emoji}!`, "good");
}

// ── Ingredients ───────────────────────────────────────────────
function setupIngredientButtons() {
  const ingBoxes = document.querySelectorAll(".ingredient-box");
  const ingKeys  = Object.keys(ingredientPrices);
  ingBoxes.forEach((box, i) => {
    const key = ingKeys[i];
    if (!key) return;
    const btn = box.querySelector(".ingredient-button");
    btn.addEventListener("click", () => {
      if (!gameRunning) { showFlash("▶ Start the game first!", "warn"); return; }
      const price = ingredientPrices[key];
      if (money < price) { showFlash(`❌ Need $${price} to buy ${key}`, "warn"); return; }
      money -= price;
      inventory[key]++;
      playSfx(sfx.buy);
      updateUI();
      showFlash(`🛒 Bought 1 ${key}!`, "good");
    });
  });
}

// ── Navigation Hub ────────────────────────────────────────────
function setupNavHub() {
  const playBtn  = document.getElementById("play-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const stopBtn  = document.getElementById("stop-btn");

  playBtn.textContent  = "▶ Play";
  pauseBtn.textContent = "⏸ Pause";
  stopBtn.textContent  = "⏹ Stop";

  // Initial visibility: only play shown
  stopBtn.style.display  = "none";
  pauseBtn.style.display = "none";

  playBtn.onclick  = () => {
    if (!gameRunning && !paused) startGame();
    else if (paused)             resumeGame();
  };
  pauseBtn.onclick = () => pauseGame();
  stopBtn.onclick  = () => stopGame();
}

// ── Game Flow ─────────────────────────────────────────────────
function startGame() {
  gameRunning     = true;
  paused          = false;
  elapsedSecs     = 0;
  lostCustomers   = 0;
  currentLevel    = 1;
  level4Intervals = 0;

  startMusic();

  gameTimerID = setInterval(() => {
    elapsedSecs++;
    updateTimerDisplay();
    checkLevelProgression();
  }, 1000);

  spawnIntervalID = setInterval(spawnCustomers, 12000);
  setTimeout(spawnCustomers, 500);

  document.getElementById("play-btn").style.display  = "none";
  document.getElementById("pause-btn").style.display = "";
  document.getElementById("stop-btn").style.display  = "";
  showFlash("🎮 Game started! Good luck!", "good");
  updateUI();
}

function pauseGame() {
  if (!gameRunning || paused) return;

  paused      = true;
  gameRunning = false;

  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);

  // Freeze all customer countdowns
  customerSlots.forEach(slot => {
    clearInterval(slot.timerID);
    slot.timerID = null;
  });

  pauseMusic();

  document.getElementById("play-btn").style.display  = "";
  document.getElementById("play-btn").textContent    = "▶ Resume";
  document.getElementById("pause-btn").style.display = "none";

  showFlash("⏸ Game paused", "warn");
}

function resumeGame() {
  if (!paused) return;

  paused      = false;
  gameRunning = true;

  // Resume main clock
  gameTimerID = setInterval(() => {
    elapsedSecs++;
    updateTimerDisplay();
    checkLevelProgression();
  }, 1000);

  // Resume spawning
  spawnIntervalID = setInterval(spawnCustomers, 12000);

  // Resume individual customer countdowns
  customerSlots.forEach((slot, i) => {
    if (!slot.occupied) return;
    slot.timerID = setInterval(() => {
      if (!gameRunning) return;
      slot.secondsLeft--;
      renderCustomerSlot(i);
      if (slot.secondsLeft <= 0) {
        clearInterval(slot.timerID);
        slot.timerID  = null;
        slot.occupied = false;
        renderCustomerSlot(i);
        customerLeft();
      }
    }, 1000);
  });

  resumeMusic();

  document.getElementById("play-btn").style.display  = "none";
  document.getElementById("play-btn").textContent    = "▶ Play";
  document.getElementById("pause-btn").style.display = "";

  showFlash("▶ Game resumed", "good");
}

function stopGame() {
  gameRunning = false;
  paused      = false;
  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);
  customerSlots.forEach((slot, i) => {
    clearInterval(slot.timerID);
    slot.timerID  = null;
    slot.occupied = false;
    renderCustomerSlot(i);
  });
  stopMusic();

  document.getElementById("stop-btn").style.display  = "none";
  document.getElementById("pause-btn").style.display = "none";
  document.getElementById("play-btn").style.display  = "";
  document.getElementById("play-btn").textContent    = "▶ Play";

  showFlash("⏹ Game stopped.", "warn");
}

function updateTimerDisplay() {
  const m  = String(Math.floor(elapsedSecs / 60)).padStart(2, "0");
  const s  = String(elapsedSecs % 60).padStart(2, "0");
  const el = document.querySelector(".time-counter");
  if (el) el.textContent = `⏱ ${m}:${s}  Lvl ${currentLevel}`;
}

// ── Music ─────────────────────────────────────────────────────
function applyMusicForLevel() {
  const newSrc  = currentLevel === 4 ? "monopoly-man.mp3" : "the-bakery.mp3";
  const newRate = currentLevel === 4 ? 1.0 : LEVEL_MUSIC_RATE[currentLevel];

  if (currentMusicSrc !== newSrc) {
    // Actually switching tracks — reload from start
    bgMusic.pause();
    bgMusic.src          = newSrc;
    bgMusic.playbackRate = newRate;
    bgMusic.currentTime  = 0;
    currentMusicSrc      = newSrc;
    bgMusic.play().catch(() => {});
  } else {
    // Same track, just nudge the speed — no interruption
    bgMusic.playbackRate = newRate;
  }
}

function startMusic() {
  currentMusicSrc      = "the-bakery.mp3";
  bgMusic.src          = "the-bakery.mp3";
  bgMusic.playbackRate = LEVEL_MUSIC_RATE[1];
  bgMusic.currentTime  = 0;
  bgMusic.play().catch(() => {});
}

function stopMusic() {
  bgMusic.pause();
  bgMusic.currentTime  = 0;
  bgMusic.playbackRate = 1.0;
}

function pauseMusic() {
  bgMusic.pause();
}

function resumeMusic() {
  bgMusic.play().catch(() => {});
}

// ── UI Update ─────────────────────────────────────────────────
function updateUI() {
  const moneyEl = document.querySelector(".money-box .task-text");
  const tipsEl  = document.querySelector(".tip-jar .task-text");
  if (moneyEl) moneyEl.textContent = `Money: $${money}`;
  if (tipsEl)  tipsEl.textContent  = `Tips: $${tips}`;

  const treatBoxes = document.querySelectorAll(".treat-box");
  const treatKeys  = Object.keys(treats);
  treatBoxes.forEach((box, i) => {
    const key = treatKeys[i];
    if (!key) return;
    const t      = treats[key];
    const invNum = box.querySelector(".inventory-num");
    const btn    = box.querySelector(".treat-button");
    if (invNum) invNum.textContent = t.count;
    if (btn) {
      if (!t.unlocked) {
        btn.textContent   = `Unlock: $${t.cost}`;
        btn.style.opacity = money >= t.cost ? "1" : "0.5";
      } else {
        btn.textContent   = `Make ${t.emoji}`;
        btn.style.opacity = canMakeTreat(key) ? "1" : "0.5";
      }
    }
  });

  const ingBoxes = document.querySelectorAll(".ingredient-box");
  const ingKeys  = Object.keys(ingredientPrices);
  ingBoxes.forEach((box, i) => {
    const key = ingKeys[i];
    if (!key) return;
    const invNum = box.querySelector(".inventory-num");
    if (invNum) invNum.textContent = inventory[key];
    const btn = box.querySelector(".ingredient-button");
    if (btn) btn.style.opacity = money >= ingredientPrices[key] ? "1" : "0.5";
  });
}

function canMakeTreat(key) {
  const t = treats[key];
  for (const [req, qty] of Object.entries(t.ingredients)) {
    if (inventory[req] !== undefined && inventory[req] < qty) return false;
    if (treats[req]    !== undefined && treats[req].count < qty) return false;
  }
  return true;
}

// ── Flash Messages ────────────────────────────────────────────
let flashTO = null;
function showFlash(msg, type = "good") {
  let el = document.getElementById("flash-msg");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash-msg";
    Object.assign(el.style, {
      position: "fixed", bottom: "20px", left: "50%",
      transform: "translateX(-50%)",
      padding: "10px 24px", borderRadius: "50px",
      fontFamily: "'Cherry Bomb One', system-ui",
      fontSize: "18px", letterSpacing: "1.5px",
      zIndex: "9999", transition: "opacity 0.4s",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
  }
  el.textContent      = msg;
  el.style.background = type === "good" ? "rgb(159,239,150)" : "rgb(239,150,163)";
  el.style.color      = "rgb(40,40,40)";
  el.style.opacity    = "1";
  clearTimeout(flashTO);
  flashTO = setTimeout(() => { el.style.opacity = "0"; }, 2200);
}

// ── Serve Button Wiring ───────────────────────────────────────
function setupServeButtons() {
  const boxes = getCustomerBoxes();
  boxes.forEach((box, i) => {
    const btn = box.querySelector("[id='serve']");
    if (btn) btn.addEventListener("click", () => serveCustomer(i));
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupNavHub();
  setupServeButtons();
  setupTreatButtons();
  setupIngredientButtons();
  customerSlots.forEach((_, i) => renderCustomerSlot(i));
  updateUI();
});
