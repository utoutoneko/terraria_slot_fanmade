const AUD = {};
Object.entries(AUDIO_SRC).forEach(([k,src])=>{ const a=new Audio(src); a.preload="auto"; AUD[k]=a; });
let actx=null;
function ac(){ if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)(); return actx; }
// Decoded Web Audio buffers, keyed the same as AUDIO_SRC/AUD. A cloneNode()+play() HTMLAudioElement
// has to re-decode the OGG payload on every single call, which adds tens-to-hundreds of ms of
// unpredictable latency between a game event (reel stop, win reveal) and the sound actually starting.
// Decoding once into an AudioBuffer up front lets playback start at sample-accurate time via
// AudioBufferSourceNode.start(0), which is effectively latency-free. AUD/cloneNode stays only as a
// fallback for the brief window (a few ms) before decoding finishes on page load.
const SFX_BUFFERS = {};
function base64ToArrayBuffer(dataUri){
  const base64 = dataUri.slice(dataUri.indexOf(",")+1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer;
}
(function decodeAllSfx(){
  const ctx = ac();
  Object.entries(AUDIO_SRC).forEach(([k,src])=>{
    ctx.decodeAudioData(base64ToArrayBuffer(src), buf=>{ SFX_BUFFERS[k]=buf; }, ()=>{});
  });
})();
let audioUnlocked=false;
function unlockAudio(){
  if(audioUnlocked) return; audioUnlocked=true;
  // Play-and-immediately-pause every sample once, synchronously inside the user gesture,
  // so later play() calls from setTimeout callbacks are not blocked by autoplay policy.
  Object.values(AUD).forEach(a=>{ a.volume=0; const p=a.play(); if(p&&p.catch) p.then(()=>{a.pause();a.currentTime=0;a.volume=0.7;}).catch(()=>{}); });
  try{ if(actx && actx.state==="suspended") actx.resume(); }catch(e){}
  document.removeEventListener("pointerdown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio, {once:true});
function playReal(key, vol){
  if(!state.sound) return;
  const v = vol!=null?vol:0.7;
  const buf = SFX_BUFFERS[key];
  if(buf){
    const ctx = ac();
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = v;
    src.connect(gain); gain.connect(ctx.destination);
    src.start(0);
    return;
  }
  const base = AUD[key]; if(!base) return;
  const a = base.cloneNode(); a.volume = v;
  a.play().catch(()=>{});
}
function beep(freq,dur,type,vol,delay){ if(!state.sound) return; const ctx=ac(); const t0=ctx.currentTime+(delay||0);
  const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type=type||"square"; osc.frequency.setValueAtTime(freq,t0);
  gain.gain.setValueAtTime(0.0001,t0); gain.gain.exponentialRampToValueAtTime(vol||0.15,t0+0.015); gain.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  osc.connect(gain); gain.connect(ctx.destination); osc.start(t0); osc.stop(t0+dur+0.02); }
function sfxTick(){ playReal("hit", 0.12); }
function sfxStop(){ playReal("hit",0.5); }
function sfxCoin(pitchMul){ const key=["coin0","coin1","coin2"][Math.floor(Math.random()*3)]; playReal(key, 0.55*(pitchMul||1)); }
// Themed win-reveal sound per active theme (Terraria Wiki sourced for zombie/zenith; slime
// reuses the existing "grab" sound - a genuinely slime-specific effect wasn't separately filed
// on the wiki, see ASSETS_CREDITS.md/DEVLOG.md for the detail). Mimic keeps its original sound.
function sfxPop(){
  if(state.activeTheme==="zombie") playReal("zombie_growl",0.5);
  else if(state.activeTheme==="zenith") playReal("zenith_swing",0.55);
  else if(state.activeTheme==="slime") playReal("grab",0.5);
  else playReal("unlock",0.55);
}
function sfxChestCreak(){ playReal("doorOpen",0.6); }
function sfxGrab(){ playReal("grab",0.6); }
function sfxBigReveal(){ playReal("reveal",0.7); setTimeout(()=>playReal("doorOpen",0.5),80); }
function sfxJackpot(){ playReal("reveal",0.8); setTimeout(()=>playReal("doorOpen",0.6),100); [0,1,2,3].forEach((i)=>beep(660+i*140,0.16,"square",0.1,0.2+i*0.09)); }
function sfxDig(){ playReal("dig",0.6); }
function sfxGhostCatch(){ playReal("ghostCatch",0.6); }

/* ================= rendering ================= */
const JACKPOT_FEED_RATE = 0.03;      // 3% of every paid bet feeds the mystery pot
const JACKPOT_FEED_RATE_LUCKY = 0.04; // with the Lucky Coin shop item: pool fills faster, same overall RTP
const JACKPOT_TRIGGER_CHANCE = 0.0009; // flat chance per paid spin to pop the mystery pot
const JACKPOT_SEED = 5000;             // reseed value (50 silver) after it pops
const SCATTER_MIN = 3;
const FREE_SPINS_AWARD = 5;
const FREE_SPINS_MULT = 2;

const KAKU_SPINS = 5;      // bonus mode length (spins)
const KAKU_MULT = 1.5;     // payout multiplier during bonus mode
const PITY_LIMIT = 100;    // paid spins without bonus mode before it is forced ("tenjou")
const KAKU_STREAK_TRIGGER = 3;
const ZENITH_ASSEMBLE_MULT = 9400; // flat bet multiplier when all 9 Zenith swords land at once

// Restored from state (not just defaulted to 0) so an in-progress bonus round, free-spin streak
// or bottle buff survives a tab refresh instead of silently vanishing - saveState() below keeps
// these three synced back into state on every save.
let freeSpinsRemaining = state.freeSpinsRemaining||0;
let bottleBuffRemaining = state.bottleBuffRemaining||0;
let bottleBuffMult = state.bottleBuffMult||2;
let kakuhenRemaining = state.kakuhenRemaining||0;
function updateKakuUI(){
  const on = kakuhenRemaining>0;
  kakuBadge.classList.toggle("show", on);
  kakuLeft.textContent = kakuhenRemaining; kakuLeftEn.textContent = kakuhenRemaining;
  document.getElementById("kakuMult").textContent = KAKU_MULT; document.getElementById("kakuMultEn").textContent = KAKU_MULT;
  document.getElementById("spinIcon").src = on ? SPR.cursor : SPR.icon_sword;
  const left = Math.max(0, PITY_LIMIT-(state.pityCount||0));
  pitylineEl.textContent = on ? "" : (state.lang==="en" ? `Bonus guaranteed in ${left} spins` : `確変まで あと${left}回転(天井)`);
}
function startKakuhen(reasonJa, reasonEn, viaPity){
  kakuhenRemaining = KAKU_SPINS; state.pityCount = 0; state.kakuhenTriggers=(state.kakuhenTriggers||0)+1;
  updateKakuUI();
  showBanner(state.lang==="en" ? "BONUS MODE!" : "確変突入!!", 1800);
  showToast(state.lang==="en" ? reasonEn : reasonJa);
  spawnParticles("rainbow",12); sfxBigReveal();
  if(viaPity) unlockAch("kakuhenPity");
}
function renderBottleUI(){
  const total = (state.bottles||0) + (state.superBottles||0);
  bottleCountEl.textContent = total;
  useBottleBtn.disabled = !(total>0) || bottleBuffRemaining>0;
}
function updateBottleBuffBadge(){
  if(bottleBuffRemaining>0){ bottleBuffBadge.classList.add("show"); bbLeft.textContent=bottleBuffRemaining; bbLeftEn.textContent=bottleBuffRemaining; }
  else { bottleBuffBadge.classList.remove("show"); }
  updateHudStrip();
}
// Fallback only matters if free spins are somehow active before any real spin this session -
// which is now reachable since freeSpinsRemaining survives a reload (see saveState()). The old
// "*SILVER" here was a latent bug (100x too large) that stayed dormant only because this path
// used to be unreachable before that persistence fix.
let lastRealBet = state.lastRealBet || BET_STEPS[betIndex];

let displayedJackpot = state.jackpotPool;
let jackpotAnimGen=0;
function renderJackpot(instant){
  const target = state.jackpotPool;
  jackpotAnimGen++;
  const myGen=jackpotAnimGen;
  if(instant){ displayedJackpot=target; jpVal.textContent=formatCoins(target); return; }
  const start=displayedJackpot, diff=target-start;
  if(diff===0){ jpVal.textContent=formatCoins(target); displayedJackpot=target; return; }
  const dur=500, t0=performance.now();
  function step(t){
    if(myGen!==jackpotAnimGen) return;
    const p=Math.min(1,(t-t0)/dur); jpVal.textContent=formatCoins(start+diff*p);
    if(p<1) requestAnimationFrame(step); else { displayedJackpot=target; jpVal.classList.add("bump"); setTimeout(()=>jpVal.classList.remove("bump"),320); }
  }
  requestAnimationFrame(step);
}
function updateFreeSpinBadge(){
  if(freeSpinsRemaining>0){
    freespinBadge.classList.add("show");
    fsLeft.textContent=freeSpinsRemaining; fsLeftEn.textContent=freeSpinsRemaining;
  } else {
    freespinBadge.classList.remove("show");
  }
  updateHudStrip();
}
function updateStreakLine(){
  if(state.streak>=2){
    const bonusPct = Math.min(state.streak-1,10)*10;
    streaklineEl.innerHTML = state.lang==="en"
      ? `🔥 ${state.streak} win streak (+${bonusPct}%)`
      : `🔥 ${state.streak}連勝中 (配当+${bonusPct}%)`;
  } else {
    streaklineEl.textContent = "";
  }
  updateHudStrip();
}
function updateHudStrip(){
  const heartImgs = heartsRowEl.querySelectorAll("img");
  const filled = Math.min(state.streak||0, heartImgs.length);
  heartImgs.forEach((im,i)=>im.classList.toggle("empty", i>=filled));
  // stars now represent MANA (collected from falling stars at night)
  const starImgs = starsRowEl.querySelectorAll("img");
  const manaFilled = Math.min(state.mana||0, starImgs.length);
  starImgs.forEach((im,i)=>{ im.classList.toggle("empty", i>=manaFilled); im.classList.toggle("active", i<manaFilled); });
  starsRowEl.style.cursor = (state.mana>0) ? "pointer" : "default";
}

let displayedBalance=state.balance;
let balanceAnimGen=0;
const MEDAL_RATE = 1000*PLATINUM, PLATINUM_KEEP_ON_CONVERT = 1000*PLATINUM, PLATINUM_AUTOCONVERT_AT = 10000*PLATINUM;
function checkPlatinumAutoConvert(){
  // Terraria caps each coin denomination at 9999, so a platinum count can't realistically climb
  // forever. Once balance would hit 10,000 platinum, auto-convert everything above a 1,000
  // platinum reserve into Defender Medals (1,000 platinum = 1 medal) - a real Terraria currency,
  // repurposed here as the shop currency for unlocking other slot themes.
  if(state.balance < PLATINUM_AUTOCONVERT_AT) return;
  if(!state.themeBtnUnlocked){ state.themeBtnUnlocked = true; updateThemeBtnVisibility(); }
  const convertible = state.balance - PLATINUM_KEEP_ON_CONVERT;
  const medals = Math.floor(convertible/MEDAL_RATE);
  if(medals<=0) return;
  state.balance -= medals*MEDAL_RATE;
  state.defenderMedals = (state.defenderMedals||0)+medals;
  saveState();
  showToast(state.lang==="en" ? `Coins capped out - converted to +${medals} Defender Medal${medals>1?"s":""}!` : `所持金が上限に達し、防衛メダル+${medals}枚に変換されました!`);
}
function renderBalance(instant){
  checkPlatinumAutoConvert();
  const target=state.balance;
  balanceAnimGen++;
  const myGen=balanceAnimGen;
  if(instant){ displayedBalance=target; paintBalance(target); return; }
  const start=displayedBalance, diff=target-start;
  if(diff===0){ paintBalance(target); displayedBalance=target; return; }
  const dur=650, t0=performance.now();
  function step(t){
    if(myGen!==balanceAnimGen) return; // a newer render call has superseded this one
    const p=Math.min(1,(t-t0)/dur); const eased=1-Math.pow(1-p,3); paintBalance(Math.round(start+diff*eased));
    if(p<1) requestAnimationFrame(step); else { displayedBalance=target; }
  }
  requestAnimationFrame(step);
}
let lastCoins={p:-1,g:-1,s:-1,c:-1};
let toastTimer=null; // declared early: renderBalance()'s auto-convert check can call showToast() during page-load init
function paintBalance(v){
  const {p,g,s,c}=toCoins(Math.max(0,v));
  balanceBar.innerHTML = `
    <div class="coin" id="coinP"><img class="spr" src="${SPR.coin_platinum}" style="width:17px;height:20px">${p}</div>
    <div class="coin" id="coinG"><img class="spr" src="${SPR.coin_gold}" style="width:15px;height:20px">${g}</div>
    <div class="coin" id="coinS"><img class="spr" src="${SPR.coin_silver}" style="width:15px;height:17px">${s}</div>
    <div class="coin" id="coinC"><img class="spr" src="${SPR.coin_copper}" style="width:15px;height:15px">${c}</div>
    <div class="coin" id="coinMedal" title="${state.lang==="en"?"Defender Medals":"防衛メダル"}"><img class="spr" src="${SPR.icon_defendermedal}" style="width:16px;height:16px">${state.defenderMedals||0}</div>`;
  if(p>lastCoins.p) document.getElementById("coinP").classList.add("bump");
  if(g>lastCoins.g) document.getElementById("coinG").classList.add("bump");
  if(s>lastCoins.s) document.getElementById("coinS").classList.add("bump");
  lastCoins={p,g,s,c};
}
function renderBet(){ const {p,g,s,c}=toCoins(currentBet()); let parts=[]; if(p) parts.push(p+"P"); if(g) parts.push(g+"G"); if(s) parts.push(s+"S"); if(c) parts.push(c+"C"); betAmt.textContent=parts.join(" ")||"0"; }
function applyLang(){ document.body.classList.toggle("lang-en", state.lang==="en"); document.getElementById("langBtn").textContent = state.lang==="en"?"JA":"EN"; }
let chatLog = [];
function setMsg(ja,en,comboJa,comboEn,log){
  msgline.innerHTML = `<span class="hidden-ja">${ja}</span><span class="hidden-en">${en}</span>` + (comboJa? `<span class="combo hidden-ja">${comboJa}</span><span class="combo hidden-en">${comboEn}</span>`:"");
  if(log){
    const line = state.lang==="en" ? en : ja;
    chatLog.push(line);
    if(chatLog.length>30) chatLog.shift();
    if(chatPanel && chatPanel.classList.contains("show")) renderChatLog();
  }
}
function renderChatLog(){
  chatPanel.innerHTML = chatLog.slice().reverse().map(l=>`<div class="chatline">${l}</div>`).join("");
}
function renderPaytable(){
  const rtp=(computeRTP()*100).toFixed(1);
  paytable.innerHTML = SYMBOLS.slice().reverse().map(s=>{ const img=SPR[s.revealVariants[0]];
    return `<div class="paytable-row"><img src="${img}" class="spr"><div class="name"><span class="hidden-ja">${s.nameJa}</span><span class="hidden-en">${s.nameEn}</span> ×3</div><div class="mult">×${s.mult}</div></div>`;
  }).join("") + `<div class="rtpnote"><span class="hidden-ja">理論上の還元率(RTP)約${rtp}%(8ライン合算)</span><span class="hidden-en">Theoretical RTP ≈ ${rtp}% (8 lines combined)</span></div>`
  + `<div class="streaknote"><span class="hidden-ja">🔥 連勝ボーナス:2連勝目から配当+10%、以降1連勝ごとに+10%(最大+100%)</span><span class="hidden-en">🔥 Win streak bonus: +10% payout from your 2nd consecutive win, +10% per further win (up to +100%)</span></div>`;
}
function updateSoundBtn(){ document.getElementById("soundBtn").classList.toggle("active", state.sound); }
renderBalance(true); renderBet(); applyLang(); renderPaytable(); updateSoundBtn(); renderJackpot(true); updateFreeSpinBadge(); updateStreakLine(); renderBottleUI(); updateBottleBuffBadge(); updateHudStrip(); updateKakuUI(); updateThemeBtnVisibility(); updateMimicPetVisibility();
function syncSkyHeight(){
  cabinet.style.marginTop = '34px';
  const top = cabinet.getBoundingClientRect().top;
  document.documentElement.style.setProperty('--skyh', Math.max(60, top - 4)+'px');
}
syncSkyHeight();
window.addEventListener('resize', syncSkyHeight);
setTimeout(syncSkyHeight, 200);

const DAYNIGHT_CYCLE_MS = 120000; // full day+night loop every 2 minutes
function updateDayNight(){
  const skyEl = document.querySelector('.worldbg .sky');
  const skyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--skyh')) || 200;
  const phase = (Date.now() % DAYNIGHT_CYCLE_MS) / DAYNIGHT_CYCLE_MS; // 0..1
  const isDay = phase < 0.5;
  const arcT = isDay ? (phase/0.5) : ((phase-0.5)/0.5); // 0..1 within day or night half: 0=rise at horizon, 0.5=peak, 1=set at horizon
  const arcX = 6 + arcT*88; // percent across sky width, horizon to horizon
  const riseSet = skyH + 24; // below the horizon (hidden behind dirt band)
  const peakY = skyH * 0.08; // near top of sky at zenith
  const arcY = riseSet - Math.sin(arcT*Math.PI) * (riseSet - peakY);
  const bodyEl = isDay ? skySun : skyMoon;
  const otherEl = isDay ? skyMoon : skySun;
  otherEl.style.opacity = '0';
  bodyEl.style.opacity = arcT<0.03 ? String(arcT/0.03) : (arcT>0.97 ? String((1-arcT)/0.03) : '1');
  bodyEl.style.left = `calc(${arcX}% - 20px)`;
  bodyEl.style.top = arcY + 'px';
  // subtle night tint
  if(skyEl) skyEl.style.filter = isDay ? 'none' : 'brightness(.45) saturate(.7)';
}
updateDayNight();
setInterval(updateDayNight, 1000);

// ---- Falling star -> mana system ----
let manaPurifyNextSpin = !!state.manaPurifyNextSpin;
function isCurrentlyNight(){
  const phase = (Date.now() % DAYNIGHT_CYCLE_MS) / DAYNIGHT_CYCLE_MS;
  return phase >= 0.5;
}
function spawnFallingStar(){
  if(!isCurrentlyNight()) return;
  if(document.querySelectorAll('.fallingstar').length >= 2) return; // don't overcrowd
  const star = document.createElement('img');
  star.src = SPR.deco_star;
  star.className = 'fallingstar';
  const vw = window.innerWidth;
  const startX = 20 + Math.random()*(vw-40);
  const skyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--skyh')) || 200;
  star.style.left = startX+'px';
  star.style.top = '-20px';
  document.body.appendChild(star);
  const fallMs = 900 + Math.random()*400;
  const landY = skyH - 6;
  star.animate([{top:'-20px'},{top:landY+'px'}], {duration:fallMs, easing:'ease-in'});
  setTimeout(()=>{
    if(!star.isConnected) return;
    star.style.top = landY+'px';
    star.classList.add('landed');
    star.onclick = ()=>{
      state.starFragments = (state.starFragments||0)+1;
      if(state.starFragments>=5){ state.starFragments-=5; state.mana=(state.mana||0)+1; updateHudStrip(); showToast(state.lang==="en"?"+1 Mana!":"マナ+1!"); }
      saveState();
      playReal("starPickup", 0.6);
      star.remove();
    };
    // despawn if not collected within a while
    setTimeout(()=>{ if(star.isConnected) star.remove(); }, 15000);
  }, fallMs);
}
setInterval(()=>{ if(Math.random()<0.35) spawnFallingStar(); }, 8000);

starsRowEl.onclick = ()=>{
  if(!(state.mana>0)) return;
  state.mana -= 1; manaPurifyNextSpin = true; state.manaUsed=(state.manaUsed||0)+1; updateHudStrip(); saveState();
  showToast(state.lang==="en" ? "Mana used — next spin excludes common Mimics!" : "マナ使用!次のスピンは低ランクのミミックが出にくくなる");
};

setInterval(()=>{
  const rect=cabinet.getBoundingClientRect();
  const d=document.createElement("div"); const size=2+Math.random()*3;
  d.className="dust"; d.style.width=d.style.height=size+"px";
  d.style.left=(rect.left+Math.random()*rect.width)+"px";
  d.style.top=(rect.top+rect.height*0.6+Math.random()*rect.height*0.3)+"px";
  d.style.opacity=.15+Math.random()*.35;
  fxlayer.appendChild(d);
  const dur=3000+Math.random()*2000;
  d.animate([{transform:"translateY(0)",opacity:d.style.opacity},{transform:`translateY(-${80+Math.random()*60}px)`,opacity:0}],{duration:dur,easing:"linear",fill:"forwards"});
  setTimeout(()=>d.remove(), dur+50);
}, 500);

document.getElementById("betUp").onclick=()=>{ betIndex=Math.min(BET_STEPS.length-1,betIndex+1); state.betIndex=betIndex; saveState(); renderBet(); sfxTick(); };
document.getElementById("betDown").onclick=()=>{ betIndex=Math.max(0,betIndex-1); state.betIndex=betIndex; saveState(); renderBet(); sfxTick(); };
document.getElementById("langBtn").onclick=()=>{ state.lang=state.lang==="en"?"ja":"en"; applyLang(); saveState(); renderPaytable(); updateKakuUI(); };
document.getElementById("soundBtn").onclick=()=>{ state.sound=!state.sound; updateSoundBtn(); saveState(); if(state.sound) sfxTick(); };
document.getElementById("resetBtn2").onclick=()=>{
  const ok=confirm(state.lang==="en" ? "Reset your save data and balance? This cannot be undone." : "セーブデータと所持金をリセットします。よろしいですか?(元に戻せません)");
  if(!ok) return;
  state={...DEFAULT_STATE, lang:state.lang, sound:state.sound};
  betIndex=3; freeSpinsRemaining=0; bottleBuffRemaining=0; bottleBuffMult=2; kakuhenRemaining=0; manaPurifyNextSpin=false;
  lastRealBet=BET_STEPS[betIndex]; SYMBOLS=MIMIC_SYMBOLS; SCATTER_ID="present";
  localStorage.removeItem(SAVE_KEY);
  randomizeAllCells(); renderPaytable(); renderThemeGrid();
  updateFreeSpinBadge(); updateBottleBuffBadge(); updateKakuUI(); renderBottleUI(); updateAutoSpinUI(); updateThemeBtnVisibility(); updateMimicPetVisibility();
  renderBalance(true); renderBet(); setMsg("リセットしました","Reset complete");
};
document.getElementById("torchGameBtn").onclick=()=>{ document.getElementById("ghostModal").classList.add("show"); renderGhost(); };
document.getElementById("ghostClose").onclick=()=>{ document.getElementById("ghostModal").classList.remove("show"); };
document.getElementById("ghostModal").onclick=(e)=>{ if(e.target.id==="ghostModal") e.currentTarget.classList.remove("show"); };
const AUTOSPIN_UNLOCK_SPINS = 100;
function isAutoSpinUnlocked(){ return !!state.autoSpinForceUnlocked || (state.totalSpins||0) >= AUTOSPIN_UNLOCK_SPINS; }
let autoSpinOn = false;
const autoSpinBtn = document.getElementById("autoSpinBtn");
function updateAutoSpinUI(){
  autoSpinBtn.classList.toggle("autospin-on", autoSpinOn);
  autoSpinBtn.classList.toggle("locked", !isAutoSpinUnlocked());
}
updateAutoSpinUI();
async function runAutoSpin(){
  while(autoSpinOn){
    const bet = freeSpinsRemaining>0 ? lastRealBet : currentBet();
    if(freeSpinsRemaining<=0 && state.balance<bet){
      autoSpinOn = false; updateAutoSpinUI();
      setMsg("自動スピン停止:所持金不足","Auto-spin stopped: not enough coins");
      break;
    }
    await spin();
    if(!autoSpinOn) break;
    await new Promise(r=>setTimeout(r,350));
  }
}
autoSpinBtn.onclick=()=>{
  if(!isAutoSpinUnlocked()){
    const left = AUTOSPIN_UNLOCK_SPINS - (state.totalSpins||0);
    setMsg(`ストレスボールはあと${left}回スピンすると使えるようになる`, `Spin ${left} more times to unlock auto-spin`);
    return;
  }
  autoSpinOn = !autoSpinOn;
  updateAutoSpinUI();
  if(autoSpinOn) runAutoSpin();
};
useBottleBtn.onclick=()=>{
  const hasSuper = (state.superBottles||0)>0, hasRegular = (state.bottles||0)>0;
  if((!hasSuper && !hasRegular) || bottleBuffRemaining>0) return;
  if(hasSuper){ state.superBottles -= 1; bottleBuffMult = 3; }
  else { state.bottles -= 1; bottleBuffMult = 2; }
  bottleBuffRemaining = 5;
  state.bottleUsedCount = (state.bottleUsedCount||0)+1;
  renderBottleUI(); updateBottleBuffBadge(); saveState(); sfxGrab();
  const first = unlockAch("bottleUsed");
  unlockAch("bottleAddict");
  if(!first){
    showToast(state.lang==="en"?`Lucky Potion active! ${bottleBuffMult}x payouts for 5 spins`:`ラッキーポーション発動!5スピン配当${bottleBuffMult}倍`);
  }
};
document.getElementById("coinPile").onclick=()=>{ document.getElementById("payModal").classList.add("show"); };
document.getElementById("skyMoon").onclick=()=>{
  state.moonClicks = (state.moonClicks||0)+1;
  if(state.moonClicks>=10) unlockAch("moonClicker"); else saveState();
};
document.getElementById("wanderBunny").onclick=()=>{ unlockAch("bunnyClicker"); };
document.getElementById("themeToggleBtn").onclick=()=>{ renderThemeGrid(); document.getElementById("themeModal").classList.add("show"); };
document.getElementById("themeModalClose").onclick=()=>{ document.getElementById("themeModal").classList.remove("show"); };
document.getElementById("themeModal").onclick=(e)=>{ if(e.target.id==="themeModal") e.currentTarget.classList.remove("show"); };
function switchTheme(themeId){
  const def = THEME_DEFS[themeId]; if(!def) return;
  state.activeTheme = themeId;
  SYMBOLS = def.symbols;
  SCATTER_ID = def.scatterId;
  saveState();
  randomizeAllCells();
  renderPaytable();
  renderThemeGrid();
  showToast(state.lang==="en" ? `Switched to ${def.nameEn} Slots!` : `${def.nameJa}スロットに切り替え!`);
}
function tryUnlockTheme(themeId){
  const def = THEME_DEFS[themeId]; if(!def) return;
  if(!state.themeUnlocked) state.themeUnlocked = {mimic:true};
  if(state.themeUnlocked[themeId]){ switchTheme(themeId); document.getElementById("themeModal").classList.remove("show"); return; }
  // Unlock order is a straight line (see THEME_ORDER) - the previous theme in the sequence must
  // already be unlocked before this one can be bought, even if the player has enough medals.
  const idx = THEME_ORDER.indexOf(themeId);
  const prevId = idx>0 ? THEME_ORDER[idx-1] : null;
  if(prevId && !state.themeUnlocked[prevId]){
    const prevDef = THEME_DEFS[prevId];
    showToast(state.lang==="en"
      ? `Unlock ${prevDef.nameEn} first`
      : `先に${prevDef.nameJa}スロットを解禁してください`);
    return;
  }
  if((state.defenderMedals||0) < def.unlockCost){
    showToast(state.lang==="en"
      ? `Need ${def.unlockCost} Defender Medals to unlock ${def.nameEn} (you have ${state.defenderMedals||0})`
      : `${def.nameJa}の解禁にはディフェンダーのメダルが${def.unlockCost}枚必要(所持${state.defenderMedals||0}枚)`);
    return;
  }
  state.defenderMedals -= def.unlockCost;
  state.themeUnlocked[themeId] = true;
  saveState();
  renderBalance();
  showToast(state.lang==="en" ? `${def.nameEn} Slots unlocked!` : `${def.nameJa}スロットを解禁した!`);
  switchTheme(themeId);
  document.getElementById("themeModal").classList.remove("show");
}
function updateMimicPetVisibility(){
  document.getElementById("mimicPet").style.display = (state.mimicPetOwned && state.mimicPetOn) ? "" : "none";
}
function updateThemeBtnVisibility(){
  // Reaching 10,000 platinum once (the point the Defender Medal economy kicks in) is what
  // reveals the theme-switch button next to the guide - before that a new player has no way
  // to afford any theme unlock cost anyway, so showing it earlier would just be clutter.
  // Also treated as unlocked retroactively if a save already has medals or a non-mimic theme
  // (covers saves from before this flag existed, or otherwise already past this point).
  const alreadyPast = state.themeBtnUnlocked || (state.defenderMedals||0)>0 || Object.keys(state.themeUnlocked||{}).length>1;
  document.getElementById("themeToggleBtn").style.display = alreadyPast ? "" : "none";
}
function renderThemeGrid(){
  if(!state.themeUnlocked) state.themeUnlocked = {mimic:true};
  THEME_ORDER.forEach((id,idx)=>{
    const btn = document.getElementById("theme_"+id); if(!btn) return;
    const def = THEME_DEFS[id];
    const unlocked = !!state.themeUnlocked[id];
    const prevId = idx>0 ? THEME_ORDER[idx-1] : null;
    const prevLocked = prevId && !state.themeUnlocked[prevId];
    btn.classList.toggle("active", state.activeTheme===id);
    btn.classList.toggle("locked", !unlocked);
    if(unlocked) btn.title = def.nameEn;
    else if(prevLocked) btn.title = `${def.nameEn} - unlock ${THEME_DEFS[prevId].nameEn} first`;
    else btn.title = `${def.nameEn} - ${def.unlockCost} Defender Medals to unlock`;
  });
}
THEME_ORDER.forEach(id=>{
  const btn = document.getElementById("theme_"+id);
  if(btn) btn.onclick=()=>tryUnlockTheme(id);
});

// Traveling Merchant's shop: spend Defender Medals on QoL/power-up items. Prices scaled up
// (2026-09-27) to sit sensibly below the new, much steeper theme-unlock costs (slime5/zombie20/
// zenith50) instead of overlapping them - see DEVLOG.md.
const SHOP_ITEMS = [
  { key:"autospin", nameJa:"オートスピン権利証", nameEn:"Auto-Spin Pass",
    descJa:"累計スピン数に関係なく自動スピンをすぐ解禁する(1回限り)", descEn:"Unlocks auto-spin immediately, skipping the 100-spin requirement (one-time)",
    cost:15, iconKey:"deco_stressball", type:"once",
    ownedCheck:()=>!!state.autoSpinForceUnlocked, buy:()=>{ state.autoSpinForceUnlocked=true; updateAutoSpinUI(); } },
  { key:"superbottle", nameJa:"プレミアムボトル", nameEn:"Premium Bottle",
    descJa:"使うと5スピンの間、配当が3倍になる(通常の瓶は2倍)。何個でも購入可", descEn:"Grants 3x payouts for 5 spins when used (regular bottles give 2x). Stackable",
    cost:3, iconKey:"deco_bottle", type:"consumable",
    countFn:()=>state.superBottles||0, buy:()=>{ state.superBottles=(state.superBottles||0)+1; renderBottleUI(); } },
  { key:"turbo", nameJa:"ターボスピン権利証", nameEn:"Turbo Spin Pass",
    descJa:"リールが止まるまでの時間を短縮する。購入後はいつでもON/OFF切り替え可能", descEn:"Shortens how long the reels take to stop. Toggle on/off anytime once purchased",
    cost:20, iconKey:"icon_hermesboots", type:"toggle",
    ownedCheck:()=>!!state.turboUnlocked, buy:()=>{ state.turboUnlocked=true; state.turboEnabled=true; },
    isOn:()=>!!state.turboEnabled, toggle:()=>{ state.turboEnabled=!state.turboEnabled; } },
  { key:"digpermit", nameJa:"発掘免許皆伝", nameEn:"Excavation Permit",
    descJa:"発掘・幽霊退治ミニゲームのクールダウンを25秒→15秒に短縮する(1回限り、永続)", descEn:"Shortens both the Dig and Ghost Hunt minigame cooldowns from 25s to 15s (one-time, permanent)",
    cost:10, iconKey:"icon_pickaxe", type:"once",
    ownedCheck:()=>!!state.digGhostFastCooldown, buy:()=>{ state.digGhostFastCooldown=true; } },
  { key:"mimicpet", nameJa:"相棒のミミック", nameEn:"Mimic Companion",
    descJa:"画面についてくる小さなミミックの相棒(見た目のみ)。購入後はいつでもON/OFF切り替え可能", descEn:"A small mimic companion that tags along on screen (cosmetic only). Toggle on/off anytime once purchased",
    cost:5, iconKey:"mimic_wood", type:"toggle",
    ownedCheck:()=>!!state.mimicPetOwned, buy:()=>{ state.mimicPetOwned=true; state.mimicPetOn=true; updateMimicPetVisibility(); },
    isOn:()=>!!state.mimicPetOn, toggle:()=>{ state.mimicPetOn=!state.mimicPetOn; updateMimicPetVisibility(); } },
  { key:"luckycoin", nameJa:"ラッキーコイン", nameEn:"Lucky Coin",
    descJa:"ミステリーポットへの積立率を3%→4%に上げる(1回限り、永続。当選確率や還元率自体は変わらず、貯まる速さとポットの大きさだけ変わる)", descEn:"Raises the Mystery Pot feed rate from 3% to 4% (one-time, permanent - doesn't change overall odds/RTP, just how fast the pool grows)",
    cost:8, iconKey:"coin_gold", type:"once",
    ownedCheck:()=>!!state.luckyCoinOwned, buy:()=>{ state.luckyCoinOwned=true; } },
  { key:"achguide", nameJa:"実績の攻略本", nameEn:"Achievement Strategy Guide",
    descJa:"隠し実績(???表示のもの)の内容と達成条件を先に教えてもらえる(1回限り、永続)", descEn:"Reveals what the hidden (???) achievements are and how to unlock them (one-time, permanent)",
    cost:100, iconKey:"icon_achguide", type:"once",
    ownedCheck:()=>!!state.achGuideOwned, buy:()=>{ state.achGuideOwned=true; } },
];
function renderShop(){
  const html = SHOP_ITEMS.map(item=>{
    const owned = (item.type==="once"||item.type==="toggle") && item.ownedCheck();
    const count = item.type==="consumable" ? item.countFn() : null;
    const canAfford = (state.defenderMedals||0) >= item.cost;
    const name = state.lang==="en" ? item.nameEn : item.nameJa;
    const desc = state.lang==="en" ? item.descEn : item.descJa;
    let btnLabel, btnDisabled, toggleClass="";
    if(item.type==="toggle" && owned){
      const on = item.isOn();
      btnLabel = on ? "ON" : "OFF";
      btnDisabled = false;
      toggleClass = on ? "toggle-on" : "toggle-off";
    } else {
      btnLabel = owned ? (state.lang==="en"?"Owned":"購入済み") : (state.lang==="en"?`Buy (${item.cost})`:`購入(${item.cost}枚)`);
      btnDisabled = owned || !canAfford;
    }
    return `<div class="shopitem">
      <img class="spr" src="${SPR[item.iconKey]}">
      <div class="shopitem-info">
        <div class="shopitem-name">${name}${count!=null?` ×${count}`:""}</div>
        <div class="shopitem-desc">${desc}</div>
      </div>
      <button class="shopitem-buy ${toggleClass}" data-key="${item.key}" ${btnDisabled?"disabled":""}>${btnLabel}</button>
    </div>`;
  }).join("");
  document.getElementById("shopItems").innerHTML = html;
  document.querySelectorAll(".shopitem-buy").forEach(btn=>{
    btn.onclick=()=>{
      const item = SHOP_ITEMS.find(i=>i.key===btn.dataset.key);
      if(item.type==="toggle" && item.ownedCheck()){ item.toggle(); saveState(); renderShop(); }
      else buyShopItem(btn.dataset.key);
    };
  });
}
function buyShopItem(key){
  const item = SHOP_ITEMS.find(i=>i.key===key); if(!item) return;
  if((item.type==="once"||item.type==="toggle") && item.ownedCheck()) return;
  if((state.defenderMedals||0) < item.cost){
    showToast(state.lang==="en" ? "Not enough Defender Medals" : "ディフェンダーのメダルが足りません");
    return;
  }
  state.defenderMedals -= item.cost;
  item.buy();
  saveState(); renderBalance(); renderShop();
  showToast(state.lang==="en" ? `Purchased ${item.nameEn}!` : `${item.nameJa}を購入した!`);
}
document.getElementById("shopToggleBtn").onclick=()=>{ renderShop(); document.getElementById("shopModal").classList.add("show"); };
document.getElementById("shopModalClose").onclick=()=>{ document.getElementById("shopModal").classList.remove("show"); };
document.getElementById("shopModal").onclick=(e)=>{ if(e.target.id==="shopModal") e.currentTarget.classList.remove("show"); };

document.getElementById("payClose").onclick=()=>{ document.getElementById("payModal").classList.remove("show"); };
document.getElementById("payModal").onclick=(e)=>{ if(e.target.id==="payModal") e.currentTarget.classList.remove("show"); };
document.getElementById("digToggle").onclick=()=>{ document.getElementById("digModal").classList.add("show"); renderDig(); };
document.getElementById("digClose").onclick=()=>{ document.getElementById("digModal").classList.remove("show"); };
document.getElementById("digModal").onclick=(e)=>{ if(e.target.id==="digModal") e.currentTarget.classList.remove("show"); };
const ACHIEVEMENT_DEFS = [
  {key:"firstWin", ja:"はじめてのミミック捕獲", en:"First Catch"},
  {key:"jackpot", ja:"プレゼントを見つけた", en:"Jackpot Hunter"},
  {key:"multiline", ja:"マルチライン職人", en:"Multi-Line Master"},
  {key:"richPlayer", ja:"白金貨の袋", en:"Platinum Pouch"},
  {key:"jungle", ja:"ジャングルの奥へ", en:"Into the Jungle"},
  {key:"allSymbols", ja:"ミミック図鑑コンプリート", en:"Mimic Compendium"},
  {key:"spins100", ja:"百戦錬磨", en:"Seasoned Spinner"},
  {key:"streak5", ja:"不屈の連勝", en:"Unstoppable Streak"},
  {key:"megaWin", ja:"メガウィン達成", en:"Mega Winner"},
  {key:"bottleUsed", ja:"ラッキードリンカー", en:"Lucky Drinker"},
  {key:"digMaster", ja:"発掘マスター", en:"Dig Master"},
  {key:"bonusHunter", ja:"ボーナスハンター", en:"Bonus Hunter"},
  {key:"mysteryRich", ja:"ミステリー成金", en:"Mystery Fortune"},
  {key:"starMage", ja:"星屑の魔術師", en:"Star Mage"},
  {key:"megaRich", ja:"大富豪", en:"Tycoon"},
  {key:"hallowFound", ja:"聖なる輝き", en:"Blessed Find"},
  {key:"evilTwins", ja:"邪悪な双子", en:"Evil Twins"},
  {key:"spins500", ja:"スロット古参兵", en:"Slot Veteran"},
  {key:"doubleTrouble", ja:"ダブルトラブル", en:"Double Trouble"},
  {key:"spins25", ja:"駆け出しスロッター", en:"Rookie Spinner"},
  {key:"spins1000", ja:"千戦錬磨", en:"Slot Legend"},
  {key:"spins2500", ja:"スロットの鬼", en:"Slot Fanatic"},
  {key:"spins5000", ja:"伝説のスロッター", en:"Slot Icon"},
  {key:"streak8", ja:"無敵の連勝", en:"Untouchable Streak"},
  {key:"streak11", ja:"運命の連鎖", en:"Chain of Fate"},
  {key:"megaWin200", ja:"超メガウィン", en:"Ultra Mega Win"},
  {key:"digMaster100", ja:"発掘の鬼", en:"Excavation Fanatic"},
  {key:"digMaster250", ja:"発掘王", en:"Excavation King"},
  {key:"manaMaster", ja:"星屑マスター", en:"Star Master"},
  {key:"jackpotStreak3", ja:"ジャックポット常連", en:"Jackpot Regular"},
  {key:"freeSpinFan", ja:"フリースピン中毒", en:"Free Spin Addict"},
  {key:"kakuhenFirst", ja:"初めての確変", en:"First Bonus Round"},
  {key:"kakuhenVeteran", ja:"確変ハンター", en:"Bonus Hunter Elite"},
  {key:"kakuhenPity", ja:"天井到達", en:"Reached the Pity Timer"},
  {key:"iceFound", ja:"氷結の証", en:"Frozen Proof"},
  {key:"corruptFound", ja:"腐敗の証", en:"Corruption's Mark"},
  {key:"crimsonFound", ja:"緋色の証", en:"Crimson Mark"},
  {key:"allBiomes", ja:"四大厄災制覇", en:"Master of Biomes"},
  {key:"pentaLine", ja:"ペンタライン", en:"Penta Line"},
  {key:"perfectBoard", ja:"全ライン制覇", en:"Perfect Board"},
  {key:"balanceUltra", ja:"伝説の資産家", en:"Legendary Fortune"},
  {key:"bigBet", ja:"大勝負", en:"High Roller"},
  {key:"smallBet", ja:"堅実プレイ", en:"Playing It Safe"},
  {key:"bottleHoarder", ja:"瓶コレクター", en:"Bottle Collector"},
  {key:"bottleAddict", ja:"リキッドラック中毒", en:"Liquid Luck Addict"},
  {key:"mimicMaster", ja:"ミミック狩りの達人", en:"Mimic Slayer"},
  {key:"iceMaster", ja:"氷の探求者", en:"Ice Seeker"},
  {key:"jackpotBig", ja:"大ジャックポット", en:"Big Jackpot"},
  {key:"moonClicker", ja:"月の秘密", en:"Moon's Secret", hidden:true, hintJa:"月を10回クリックする", hintEn:"Click the moon 10 times"},
  {key:"bunnyClicker", ja:"ウサギを捕まえた", en:"Caught the Bunny", hidden:true, hintJa:"歩いているウサギをクリックする", hintEn:"Click the wandering bunny"},
];
const ACH_PAGE_SIZE = 10;
let achPage = 0;
function renderAchBubble(){
  const ach = state.achievements||{};
  const unlockedCount = ACHIEVEMENT_DEFS.filter(d=>ach[d.key]).length;
  const pageCount = Math.ceil(ACHIEVEMENT_DEFS.length/ACH_PAGE_SIZE);
  achPage = Math.max(0, Math.min(achPage, pageCount-1));
  let html = `<span class="ach-title">${state.lang==="en"?`Achievements (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`:`実績 (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`}</span>`;
  html += `<div class="ach-list">`;
  ACHIEVEMENT_DEFS.slice(achPage*ACH_PAGE_SIZE, achPage*ACH_PAGE_SIZE+ACH_PAGE_SIZE).forEach(d=>{
    const got = !!ach[d.key];
    const guideRevealed = state.achGuideOwned && !got && d.hidden;
    const label = (!got && d.hidden && !guideRevealed) ? "???" : (state.lang==="en"?d.en:d.ja);
    const hint = guideRevealed ? `<span class="ach-hint">(${state.lang==="en"?d.hintEn:d.hintJa})</span>` : "";
    html += `<div class="${got?"":"ach-locked"}">${got?"★":"☆"} ${label}${hint}</div>`;
  });
  html += `</div>`;
  html += `<div class="ach-pager">
    <button class="ach-pagebtn" id="achPrev" ${achPage===0?"disabled":""}>&lt;</button>
    <span class="ach-pagenum">${achPage+1} / ${pageCount}</span>
    <button class="ach-pagebtn" id="achNext" ${achPage>=pageCount-1?"disabled":""}>&gt;</button>
  </div>`;
  achBubble.innerHTML = html;
  document.getElementById("achPrev").onclick=(e)=>{ e.stopPropagation(); achPage--; renderAchBubble(); };
  document.getElementById("achNext").onclick=(e)=>{ e.stopPropagation(); achPage++; renderAchBubble(); };
}
document.getElementById("grassTable").onclick=(e)=>{
  renderChatLog();
  const rect = e.currentTarget.getBoundingClientRect();
  chatPanel.style.top = (rect.bottom+6)+"px";
  chatPanel.style.left = Math.max(8, Math.min(window.innerWidth-190, rect.left-60))+"px";
  chatPanel.classList.toggle("show");
  achBubble.classList.remove("show");
};
document.getElementById("standSign").onclick=(e)=>{
  renderAchBubble();
  const rect = e.currentTarget.getBoundingClientRect();
  achBubble.style.top = (rect.bottom+6)+"px";
  achBubble.style.left = Math.max(8, rect.left-80)+"px";
  achBubble.classList.toggle("show");
};
document.addEventListener("click",(e)=>{
  if(achBubble.classList.contains("show") && e.target.id!=="standSign" && !achBubble.contains(e.target)){
    achBubble.classList.remove("show");
  }
  if(chatPanel.classList.contains("show") && e.target.id!=="grassTable" && !chatPanel.contains(e.target)){
    chatPanel.classList.remove("show");
  }
});
document.getElementById("infoBtn").onclick=()=>{ document.getElementById("infoModal").classList.add("show"); };
document.getElementById("infoClose").onclick=()=>{ document.getElementById("infoModal").classList.remove("show"); };
document.getElementById("infoModal").onclick=(e)=>{ if(e.target.id==="infoModal") e.currentTarget.classList.remove("show"); };
document.getElementById("decoMushroom").onclick=()=>{ document.getElementById("devlogModal").classList.add("show"); };
document.getElementById("devlogClose").onclick=()=>{ document.getElementById("devlogModal").classList.remove("show"); };
document.getElementById("devlogModal").onclick=(e)=>{ if(e.target.id==="devlogModal") e.currentTarget.classList.remove("show"); };

// Secret, entirely undiscoverable-by-UI strategy guide viewer: no button, no menu entry, no
// hint anywhere in the game (not even the dev diary). Only reachable by typing this exact
// word anywhere on the page. Renders the same guide page published as an Artifact, embedded
// verbatim via SECRET_GUIDE_HTML (secretguide_data.js) so it works standalone with no network
// dependency on claude.ai.
(function setupSecretGuide(){
  const CODE = "utoutoneko";
  let buffer = "";
  document.addEventListener("keydown", (e)=>{
    if(e.key.length !== 1) return; // ignore Shift/Enter/arrows/etc.
    buffer = (buffer + e.key.toLowerCase()).slice(-CODE.length);
    if(buffer === CODE){
      const frame = document.getElementById("secretGuideFrame");
      if(!frame.src && !frame.hasAttribute("data-loaded")){
        frame.srcdoc = SECRET_GUIDE_HTML;
        frame.setAttribute("data-loaded","1");
      }
      document.getElementById("secretGuideModal").classList.add("show");
      buffer = "";
    }
  });
  document.getElementById("secretGuideClose").onclick=()=>{ document.getElementById("secretGuideModal").classList.remove("show"); };
  document.getElementById("secretGuideModal").onclick=(e)=>{ if(e.target.id==="secretGuideModal") e.currentTarget.classList.remove("show"); };
})();

let digState={tiles:null};
function renderDig(){
  const now=Date.now();
  if(now < state.digCooldownUntil){ digRow.innerHTML=""; startDigCountdown(); return; }
  // Start the cooldown the moment a fresh round is opened (not on completion) so closing
  // the modal early can never be used to repeat-farm free digs.
  state.digCooldownUntil = now + (state.digGhostFastCooldown ? 15000 : 25000); saveState();
  digState.tiles = Array.from({length:6}, ()=>({done:false}));
  digRow.innerHTML=""; digCd.textContent="";
  digState.tiles.forEach((t,idx)=>{ const el=document.createElement("div"); el.className="digtile";
    const pk=document.createElement("img"); pk.className="spr"; pk.src=SPR.icon_pickaxe; pk.style.width="70%"; pk.style.height="70%";
    el.appendChild(pk); el.onclick=()=>digOne(idx,el); digRow.appendChild(el); });
}
function digOne(idx,el){
  if(digState.tiles[idx].done) return;
  digState.tiles[idx].done=true; el.classList.add("done"); sfxDig();
  state.totalDigs=(state.totalDigs||0)+1;
  const roll=Math.random(); let gain=0,iconKey="",foundBottle=false;
  if(roll<0.10){ gain=0; iconKey="icon_dirt"; }
  else if(roll<0.15){ foundBottle=true; iconKey="deco_bottle"; }
  else if(roll<0.68){ gain=5+Math.floor(Math.random()*36); iconKey="coin_copper"; }
  else if(roll<0.93){ gain=SILVER*(1+Math.floor(Math.random()*6)); iconKey="coin_silver"; }
  else { gain=SILVER*(5+Math.floor(Math.random()*11)); iconKey="coin_gold"; }
  const rev=document.createElement("img"); rev.className="spr rev"; rev.src=SPR[iconKey]; rev.style.width=foundBottle?"55%":"65%"; rev.style.height=foundBottle?"70%":"65%";
  el.innerHTML=""; el.appendChild(rev);
  if(foundBottle){ state.bottles=(state.bottles||0)+1; renderBottleUI(); saveState(); sfxGrab(); showToast(state.lang==="en"?"Found a Lucky Bottle!":"ラッキーな瓶を発見!"); }
  else if(gain>0){ state.balance+=gain; renderBalance(); saveState(); if(gain>=SILVER) sfxGrab(); else sfxCoin(0.8); }
  if(digState.tiles.every(t=>t.done)){ setTimeout(startDigCountdown,600); }
}
let digTimerId=null;
function startDigCountdown(){
  clearInterval(digTimerId);
  digTimerId=setInterval(()=>{ const remain=state.digCooldownUntil-Date.now();
    if(remain<=0){ clearInterval(digTimerId); digCd.textContent=""; renderDig(); return; }
    digCd.innerHTML = state.lang==="en" ? `Next dig in ${Math.ceil(remain/1000)}s` : `次の発掘まで ${Math.ceil(remain/1000)}秒`;
  }, 250);
}

// Ghost Hunt: the field is pitch dark except for a small torch circle that follows the
// pointer/finger. Ghosts drift around freely (re-targeting a nearby spot every ~0.9s, with a
// CSS transition giving the glide) and can only be caught while inside the lit torch radius -
// clicking blind outside the light never registers a catch, matching "explore the dark with
// the torch" rather than the old click-before-it-vanishes version.
const ghostField = document.getElementById("ghostField"), ghostCd = document.getElementById("ghostCd"), ghostFog = document.getElementById("ghostFog");
const GHOST_COUNT = 5, GHOST_ROUND_MS = 20000, TORCH_RADIUS = 48;
let ghostState={active:false,caught:0,earned:0,ghosts:[]};
let ghostRunToken=0, ghostDriftTimer=null, ghostRoundTimer=null;
let torchX=-999, torchY=-999;
function setTorch(clientX,clientY){
  const r = ghostField.getBoundingClientRect();
  torchX = clientX-r.left; torchY = clientY-r.top;
  ghostField.style.setProperty("--tx", torchX+"px");
  ghostField.style.setProperty("--ty", torchY+"px");
}
function resetTorch(){ torchX=-999; torchY=-999; ghostField.style.setProperty("--tx","-999px"); ghostField.style.setProperty("--ty","-999px"); }
ghostField.addEventListener("pointermove", e=>setTorch(e.clientX,e.clientY));
ghostField.addEventListener("pointerleave", resetTorch);
ghostField.addEventListener("pointerdown", e=>{ setTorch(e.clientX,e.clientY); tryCatchGhosts(); });
function renderGhost(){
  const now=Date.now();
  clearInterval(ghostDriftTimer); clearTimeout(ghostRoundTimer);
  if(now < state.ghostCooldownUntil){ ghostField.querySelectorAll(".ghosttile").forEach(el=>el.remove()); resetTorch(); startGhostCountdown(); return; }
  // Cooldown starts the moment a fresh round opens (matches the dig minigame) so closing
  // the modal early can never be used to repeat-farm free ghost catches.
  state.ghostCooldownUntil = now + (state.digGhostFastCooldown ? 15000 : 25000); saveState();
  ghostField.querySelectorAll(".ghosttile").forEach(el=>el.remove()); ghostCd.textContent=""; resetTorch();
  const myToken = ++ghostRunToken;
  const fieldRect = ghostField.getBoundingClientRect();
  ghostState = {active:true, caught:0, earned:0, ghosts:[]};
  for(let i=0;i<GHOST_COUNT;i++){
    const el=document.createElement("div"); el.className="ghosttile";
    const img=document.createElement("img"); img.className="spr"; img.src=SPR.deco_ghost; el.appendChild(img);
    const ghost={el, x:10+Math.random()*80, y:15+Math.random()*70, caught:false};
    el.style.left=ghost.x+"%"; el.style.top=ghost.y+"%";
    ghostField.appendChild(el);
    ghostState.ghosts.push(ghost);
  }
  ghostDriftTimer = setInterval(()=>driftGhosts(myToken), 900);
  ghostRoundTimer = setTimeout(()=>finishGhostRound(myToken), GHOST_ROUND_MS);
}
function driftGhosts(myToken){
  if(myToken!==ghostRunToken) return;
  ghostState.ghosts.forEach(g=>{
    if(g.caught) return;
    g.x = Math.min(92, Math.max(8, g.x + (Math.random()-0.5)*36));
    g.y = Math.min(88, Math.max(10, g.y + (Math.random()-0.5)*36));
    g.el.style.left=g.x+"%"; g.el.style.top=g.y+"%";
  });
}
function tryCatchGhosts(){
  if(!ghostState.active) return;
  const fieldRect = ghostField.getBoundingClientRect();
  ghostState.ghosts.forEach(g=>{
    if(g.caught) return;
    const r = g.el.getBoundingClientRect();
    const gx = r.left+r.width/2-fieldRect.left, gy = r.top+r.height/2-fieldRect.top;
    const dist = Math.hypot(gx-torchX, gy-torchY);
    if(dist <= TORCH_RADIUS) catchGhost(g);
  });
}
function catchGhost(g){
  g.caught=true; g.el.classList.add("caught"); sfxGhostCatch();
  state.totalGhosts=(state.totalGhosts||0)+1;
  const roll=Math.random(); let gain;
  if(roll<0.55) gain=8+Math.floor(Math.random()*40);
  else if(roll<0.90) gain=SILVER*(1+Math.floor(Math.random()*7));
  else gain=SILVER*(6+Math.floor(Math.random()*12));
  state.balance+=gain; renderBalance(); saveState(); if(gain>=SILVER) sfxGrab(); else sfxCoin(0.8);
  ghostState.caught++; ghostState.earned+=gain;
  setTimeout(()=>g.el.remove(),350);
  if(ghostState.ghosts.every(x=>x.caught)) finishGhostRound(ghostRunToken);
}
function finishGhostRound(myToken){
  if(myToken!==ghostRunToken || !ghostState.active) return;
  ghostState.active=false;
  clearInterval(ghostDriftTimer); clearTimeout(ghostRoundTimer);
  ghostState.ghosts.forEach(g=>{ if(!g.caught){ g.el.classList.add("missed"); setTimeout(()=>g.el.remove(),300); } });
  ghostCd.innerHTML = state.lang==="en"
    ? `Caught ${ghostState.caught}/${GHOST_COUNT} ghosts — +${formatCoins(ghostState.earned)}`
    : `${GHOST_COUNT}匹中${ghostState.caught}匹退治 — +${formatCoins(ghostState.earned)}`;
  setTimeout(startGhostCountdown,1400);
}
let ghostTimerId=null;
function startGhostCountdown(){
  clearInterval(ghostTimerId);
  ghostTimerId=setInterval(()=>{ const remain=state.ghostCooldownUntil-Date.now();
    if(remain<=0){ clearInterval(ghostTimerId); ghostCd.textContent=""; renderGhost(); return; }
    ghostCd.innerHTML = state.lang==="en" ? `Next hunt in ${Math.ceil(remain/1000)}s` : `次の退治まで ${Math.ceil(remain/1000)}秒`;
  }, 250);
}

function screenFlash(color,ms){
  // gentle edge vignette pulse instead of a full bright screen wash - kinder on the eyes
  flashlayer.style.background = `radial-gradient(ellipse 60% 55% at 50% 50%, transparent 45%, ${color} 140%)`;
  flashlayer.style.transition="none"; flashlayer.style.opacity="0.38";
  requestAnimationFrame(()=>{ flashlayer.style.transition=`opacity ${Math.max(ms,500)}ms ease-out`; flashlayer.style.opacity="0"; });
}
function shakeCabinet(size){ cabinet.classList.remove("shake-sm","shake-md","shake-lg"); void cabinet.offsetWidth; cabinet.classList.add(size); setTimeout(()=>cabinet.classList.remove(size),650); }
function spawnParticles(kind,count){
  const cabRect=cabinet.getBoundingClientRect();
  for(let i=0;i<count;i++){
    const p=document.createElement("div"); p.className="particle";
    const startX=cabRect.left+Math.random()*cabRect.width;
    const dur=1.2+Math.random()*1.4, delay=Math.random()*0.5;
    if(kind==="snow"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:6px;height:6px;border-radius:50%;background:#fff;opacity:.95;box-shadow:0 0 4px #fff;`;
      p.animate([{transform:`translate(0,0)`},{transform:`translate(${(Math.random()-0.5)*100}px, ${cabRect.height+40}px)`}],{duration:dur*1000,delay:delay*1000,easing:"linear",fill:"forwards"});
    } else if(kind==="leaf"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:11px;height:7px;border-radius:0 60% 0 60%;background:#5fa63d;opacity:.95;`;
      p.animate([{transform:`translate(0,0) rotate(0deg)`},{transform:`translate(${(Math.random()-0.5)*160}px, ${cabRect.height+40}px) rotate(${360*(Math.random()>.5?1:-1)}deg)`}],{duration:dur*1000,delay:delay*1000,easing:"ease-in",fill:"forwards"});
    } else if(kind==="spore"){ p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.3}px;width:6px;height:6px;border-radius:50%;background:#b06bd6;box-shadow:0 0 8px #b06bd6;opacity:.95;`;
      p.animate([{transform:`translate(0,0)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*140}px, ${(Math.random()-0.5)*200}px)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    } else if(kind==="blood"){ p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:5px;height:11px;border-radius:50% 50% 50% 50% / 60% 60% 40% 40%;background:#c81f3a;opacity:.95;box-shadow:0 0 5px #c81f3a;`;
      p.animate([{transform:`translate(0,0)`},{transform:`translate(${(Math.random()-0.5)*40}px, ${cabRect.height+40}px)`}],{duration:(dur*0.7)*1000,delay:delay*1000,easing:"cubic-bezier(.5,0,1,1)",fill:"forwards"});
    } else if(kind==="spark"){ const col=["#ffb3e6","#b3e6ff","#c8ffb3","#fff2b3"][i%4];
      p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.35}px;width:5px;height:5px;border-radius:50%;background:${col};box-shadow:0 0 8px ${col};opacity:1;`;
      p.animate([{transform:`translate(0,0) scale(1)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*220}px, ${(Math.random()-0.5)*220}px) scale(.2)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    } else if(kind==="coin"){ const ck=["coin_copper","coin_silver","coin_gold","coin_platinum"][i%4];
      p.style.cssText=`left:${startX}px;top:${cabRect.top+cabRect.height*0.4}px;width:10px;height:10px;`;
      const im=document.createElement("img"); im.src=SPR[ck]; im.className="spr"; im.style.width="100%"; im.style.height="100%"; p.appendChild(im);
      p.animate([{transform:`translate(0,0) rotateY(0deg)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*80}px, ${cabRect.height+40}px) rotateY(900deg)`,opacity:.9}],{duration:dur*1000,delay:delay*1000,easing:"cubic-bezier(.4,0,.8,1)",fill:"forwards"});
    } else if(kind==="confetti"){ const ck=["coin_copper","coin_silver","coin_gold","coin_platinum"][i%4];
      p.style.cssText=`left:${startX}px;top:${cabRect.top-10}px;width:9px;height:9px;`;
      const im=document.createElement("img"); im.src=SPR[ck]; im.className="spr"; im.style.width="100%"; im.style.height="100%"; p.appendChild(im);
      p.animate([{transform:`translate(0,0) rotate(0deg)`,opacity:1},{transform:`translate(${(Math.random()-0.5)*160}px, ${cabRect.height+40}px) rotate(${720*(Math.random()>.5?1:-1)}deg)`,opacity:.9}],{duration:dur*1000,delay:delay*1000,easing:"ease-in",fill:"forwards"});
    } else if(kind==="fragment"){
      // Which chest/sword/slime sprites go flying should match the active theme, not always
      // show Mimic chests during a Zombie/Slime/Zenith win.
      const FRAGMENT_KEYS = {
        mimic:  ["mimic_gold","mimic_wood","mimic_shadow","present_chest","present_reveal"],
        zombie: ["zombie_zombie","zombie_bride","zombie_doctorbones","zombie_blood"],
        zenith: ["zenith_meowmere","zenith_terrablade","zenith_horseman","zenith_enchanted"],
        slime:  ["slime_king","slime_queen","slime_golden","slime_pinky"],
      };
      const keys = FRAGMENT_KEYS[state.activeTheme] || FRAGMENT_KEYS.mimic;
      const cx=cabRect.left+cabRect.width/2, cy=cabRect.top+cabRect.height/2;
      p.style.cssText=`left:${cx}px;top:${cy}px;width:22px;height:22px;`;
      const im=document.createElement("img"); im.src=SPR[keys[i%keys.length]]; im.className="spr"; im.style.width="100%"; im.style.height="100%"; p.appendChild(im);
      const ang=Math.random()*Math.PI*2, dist=80+Math.random()*160;
      p.animate([{transform:`translate(-50%,-50%) rotate(0deg) scale(1)`,opacity:1},{transform:`translate(${Math.cos(ang)*dist-50}%, ${Math.sin(ang)*dist-50}%) rotate(${(Math.random()>.5?1:-1)*540}deg) scale(.6)`,opacity:0}],{duration:(dur*1.1)*1000,delay:delay*1000,easing:"cubic-bezier(.2,.7,.3,1)",fill:"forwards"});
    } else if(kind==="tree"){
      const sx = Math.random()*window.innerWidth;
      p.style.cssText=`left:${sx}px;top:-80px;width:34px;height:70px;`;
      const im=document.createElement("img"); im.src=SPR.deco_tree; im.className="spr"; im.style.width="100%"; im.style.height="100%"; im.style.objectFit="contain"; p.appendChild(im);
      const dur2=1.1+Math.random()*0.6;
      p.animate([{transform:`translateY(0) rotate(${(Math.random()-0.5)*30}deg)`,opacity:1},{transform:`translateY(${window.innerHeight+120}px) rotate(${(Math.random()-0.5)*60}deg)`,opacity:.9}],{duration:dur2*1000,delay:(Math.random()*0.4)*1000,easing:"cubic-bezier(.5,0,.9,1)",fill:"forwards"});
    } else if(kind==="rainbow"){
      p.className="rainbowp"; p.style.left=startX+"px"; p.style.top=(cabRect.top+cabRect.height*0.4)+"px";
      const img=document.createElement("img"); img.src=SPR.cursor; img.className="spr"; img.style.width="100%"; img.style.height="100%"; p.appendChild(img);
      const ang=Math.random()*Math.PI*2, dist=60+Math.random()*120;
      p.animate([{transform:`translate(0,0) rotate(0deg) scale(0.5)`,opacity:1},{transform:`translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px) rotate(${360*(Math.random()>.5?1:-1)}deg) scale(1.1)`,opacity:0}],{duration:dur*1000,delay:delay*1000,easing:"ease-out",fill:"forwards"});
    }
    fxlayer.appendChild(p); setTimeout(()=>p.remove(), (dur+delay+0.3)*1000);
  }
}
let bannerQueue=[]; let bannerBusy=false;
function showBanner(text,ms){
  bannerQueue.push({text,ms});
  if(!bannerBusy) processBannerQueue();
}
function processBannerQueue(){
  if(bannerQueue.length===0){ bannerBusy=false; return; }
  bannerBusy=true;
  const {text,ms} = bannerQueue.shift();
  banner.textContent=text; banner.classList.remove("show"); void banner.offsetWidth; banner.classList.add("show");
  setTimeout(()=>{ banner.classList.remove("show"); setTimeout(processBannerQueue, 150); }, ms);
}
function drawLines(lineObjs){ lineSvg.innerHTML=""; lineObjs.forEach(line=>{ const pts=line.cells.map(([r,c])=>[(c+0.5)/3*100,(r+0.5)/3*100]);
  const d=`M${pts[0][0]},${pts[0][1]} L${pts[1][0]},${pts[1][1]} L${pts[2][0]},${pts[2][1]}`;
  const path=document.createElementNS("http://www.w3.org/2000/svg","path"); path.setAttribute("d",d); path.setAttribute("stroke",line.color); path.style.color=line.color; lineSvg.appendChild(path); }); }
function clearLines(){ lineSvg.innerHTML=""; }
function showBiome(id, ms){ const el=document.getElementById(id); el.classList.add("show"); setTimeout(()=>el.classList.remove("show"), ms); }

function showFloatingPayout(amount){
  const rect = reelwindowEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "floatpay rise";
  el.textContent = "+"+formatCoins(amount);
  el.style.left = (rect.left+rect.width/2)+"px";
  el.style.top = (rect.top+rect.height/2)+"px";
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1450);
}
function showToast(text){
  toastText.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove("show"), 3200);
}
let achToastQueue=[]; let achToastBusy=false;
function processAchToastQueue(){
  if(achToastQueue.length===0){ achToastBusy=false; return; }
  achToastBusy=true;
  showToast(achToastQueue.shift());
  setTimeout(processAchToastQueue, 1800);
}
function unlockAch(key){
  if(!state.achievements) state.achievements = {};
  if(state.achievements[key]) return false;
  state.achievements[key] = true;
  const def = ACHIEVEMENT_DEFS.find(d=>d.key===key);
  const label = def ? (state.lang==="en"?def.en:def.ja) : key;
  achToastQueue.push(state.lang==="en" ? `Achievement: ${label}!` : `実績解除:${label}!`);
  if(!achToastBusy) processAchToastQueue();
  saveState();
  return true;
}
function checkAchievements(wins, totalPayout, payoutRatio, jackpotWin){
  if(!state.achievements) state.achievements = {};
  if(!state.symbolsWon) state.symbolsWon = {};
  if(!state.symbolWinCounts) state.symbolWinCounts = {};
  wins.forEach(w=>{
    state.symbolsWon[w.sym.id]=true;
    state.symbolWinCounts[w.sym.id]=(state.symbolWinCounts[w.sym.id]||0)+1;
  });
  if(true) unlockAch("firstWin");
  if(wins.some(w=>w.sym.id==="present")) unlockAch("jackpot");
  if(wins.length>=3) unlockAch("multiline");
  if(state.balance>=PLATINUM) unlockAch("richPlayer");
  if(wins.some(w=>w.sym.id==="jungle")) unlockAch("jungle");
  if(MIMIC_SYMBOLS.every(s=>state.symbolsWon[s.id])) unlockAch("allSymbols");
  if((state.totalSpins||0)>=100) unlockAch("spins100");
  if(state.streak>=5) unlockAch("streak5");
  if(payoutRatio>=100) unlockAch("megaWin");
  if((state.totalDigs||0)>=50) unlockAch("digMaster");
  if((state.freeSpinTriggers||0)>=5) unlockAch("bonusHunter");
  if((state.jackpotWins||0)>=1) unlockAch("mysteryRich");
  if((state.manaUsed||0)>=1) unlockAch("starMage");
  if(state.balance>=10*PLATINUM) unlockAch("megaRich");
  if(state.symbolsWon.hallowed) unlockAch("hallowFound");
  if(state.symbolsWon.corrupt && state.symbolsWon.crimson) unlockAch("evilTwins");
  if((state.totalSpins||0)>=500) unlockAch("spins500");
  if(wins.length===2) unlockAch("doubleTrouble");
  // README 8番: 追加31実績
  if((state.totalSpins||0)>=25) unlockAch("spins25");
  if((state.totalSpins||0)>=1000) unlockAch("spins1000");
  if((state.totalSpins||0)>=2500) unlockAch("spins2500");
  if((state.totalSpins||0)>=5000) unlockAch("spins5000");
  if(state.streak>=8) unlockAch("streak8");
  if(state.streak>=11) unlockAch("streak11");
  if(payoutRatio>=200) unlockAch("megaWin200");
  if((state.totalDigs||0)>=100) unlockAch("digMaster100");
  if((state.totalDigs||0)>=250) unlockAch("digMaster250");
  if((state.manaUsed||0)>=10) unlockAch("manaMaster");
  if((state.jackpotWins||0)>=3) unlockAch("jackpotStreak3");
  if((state.freeSpinTriggers||0)>=20) unlockAch("freeSpinFan");
  if((state.kakuhenTriggers||0)>=1) unlockAch("kakuhenFirst");
  if((state.kakuhenTriggers||0)>=10) unlockAch("kakuhenVeteran");
  if(state.symbolsWon.ice) unlockAch("iceFound");
  if(state.symbolsWon.corrupt) unlockAch("corruptFound");
  if(state.symbolsWon.crimson) unlockAch("crimsonFound");
  if(["corrupt","crimson","hallowed","jungle"].every(id=>state.symbolsWon[id])) unlockAch("allBiomes");
  if(wins.length>=5) unlockAch("pentaLine");
  if(wins.length===8) unlockAch("perfectBoard");
  if(state.balance>=100*PLATINUM) unlockAch("balanceUltra");
  if((state.bottles||0)>=5) unlockAch("bottleHoarder");
  if((state.bottleUsedCount||0)>=10) unlockAch("bottleAddict");
  if((state.symbolWinCounts.mimic||0)>=100) unlockAch("mimicMaster");
  if((state.symbolWinCounts.ice||0)>=50) unlockAch("iceMaster");
  if(jackpotWin!=null){ state.biggestJackpot = Math.max(state.biggestJackpot||0, jackpotWin); }
  if((state.biggestJackpot||0)>=PLATINUM) unlockAch("jackpotBig");
  saveState();
}
let spinning=false;
function weightedFinalGrid(boost){
  const pool = manaPurifyNextSpin ? SYMBOLS.filter(s=>s.tier!==1) : SYMBOLS;
  const result=[]; for(let c=0;c<3;c++){ const col=[]; for(let r=0;r<3;r++){ const sym=pickSymbol(pool, boost); col.push({sym,variant:pickVariantIndex(sym)}); } result.push(col); } return result;
}
async function spin(){
  if(spinning) return;
  state.totalSpins=(state.totalSpins||0)+1;
  if(state.totalSpins===AUTOSPIN_UNLOCK_SPINS){ showToast(state.lang==="en"?"Auto-spin unlocked! (stress ball)":"ストレスボール(自動スピン)が使えるようになった!"); }
  updateAutoSpinUI();
  const isFree = freeSpinsRemaining>0;
  let bet;
  if(isFree){
    bet = lastRealBet;
  } else {
    bet = currentBet();
    if(state.balance<bet){ setMsg("所持金が足りません。下の「発掘」でコインを稼ごう","Not enough coins — try digging below!"); return; }
    if(bet===BET_STEPS[BET_STEPS.length-1]) unlockAch("bigBet");
    if(bet===BET_STEPS[0]) unlockAch("smallBet");
  }
  spinning=true; spinBtn.disabled=true; clearLines();
  const kakuActive = kakuhenRemaining>0;
  if(!isFree && !kakuActive){ state.pityCount=(state.pityCount||0)+1; }
  if(isFree){
    freeSpinsRemaining -= 1; updateFreeSpinBadge();
  } else {
    state.balance-=bet; renderBalance(); lastRealBet=bet;
    const feedRate = state.luckyCoinOwned ? JACKPOT_FEED_RATE_LUCKY : JACKPOT_FEED_RATE;
    state.jackpotPool += Math.max(1, Math.floor(bet*feedRate)); renderJackpot();
  }
  setMsg(isFree?"フリースピン中…":"回転中…", isFree?"Free spin...":"Spinning...");
  cells.forEach(c=>c.el.classList.add("spinning"));
  const flickers=cells.map(cell=>setInterval(()=>{ const sym=pickSymbol(); cell.img.src=SPR[sym.chestVariants[pickVariantIndex(sym)]]; if(Math.random()<0.25) sfxTick(); },65));
  const finalGrid=weightedFinalGrid(kakuActive);
  if(manaPurifyNextSpin){ manaPurifyNextSpin=false; }
  const turboScale = (state.turboUnlocked && state.turboEnabled) ? 0.55 : 1;
  const stopTimes=[700,1100,1600].map(t=>Math.round(t*turboScale));
  // cells[] is built row-major (index = row*3 + col), so column c's three cells are at indices c, 3+c, 6+c — NOT c*3..c*3+2.
  await Promise.all([0,1,2].map(c=>new Promise(res=>{
    setTimeout(()=>{
      clearInterval(flickers[c]); clearInterval(flickers[3+c]); clearInterval(flickers[6+c]);
      for(let r=0;r<3;r++){ const cell=cellAt(r,c); cell.el.classList.remove("spinning");
        const {sym,variant}=finalGrid[c][r]; setCellChest(cell,sym,variant);
        cell.el.classList.add("shake"); setTimeout(()=>cell.el.classList.remove("shake"),350); }
      shakeCabinet("shake-sm"); sfxStop(); res();
    }, stopTimes[c]);
  })));
  await new Promise(r=>setTimeout(r,Math.round(220*turboScale)));
  const wins = LINES.map(line=>{ const syms=line.cells.map(([r,c])=>finalGrid[c][r].sym.id);
    if(syms[0]===syms[1] && syms[1]===syms[2]){ const sym=finalGrid[line.cells[0][1]][line.cells[0][0]].sym; return {line,sym,payout:bet*sym.mult}; }
    return null; }).filter(Boolean);

  let scatterCount=0;
  for(let c=0;c<3;c++) for(let r=0;r<3;r++) if(finalGrid[c][r].sym.id===SCATTER_ID) scatterCount++;

  let jackpotWin=0;
  if(!isFree && Math.random()<JACKPOT_TRIGGER_CHANCE){ jackpotWin=state.jackpotPool; state.jackpotPool=JACKPOT_SEED; renderJackpot(); state.jackpotWins=(state.jackpotWins||0)+1; }

  let triggeredFreeSpins=false;
  if(scatterCount>=SCATTER_MIN){ freeSpinsRemaining+=FREE_SPINS_AWARD; triggeredFreeSpins=true; updateFreeSpinBadge(); state.freeSpinTriggers=(state.freeSpinTriggers||0)+1; }

  // Zenith theme special win: all 9 cells show 9 different Zenith-ingredient swords at once.
  // Impossible to also be a line win (no 3 cells can share a symbol when all 9 are distinct).
  let zenithBonus = 0;
  if(isZenithAssembled(finalGrid)){
    zenithBonus = bet * ZENITH_ASSEMBLE_MULT;
    state.zenithAssembles = (state.zenithAssembles||0)+1;
  }

  const bottleMultAtSpinTime = bottleBuffRemaining>0 ? bottleBuffMult : 1;
  if(bottleBuffRemaining>0){ bottleBuffRemaining--; updateBottleBuffBadge(); renderBottleUI(); }

  const kakuMultAtSpinTime = kakuActive ? KAKU_MULT : 1;
  if(kakuActive){ kakuhenRemaining--; }

  if(wins.length || jackpotWin>0 || triggeredFreeSpins || zenithBonus>0){
    await playWin(wins, {isFree, jackpotWin, triggeredFreeSpins, bet, bottleMultAtSpinTime, kakuMultAtSpinTime, zenithBonus});
  } else {
    setMsg("擬態を見破れ…!","Spot the mimics...!");
    state.streak=0; updateStreakLine();
  }
  // bonus mode: never re-triggers while active; ends quietly after its last spin
  if(!kakuActive){
    if(wins.length>0 && state.streak===KAKU_STREAK_TRIGGER) startKakuhen(`${KAKU_STREAK_TRIGGER}連勝!確変突入`, `${KAKU_STREAK_TRIGGER}-win streak! Bonus mode`);
    else if((state.pityCount||0)>=PITY_LIMIT) startKakuhen("天井到達!確変突入","Pity reached! Bonus mode", true);
  } else if(kakuhenRemaining===0){
    showToast(state.lang==="en" ? "Bonus mode ended" : "確変終了");
  }
  updateKakuUI();
  spinBtn.disabled=false; spinning=false; saveState();
}

async function playWin(wins, extra){
  extra = extra||{};
  const isFree=!!extra.isFree, jackpotWin=extra.jackpotWin||0, triggeredFreeSpins=!!extra.triggeredFreeSpins, zenithBonus=extra.zenithBonus||0;

  if(wins.length || zenithBonus>0){
    reelwindowEl.classList.add("winpunch"); setTimeout(()=>reelwindowEl.classList.remove("winpunch"),380);
    // line-drawing overlay removed per user preference; wins are still shown via cell pop/flash/reveal
    const revealSet=new Map();
    wins.forEach(w=>w.line.cells.forEach(([r,c])=>revealSet.set(r+"_"+c,[r,c])));
    if(zenithBonus>0){ for(let r=0;r<3;r++) for(let c=0;c<3;c++) revealSet.set(r+"_"+c,[r,c]); }
    revealSet.forEach(([r,c])=>{ const cell=cellAt(r,c); cell.el.classList.add("popflash");
      cell.img.src=SPR[cell.sym.revealVariants[cell.variantIdx % cell.sym.revealVariants.length]];
      cell.el.classList.add("pop"); setTimeout(()=>{ cell.el.classList.remove("pop"); cell.el.classList.remove("popflash"); },650); });
    sfxPop();
    state.streak += 1;
  } else {
    state.streak = 0;
  }
  updateStreakLine();
  const streakMult = state.streak>=2 ? (1+Math.min(state.streak-1,10)*0.10) : 1;
  const freeMult = isFree ? FREE_SPINS_MULT : 1;
  const bottleMult = extra.bottleMultAtSpinTime || 1;
  const kakuMult = extra.kakuMultAtSpinTime || 1;
  let linePayout = Math.round(wins.reduce((s,w)=>s+w.payout,0) * streakMult * freeMult * bottleMult * kakuMult);
  const totalPayout = linePayout + jackpotWin + zenithBonus;

  if(totalPayout>0) showFloatingPayout(totalPayout);
  let maxWait=700;
  const refBet = extra.bet || lastRealBet || 1;
  const payoutRatio = refBet>0 ? totalPayout/refBet : 0;
  let winTierBanner=null;
  if(payoutRatio>=100) winTierBanner = state.lang==="en"?"MEGA WIN!!!":"メガウィン!!!";
  else if(payoutRatio>=40) winTierBanner = state.lang==="en"?"HUGE WIN!!":"ヒュージウィン!!";
  else if(payoutRatio>=15) winTierBanner = state.lang==="en"?"BIG WIN!":"ビッグウィン!";
  else if(payoutRatio>=5) winTierBanner = state.lang==="en"?"NICE WIN!":"ナイスウィン!";
  if(winTierBanner){ showBanner(winTierBanner, payoutRatio>=40?2000:1300); maxWait = Math.max(maxWait, (payoutRatio>=40?2000:1300)+400); }
  if(wins.length){
    const uniqueSymbols=[...new Map(wins.map(w=>[w.sym.id,w.sym])).values()];
    const topSym=uniqueSymbols.reduce((a,b)=>a.tier>=b.tier?a:b);
    const flashColors={coin:"rgba(255,225,150,.6)",frost:"rgba(150,220,255,.6)",corrupt:"rgba(160,90,230,.6)",crimson:"rgba(230,60,80,.6)",hallow:"rgba(255,180,245,.6)",jungle:"rgba(100,210,80,.6)",jackpot:"rgba(255,225,140,.7)"};
    screenFlash(flashColors[topSym.fx]||"rgba(255,255,255,.4)", topSym.tier>=4?700:400);
    if(topSym.tier>=3) sfxBigReveal();

    const comboJa=wins.length>1?`${wins.length}ライン同時ヒット!`:"";
    const comboEn=wins.length>1?`${wins.length}-LINE COMBO!`:"";
    setMsg(uniqueSymbols.map(s=>s.nameJa).join("+")+` そろい! 合計+${formatCoins(totalPayout)}`, uniqueSymbols.map(s=>s.nameEn).join("+")+` match! Total +${formatCoins(totalPayout)}`, comboJa, comboEn, true);

    uniqueSymbols.forEach(sym=>{
      if(sym.fx==="coin"){ shakeCabinet("shake-sm"); spawnParticles("coin",14); sfxCoin(1); maxWait=Math.max(maxWait,700); }
      else if(sym.fx==="frost"){ shakeCabinet("shake-sm"); spawnParticles("snow",22); sfxCoin(1.3); maxWait=Math.max(maxWait,900); }
      else if(sym.fx==="corrupt"){ shakeCabinet("shake-md"); spawnParticles("spore",26); showBiome("bioCorrupt",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="crimson"){ shakeCabinet("shake-md"); spawnParticles("blood",26); showBiome("bioCrimson",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="hallow"){ shakeCabinet("shake-md"); spawnParticles("spark",30); showBiome("bioHallow",1300); maxWait=Math.max(maxWait,1300); }
      else if(sym.fx==="jungle"){ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
        spawnParticles("tree",26); showBanner((state.lang==="en"?sym.nameEn.toUpperCase():sym.nameJa)+"!!",1500);
        maxWait=Math.max(maxWait,1700); }
      else if(sym.fx==="jackpot"){ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
        borderLights.classList.add("on");
        spawnParticles("confetti",40); spawnParticles("snow",24); spawnParticles("coin",24); spawnParticles("rainbow",8); spawnParticles("fragment",10);
        showBanner("★ JACKPOT ★",2400); sfxJackpot();
        setTimeout(()=>{ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400); },260);
        setTimeout(()=>borderLights.classList.remove("on"),2600); maxWait=Math.max(maxWait,2600); }
    });
    if(wins.length>1) showBanner((state.lang==="en"?wins.length+"-LINE COMBO!":wins.length+"ライン コンボ!"), 1400);
  } else if(jackpotWin>0 || triggeredFreeSpins){
    setMsg(state.lang==="en"?"Bonus triggered!":"ボーナス発生!", state.lang==="en"?"Bonus triggered!":"ボーナス発生!", null, null, true);
  }

  if(zenithBonus>0){
    shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
    borderLights.classList.add("on");
    screenFlash("rgba(180,140,255,.8)", 900);
    spawnParticles("confetti",60); spawnParticles("rainbow",16); spawnParticles("fragment",14); spawnParticles("spark",30);
    showBanner(state.lang==="en"?"★ ZENITH ASSEMBLED! ★":"★ ゼニス、完成!! ★", 2800);
    setMsg(state.lang==="en"?`All 9 swords aligned! +${formatCoins(zenithBonus)}`:`9本の剣が揃った! +${formatCoins(zenithBonus)}`, state.lang==="en"?`All 9 swords aligned! +${formatCoins(zenithBonus)}`:`9本の剣が揃った! +${formatCoins(zenithBonus)}`, null, null, true);
    sfxJackpot();
    setTimeout(()=>{ shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400); },300);
    setTimeout(()=>{ shakeCabinet("shake-lg"); }, 700);
    setTimeout(()=>borderLights.classList.remove("on"),3000);
    maxWait = Math.max(maxWait, 3000);
  }

  if(jackpotWin>0){
    shakeCabinet("shake-lg"); cabinet.classList.add("punch"); setTimeout(()=>cabinet.classList.remove("punch"),400);
    borderLights.classList.add("on");
    spawnParticles("confetti",50); spawnParticles("coin",40); spawnParticles("rainbow",10);
    showBanner(state.lang==="en"?"MYSTERY JACKPOT!!":"ミステリージャックポット!!",2600);
    sfxJackpot();
    setTimeout(()=>borderLights.classList.remove("on"),2800);
    maxWait=Math.max(maxWait,2800);
  }
  if(triggeredFreeSpins){
    setTimeout(()=>showBanner(state.lang==="en"?"FREE SPINS +5!":"フリースピン+5回!",1800), jackpotWin>0?900:0);
    showToast(state.lang==="en"?"Bonus! 5 Free Spins (x2) unlocked":"ボーナス!フリースピン5回(x2)獲得");
    maxWait=Math.max(maxWait, (jackpotWin>0?900:0)+1800);
  }

  state.balance += totalPayout; renderBalance();
  checkAchievements(wins, totalPayout, payoutRatio, jackpotWin);
  await new Promise(r=>setTimeout(r, maxWait));
  clearLines();
}

spinBtn.onclick = spin;
