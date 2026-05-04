// ============================================================
//  THE BAKERY — bakery.js
// ============================================================

// ── State ────────────────────────────────────────────────────
let paused = false;
let gameRunning    = false;
let money          = 100;
let tips           = 0;
let elapsedSecs    = 0;
let gameTimerID    = null;
let lostCustomers  = 0;   // game ends at 3
let bgMusic = new Audio();
bgMusic.loop = true;


// Inventory: ingredient counts
const inventory = {
  sugar: 0, cocoa: 0, flour: 0,
  milk: 0, butter: 0, egg: 0, strawberry: 0
};

// Treat inventory & unlock state
const treats = {
  candy:         { unlocked: false, cost: 5,   count: 0, ingredients: { sugar: 1 },                                                        sell: 8,   emoji: "🍬" },
  lolipop:       { unlocked: false, cost: 25,  count: 0, ingredients: { sugar: 1, candy: 1 },                                              sell: 18,  emoji: "🍭" },
  icecream:      { unlocked: false, cost: 50,  count: 0, ingredients: { milk: 1, strawberry: 1, lolipop: 1 },                              sell: 30,  emoji: "🍦" },
  milkchocolate: { unlocked: false, cost: 100, count: 0, ingredients: { sugar: 1, cocoa: 1, milk: 1 },                                     sell: 55,  emoji: "🍫" },
  crispycookie:  { unlocked: false, cost: 250, count: 0, ingredients: { flour: 1, milk: 1, butter: 1, milkchocolate: 1 },                  sell: 130, emoji: "🍪" },
  chocolutzcake: { unlocked: false, cost: 500, count: 0, ingredients: { egg: 1, flour: 1, milkchocolate: 1, strawberry: 1, crispycookie: 1 }, sell: 300, emoji: "🎂" },
};

// Ingredient shop prices
const ingredientPrices = {
  sugar: 10, cocoa: 25, flour: 35, strawberry: 45,
  milk: 55, butter: 65, egg: 75
};

// ── Customer / Level Config ───────────────────────────────────
// Level 3 includes every treat
const LEVEL_POOLS = {
  1: ["candy", "lolipop"],
  2: ["candy", "lolipop", "icecream", "milkchocolate"],
  3: ["candy", "lolipop", "icecream", "milkchocolate", "crispycookie", "chocolutzcake"],
};

// [min, max] number of items per order at each level
const LEVEL_ORDER_RANGE = { 1: [1, 2], 2: [3, 4], 3: [5, 6] };

// Base serve timers in seconds
const LEVEL_BASE_TIMERS = { 1: 30, 2: 20, 3: 15 };

// Tip chance per level (0–1)
const TIP_CHANCE = { 1: 0.5, 2: 0.35, 3: 0.2 };

const CUSTOMER_NAMES = [
  "Hailey","Audrina","Rylan","Nicholas","Eileen","Roger",
  "Priya","Sam","Luna","Finn","Zara","Marco"
];

// Active customer slots
const customerSlots = [
  { occupied: false, timerID: null, secondsLeft: 0, maxSecs: 0, order: [], name: "" },
  { occupied: false, timerID: null, secondsLeft: 0, maxSecs: 0, order: [], name: "" },
];

let currentLevel    = 1;
let spawnIntervalID = null;

// How many full minutes have been spent in level 3 (for timer reduction)
let level3Minutes = 0;

// ── Timer calc ────────────────────────────────────────────────
// Returns the current serve timer for the active level.
// In level 3 it shrinks by 1 second for every additional minute survived.
function getServeTimer() {
  const base = LEVEL_BASE_TIMERS[currentLevel];
  if (currentLevel < 3) return base;
  return Math.max(5, base - level3Minutes); // floor of 5s so it never hits 0
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

  // Build timer bar wrapper once, replacing the old #timer pill
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

// ── Lost customer / game over ─────────────────────────────────
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
  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);
  customerSlots.forEach((slot, i) => {
    clearInterval(slot.timerID);
    slot.timerID  = null;
    slot.occupied = false;
    renderCustomerSlot(i);
  });
  stopMusic();
  document.getElementById("stop-btn").style.display = "none";
  document.getElementById("play-btn").style.display = "";

  // Show a game-over overlay
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
  money         = 50;
  tips          = 0;
  elapsedSecs   = 0;
  lostCustomers = 0;
  currentLevel  = 1;
  level3Minutes = 0;
  // Reset treat counts (keep unlocked state so player keeps progress)
  Object.values(treats).forEach(t => { t.count = 0; });
  // Reset ingredients
  Object.keys(inventory).forEach(k => { inventory[k] = 0; });
  updateUI();
}

// ── Spawn Customers ───────────────────────────────────────────
function fillSlot(slotIndex) {
  const slot    = customerSlots[slotIndex];
  const pool    = LEVEL_POOLS[currentLevel];
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
      customerLeft(); // track loss & check game over
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

// +20% payout boost
earned = Math.floor(earned * 2);

money += earned;

  if (Math.random() < TIP_CHANCE[currentLevel]) {
    const tipAmount = Math.floor(earned * 0.15) + Math.floor(Math.random() * 5) + 1;
    tips  += tipAmount;
    money += tipAmount;
    showFlash(`💰 +$${earned} earned  +$${tipAmount} tip!`, "good");
  } else {
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
      updateUI();
      showFlash(`🛒 Bought 1 ${key}!`, "good");
    });
  });
}

// ── Navigation Hub ────────────────────────────────────────────
function setupNavHub() {
  const buttons = document.querySelectorAll(".game-box .game-button");

  const playBtn  = buttons[0];
  const pauseBtn = buttons[1];
  const stopBtn  = buttons[2];

  playBtn.textContent  = "▶ Play";
  pauseBtn.textContent = "⏸ Pause";
  stopBtn.textContent  = "⏹ Stop";

  playBtn.onclick = () => {
    if (!gameRunning && !paused) startGame();
    else if (paused) resumeGame();
  };

  pauseBtn.onclick = () => pauseGame();
  stopBtn.onclick  = () => stopGame();
}

function startGame() {
  gameRunning   = true;
  paused = false;
  elapsedSecs   = 0;
  lostCustomers = 0;
  currentLevel  = 1;
  level3Minutes = 0;

  startMusic();

  gameTimerID = setInterval(() => {
    elapsedSecs++;
    updateTimerDisplay();

    // Level progression
    if (elapsedSecs >= 120 && currentLevel < 3) {
      currentLevel = 3;
      level3Minutes = 0;
      showFlash("🔥 Level 3 — Expert Mode!", "good");
    } else if (elapsedSecs >= 60 && currentLevel < 2) {
      currentLevel = 2;
      showFlash("⬆ Level 2 — Medium Mode!", "good");
    }

    // In level 3, every additional minute reduces the serve timer by 1
    if (currentLevel === 3) {
      const minsInL3 = Math.floor((elapsedSecs - 120) / 60);
      if (minsInL3 > level3Minutes) {
        level3Minutes = minsInL3;
        const newTimer = getServeTimer();
        showFlash(`⚡ Timer reduced! Customers now wait only ${newTimer}s`, "warn");
      }
    }
  }, 1000);

  function pauseGame() {
  if (!gameRunning) return;

  paused = true;
  gameRunning = false;

  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);

  customerSlots.forEach(slot => {
    clearInterval(slot.timerID);
    slot.timerID = null;
  });

  function resumeGame() {
  if (!paused) return;

  paused = false;
  gameRunning = true;

  // resume timer
  gameTimerID = setInterval(() => {
    elapsedSecs++;
    updateTimerDisplay();

    // level progression
    if (elapsedSecs >= 120 && currentLevel < 3) {
      currentLevel = 3;
      level3Minutes = 0;
      switchMusic();
      showFlash("🔥 Level 3 — Expert Mode!", "good");
    } 
    else if (elapsedSecs >= 60 && currentLevel < 2) {
      currentLevel = 2;
      switchMusic();
      showFlash("⬆ Level 2 — Medium Mode!", "good");
    }

    if (currentLevel === 3) {
      const minsInL3 = Math.floor((elapsedSecs - 120) / 60);
      if (minsInL3 > level3Minutes) {
        level3Minutes = minsInL3;
        showFlash(`⚡ Timer reduced!`, "warn");
      }
    }

  }, 1000);

  // resume spawns
  spawnIntervalID = setInterval(spawnCustomers, 12000);

  // restart customer timers
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
  showFlash("▶ Game resumed", "good");
}

  pauseMusic();
  showFlash("⏸ Game paused", "warn");
}

  spawnIntervalID = setInterval(spawnCustomers, 12000);
  setTimeout(spawnCustomers, 500);

  document.getElementById("play-btn").style.display = "none";
  document.getElementById("stop-btn").style.display = "";
  showFlash("🎮 Game started! Good luck!", "good");
  updateUI();
}

function stopGame() {
  gameRunning = false;
  clearInterval(gameTimerID);
  clearInterval(spawnIntervalID);
  customerSlots.forEach((slot, i) => {
    clearInterval(slot.timerID);
    slot.timerID  = null;
    slot.occupied = false;
    renderCustomerSlot(i);
  });
  stopMusic();
  document.getElementById("stop-btn").style.display = "none";
  document.getElementById("play-btn").style.display = "";
  showFlash("⏹ Game stopped.", "warn");
}

function updateTimerDisplay() {
  const m  = String(Math.floor(elapsedSecs / 60)).padStart(2, "0");
  const s  = String(elapsedSecs % 60).padStart(2, "0");
  const el = document.querySelector(".game-box div:last-child");
  if (el) el.textContent = `⏱ ${m}:${s}`;
}

// ── Music ─────────────────────────────────────────────────────

function switchMusic() {
  if (currentLevel === 3) {
    bgMusic.src = "monopoly-man.mp3";
  } else {
    bgMusic.src = "the-bakery.mp3";
  }
  bgMusic.play().catch(() => {});
}

function startMusic() {
  switchMusic();
}

function stopMusic() {
  bgMusic.pause();
  bgMusic.currentTime = 0;
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
