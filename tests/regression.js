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
  assert((await page.evaluate(() => ACHIEVEMENT_DEFS.length)) === 108, "expected exactly 108 achievements");
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
check("Defender Medals auto-convert overflow into Etherian Mana, always leaving the 1000-medal reserve", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 500; state.etherianMana = 0; addDefenderMedals(2500); saveState(); renderBalance(); });
  const afterFirst = await page.evaluate(() => ({ medals: state.defenderMedals, mana: state.etherianMana }));
  // 500 + 2500 = 3000 medals; reserve 1000 -> 2000 convertible -> 2 mana, leaving 1000 medals
  assert(afterFirst.medals === 1000, `expected 1000 medals left after auto-convert, got ${afterFirst.medals}`);
  assert(afterFirst.mana === 2, `expected 2 Etherian Mana gained, got ${afterFirst.mana}`);
  const manaCoinVisible = await page.evaluate(() => !!document.getElementById("coinMana"));
  assert(manaCoinVisible, "the Etherian Mana balance-bar coin should appear once mana > 0");
  const converted = await page.evaluate(() => convertManaToMedals(1));
  const afterConvert = await page.evaluate(() => ({ medals: state.defenderMedals, mana: state.etherianMana }));
  assert(converted === true, "convertManaToMedals should report success when enough mana is available");
  assert(afterConvert.medals === 2000, `expected 2000 medals after converting 1 mana back, got ${afterConvert.medals}`);
  assert(afterConvert.mana === 1, `expected 1 Etherian Mana remaining, got ${afterConvert.mana}`);
  const failedConvert = await page.evaluate(() => convertManaToMedals(99));
  assert(failedConvert === false, "converting more mana than owned should fail rather than go negative");
});
check("regression: a returning save already past the platinum auto-convert threshold must not crash on load", async (page) => {
  // Found 2026-09-29 via a real player report of saves "breaking" - freeSpinsRemaining/bottleBuffRemaining/
  // bottleBuffMult/kakuhenRemaining/manaPurifyNextSpin/lastRealBet were declared with `let`, so
  // saveState()'s `typeof x!=="undefined"` guard (meant to fall back to state.x before game.js finishes
  // initializing) sat in the temporal dead zone instead of safely evaluating to "undefined", and threw
  // a ReferenceError. This fired for real whenever checkPlatinumAutoConvert() ran from the very first
  // renderBalance() call in game.js's own init sequence (line ~301) - which happens for any save whose
  // balance is already at/above the 10,000-platinum auto-convert threshold, i.e. exactly the returning
  // whale-tier players this game's RTP curve is designed to produce. The crash was silent (uncaught,
  // pre-console-listener) and halted the rest of that script's top-level init, which is what "breaks and
  // stops responding" looked like in the wild. Fixed by switching those six to `var` (hoisted as
  // `undefined`, never TDZ). This check sets a huge balance directly into localStorage *before* the page
  // ever loads, so the crash-prone code path runs during real page init, not a later evaluate() call.
  const hugeSave = { balance: 1e18, defenderMedals: 99999999, etherianMana: 123456789, achievements: {}, themeUnlocked: { mimic: true, slime: true, zombie: true, zenith: true }, activeTheme: "mimic" };
  await page.evaluate(({ key, obj }) => { localStorage.setItem(key, JSON.stringify(obj)); }, { key: SAVE_KEY, obj: hugeSave });
  await page.reload();
  await page.waitForTimeout(500);
  assert(page.__errors.length === 0, `loading a save already past the auto-convert threshold must not throw, got: ${page.__errors.join(" | ")}`);
  const balance = await page.evaluate(() => state.balance);
  assert(typeof balance === "number" && !Number.isNaN(balance), `state.balance should be a real number after load, got ${balance}`);
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
  assert(achCount === 108, `expected 108 achievement rows in the guide, got ${achCount}`);
});
check("minigame unlock gate: locked by default, costs medals once via a confirm dialog, then stays unlocked", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 10; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  const lockedBefore = await page.evaluate(() => document.getElementById("quizLaunchBtn").classList.contains("locked"));
  assert(lockedBefore, "quiz should be locked by default on a fresh save");
  // Not enough medals for the 25-medal unlock cost: confirming should not open the game or deduct medals.
  await page.click("#quizLaunchBtn");
  const stillLockedAndUnspent = await page.evaluate(() => ({ medals: state.defenderMedals, unlocked: !!(state.minigameUnlocked && state.minigameUnlocked.quiz) }));
  assert(stillLockedAndUnspent.medals === 10 && !stillLockedAndUnspent.unlocked, "declining/failing the unlock must not spend medals or unlock the game");
  await page.evaluate(() => { state.defenderMedals = 100; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#quizLaunchBtn"); // dialog auto-accepted by freshPage's page.on("dialog", d => d.accept())
  await page.waitForSelector("#quizModal.show", { state: "visible" });
  const afterUnlock = await page.evaluate(() => ({ medals: state.defenderMedals, unlocked: !!(state.minigameUnlocked && state.minigameUnlocked.quiz) }));
  assert(afterUnlock.medals === 75, `expected 100 - 25 (unlock cost) = 75 medals, got ${afterUnlock.medals}`);
  assert(afterUnlock.unlocked, "quiz should be marked unlocked in state after paying the cost");
  await page.click("#quizModalClose");
  await page.click("#shopToggleBtn");
  const lockedAfter = await page.evaluate(() => document.getElementById("quizLaunchBtn").classList.contains("locked"));
  assert(!lockedAfter, "quiz launch button should lose its locked styling once unlocked");
});
check("minigames using non-Terraria placeholder art (fishing/draw/roulette) are paused; quiz/coinflip stay playable", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 100000; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  const flags = await page.evaluate(() => ({
    fishing: document.getElementById("fishLaunchBtn").disabled,
    draw: document.getElementById("drawLaunchBtn").disabled,
    roulette: document.getElementById("rouletteLaunchBtn").disabled,
    quiz: document.getElementById("quizLaunchBtn").disabled,
    coinflip: document.getElementById("coinflipLaunchBtn").disabled,
  }));
  assert(flags.fishing && flags.draw && flags.roulette, "fishing/draw/roulette must stay disabled while they use non-Terraria placeholder art");
  assert(!flags.quiz && !flags.coinflip, "quiz and coinflip use real Terraria material (or none) and must remain playable");
  await page.evaluate(() => document.getElementById("fishLaunchBtn").click());
  const stillClosed = await page.evaluate(() => !document.getElementById("fishModal").classList.contains("show"));
  assert(stillClosed, "a paused minigame's button is natively disabled and must not open its modal even if force-clicked");
});
check("quiz minigame: costs medals, the per-question timer counts a timeout as wrong, pays out correctly, and blocks play when broke", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { quiz: true }; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#quizLaunchBtn");
  await page.waitForSelector("#quizStartBtn", { state: "visible" });
  await page.click("#quizStartBtn");
  await page.waitForSelector(".quiz-choice", { state: "visible" });
  // Regression check for the 2026-09-28 difficulty pass: let the first question's real 8s timer
  // run out untouched, and confirm it resolves exactly like a wrong answer (auto-advances, does
  // not count as correct) instead of stalling or crashing.
  await page.waitForSelector(".quiz-choice:disabled", { state: "attached", timeout: 9000 });
  const correctAfterTimeout = await page.evaluate(() => quizSession.correct);
  assert(correctAfterTimeout === 0, `a timed-out question must not count as correct, got correct=${correctAfterTimeout}`);
  await page.waitForTimeout(950);
  for (let i = 0; i < 4; i++) {
    await page.waitForSelector(".quiz-choice", { state: "visible" });
    const correctIdx = await page.evaluate(() => quizSession.questions[quizSession.idx].choices.findIndex((c) => c.correct));
    (await page.$$(".quiz-choice"))[correctIdx].click();
    await page.waitForTimeout(950);
  }
  await page.waitForSelector(".quiz-result", { state: "visible" });
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 54, `expected 50 - 3 (entry) + 7 (4/5 reward, first question timed out) = 54 medals, got ${medalsAfter}`);
  assert(!(await page.evaluate(() => !!state.achievements.firstWin)), "regression: playing the quiz alone must not unlock the spin-based firstWin achievement");
  await page.click("#quizRetryBtn");
  await page.evaluate(() => { state.defenderMedals = 0; saveState(); renderBalance(); });
  const introHtml = await page.evaluate(() => { renderQuizIntro(); return document.getElementById("quizStartBtn").disabled; });
  assert(introHtml === true, "quiz start button should be disabled with 0 Defender Medals");
});
check("quiz minigame: a genuine 5/5 (no timeouts) unlocks the quizPerfect achievement", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { quiz: true }; saveState(); renderBalance(); });
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
  assert(await page.evaluate(() => !!state.achievements.quizPerfect), "quizPerfect achievement did not unlock on a real 5/5 round");
});
check("fishing minigame: costs medals, a forced-mythic catch pays the right amount, and a missed bite still costs the entry fee", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { fishing: true }; MINIGAME_DEFS.find((d) => d.key === "fishing").unavailable = false; saveState(); renderBalance(); });
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
  // Force the marker onto the zone and call the real attemptReel() synchronously (no DOM click
  // round-trip) for each of the 3 needed hits - deterministic, since polling+clicking real segment
  // state left a small race window against the live 190ms marker tick that occasionally cost a hit.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { if (fishSession && fishSession.stage === "reel") { fishSession.segment = fishSession.zoneStart; attemptReel(); } });
  }
  await page.waitForSelector(".fish-result", { state: "visible" });
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 62, `expected 42 + 20 (mythic reward) = 62 medals, got ${medalsAfter}`);
  assert(await page.evaluate(() => !!state.achievements.fishMythic), "fishMythic achievement did not unlock");
});
check("lucky draw (kuji/gacha/garapon unified): costs medals, a forced jackpot pays the right amount", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { draw: true }; MINIGAME_DEFS.find((d) => d.key === "draw").unavailable = false; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#drawLaunchBtn");
  await page.waitForSelector("#drawStartBtn", { state: "visible" });
  await page.evaluate(() => { pickDrawTier = () => DRAW_TIERS.find((t) => t.key === "jackpot"); });
  await page.click("#drawStartBtn");
  await page.waitForTimeout(1000);
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 86, `expected 50 - 4 (entry fee) + 40 (jackpot reward) = 86 medals, got ${medalsAfter}`);
  assert(await page.evaluate(() => !!state.achievements.drawJackpot), "drawJackpot achievement did not unlock");
});
check("coin flip: chained wins compound the pot at x1.9, a loss wipes it, cash-out banks the medals", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { coinflip: true }; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#coinflipLaunchBtn");
  await page.waitForSelector(".coinflip-stakebtns button", { state: "visible" });
  await page.evaluate(() => { Math.random = () => 0; }); // forces a win (0 < 0.5) every flip
  const stakeBtns = await page.$$(".coinflip-stakebtns button");
  await stakeBtns[1].click(); // stake = 5
  await page.waitForSelector("#coinflipFlipBtn", { state: "visible" });
  await page.click("#coinflipFlipBtn");
  await page.waitForTimeout(750);
  await page.click("#coinflipFlipBtn");
  await page.waitForTimeout(750);
  await page.click("#coinflipCashBtn");
  await page.waitForTimeout(150);
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 63, `expected 45 (after 5-medal stake) + floor(5*1.9*1.9)=18 = 63 medals, got ${medalsAfter}`);
  // now verify a loss wipes the whole pot instead of just the stake
  await page.evaluate(() => { renderCoinflipIntro(); });
  await page.waitForSelector(".coinflip-stakebtns button", { state: "visible" });
  await page.evaluate(() => { Math.random = () => 0.99; }); // forces a loss
  const stakeBtns2 = await page.$$(".coinflip-stakebtns button");
  await stakeBtns2[0].click(); // stake = 2
  await page.waitForSelector("#coinflipFlipBtn", { state: "visible" });
  const afterStake2 = await page.evaluate(() => state.defenderMedals);
  await page.click("#coinflipFlipBtn");
  await page.waitForTimeout(750);
  const medalsFinal = await page.evaluate(() => state.defenderMedals);
  assert(medalsFinal === afterStake2, `a loss should not deduct further beyond the already-staked amount (${afterStake2}), got ${medalsFinal}`);
});
check("roulette: matches real European-wheel color mapping and pays out red/black bets 1:1", async (page) => {
  await page.evaluate(() => { state.defenderMedals = 50; state.minigameUnlocked = { roulette: true }; MINIGAME_DEFS.find((d) => d.key === "roulette").unavailable = false; saveState(); renderBalance(); });
  await page.click("#shopToggleBtn");
  await page.click("#rouletteLaunchBtn");
  await page.waitForSelector(".roulette-stake button", { state: "visible" });
  const spinDisabledInitially = await page.evaluate(() => document.getElementById("rouletteSpinBtn").disabled);
  assert(spinDisabledInitially, "spin button should start disabled before a stake and bet type are chosen");
  const stakeBtns = await page.$$(".roulette-stake button");
  await stakeBtns[0].click(); // stake = 5
  const betBtns = await page.$$(".roulette-bettype button");
  await betBtns[0].click(); // "red"
  await page.evaluate(() => { Math.random = () => (1 / 37) + 0.001; }); // forces n=1, a red number
  await page.click("#rouletteSpinBtn");
  await page.waitForTimeout(1300);
  const medalsAfter = await page.evaluate(() => state.defenderMedals);
  assert(medalsAfter === 55, `expected 50 - 5 (stake) + 10 (1:1 payout on a 5-medal red bet) = 55 medals, got ${medalsAfter}`);
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
