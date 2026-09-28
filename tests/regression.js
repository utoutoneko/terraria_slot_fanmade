#!/usr/bin/env node
// Regression suite for TERRARIA SLOTS. Spins up a local static server, drives the real
// page with Playwright, and checks the UI/economy paths that have broken in the past
// (see DEVLOG.md) or are easy to break silently when touching shared code.
//
// Setup (once):  npm install
// Run:           npm test        (or: node tests/regression.js)
//
// Each check gets its own fresh page + fresh localStorage. A check fails by throwing;
// any uncaught page/console error during a check also fails it. Exits 1 if anything failed
// (usable as a CI gate later, even though none is wired up yet - see README.md).

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.TEST_PORT ? Number(process.env.TEST_PORT) : 8791;
const BASE_URL = `http://localhost:${PORT}`;
const SAVE_KEY = "mimicslot_terrariajp_save_v3";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon" };

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

async function freshPage(browser, { keepInfoModal = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("ERR_CERT")) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE_URL}/index.html`);
  await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
  await page.reload();
  await page.waitForTimeout(300);
  if (!keepInfoModal) {
    // A wiped localStorage looks like a brand-new player to the game, which auto-opens the
    // guide once (see game.js's isFirstEverVisit) - close it so every other check gets the
    // clean slate it expects. The dedicated onboarding check below opts out of this via
    // keepInfoModal to actually exercise that behavior.
    await page.evaluate(() => document.getElementById("infoModal").classList.remove("show"));
  }
  page.__errors = errors;
  return page;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// ---- UI click-through: every modal/decoration a player can open ----
check("info guide modal opens/closes", async (page) => {
  await page.click("#infoBtn"); await page.waitForTimeout(80);
  assert(await page.evaluate(() => document.getElementById("infoModal").classList.contains("show")), "did not open");
  await page.click("#infoClose");
});
check("sound toggle", async (page) => {
  await page.click("#soundBtn"); await page.waitForTimeout(50);
  assert(await page.evaluate(() => !state.sound), "sound flag did not flip");
});
check("language toggle", async (page) => {
  await page.click("#langBtn"); await page.waitForTimeout(50);
  assert((await page.evaluate(() => state.lang)) === "en", "lang did not switch to en");
});
check("mana star spends mana", async (page) => {
  await page.evaluate(() => { state.mana = 1; updateHudStrip(); });
  await page.click("#starsRow"); await page.waitForTimeout(50);
  assert((await page.evaluate(() => state.mana)) === 0, "mana was not spent");
});
check("bet +/- changes bet", async (page) => {
  const before = await page.evaluate(() => betIndex);
  await page.click("#betUp"); await page.waitForTimeout(50);
  assert((await page.evaluate(() => betIndex)) !== before, "betIndex unchanged");
});
check("spin runs and increments totalSpins", async (page) => {
  await page.evaluate(() => { state.balance = 1000000; renderBalance(true); });
  await page.click("#spinBtn");
  await page.waitForFunction(() => !spinning, null, { timeout: 8000 });
  assert((await page.evaluate(() => state.totalSpins)) >= 1, "totalSpins did not increment");
});
check("dig minigame opens and a tile is clickable", async (page) => {
  await page.click("#digToggle"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("digModal").classList.contains("show")), "dig modal did not open");
  const tileCount = await page.evaluate(() => document.querySelectorAll(".digtile").length);
  assert(tileCount > 0, "no dig tiles rendered");
  await page.click(".digtile"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => digState.tiles[0].done), "clicking a tile did not mark it done");
  await page.click("#digClose");
});
check("ghost hunt minigame opens", async (page) => {
  await page.click("#torchGameBtn"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("ghostModal").classList.contains("show")), "ghost modal did not open");
  await page.click("#ghostClose");
});
check("coin pile opens paytable", async (page) => {
  await page.click("#coinPile"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("payModal").classList.contains("show")), "paytable did not open");
  await page.click("#payClose");
});
check("sign opens achievement list (104 entries, 11 pages)", async (page) => {
  await page.click("#standSign"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("achBubble").classList.contains("show")), "achievement bubble did not open");
  assert((await page.evaluate(() => ACHIEVEMENT_DEFS.length)) === 104, "expected exactly 104 achievements");
  const pageLabel = await page.evaluate(() => document.querySelector(".ach-pagenum").textContent.trim());
  assert(pageLabel === "1 / 11", `expected page "1 / 11", got "${pageLabel}"`);
});
check("table opens chat log", async (page) => {
  await page.click("#grassTable"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("chatPanel").classList.contains("show")), "chat panel did not open");
});
check("merchant opens shop", async (page) => {
  await page.click("#shopToggleBtn"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("shopModal").classList.contains("show")), "shop modal did not open");
  await page.click("#shopModalClose");
});
check("mushroom opens dev diary", async (page) => {
  await page.click("#decoMushroom"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("devlogModal").classList.contains("show")), "dev diary did not open");
  await page.click("#devlogClose");
});
check("tree opens changelog", async (page) => {
  await page.click("#decoTree"); await page.waitForTimeout(100);
  assert(await page.evaluate(() => document.getElementById("changelogModal").classList.contains("show")), "changelog did not open");
});
// Known flaky: the moon's position follows a real-time day/night cycle, so depending on the
// exact moment this runs it can occasionally sit behind another decoration (e.g. the tree) and
// intercept the click instead. Not a regression - just re-run if only this one fails.
check("moon click counts toward its hidden achievement", async (page) => {
  await page.evaluate(() => { document.getElementById("skyMoon").style.opacity = "1"; });
  await page.click("#skyMoon"); await page.waitForTimeout(50);
  assert((await page.evaluate(() => state.moonClicks || 0)) >= 1, "moonClicks did not increment");
});
check("reset button restores default balance", async (page) => {
  await page.click("#resetBtn2"); await page.waitForTimeout(150);
  assert((await page.evaluate(() => state.balance)) === 100000, "balance was not reset to default");
});
check("first-ever visit auto-opens the guide; later visits and existing saves do not", async (page, browser) => {
  assert(await page.evaluate(() => document.getElementById("infoModal").classList.contains("show")), "guide did not auto-open on first visit");
  await page.click("#infoClose");
  await page.reload();
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => document.getElementById("infoModal").classList.contains("show"))), "guide reopened on a later visit");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ balance: 999, totalSpins: 500 })), SAVE_KEY);
  await page.reload();
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => document.getElementById("infoModal").classList.contains("show"))), "guide auto-opened for a pre-existing (veteran) save");
});

// ---- Economy / logic checks: the numbers actually have to be right ----
check("kakuhen re-trigger while active extends remaining instead of resetting", async (page) => {
  await page.evaluate(() => { kakuhenRemaining = 2; state.streak = 2; updateKakuUI(); });
  await page.evaluate(() => {
    window.__origWFG = weightedFinalGrid;
    weightedFinalGrid = function () {
      const s = SYMBOLS[SYMBOLS.length - 1];
      const grid = [[], [], []];
      for (let c = 0; c < 3; c++) { grid[c][0] = { sym: SYMBOLS[0], variant: 0 }; grid[c][1] = { sym: s, variant: 0 }; grid[c][2] = { sym: SYMBOLS[0], variant: 0 }; }
      return grid;
    };
    state.balance = 1000000;
  });
  await page.click("#spinBtn");
  await page.waitForFunction(() => !spinning, null, { timeout: 8000 });
  // was 2, decremented to 1 by this spin, then the streak-3 trigger should ADD 5 (not reset to 5)
  assert((await page.evaluate(() => kakuhenRemaining)) === 6, `expected kakuhenRemaining=6 after extend, got ${await page.evaluate(() => kakuhenRemaining)}`);
});
check("bottle re-use while active extends remaining and never downgrades the multiplier", async (page) => {
  await page.evaluate(() => { state.bottles = 2; state.superBottles = 1; bottleBuffRemaining = 0; renderBottleUI(); });
  await page.click("#useBottleSlot");
  const first = await page.evaluate(() => ({ remaining: bottleBuffRemaining, mult: bottleBuffMult }));
  assert(first.remaining === 5 && first.mult === 3, `expected first use to be 5/3x, got ${JSON.stringify(first)}`);
  await page.click("#useBottleSlot");
  const second = await page.evaluate(() => ({ remaining: bottleBuffRemaining, mult: bottleBuffMult }));
  assert(second.remaining === 10 && second.mult === 3, `expected stacked use to be 10/3x (not downgraded), got ${JSON.stringify(second)}`);
});
check("Defender Medals cap at 9999 and don't spam the cap toast", async (page) => {
  const messages = [];
  await page.evaluate(() => { window.__msgs = []; const orig = showToast; showToast = (m) => { window.__msgs.push(m); return orig(m); }; });
  await page.evaluate(() => { state.defenderMedals = 9999; state.balance = 20000 * 1000000; state.medalCapToastShown = false; for (let i = 0; i < 5; i++) renderBalance(true); });
  const medals = await page.evaluate(() => state.defenderMedals);
  const msgs = await page.evaluate(() => window.__msgs.filter((m) => /9999/.test(m)));
  assert(medals === 9999, `medals should stay capped at 9999, got ${medals}`);
  assert(msgs.length === 1, `expected exactly 1 cap-warning toast across 5 calls, got ${msgs.length}`);
});
check("Zenith line win and assemble bonus pay the exact configured multipliers", async (page) => {
  await page.evaluate(() => {
    state.defenderMedals = 300; state.themeUnlocked = { mimic: true, slime: true, zombie: true, zenith: true };
    state.activeTheme = "zenith"; switchTheme("zenith"); state.balance = 100000000; state.streak = 0; betIndex = 3; state.betIndex = 3;
  });
  const bet = await page.evaluate(() => currentBet());
  const mult = await page.evaluate(() => ZENITH_SYMBOLS.find((s) => s.id === "zenith_terrablade").mult);
  await page.evaluate((symMult) => {
    const sym = ZENITH_SYMBOLS.find((s) => s.id === "zenith_terrablade");
    const filler = ZENITH_SYMBOLS.filter((s) => s.id !== sym.id);
    weightedFinalGrid = function () {
      const grid = [[], [], []];
      for (let c = 0; c < 3; c++) { grid[c][0] = { sym: filler[c], variant: 0 }; grid[c][1] = { sym, variant: 0 }; grid[c][2] = { sym: filler[c + 3] || filler[0], variant: 0 }; }
      return grid;
    };
  }, mult);
  const before = await page.evaluate(() => state.balance);
  await page.click("#spinBtn");
  await page.waitForFunction(() => !spinning, null, { timeout: 8000 });
  const after = await page.evaluate(() => state.balance);
  assert(after - before === bet * mult - bet, `expected net +${bet * mult - bet}, got +${after - before}`);

  await page.evaluate(() => {
    weightedFinalGrid = function () {
      return ZENITH_SYMBOLS.reduce((acc, s, i) => { const c = i % 3; if (!acc[c]) acc[c] = []; acc[c].push({ sym: s, variant: 0 }); return acc; }, []);
    };
  });
  const assembleMult = await page.evaluate(() => ZENITH_ASSEMBLE_MULT);
  const beforeAssemble = await page.evaluate(() => state.balance);
  await page.click("#spinBtn");
  await page.waitForFunction(() => !spinning, null, { timeout: 8000 });
  const afterAssemble = await page.evaluate(() => state.balance);
  assert(afterAssemble - beforeAssemble === bet * assembleMult - bet, `expected assemble net +${bet * assembleMult - bet}, got +${afterAssemble - beforeAssemble}`);
});
check("theme unlock cost badge matches THEME_DEFS (regression: was hardcoded stale in index.html)", async (page) => {
  await page.evaluate(() => { renderThemeGrid(); document.getElementById("themeModal").classList.add("show"); });
  const shown = await page.evaluate(() => document.querySelector("#theme_zenith .themecost").textContent.trim());
  const real = await page.evaluate(() => THEME_DEFS.zenith.unlockCost);
  assert(shown === String(real), `badge shows ${shown} but THEME_DEFS.zenith.unlockCost is ${real}`);
});
check("save export/import round-trips through a file", async (page) => {
  await page.evaluate(() => { state.balance = 123456789; state.defenderMedals = 42; saveState(); document.getElementById("infoBtn").click(); });
  const savePath = path.join(os.tmpdir(), "terraria_slots_regression_save.json");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#exportSaveBtn")]);
  await download.saveAs(savePath);
  await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("infoBtn").click());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('label[for="importSaveInput"]')]);
  await chooser.setFiles(savePath);
  await page.waitForTimeout(500);
  await page.waitForLoadState("load");
  await page.waitForTimeout(300);
  assert((await page.evaluate(() => state.balance)) === 123456789, "balance was not restored from the imported save");
  fs.unlinkSync(savePath);
});
check("secret guide loads lazily on the trigger word and its links don't navigate away", async (page) => {
  const requestsBefore = [];
  page.on("request", (r) => { if (r.url().includes("secretguide_data.js")) requestsBefore.push(r.url()); });
  await page.waitForTimeout(100);
  assert(requestsBefore.length === 0, "secretguide_data.js was fetched before being triggered");
  for (const ch of "utoutoneko") await page.keyboard.press(ch);
  await page.waitForTimeout(700);
  assert(await page.evaluate(() => document.getElementById("secretGuideModal").classList.contains("show")), "secret guide did not open");
  const frame = await (await page.$("#secretGuideFrame")).contentFrame();
  await frame.waitForSelector('nav.toc a[href="#ach"]', { timeout: 5000 });
  const urlBefore = page.url();
  await frame.click('nav.toc a[href="#ach"]');
  await page.waitForTimeout(300);
  assert(page.url() === urlBefore, "clicking a guide link navigated the page (regression: srcdoc base-URL bug)");
  const achCount = await frame.evaluate(() => document.querySelectorAll("#ach-body tr").length);
  assert(achCount === 104, `expected 104 achievement rows in the guide, got ${achCount}`);
});
check("quiz minigame: costs medals, pays out on a perfect round, and blocks play when broke", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#quizLaunchBtn");
  await page.waitForSelector("#quizStartBtn", { state: "visible" });
  await page.click("#quizStartBtn");
  for (let i = 0; i < 5; i++) {
    await page.waitForSelector(".quiz-choice", { state: "visible" });
    const correctIdx = await page.evaluate(() => quizSession.questions[quizSession.idx].choices.findIndex((c) => c.correct));
    (await page.$$(".quiz-choice"))[correctIdx].click();
    await page.waitForTimeout(950);
  }
  await page.waitForSelector(".quiz-result", { state: "visible" });
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 62, `expected 50 - 3 (entry) + 15 (perfect reward) = 62 medals, got ${medalsAfter}`);
  assert(await page.evaluate(() => !!state.achievements.quizPerfect), "quizPerfect achievement did not unlock on a 5/5 round");
  assert(!(await page.evaluate(() => !!state.achievements.firstWin)), "regression: playing the quiz alone must not unlock the spin-based firstWin achievement");
  await page.click("#quizRetryBtn");
  await page.evaluate(() => { state.defenderMedals = 0; saveState(); renderBalance(); });
  const introHtml = await page.evaluate(() => { renderQuizIntro(); return document.getElementById("quizStartBtn").disabled; });
  assert(introHtml === true, "quiz start button should be disabled with 0 Defender Medals");
});
check("fishing minigame: costs medals, a forced-mythic catch pays the right amount, and a missed bite still costs the entry fee", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#fishLaunchBtn");
  await page.waitForSelector("#fishCastBtn", { state: "visible" });
  await page.evaluate(() => { pickFishTier = () => FISH_TIERS.find((t) => t.key === "mythic"); });
  await page.click("#fishCastBtn");
  const afterCast = await page.evaluate(() => state.defenderMedals);
  assert(afterCast === 42, `expected 50 - 8 (entry fee) = 42 medals right after casting, got ${afterCast}`);
  await page.waitForSelector("#fishHookBtn", { state: "visible", timeout: 5000 });
  await page.click("#fishHookBtn", { force: true });
  await page.waitForSelector("#fishReelBtn", { state: "visible" });
  let hits = 0, guard = 0;
  while (hits < 2 && guard < 300) {
    const inZone = await page.evaluate(() => {
      const s = fishSession;
      return !!(s && s.stage === "reel" && s.segment >= s.zoneStart && s.segment < s.zoneStart + s.tier.zoneSize);
    });
    if (inZone) { await page.click("#fishReelBtn"); hits++; await page.waitForTimeout(150); } else { await page.waitForTimeout(30); }
    guard++;
  }
  await page.waitForSelector(".fish-result", { state: "visible" });
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 62, `expected 42 + 20 (mythic reward) = 62 medals, got ${medalsAfter}`);
  assert(await page.evaluate(() => !!state.achievements.fishMythic), "fishMythic achievement did not unlock");
});

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  let failed = 0;
  for (const { name, fn } of checks) {
    const page = await freshPage(browser, { keepInfoModal: name.includes("first-ever visit") });
    try {
      await fn(page, browser);
      if (page.__errors.length) throw new Error("page/console errors: " + page.__errors.join(" | "));
      console.log(`PASS  ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  server.close();
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
