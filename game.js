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
const ZENITH_ASSEMBLE_MULT = 17500; // flat bet multiplier when all 9 Zenith swords land at once (2026-09-28: rescaled ~1.86x alongside ZENITH_SYMBOLS' mults)

// Restored from state (not just defaulted to 0) so an in-progress bonus round, free-spin streak
// or bottle buff survives a tab refresh instead of silently vanishing - saveState() below keeps
// these three synced back into state on every save.
// var (not let) is deliberate here: saveState() in audio_data.js reads these back via a
// `typeof x!=="undefined"` guard so an early save (e.g. checkPlatinumAutoConvert firing on the
// very first renderBalance() call for a returning player already over the auto-convert threshold)
// falls back to state.x instead of crashing. `let` puts the guard itself in the temporal dead zone
// until this exact line runs, throwing "not defined" instead of returning "undefined" - a real bug
// that broke the game on load for any player already past this net worth (found 2026-09-29).
var freeSpinsRemaining = state.freeSpinsRemaining||0;
var bottleBuffRemaining = state.bottleBuffRemaining||0;
var bottleBuffMult = state.bottleBuffMult||2;
var kakuhenRemaining = state.kakuhenRemaining||0;
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
  const stacking = kakuhenRemaining>0;
  kakuhenRemaining += KAKU_SPINS; // extend rather than overwrite, so a re-trigger mid-bonus is never wasted
  state.pityCount = 0; state.kakuhenTriggers=(state.kakuhenTriggers||0)+1;
  updateKakuUI();
  showBanner(state.lang==="en" ? (stacking?"BONUS EXTENDED!":"BONUS MODE!") : (stacking?"確変延長!!":"確変突入!!"), 1800);
  showToast(state.lang==="en" ? reasonEn : reasonJa);
  spawnParticles("rainbow",12); sfxBigReveal();
  if(viaPity) unlockAch("kakuhenPity");
}
function renderBottleUI(){
  const total = (state.bottles||0) + (state.superBottles||0);
  bottleCountEl.textContent = total;
  useBottleBtn.disabled = !(total>0);
}
function updateBottleBuffBadge(){
  if(bottleBuffRemaining>0){
    bottleBuffBadge.classList.add("show"); bbLeft.textContent=bottleBuffRemaining; bbLeftEn.textContent=bottleBuffRemaining;
    document.getElementById("bbMult").textContent = bottleBuffMult;
    document.getElementById("bbMultEn").textContent = bottleBuffMult;
  }
  else { bottleBuffBadge.classList.remove("show"); }
  updateHudStrip();
}
// Fallback only matters if free spins are somehow active before any real spin this session -
// which is now reachable since freeSpinsRemaining survives a reload (see saveState()). The old
// "*SILVER" here was a latent bug (100x too large) that stayed dormant only because this path
// used to be unreachable before that persistence fix.
var lastRealBet = state.lastRealBet || BET_STEPS[betIndex]; // var: see note above freeSpinsRemaining

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
  const wanted = Math.floor(convertible/MEDAL_RATE);
  if(wanted<=0) return;
  state.balance -= wanted*MEDAL_RATE;
  addDefenderMedals(wanted);
  saveState();
  showToast(state.lang==="en" ? `Coins capped out - converted to +${wanted} Defender Medal${wanted>1?"s":""}!` : `所持金が上限に達し、防衛メダル+${wanted}枚に変換されました!`);
}
// エーテリアンマナ(2026-09-28追記):ディフェンダーのメダルを単純に9999枚で頭打ちにするのをやめ、
// 1000枚を残して超過分を自動でマナ1000枚=1ポイントに変換するエンドコンテンツ通貨。メダルの実質的な
// 上限を撤廃しつつ、メダル自体は常に使い出のある(1000枚前後の)水準に保たれる。マナはいつでも
// メダルへ手動で変換し直せる(`convertManaToMedals`)。
const ETHERIAN_MANA_RATE = 1000; // メダル1000枚 = マナ1ポイント
const MEDAL_RESERVE = 1000; // 自動変換後も必ず手元に残る最低メダル枚数
function addDefenderMedals(n){
  if(n<=0) return;
  state.defenderMedals = (state.defenderMedals||0)+n;
  if(state.defenderMedals >= MEDAL_RESERVE + ETHERIAN_MANA_RATE){
    const gained = Math.floor((state.defenderMedals - MEDAL_RESERVE) / ETHERIAN_MANA_RATE);
    state.defenderMedals -= gained*ETHERIAN_MANA_RATE;
    state.etherianMana = (state.etherianMana||0) + gained;
    showToast(state.lang==="en"
      ? `Defender Medals converted: +${gained} Etherian Mana!`
      : `ディフェンダーメダルが変換され、エーテリアンマナ+${gained}!`);
  }
}
function convertManaToMedals(amount){
  const mana = Math.floor(amount);
  if(mana<=0 || mana>(state.etherianMana||0)) return false;
  state.etherianMana -= mana;
  state.defenderMedals = (state.defenderMedals||0) + mana*ETHERIAN_MANA_RATE;
  saveState(); renderBalance();
  showToast(state.lang==="en" ? `Converted ${mana} Etherian Mana into ${mana*ETHERIAN_MANA_RATE} Defender Medals!` : `エーテリアンマナ${mana}を防衛メダル${mana*ETHERIAN_MANA_RATE}枚に変換した!`);
  return true;
}
function fmtMana(n){
  n = n||0;
  if(n<1000) return String(n);
  const units = [[1e9,"b"],[1e6,"m"],[1e3,"k"]];
  for(const [v,suf] of units){ if(n>=v) return (n/v).toFixed(n/v>=100?0:1).replace(/\.0$/,"")+suf; }
  return String(n);
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
function fitBalanceCoins(){
  const row = document.getElementById("balanceCoins");
  if(!row) return;
  row.style.transform = "";
  const avail = balanceBar.clientWidth, need = row.scrollWidth;
  if(avail>0 && need>avail) row.style.transform = `scale(${Math.max(0.45, avail/need)})`;
}
function paintBalance(v){
  const {p,g,s,c}=toCoins(Math.max(0,v));
  balanceBar.innerHTML = `<div class="coinrow" id="balanceCoins">
    <div class="coin" id="coinP"><img class="spr" src="${SPR.coin_platinum}" style="width:17px;height:20px">${p}</div>
    <div class="coin" id="coinG"><img class="spr" src="${SPR.coin_gold}" style="width:15px;height:20px">${g}</div>
    <div class="coin" id="coinS"><img class="spr" src="${SPR.coin_silver}" style="width:15px;height:17px">${s}</div>
    <div class="coin" id="coinC"><img class="spr" src="${SPR.coin_copper}" style="width:15px;height:15px">${c}</div>
    <div class="coin" id="coinMedal" title="${state.lang==="en"?"Defender Medals":"防衛メダル"}"><img class="spr" src="${SPR.icon_defendermedal}" style="width:16px;height:16px">${state.defenderMedals||0}</div>
    ${(state.etherianMana||0)>0 ? `<div class="coin" id="coinMana" title="${state.lang==="en"?"Etherian Mana (click to convert)":"エーテリアンマナ(クリックで変換)"}"><img class="spr" src="${SPR.icon_etherianmana}" style="width:16px;height:16px">${fmtMana(state.etherianMana)}</div>` : ""}
  </div>`;
  const coinManaEl = document.getElementById("coinMana");
  if(coinManaEl) coinManaEl.onclick = openManaModal;
  if(p>lastCoins.p) document.getElementById("coinP").classList.add("bump");
  if(g>lastCoins.g) document.getElementById("coinG").classList.add("bump");
  if(s>lastCoins.s) document.getElementById("coinS").classList.add("bump");
  lastCoins={p,g,s,c};
  fitBalanceCoins();
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
window.addEventListener('resize', fitBalanceCoins);
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
var manaPurifyNextSpin = !!state.manaPurifyNextSpin; // var: see note above freeSpinsRemaining (this is the one that actually crashed)
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
  const landY = skyH - 20; // star's rendered height is ~18-20px; bottom edge should land flush with the grass top (skyH), not sink into it
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
  if(!hasSuper && !hasRegular) return;
  const stacking = bottleBuffRemaining>0;
  const newMult = hasSuper ? 3 : 2;
  if(hasSuper){ state.superBottles -= 1; } else { state.bottles -= 1; }
  bottleBuffMult = stacking ? Math.max(bottleBuffMult, newMult) : newMult; // stacking a weaker bottle never downgrades the active buff
  bottleBuffRemaining += 5; // extend rather than overwrite, so using another bottle mid-buff is never wasted
  state.bottleUsedCount = (state.bottleUsedCount||0)+1;
  renderBottleUI(); updateBottleBuffBadge(); saveState(); sfxGrab();
  const first = unlockAch("bottleUsed");
  unlockAch("bottleAddict");
  if(!first){
    showToast(state.lang==="en"
      ? (stacking ? `Lucky Potion extended! ${bottleBuffMult}x payouts for ${bottleBuffRemaining} more spins` : `Lucky Potion active! ${bottleBuffMult}x payouts for 5 spins`)
      : (stacking ? `ラッキーポーション延長!配当${bottleBuffMult}倍が残り${bottleBuffRemaining}スピンに` : `ラッキーポーション発動!5スピン配当${bottleBuffMult}倍`));
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
  if(themeId==="slime") unlockAch("unlockSlime");
  if(themeId==="zombie") unlockAch("unlockZombie");
  if(themeId==="zenith") unlockAch("unlockZenith");
  if(THEME_ORDER.every(id=>state.themeUnlocked[id])) unlockAch("allThemesUnlocked");
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
    const costEl = btn.querySelector(".tcnum");
    if(costEl) costEl.textContent = def.unlockCost; // was a hardcoded number in index.html - drifted out of sync with THEME_DEFS when Zenith's cost changed
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
document.getElementById("shopToggleBtn").onclick=()=>{ renderShop(); renderMinigameHub(); document.getElementById("shopModal").classList.add("show"); };
document.getElementById("shopModalClose").onclick=()=>{ document.getElementById("shopModal").classList.remove("show"); };
document.getElementById("shopModal").onclick=(e)=>{ if(e.target.id==="shopModal") e.currentTarget.classList.remove("show"); };

// テラリアクイズ:知識ベースのミニゲーム。ハードコード率の低い長期安定した事実のみを出題し、
// スロット本体と同じ「運まかせ」の体験にならないよう差別化する。
const QUIZ_COST = 3;
const QUIZ_ROUND_SIZE = 5;
const QUIZ_REWARD_TABLE = [0,1,2,4,7,15]; // index = 5問中の正解数
const QUIZ_QUESTIONS = [
  {qJa:"ウォール・オブ・フレッシュと戦う場所は?", qEn:"Where do you fight the Wall of Flesh?", choices:[
    {ja:"アンダーワールド(地獄)", en:"The Underworld", correct:true},
    {ja:"地下ジャングル", en:"The Underground Jungle"},
    {ja:"雪原バイオーム", en:"The Snow Biome"},
    {ja:"海", en:"The Ocean"}]},
  {qJa:"ハードモードが始まるきっかけは?", qEn:"What triggers Hardmode?", choices:[
    {ja:"ウォール・オブ・フレッシュを倒す", en:"Defeating the Wall of Flesh", correct:true},
    {ja:"ムーンロードを倒す", en:"Defeating the Moon Lord"},
    {ja:"スケルトロンを倒す", en:"Defeating Skeletron"},
    {ja:"キングスライムを倒す", en:"Defeating King Slime"}]},
  {qJa:"ディフェンダーのメダルが手に入るイベントは?", qEn:"Which event awards Defender Medals?", choices:[
    {ja:"オールドワンズアーミー", en:"The Old One's Army", correct:true},
    {ja:"フロストムーン", en:"The Frost Moon"},
    {ja:"パンプキンムーン", en:"The Pumpkin Moon"},
    {ja:"ブラッドムーン", en:"A Blood Moon"}]},
  {qJa:"ディフェンダーのメダルで買い物ができるNPCは?", qEn:"Which NPC sells items for Defender Medals?", choices:[
    {ja:"酒場の主人(タバーンキープ)", en:"The Tavernkeep", correct:true},
    {ja:"商人", en:"The Merchant"},
    {ja:"ガイド", en:"The Guide"},
    {ja:"魔法使い", en:"The Wizard"}]},
  {qJa:"クイーンビーを召喚できる場所は?", qEn:"Where do you summon Queen Bee?", choices:[
    {ja:"地下ジャングルの蜂の巣(幼虫)", en:"The Underground Jungle (Bee Larva)", correct:true},
    {ja:"コラプション", en:"The Corruption"},
    {ja:"雪原", en:"The Snow biome"},
    {ja:"普通の洞窟", en:"An ordinary cavern"}]},
  {qJa:"ゼニス(Zenith)の合成に使わない剣は?", qEn:"Which sword is NOT used to craft the Zenith?", choices:[
    {ja:"銅の剣(コッパーブロードソード)", en:"The Copper Broadsword", correct:true},
    {ja:"ナイツエッジ系の剣", en:"A Night's Edge-line sword"},
    {ja:"スターラース", en:"The Star Wrath"},
    {ja:"ミャウメア", en:"The Meowmere"}]},
  {qJa:"ディフェンダーのメダルの1スタック上限は?", qEn:"What is the stack cap for Defender Medals?", choices:[
    {ja:"9999枚", en:"9999", correct:true},
    {ja:"999枚", en:"999"},
    {ja:"99枚", en:"99"},
    {ja:"上限なし", en:"Unlimited"}]},
  {qJa:"コラプションとクリムゾンは同じワールドに両方生成される?", qEn:"Do the Corruption and Crimson both generate in the same world?", choices:[
    {ja:"されない(片方だけ)", en:"No — a world gets only one", correct:true},
    {ja:"される(必ず両方)", en:"Yes, always both"},
    {ja:"ハードモードで両方増える", en:"Both expand in Hardmode"},
    {ja:"プレイヤーが選んで両方置ける", en:"The player can place both freely"}]},
  {qJa:"ガイドNPCの主な役割は?", qEn:"What is the Guide NPC mainly used for?", choices:[
    {ja:"見せたアイテムのクラフトレシピを教える", en:"Telling you the crafting recipe for an item you show him", correct:true},
    {ja:"装備を強化する", en:"Enchanting your equipment"},
    {ja:"天気を予報する", en:"Forecasting the weather"},
    {ja:"ペットを配布する", en:"Handing out pets"}]},
  {qJa:"旅商人(Traveling Merchant)の出現の仕方は?", qEn:"How does the Traveling Merchant NPC appear?", choices:[
    {ja:"空き家があればランダムな日に一時的に訪れる", en:"Randomly visits for a day if you have a vacant house", correct:true},
    {ja:"特定のボスを倒すと出現する", en:"Only appears after defeating a specific boss"},
    {ja:"夜にしか出ない", en:"Only appears at night"},
    {ja:"一度来たらずっと定住する", en:"Permanently settles once it arrives"}]},
  {qJa:"プランテラと戦う前、その姿はどこにある?", qEn:"Where is Plantera before you fight her?", choices:[
    {ja:"地下ジャングルの巨大な蕾(バルブ)の中で眠っている", en:"Asleep inside a giant bulb in the Underground Jungle", correct:true},
    {ja:"アンダーワールドを徘徊している", en:"Wandering the Underworld"},
    {ja:"ダンジョンの最深部にいる", en:"At the bottom of the Dungeon"},
    {ja:"空に浮かんでいる", en:"Floating in the sky"}]},
  {qJa:"ムーンロードを召喚するのに必要なアイテムは?", qEn:"What item is needed to summon the Moon Lord?", choices:[
    {ja:"セレスティアルサイジル(天体の印章)", en:"The Celestial Sigil", correct:true},
    {ja:"何もせず自動で出現する", en:"Nothing — it spawns automatically"},
    {ja:"満月の夜に自然発生する", en:"It spawns naturally on a full moon"},
    {ja:"ダンジョンのNPCに話しかける", en:"Talking to an NPC in the Dungeon"}]},
  {qJa:"トリュフ(Truffle)NPCが引っ越してくる条件は?", qEn:"What lets the Truffle NPC move in?", choices:[
    {ja:"地上にキノコバイオームを作る", en:"Building a surface Glowing Mushroom biome", correct:true},
    {ja:"地下に行く", en:"Going underground"},
    {ja:"ジャングルを解禁する", en:"Unlocking the Jungle"},
    {ja:"ボスを1体倒す", en:"Defeating any one boss"}]},
  {qJa:"ブラッドムーンが起きると空はどんな色になる?", qEn:"What color does the sky turn during a Blood Moon?", choices:[
    {ja:"赤", en:"Red", correct:true},
    {ja:"緑", en:"Green"},
    {ja:"紫", en:"Purple"},
    {ja:"変わらない", en:"It doesn't change"}]},
  {qJa:"スケルトロンを倒すと何が変わる?", qEn:"What changes after defeating Skeletron?", choices:[
    {ja:"ダンジョンに昼間でも安全に入れる", en:"The Dungeon becomes safe to enter during the day", correct:true},
    {ja:"ハードモードになる", en:"Hardmode begins"},
    {ja:"旅商人が定住する", en:"The Traveling Merchant settles permanently"},
    {ja:"全ボスが弱体化する", en:"All bosses become weaker"}]},
  {qJa:"キングスライムを召喚するアイテムは?", qEn:"What item summons King Slime?", choices:[
    {ja:"スライムクラウン", en:"The Slime Crown", correct:true},
    {ja:"スライムの心臓", en:"A Slime Heart"},
    {ja:"ゼリーの結晶", en:"A Gel Crystal"},
    {ja:"何もいらず自然発生のみ", en:"Nothing — it's wild-spawn only"}]},
  {qJa:"人狼(ワーウルフ)が特に出現しやすい夜は?", qEn:"Werewolves are especially likely to spawn during:", choices:[
    {ja:"満月の夜", en:"A full moon", correct:true},
    {ja:"新月の夜", en:"A new moon"},
    {ja:"ブラッドムーン限定", en:"Blood Moons only"},
    {ja:"雨の夜限定", en:"Rainy nights only"}]},
  {qJa:"染料(ダイ)をクラフトするのに必要な施設は?", qEn:"What's needed to craft Dyes?", choices:[
    {ja:"ダイバット", en:"A Dye Vat", correct:true},
    {ja:"かまど", en:"A Furnace"},
    {ja:"アンビル", en:"An Anvil"},
    {ja:"作業台", en:"A Work Bench"}]},
  {qJa:"次のうち、ハードモードで新しく手に入る鉱石でないものは?", qEn:"Which of these is NOT a new Hardmode ore?", choices:[
    {ja:"鉄", en:"Iron", correct:true},
    {ja:"コバルト/パラジウム", en:"Cobalt/Palladium"},
    {ja:"ミスリル/オリハルコン", en:"Mythril/Orichalcum"},
    {ja:"アダマンタイト/チタニウム", en:"Adamantite/Titanium"}]},
  {qJa:"ジャングルの寺院に入るための鍵は?", qEn:"What key is needed to enter the Lihzahrd Temple?", choices:[
    {ja:"テンプルキー(プランテラのドロップ)", en:"The Temple Key, dropped by Plantera", correct:true},
    {ja:"ダンジョンの鍵", en:"A Dungeon key"},
    {ja:"金の鍵", en:"A Golden Key"},
    {ja:"鍵は不要", en:"No key is needed"}]},
  {qJa:"ハロウ(The Hallow)が出現するタイミングは?", qEn:"When does the Hallow first appear?", choices:[
    {ja:"ハードモード開始と同時にワールドに新生成される", en:"It's newly generated across the world when Hardmode begins", correct:true},
    {ja:"最初からワールドに存在する", en:"It exists from world creation"},
    {ja:"ムーンロードを倒すと出現する", en:"It appears after defeating the Moon Lord"},
    {ja:"プレイヤーが種で植える", en:"The player plants it from a seed"}]},
];
const QUIZ_TIME_LIMIT = 8000; // 難易度向上(2026-09-28): 無制限に考えられると易しすぎるため、1問あたり8秒の時間制限を追加
let quizSession = null;
let quizTimerId = null;
function shuffleArr(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function renderQuizIntro(){
  const en = state.lang==="en";
  const canAfford = (state.defenderMedals||0) >= QUIZ_COST;
  document.getElementById("quizBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `Answer ${QUIZ_ROUND_SIZE} Terraria trivia questions (4 choices each) — you have ${QUIZ_TIME_LIMIT/1000} seconds per question. Entry costs ${QUIZ_COST} Defender Medals — the more you get right, the more medals you win back.`
      : `テラリアの4択クイズに${QUIZ_ROUND_SIZE}問挑戦(1問${QUIZ_TIME_LIMIT/1000}秒の制限時間あり)。参加費はディフェンダーのメダル${QUIZ_COST}枚、正解数が多いほどメダルがもらえる。`}</p>
    <button class="quiz-startbtn" id="quizStartBtn" ${canAfford?"":"disabled"}>${en?`Start (${QUIZ_COST} medals)`:`挑戦する(${QUIZ_COST}枚)`}</button>
    ${canAfford?"":`<div class="quiz-progress">${en?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"}</div>`}
  `;
  const btn = document.getElementById("quizStartBtn");
  if(btn && !btn.disabled) btn.onclick=()=>startQuiz();
}
function startQuiz(){
  if((state.defenderMedals||0) < QUIZ_COST){ showToast(state.lang==="en"?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"); renderQuizIntro(); return; }
  state.defenderMedals -= QUIZ_COST;
  saveState(); renderBalance();
  const picked = shuffleArr(QUIZ_QUESTIONS).slice(0,QUIZ_ROUND_SIZE).map(q=>({ qJa:q.qJa, qEn:q.qEn, choices:shuffleArr(q.choices) }));
  quizSession = { questions:picked, idx:0, correct:0 };
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const en = state.lang==="en";
  const q = quizSession.questions[quizSession.idx];
  const body = document.getElementById("quizBody");
  body.innerHTML = `
    <div class="quiz-progress">${en?"Question":"問題"} ${quizSession.idx+1} / ${quizSession.questions.length}</div>
    <div class="quiz-timerbar"><div class="quiz-timerfill" id="quizTimerFill"></div></div>
    <div class="quiz-q">${en?q.qEn:q.qJa}</div>
    <div class="quiz-choices">${q.choices.map((c,i)=>`<button class="quiz-choice" data-i="${i}">${en?c.en:c.ja}</button>`).join("")}</div>
  `;
  const startTime = Date.now();
  const fill = document.getElementById("quizTimerFill");
  quizTimerId = setInterval(()=>{
    const remain = Math.max(0, QUIZ_TIME_LIMIT - (Date.now()-startTime));
    fill.style.width = `${(remain/QUIZ_TIME_LIMIT)*100}%`;
    if(remain<=0){ clearInterval(quizTimerId); resolveQuizAnswer(q, body, -1); }
  }, 60);
  body.querySelectorAll(".quiz-choice").forEach(btn=>{
    btn.onclick=()=>{ clearInterval(quizTimerId); resolveQuizAnswer(q, body, +btn.dataset.i); };
  });
}
function resolveQuizAnswer(q, body, idx){
  const buttons = [...body.querySelectorAll(".quiz-choice")];
  buttons.forEach(b=>b.disabled=true);
  const picked = idx>=0 ? q.choices[idx] : null;
  if(picked && picked.correct){
    buttons[idx].classList.add("quiz-correct"); quizSession.correct++; playReal("unlock",0.5);
  } else {
    if(idx>=0) buttons[idx].classList.add("quiz-wrong");
    playReal("hit",0.4);
    const correctIdx = q.choices.findIndex(c=>c.correct);
    if(correctIdx>=0) buttons[correctIdx].classList.add("quiz-correct");
  }
  setTimeout(()=>{
    quizSession.idx++;
    if(quizSession.idx < quizSession.questions.length) renderQuizQuestion();
    else finishQuiz();
  }, 900);
}
function finishQuiz(){
  const en = state.lang==="en";
  const correct = quizSession.correct;
  const total = quizSession.questions.length;
  const reward = QUIZ_REWARD_TABLE[correct] || 0;
  state.quizPlayCount = (state.quizPlayCount||0)+1;
  if(correct===total) state.quizPerfectCount = (state.quizPerfectCount||0)+1;
  const given = reward;
  if(given>0){
    addDefenderMedals(given);
    if(correct===total) sfxJackpot(); else sfxCoin();
  }
  if(correct===total) unlockAch("quizPerfect");
  if((state.quizPlayCount||0)>=10) unlockAch("quizMaster");
  saveState(); renderBalance();
  document.getElementById("quizBody").innerHTML = `
    <div class="quiz-result ${correct===total?"bigwin-flash":""}">${en?`You got ${correct}/${total} correct!<br>+${reward} Defender Medals`:`${total}問中${correct}問正解!<br>ディフェンダーメダル +${reward}枚`}</div>
    <button class="quiz-retrybtn" id="quizRetryBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("quizRetryBtn").onclick=()=>renderQuizIntro();
  quizSession = null;
}
document.getElementById("quizModalClose").onclick=()=>{ document.getElementById("quizModal").classList.remove("show"); clearInterval(quizTimerId); quizSession=null; };
document.getElementById("quizModal").onclick=(e)=>{ if(e.target.id==="quizModal"){ e.currentTarget.classList.remove("show"); clearInterval(quizTimerId); quizSession=null; } };

// 釣りミニゲーム:キャスト→アタリ待ち→アワセ→リールQTEの4段階。実在するテラリアの魚種名を採用しているが、
// terraria.wiki.gg本体がこのセッションのネットワーク環境からCloudflareのbot対策で到達不能だったため、
// スプライトは同じ雰囲気に寄せた自作のドット絵アイコン(sprites_data.jsのfish_*/deco_bobber/icon_fishingrod)を使用。
const FISH_COST = 8;
const FISH_SEGMENTS = 8;
const FISH_TICK_MS = 190; // 難易度向上(2026-09-28): 260→190msでマーカーの移動を速く
const FISH_ATTEMPTS = 5;
const FISH_NEED_HITS = 3; // 難易度向上(2026-09-28): 2/5→3/5に引き上げ
const FISH_TIERS = [
  { key:"common", nameJa:"トラウト", nameEn:"Trout", weight:55, reward:[1,2], zoneSize:4, iconKey:"fish_common" },
  { key:"rare", nameJa:"クリムゾンタイガーフィッシュ", nameEn:"Crimson Tigerfish", weight:28, reward:[4,4], zoneSize:3, iconKey:"fish_rare" },
  { key:"legendary", nameJa:"リーバーシャーク", nameEn:"Reaver Shark", weight:12, reward:[9,9], zoneSize:2, iconKey:"fish_legendary" },
  { key:"mythic", nameJa:"クリスタルサーペント", nameEn:"Crystal Serpent", weight:5, reward:[20,20], zoneSize:1, iconKey:"fish_mythic" },
];
function pickFishTier(){
  const total = FISH_TIERS.reduce((s,t)=>s+t.weight,0);
  let r = Math.random()*total;
  for(const t of FISH_TIERS){ if(r<t.weight) return t; r-=t.weight; }
  return FISH_TIERS[0];
}
let fishSession = null;
let fishTimer = null;
function renderFishIntro(){
  const en = state.lang==="en";
  const canAfford = (state.defenderMedals||0) >= FISH_COST;
  document.getElementById("fishBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `Cast a line for ${FISH_COST} Defender Medals. Hook the bite in time, then click Reel when the marker lands in the lit-up zone (need ${FISH_NEED_HITS} of ${FISH_ATTEMPTS} tries). Rarer fish pay more but are harder to land.`
      : `ディフェンダーのメダル${FISH_COST}枚でキャスト。アタリが来たらすぐアワセて、リールは光っている範囲にマーカーが来た瞬間にクリック(${FISH_ATTEMPTS}回中${FISH_NEED_HITS}回成功で釣り上げ)。レアな魚ほど報酬は高いが難しい。`}</p>
    <button class="quiz-startbtn" id="fishCastBtn" ${canAfford?"":"disabled"}>${en?`Cast (${FISH_COST} medals)`:`キャストする(${FISH_COST}枚)`}</button>
    ${canAfford?"":`<div class="quiz-progress">${en?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"}</div>`}
  `;
  const btn = document.getElementById("fishCastBtn");
  if(btn && !btn.disabled) btn.onclick=()=>startFishCast();
}
function startFishCast(){
  if((state.defenderMedals||0) < FISH_COST){ showToast(state.lang==="en"?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"); renderFishIntro(); return; }
  state.defenderMedals -= FISH_COST;
  saveState(); renderBalance();
  const en = state.lang==="en";
  document.getElementById("fishBody").innerHTML = `
    <div class="fish-wait pixel">${en?"Waiting for a bite...":"アタリを待っています…"}</div>
    <div class="fish-bobber-area"><img class="spr fish-bobber-img" id="fishBobberImg"></div>`;
  document.getElementById("fishBobberImg").src = SPR.deco_bobber;
  fishSession = { stage:"waiting" };
  const waitMs = 1500 + Math.random()*2000;
  setTimeout(()=>{ if(fishSession && fishSession.stage==="waiting") startBiteWindow(); }, waitMs);
}
function startBiteWindow(){
  fishSession.stage = "bite";
  const en = state.lang==="en";
  document.getElementById("fishBody").innerHTML = `
    <div class="fish-bite pixel">${en?"A bite!! Hook it now!":"アタリだ!!今アワセろ!"}</div>
    <button class="quiz-startbtn fish-hook-btn" id="fishHookBtn">${en?"Hook!":"アワセる!"}</button>`;
  playReal("hit",0.5);
  const biteTimeout = setTimeout(()=>{ if(fishSession && fishSession.stage==="bite") finishFishEscaped(); }, 1100); // 難易度向上(2026-09-28): 1500→1100ms
  document.getElementById("fishHookBtn").onclick=()=>{
    clearTimeout(biteTimeout);
    if(!fishSession || fishSession.stage!=="bite") return;
    sfxGrab();
    startReelQte();
  };
}
function startReelQte(){
  const tier = pickFishTier();
  fishSession = { stage:"reel", tier, hits:0, misses:0, segment:0,
    zoneStart: Math.floor(Math.random()*(FISH_SEGMENTS-tier.zoneSize+1)), startTime: Date.now() };
  renderReelQte();
  clearInterval(fishTimer);
  fishTimer = setInterval(()=>{
    if(!fishSession || fishSession.stage!=="reel") return;
    fishSession.segment = Math.floor((Date.now()-fishSession.startTime)/FISH_TICK_MS) % FISH_SEGMENTS;
    renderReelQte();
  }, 60);
}
function renderReelQte(){
  const en = state.lang==="en";
  const s = fishSession;
  const bar = Array.from({length:FISH_SEGMENTS},(_,i)=>{
    const inZone = i>=s.zoneStart && i<s.zoneStart+s.tier.zoneSize;
    const isMarker = i===s.segment;
    return `<span class="fish-seg ${inZone?"fish-seg-zone":""} ${isMarker?"fish-seg-marker":""}"></span>`;
  }).join("");
  document.getElementById("fishBody").innerHTML = `
    <div class="fish-reel-title pixel">${en?`Reeling in a ${s.tier.nameEn}...`:`${s.tier.nameJa}を釣り上げ中…`}</div>
    <div class="fish-reel-bar">${bar}</div>
    <div class="fish-reel-status pixel">${en?`Hits: ${s.hits}/${FISH_NEED_HITS} — Tries left: ${FISH_ATTEMPTS-s.hits-s.misses}`:`成功:${s.hits}/${FISH_NEED_HITS} 残り回数:${FISH_ATTEMPTS-s.hits-s.misses}`}</div>
    <button class="quiz-startbtn" id="fishReelBtn">${en?"Reel!":"巻く!"}</button>
  `;
  document.getElementById("fishReelBtn").onclick=()=>attemptReel();
}
function attemptReel(){
  const s = fishSession;
  if(!s || s.stage!=="reel") return;
  const inZone = s.segment>=s.zoneStart && s.segment<s.zoneStart+s.tier.zoneSize;
  if(inZone){ s.hits++; playReal("unlock",0.4); } else { s.misses++; playReal("hit",0.35); }
  if(s.hits>=FISH_NEED_HITS){ finishFishCaught(); return; }
  if(s.hits+s.misses>=FISH_ATTEMPTS){ finishFishEscaped(); return; }
  s.zoneStart = Math.floor(Math.random()*(FISH_SEGMENTS-s.tier.zoneSize+1));
  renderReelQte();
}
function finishFishCaught(){
  clearInterval(fishTimer);
  const en = state.lang==="en";
  const tier = fishSession.tier;
  const reward = tier.reward[0] + Math.floor(Math.random()*(tier.reward[1]-tier.reward[0]+1));
  state.fishCaught = (state.fishCaught||0)+1;
  state.fishTierCounts = state.fishTierCounts||{};
  state.fishTierCounts[tier.key] = (state.fishTierCounts[tier.key]||0)+1;
  const given = reward;
  addDefenderMedals(given);
  if(given>0){ if(tier.key==="mythic") sfxJackpot(); else sfxCoin(); }
  if((state.fishTierCounts.mythic||0)>=1) unlockAch("fishMythic");
  if((state.fishCaught||0)>=20) unlockAch("fishVeteran");
  saveState(); renderBalance();
  document.getElementById("fishBody").innerHTML = `
    <div class="fish-result ${tier.key==="mythic"?"bigwin-flash":""}">
      <img class="spr fish-result-img" src="${SPR[tier.iconKey]}">
      <div class="pixel">${en?`Caught a ${tier.nameEn}!`:`${tier.nameJa}を釣り上げた!`}</div>
      <div class="pixel">+${given} ${en?"Defender Medals":"ディフェンダーメダル"}</div>
    </div>
    <button class="quiz-retrybtn" id="fishBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("fishBackBtn").onclick=()=>renderFishIntro();
  fishSession = null;
}
function finishFishEscaped(){
  clearInterval(fishTimer);
  const en = state.lang==="en";
  document.getElementById("fishBody").innerHTML = `
    <div class="fish-result pixel">${en?"The fish got away...":"残念、逃げられた…"}</div>
    <button class="quiz-retrybtn" id="fishBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("fishBackBtn").onclick=()=>renderFishIntro();
  fishSession = null;
}
document.getElementById("fishModalClose").onclick=()=>{ document.getElementById("fishModal").classList.remove("show"); clearInterval(fishTimer); fishSession=null; };
document.getElementById("fishModal").onclick=(e)=>{ if(e.target.id==="fishModal"){ e.currentTarget.classList.remove("show"); clearInterval(fishTimer); fishSession=null; } };

// 抽選所:くじ引き・ガチャ・ガラポンは中身が同じ「重み付き抽選」なので1つのメカニクスに統合し、
// 演出(絵文字+ラベル)だけ毎回3種類からランダムに変える。
const DRAW_COST = 4;
const DRAW_MODES = [
  { emoji:"🎫", labelJa:"くじを引いています…", labelEn:"Drawing a ticket..." },
  { emoji:"🎁", labelJa:"ガチャを回しています…", labelEn:"Turning the gacha crank..." },
  { emoji:"🔴", labelJa:"ガラポンを回しています…", labelEn:"Spinning the lottery drum..." },
];
const DRAW_TIERS = [
  { key:"miss", ja:"はずれ", en:"No Luck", weight:45, reward:0, emoji:"😢" },
  { key:"small", ja:"小当たり", en:"Small Win", weight:30, reward:2, emoji:"🙂" },
  { key:"mid", ja:"中当たり", en:"Mid Win", weight:15, reward:6, emoji:"😄" },
  { key:"big", ja:"大当たり", en:"Big Win", weight:8, reward:15, emoji:"🤩" },
  { key:"jackpot", ja:"特大当たり", en:"Mega Win", weight:2, reward:40, emoji:"🎉" },
];
function pickDrawTier(){
  const total = DRAW_TIERS.reduce((s,t)=>s+t.weight,0);
  let r = Math.random()*total;
  for(const t of DRAW_TIERS){ if(r<t.weight) return t; r-=t.weight; }
  return DRAW_TIERS[0];
}
function renderDrawIntro(){
  const en = state.lang==="en";
  const canAfford = (state.defenderMedals||0) >= DRAW_COST;
  document.getElementById("drawBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `A lucky draw counter that appears as a lottery ticket, a gacha capsule, or a lottery drum at random. ${DRAW_COST} Defender Medals per try, 0 to 40 medals back depending on the prize.`
      : `くじ引き・ガチャ・ガラポンがランダムに出てくる抽選所。1回${DRAW_COST}枚で挑戦、景品に応じて0〜40枚が返ってくる。`}</p>
    <button class="quiz-startbtn" id="drawStartBtn" ${canAfford?"":"disabled"}>${en?`Try (${DRAW_COST} medals)`:`挑戦する(${DRAW_COST}枚)`}</button>
    ${canAfford?"":`<div class="quiz-progress">${en?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"}</div>`}
  `;
  const btn = document.getElementById("drawStartBtn");
  if(btn && !btn.disabled) btn.onclick=()=>startDraw();
}
function startDraw(){
  if((state.defenderMedals||0) < DRAW_COST){ showToast(state.lang==="en"?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"); renderDrawIntro(); return; }
  state.defenderMedals -= DRAW_COST;
  saveState(); renderBalance();
  const en = state.lang==="en";
  const mode = DRAW_MODES[Math.floor(Math.random()*DRAW_MODES.length)];
  document.getElementById("drawBody").innerHTML = `
    <div class="draw-mode-label">${en?mode.labelEn:mode.labelJa}</div>
    <div class="draw-anim">${mode.emoji}</div>
  `;
  playReal("doorOpen",0.5);
  setTimeout(()=>finishDraw(), 900);
}
function finishDraw(){
  const en = state.lang==="en";
  const tier = pickDrawTier();
  state.drawPlayCount = (state.drawPlayCount||0)+1;
  if(tier.key==="jackpot") state.drawJackpotCount = (state.drawJackpotCount||0)+1;
  const given = tier.reward;
  addDefenderMedals(given);
  if(tier.key==="jackpot") sfxJackpot();
  else if(tier.key==="small"||tier.key==="mid") playReal("starPickup",0.55);
  else if(given>0) sfxCoin();
  if(tier.key==="jackpot") unlockAch("drawJackpot");
  if((state.drawPlayCount||0)>=30) unlockAch("drawRegular");
  saveState(); renderBalance();
  document.getElementById("drawBody").innerHTML = `
    <div class="draw-result-icon ${tier.key==="jackpot"?"bigwin-flash":""}">${tier.emoji}</div>
    <div class="quiz-result ${tier.key==="jackpot"?"bigwin-flash":""}">${en?`${tier.en}!<br>+${given} Defender Medals`:`${tier.ja}!<br>ディフェンダーメダル +${given}枚`}</div>
    <button class="quiz-retrybtn" id="drawBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("drawBackBtn").onclick=()=>renderDrawIntro();
}
document.getElementById("drawModalClose").onclick=()=>{ document.getElementById("drawModal").classList.remove("show"); };
document.getElementById("drawModal").onclick=(e)=>{ if(e.target.id==="drawModal") e.currentTarget.classList.remove("show"); };

// コインフリップ:賭け金を選んでコイン投げ、当たるたびに持ち金×1.9で伸ばせるプッシュユアラック方式。
// 1.9倍(2倍未満)にしてあるのは、続けるほど期待値がわずかに下がる本物のハウスエッジを再現するため。
const COINFLIP_STAKES = [2,5,10,20];
const COINFLIP_MULT = 1.9;
let coinflipSession = null;
function renderCoinflipIntro(){
  const en = state.lang==="en";
  const medals = state.defenderMedals||0;
  coinflipSession = null;
  document.getElementById("coinflipBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `Pick a stake, then flip. Win and your pot grows ×1.9 — keep flipping or cash out anytime. Lose once and the whole pot is gone.`
      : `賭け金を選んでコインを投げる。当たれば持ち金が×1.9に増える。続けて賭けるか、好きなタイミングで換金できる。外れると持ち金は全部無くなる。`}</p>
    <div class="coinflip-stakebtns">${COINFLIP_STAKES.map(s=>`<button class="coinflip-optbtn" data-s="${s}" ${medals<s?"disabled":""}>${s}${en?"":"枚"}</button>`).join("")}</div>
  `;
  document.querySelectorAll(".coinflip-stakebtns .coinflip-optbtn").forEach(btn=>{
    if(btn.disabled) return;
    btn.onclick=()=>startCoinflip(+btn.dataset.s);
  });
}
function startCoinflip(stake){
  if((state.defenderMedals||0) < stake){ showToast(state.lang==="en"?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"); renderCoinflipIntro(); return; }
  state.defenderMedals -= stake;
  saveState(); renderBalance();
  coinflipSession = { stake, pot: stake, streak: 0 };
  renderCoinflipRound();
}
function renderCoinflipRound(){
  const en = state.lang==="en";
  const s = coinflipSession;
  document.getElementById("coinflipBody").innerHTML = `
    <img class="spr coinflip-coin" id="coinflipCoinImg">
    <div class="coinflip-banktext">${en?`Current pot: ${Math.floor(s.pot)} medals (streak ${s.streak})`:`現在の持ち金:${Math.floor(s.pot)}枚(連勝${s.streak})`}</div>
    <div class="coinflip-choicebtns">
      <button class="coinflip-optbtn" id="coinflipFlipBtn">${en?"Flip (50/50)":"賭ける(50%)"}</button>
      <button class="coinflip-optbtn" id="coinflipCashBtn">${en?"Cash Out":"換金する"}</button>
    </div>
  `;
  document.getElementById("coinflipCoinImg").src = SPR.coin_gold;
  document.getElementById("coinflipFlipBtn").onclick=()=>doCoinflip();
  document.getElementById("coinflipCashBtn").onclick=()=>cashOutCoinflip();
}
function doCoinflip(){
  document.getElementById("coinflipCoinImg").classList.add("flipping");
  document.getElementById("coinflipFlipBtn").disabled = true;
  document.getElementById("coinflipCashBtn").disabled = true;
  playReal("hit",0.4);
  setTimeout(()=>{
    const win = Math.random() < 0.5;
    const s = coinflipSession;
    if(!s) return;
    if(win){
      s.pot = s.pot*COINFLIP_MULT;
      s.streak++;
      state.coinflipMaxStreak = Math.max(state.coinflipMaxStreak||0, s.streak);
      if(s.streak>=5) unlockAch("coinflipStreak5");
      saveState();
      playReal("unlock",0.5);
      renderCoinflipRound();
    } else {
      playReal("hit",0.6);
      finishCoinflipLoss();
    }
  }, 700);
}
function finishCoinflipLoss(){
  const en = state.lang==="en";
  document.getElementById("coinflipBody").innerHTML = `
    <div class="quiz-result">${en?"Tails! You lost the whole pot.":"残念、外れ!持ち金は全部無くなった。"}</div>
    <button class="quiz-retrybtn" id="coinflipBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("coinflipBackBtn").onclick=()=>renderCoinflipIntro();
  coinflipSession = null;
}
function cashOutCoinflip(){
  const en = state.lang==="en";
  const s = coinflipSession;
  if(!s) return;
  const given = Math.floor(s.pot);
  addDefenderMedals(given);
  const bigWin = s.streak>=3;
  if(bigWin) sfxJackpot(); else sfxCoin();
  saveState(); renderBalance();
  document.getElementById("coinflipBody").innerHTML = `
    <div class="quiz-result ${bigWin?"bigwin-flash":""}">${en?`Cashed out ${given} Defender Medals!`:`ディフェンダーメダル${given}枚を換金した!`}</div>
    <button class="quiz-retrybtn" id="coinflipBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("coinflipBackBtn").onclick=()=>renderCoinflipIntro();
  coinflipSession = null;
}
document.getElementById("coinflipModalClose").onclick=()=>{ document.getElementById("coinflipModal").classList.remove("show"); coinflipSession=null; };
document.getElementById("coinflipModal").onclick=(e)=>{ if(e.target.id==="coinflipModal"){ e.currentTarget.classList.remove("show"); coinflipSession=null; } };

// ルーレット:実物のヨーロピアン式(0が1つ、37マス)と同じ配色・配当・還元率(理論値約97.3%)を再現。
// 数字ピンポイント賭けは省略し、赤黒/奇偶/レンジ/ドズンのアウトサイドベットのみに絞ってUIを簡潔にしている。
const ROULETTE_STAKES = [5,10,20,50];
const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteColor(n){ if(n===0) return "green"; return ROULETTE_RED.has(n) ? "red" : "black"; }
const ROULETTE_BETS = [
  { key:"red", ja:"赤", en:"Red", pays:1, check:(n)=>rouletteColor(n)==="red" },
  { key:"black", ja:"黒", en:"Black", pays:1, check:(n)=>rouletteColor(n)==="black" },
  { key:"odd", ja:"奇数", en:"Odd", pays:1, check:(n)=>n!==0 && n%2===1 },
  { key:"even", ja:"偶数", en:"Even", pays:1, check:(n)=>n!==0 && n%2===0 },
  { key:"low", ja:"1-18", en:"1-18", pays:1, check:(n)=>n>=1 && n<=18 },
  { key:"high", ja:"19-36", en:"19-36", pays:1, check:(n)=>n>=19 && n<=36 },
  { key:"d1", ja:"1〜12", en:"1st 12 (1-12)", pays:2, check:(n)=>n>=1 && n<=12 },
  { key:"d2", ja:"13〜24", en:"2nd 12 (13-24)", pays:2, check:(n)=>n>=13 && n<=24 },
  { key:"d3", ja:"25〜36", en:"3rd 12 (25-36)", pays:2, check:(n)=>n>=25 && n<=36 },
];
let rouletteChoice = { stake:null, betKey:null };
function renderRouletteIntro(){
  const en = state.lang==="en";
  const medals = state.defenderMedals||0;
  rouletteChoice = { stake:null, betKey:null };
  document.getElementById("rouletteBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `A real European-style roulette wheel (single zero). Color / odd-even / high-low pay 1:1, dozens pay 2:1.`
      : `本物のヨーロピアン式ルーレット(0が1つだけ)。赤黒/奇偶/範囲は配当1:1、ドズン(12個組)は2:1。`}</p>
    <div class="roulette-stake">${ROULETTE_STAKES.map(s=>`<button data-s="${s}" ${medals<s?"disabled":""}>${s}${en?"":"枚"}</button>`).join("")}</div>
    <div class="roulette-bettype">${ROULETTE_BETS.map(b=>`<button data-b="${b.key}">${en?b.en:b.ja}</button>`).join("")}</div>
    <button class="quiz-startbtn" id="rouletteSpinBtn" disabled>${en?"Spin":"スピン"}</button>
  `;
  document.querySelectorAll(".roulette-stake button").forEach(btn=>{
    if(btn.disabled) return;
    btn.onclick=()=>{ document.querySelectorAll(".roulette-stake button").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); rouletteChoice.stake=+btn.dataset.s; updateRouletteSpinBtn(); };
  });
  document.querySelectorAll(".roulette-bettype button").forEach(btn=>{
    btn.onclick=()=>{ document.querySelectorAll(".roulette-bettype button").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); rouletteChoice.betKey=btn.dataset.b; updateRouletteSpinBtn(); };
  });
  document.getElementById("rouletteSpinBtn").onclick=()=>startRouletteSpin();
}
function updateRouletteSpinBtn(){
  const btn = document.getElementById("rouletteSpinBtn");
  if(!btn) return;
  btn.disabled = !(rouletteChoice.stake && rouletteChoice.betKey);
}
function startRouletteSpin(){
  if(!rouletteChoice.stake || !rouletteChoice.betKey) return;
  if((state.defenderMedals||0) < rouletteChoice.stake){ showToast(state.lang==="en"?"Not enough Defender Medals":"ディフェンダーのメダルが足りません"); renderRouletteIntro(); return; }
  state.defenderMedals -= rouletteChoice.stake;
  saveState(); renderBalance();
  document.getElementById("rouletteBody").innerHTML = `<img class="spr roulette-wheel spinning" id="rouletteWheelImg">`;
  document.getElementById("rouletteWheelImg").src = SPR.icon_roulette;
  playReal("hit",0.4);
  setTimeout(()=>finishRoulette(), 1150);
}
function finishRoulette(){
  const en = state.lang==="en";
  const n = Math.floor(Math.random()*37);
  const color = rouletteColor(n);
  const bet = ROULETTE_BETS.find(b=>b.key===rouletteChoice.betKey);
  const win = bet.check(n);
  let given = 0, bigWin = false;
  if(win){
    given = rouletteChoice.stake * (1+bet.pays);
    addDefenderMedals(given);
    bigWin = given>=50;
    if(bigWin) sfxJackpot(); else sfxCoin();
    state.rouletteMaxWin = Math.max(state.rouletteMaxWin||0, given);
    if(given>=100) unlockAch("rouletteBigWin");
  } else {
    playReal("hit",0.6);
  }
  saveState(); renderBalance();
  document.getElementById("rouletteBody").innerHTML = `
    <div class="roulette-numresult ${color} ${bigWin?"bigwin-flash":""}">${n}</div>
    <div class="quiz-result ${bigWin?"bigwin-flash":""}">${win
      ? (en?`You won! +${given} Defender Medals`:`当たり!ディフェンダーメダル +${given}枚`)
      : (en?"No win this time.":"残念、外れ。")}</div>
    <button class="quiz-retrybtn" id="rouletteBackBtn">${en?"Back":"戻る"}</button>
  `;
  document.getElementById("rouletteBackBtn").onclick=()=>renderRouletteIntro();
}
// ミニゲームの解禁ゲート(2026-09-28追記):5種とも常時プレイ可能だったのを、テーマ解禁と同じ
// 「メダルで1回だけ解禁」方式に変更。高価にすることでメダルの使い道・エンドコンテンツ感を強化。
const MINIGAME_DEFS = [
  { key:"quiz", nameJa:"テラリアクイズ", nameEn:"Terraria Quiz", unlockCost:25, btnId:"quizLaunchBtn", modalId:"quizModal", open:()=>renderQuizIntro() },
  { key:"draw", nameJa:"抽選所", nameEn:"Lucky Draw", unlockCost:35, btnId:"drawLaunchBtn", modalId:"drawModal", open:()=>renderDrawIntro(), unavailable:true },
  { key:"fishing", nameJa:"釣り", nameEn:"Fishing", unlockCost:50, btnId:"fishLaunchBtn", modalId:"fishModal", open:()=>renderFishIntro(), unavailable:true },
  { key:"coinflip", nameJa:"コインフリップ", nameEn:"Coin Flip", unlockCost:70, btnId:"coinflipLaunchBtn", modalId:"coinflipModal", open:()=>renderCoinflipIntro() },
  { key:"roulette", nameJa:"ルーレット", nameEn:"Roulette", unlockCost:100, btnId:"rouletteLaunchBtn", modalId:"rouletteModal", open:()=>renderRouletteIntro(), unavailable:true },
];
// unavailable: 実在するテラリア素材の代役(釣り)、またはテラリア世界観に無い自作絵作り(抽選所の絵文字演出/ルーレット盤)を
// 一時停止中の印。正式な素材が揃うまでhubで押せない状態にしておく(2026-09-29)。
function renderMinigameHub(){
  MINIGAME_DEFS.forEach(def=>{
    const btn = document.getElementById(def.btnId);
    if(def.unavailable){
      btn.classList.add("locked","unavailable");
      btn.disabled = true;
      const costEl = btn.querySelector(".tcnum");
      if(costEl) costEl.textContent = state.lang==="en" ? "soon" : "準備中";
      return;
    }
    const unlocked = !!(state.minigameUnlocked && state.minigameUnlocked[def.key]);
    btn.classList.toggle("locked", !unlocked);
    const costEl = btn.querySelector(".tcnum");
    if(costEl) costEl.textContent = def.unlockCost;
  });
}
function launchMinigame(def){
  const en = state.lang==="en";
  if(def.unavailable){
    showToast(en ? "Paused until real Terraria art is ready" : "本物のテラリア素材が揃うまで一時停止中");
    return;
  }
  const unlocked = !!(state.minigameUnlocked && state.minigameUnlocked[def.key]);
  document.getElementById("shopModal").classList.remove("show");
  if(unlocked){
    def.open();
    document.getElementById(def.modalId).classList.add("show");
    return;
  }
  const name = en?def.nameEn:def.nameJa;
  const ok = confirm(en
    ? `Unlock ${name} for ${def.unlockCost} Defender Medals?`
    : `${name}をディフェンダーメダル${def.unlockCost}枚で解禁しますか?`);
  if(!ok) return;
  if((state.defenderMedals||0) < def.unlockCost){
    showToast(en?"Not enough Defender Medals":"ディフェンダーのメダルが足りません");
    return;
  }
  state.defenderMedals -= def.unlockCost;
  state.minigameUnlocked = state.minigameUnlocked||{};
  state.minigameUnlocked[def.key] = true;
  saveState(); renderBalance(); renderMinigameHub();
  showToast(en?`${name} unlocked!`:`${name}を解禁した!`);
  def.open();
  document.getElementById(def.modalId).classList.add("show");
}
MINIGAME_DEFS.forEach(def=>{ document.getElementById(def.btnId).onclick=()=>launchMinigame(def); });
document.getElementById("rouletteModalClose").onclick=()=>{ document.getElementById("rouletteModal").classList.remove("show"); };
document.getElementById("rouletteModal").onclick=(e)=>{ if(e.target.id==="rouletteModal") e.currentTarget.classList.remove("show"); };

function renderManaModal(){
  const en = state.lang==="en";
  const mana = state.etherianMana||0;
  document.getElementById("manaBody").innerHTML = `
    <p class="quiz-intro-text">${en
      ? `Defender Medals over ${MEDAL_RESERVE} auto-convert into Etherian Mana at a rate of ${ETHERIAN_MANA_RATE}:1, always leaving ${MEDAL_RESERVE} medals on hand. Convert Mana back into medals anytime you need them.`
      : `ディフェンダーのメダルは${MEDAL_RESERVE}枚を残して、超過分が${ETHERIAN_MANA_RATE}枚=マナ1として自動変換される。マナはいつでもメダルに戻せる。`}</p>
    <div class="quiz-progress">${en?"Current Mana":"現在のマナ"}: ${fmtMana(mana)} (${mana.toLocaleString()})</div>
    <div class="coinflip-stakebtns">
      ${[1,10,100].filter(n=>n<=mana).map(n=>`<button class="coinflip-optbtn" data-n="${n}">${n} → ${(n*ETHERIAN_MANA_RATE).toLocaleString()}${en?" medals":"枚"}</button>`).join("")}
      ${mana>0?`<button class="coinflip-optbtn" id="manaConvertAllBtn">${en?"Convert All":"全部変換"}</button>`:""}
    </div>
    ${mana<=0?`<div class="quiz-progress">${en?"No Mana yet - it builds up automatically as Defender Medals overflow.":"マナはまだ無い。メダルが1000枚を超えると自動的に貯まっていく。"}</div>`:""}
  `;
  document.querySelectorAll("#manaBody .coinflip-stakebtns button[data-n]").forEach(btn=>{
    btn.onclick=()=>{ convertManaToMedals(+btn.dataset.n); renderManaModal(); renderMinigameHub(); };
  });
  const allBtn = document.getElementById("manaConvertAllBtn");
  if(allBtn) allBtn.onclick=()=>{ convertManaToMedals(state.etherianMana||0); renderManaModal(); renderMinigameHub(); };
}
function openManaModal(){
  renderManaModal();
  document.getElementById("manaModal").classList.add("show");
}
document.getElementById("manaModalClose").onclick=()=>{ document.getElementById("manaModal").classList.remove("show"); };
document.getElementById("manaModal").onclick=(e)=>{ if(e.target.id==="manaModal") e.currentTarget.classList.remove("show"); };

document.getElementById("payClose").onclick=()=>{ document.getElementById("payModal").classList.remove("show"); };
document.getElementById("payModal").onclick=(e)=>{ if(e.target.id==="payModal") e.currentTarget.classList.remove("show"); };
document.getElementById("digToggle").onclick=()=>{ document.getElementById("digModal").classList.add("show"); renderDig(); };
document.getElementById("digClose").onclick=()=>{ document.getElementById("digModal").classList.remove("show"); };
document.getElementById("digModal").onclick=(e)=>{ if(e.target.id==="digModal") e.currentTarget.classList.remove("show"); };
const ACHIEVEMENT_DEFS = [
  {key:"firstWin", ja:"はじめてのミミック捕獲", en:"First Catch", condJa:"初めて絵柄を3つ揃えて勝利する"},
  {key:"jackpot", ja:"プレゼントを見つけた", en:"Jackpot Hunter", condJa:"プレゼントミミック(ミミックテーマのジャックポット絵柄)を揃える"},
  {key:"multiline", ja:"マルチライン職人", en:"Multi-Line Master", condJa:"1スピンで3ライン以上同時に当てる"},
  {key:"richPlayer", ja:"白金貨の袋", en:"Platinum Pouch", condJa:"所持金が白金貨1枚(1,000,000)以上になる"},
  {key:"jungle", ja:"ジャングルの奥へ", en:"Into the Jungle", condJa:"ジャングルミミックを揃える"},
  {key:"allSymbols", ja:"ミミック図鑑コンプリート", en:"Mimic Compendium", condJa:"ミミックテーマの7種類全部を1回以上揃える"},
  {key:"spins100", ja:"百戦錬磨", en:"Seasoned Spinner", condJa:"通算100回スピンする"},
  {key:"streak5", ja:"不屈の連勝", en:"Unstoppable Streak", condJa:"連勝ストリークを5まで伸ばす"},
  {key:"megaWin", ja:"メガウィン達成", en:"Mega Winner", condJa:"1回の配当がベット額の100倍以上になる"},
  {key:"bottleUsed", ja:"ラッキードリンカー", en:"Lucky Drinker", condJa:"瓶(ラッキーポーション)を初めて使う"},
  {key:"digMaster", ja:"発掘マスター", en:"Dig Master", condJa:"通算50回発掘する"},
  {key:"bonusHunter", ja:"ボーナスハンター", en:"Bonus Hunter", condJa:"フリースピンを通算5回発動させる"},
  {key:"mysteryRich", ja:"ミステリー成金", en:"Mystery Fortune", condJa:"ミステリーポットに初めて当選する"},
  {key:"starMage", ja:"星屑の魔術師", en:"Star Mage", condJa:"マナを初めて使う"},
  {key:"megaRich", ja:"大富豪", en:"Tycoon", condJa:"所持金が白金貨10枚以上になる"},
  {key:"hallowFound", ja:"聖なる輝き", en:"Blessed Find", condJa:"ハロウミミックを揃える"},
  {key:"evilTwins", ja:"邪悪な双子", en:"Evil Twins", condJa:"コラプトミミックとクリムゾンミミックの両方を揃える"},
  {key:"spins500", ja:"スロット古参兵", en:"Slot Veteran", condJa:"通算500回スピンする"},
  {key:"doubleTrouble", ja:"ダブルトラブル", en:"Double Trouble", condJa:"1スピンでちょうど2ライン同時に当てる"},
  {key:"spins25", ja:"駆け出しスロッター", en:"Rookie Spinner", condJa:"通算25回スピンする"},
  {key:"spins1000", ja:"千戦錬磨", en:"Slot Legend", condJa:"通算1000回スピンする"},
  {key:"spins2500", ja:"スロットの鬼", en:"Slot Fanatic", condJa:"通算2500回スピンする"},
  {key:"spins5000", ja:"伝説のスロッター", en:"Slot Icon", condJa:"通算5000回スピンする"},
  {key:"streak8", ja:"無敵の連勝", en:"Untouchable Streak", condJa:"連勝ストリークを8まで伸ばす"},
  {key:"streak11", ja:"運命の連鎖", en:"Chain of Fate", condJa:"連勝ストリークを11まで伸ばす"},
  {key:"megaWin200", ja:"超メガウィン", en:"Ultra Mega Win", condJa:"1回の配当がベット額の200倍以上になる"},
  {key:"digMaster100", ja:"発掘の鬼", en:"Excavation Fanatic", condJa:"通算100回発掘する"},
  {key:"digMaster250", ja:"発掘王", en:"Excavation King", condJa:"通算250回発掘する"},
  {key:"manaMaster", ja:"星屑マスター", en:"Star Master", condJa:"マナを通算10回使う"},
  {key:"jackpotStreak3", ja:"ジャックポット常連", en:"Jackpot Regular", condJa:"ミステリーポットに通算3回当選する"},
  {key:"freeSpinFan", ja:"フリースピン中毒", en:"Free Spin Addict", condJa:"フリースピンを通算20回発動させる"},
  {key:"kakuhenFirst", ja:"初めての確変", en:"First Bonus Round", condJa:"確変(ボーナスモード)を初めて発動させる"},
  {key:"kakuhenVeteran", ja:"確変ハンター", en:"Bonus Hunter Elite", condJa:"確変を通算10回発動させる"},
  {key:"kakuhenPity", ja:"天井到達", en:"Reached the Pity Timer", condJa:"天井(100回転ノーボーナス)で確変を強制発動させる"},
  {key:"iceFound", ja:"氷結の証", en:"Frozen Proof", condJa:"アイスミミックを揃える"},
  {key:"corruptFound", ja:"腐敗の証", en:"Corruption's Mark", condJa:"コラプトミミックを揃える"},
  {key:"crimsonFound", ja:"緋色の証", en:"Crimson Mark", condJa:"クリムゾンミミックを揃える"},
  {key:"allBiomes", ja:"四大厄災制覇", en:"Master of Biomes", condJa:"コラプト/クリムゾン/ハロウ/ジャングルミミックを全部揃える"},
  {key:"pentaLine", ja:"ペンタライン", en:"Penta Line", condJa:"1スピンで5ライン以上同時に当てる"},
  {key:"perfectBoard", ja:"全ライン制覇", en:"Perfect Board", condJa:"1スピンで8ライン全部同時に当てる"},
  {key:"balanceUltra", ja:"伝説の資産家", en:"Legendary Fortune", condJa:"所持金が白金貨100枚以上になる"},
  {key:"bigBet", ja:"大勝負", en:"High Roller", condJa:"最大ベット額(白金貨100枚)でスピンする"},
  {key:"smallBet", ja:"堅実プレイ", en:"Playing It Safe", condJa:"最小ベット額(銅貨10枚)でスピンする"},
  {key:"bottleHoarder", ja:"瓶コレクター", en:"Bottle Collector", condJa:"瓶を5個以上所持する"},
  {key:"bottleAddict", ja:"リキッドラック中毒", en:"Liquid Luck Addict", condJa:"瓶を通算10回使用する"},
  {key:"mimicMaster", ja:"ミミック狩りの達人", en:"Mimic Slayer", condJa:"通常のミミック絵柄を通算100回揃える"},
  {key:"iceMaster", ja:"氷の探求者", en:"Ice Seeker", condJa:"アイスミミックを通算50回揃える"},
  {key:"jackpotBig", ja:"大ジャックポット", en:"Big Jackpot", condJa:"ミステリーポットで白金貨1枚以上を獲得する"},
  {key:"moonClicker", ja:"月の秘密", en:"Moon's Secret", condJa:"月を10回クリックする", hidden:true, hintJa:"月を10回クリックする", hintEn:"Click the moon 10 times"},
  {key:"bunnyClicker", ja:"ウサギを捕まえた", en:"Caught the Bunny", condJa:"歩いているウサギをクリックする", hidden:true, hintJa:"歩いているウサギをクリックする", hintEn:"Click the wandering bunny"},
  {key:"allSymbolsSlime", ja:"スライム図鑑コンプリート", en:"Slime Compendium", condJa:"スライムテーマの37種類全部を1回以上揃える"},
  {key:"allSymbolsZombie", ja:"ゾンビ図鑑コンプリート", en:"Zombie Compendium", condJa:"ゾンビテーマの23種類全部を1回以上揃える"},
  {key:"allSymbolsZenith", ja:"ゼニス図鑑コンプリート", en:"Zenith Compendium", condJa:"ゼニステーマの9種類全部を1回以上揃える"},
  {key:"firstWinSlime", ja:"はじめてのスライム討伐", en:"First Slime Slain", condJa:"スライムテーマで初めて絵柄を揃えて勝利する"},
  {key:"firstWinZombie", ja:"はじめてのゾンビ討伐", en:"First Zombie Slain", condJa:"ゾンビテーマで初めて絵柄を揃えて勝利する"},
  {key:"firstWinZenith", ja:"はじめての聖剣", en:"First Holy Blade", condJa:"ゼニステーマで初めて絵柄を揃えて勝利する"},
  {key:"slimeKingFound", ja:"キングスライム討伐", en:"King Slime Slain", condJa:"キングスライムを揃える"},
  {key:"slimeQueenFound", ja:"クイーンスライム討伐", en:"Queen Slime Slain", condJa:"クイーンスライムを揃える"},
  {key:"slimeGoldenFound", ja:"黄金の輝き", en:"Golden Glimmer", condJa:"ゴールデンスライムを揃える"},
  {key:"zombieBrideFound", ja:"花嫁を見つけた", en:"Found the Bride", condJa:"花嫁(ゾンビ)を揃える"},
  {key:"zombieGroomFound", ja:"花婿を見つけた", en:"Found the Groom", condJa:"花婿を揃える"},
  {key:"zombieDoctorBonesFound", ja:"ドクターボーンズ討伐", en:"Doctor Bones Down", condJa:"ドクターボーンズを揃える"},
  {key:"zenithMeowmereFound", ja:"運命の一振り", en:"A Meow-velous Strike", condJa:"ニャウメアを揃える"},
  {key:"zenithTerrabladeFound", ja:"テラブレード顕現", en:"Terra Blade Manifest", condJa:"テラブレードを揃える"},
  {key:"zenithHorsemanFound", ja:"首なし騎士の剣", en:"Headless Horseman's Blade", condJa:"ホースマンズブレードを揃える"},
  {key:"zenithAssemble1", ja:"ゼニス、完成!!", en:"Zenith, Assembled!!", condJa:"ゼニスの完成ボーナス(9本全部そろい)を1回発生させる"},
  {key:"zenithAssemble10", ja:"完成の匠", en:"Master Assembler", condJa:"ゼニスの完成ボーナスを通算10回発生させる"},
  {key:"zenithAssemble50", ja:"伝説の鍛冶屋", en:"Legendary Blacksmith", condJa:"ゼニスの完成ボーナスを通算50回発生させる"},
  {key:"unlockSlime", ja:"スライムスロット解禁", en:"Slime Slots Unlocked", condJa:"スライムスロットを解禁する"},
  {key:"unlockZombie", ja:"ゾンビスロット解禁", en:"Zombie Slots Unlocked", condJa:"ゾンビスロットを解禁する"},
  {key:"unlockZenith", ja:"ゼニススロット解禁", en:"Zenith Slots Unlocked", condJa:"ゼニススロットを解禁する"},
  {key:"allThemesUnlocked", ja:"全テーマ制覇", en:"All Themes Unlocked", condJa:"4テーマ全部を解禁する"},
  {key:"spins10000", ja:"回転の求道者", en:"Spin Seeker", condJa:"通算10,000回スピンする"},
  {key:"spins25000", ja:"回転の権化", en:"Spin Incarnate", condJa:"通算25,000回スピンする"},
  {key:"spins50000", ja:"回転の神", en:"Spin Deity", condJa:"通算50,000回スピンする"},
  {key:"streak15", ja:"止まらない連勝", en:"Streak Unstoppable", condJa:"連勝ストリークを15まで伸ばす"},
  {key:"streak20", ja:"神がかった連勝", en:"Divine Streak", condJa:"連勝ストリークを20まで伸ばす"},
  {key:"megaWin300", ja:"驚異のウィン", en:"Astonishing Win", condJa:"1回の配当がベット額の300倍以上になる"},
  {key:"megaWin500", ja:"神話級ウィン", en:"Mythical Win", condJa:"1回の配当がベット額の500倍以上になる"},
  {key:"megaWin1000", ja:"宇宙級ウィン", en:"Cosmic Win", condJa:"1回の配当がベット額の1000倍以上になる"},
  {key:"digMaster500", ja:"発掘の伝説", en:"Excavation Legend", condJa:"通算500回発掘する"},
  {key:"digMaster1000", ja:"発掘神", en:"Excavation Deity", condJa:"通算1000回発掘する"},
  {key:"balance500P", ja:"超富豪", en:"Ultra Wealthy", condJa:"所持金が白金貨500枚以上になる"},
  {key:"balance1000P", ja:"億万長者", en:"Billionaire", condJa:"所持金が白金貨1000枚以上になる"},
  {key:"jackpotStreak5", ja:"ポットの寵児", en:"Pot's Favorite", condJa:"ミステリーポットに通算5回当選する"},
  {key:"jackpotStreak10", ja:"ポットの支配者", en:"Pot Overlord", condJa:"ミステリーポットに通算10回当選する"},
  {key:"kakuhenVeteran25", ja:"確変の化身", en:"Bonus Incarnate", condJa:"確変を通算25回発動させる"},
  {key:"kakuhenVeteran50", ja:"確変の神", en:"Bonus Deity", condJa:"確変を通算50回発動させる"},
  {key:"bottleAddict25", ja:"ポーション中毒者", en:"Potion Addict", condJa:"瓶を通算25回使用する"},
  {key:"bottleHoarder10", ja:"瓶の収集家", en:"Bottle Hoarder Elite", condJa:"瓶を10個以上所持する"},
  {key:"freeSpinFan50", ja:"フリースピンの申し子", en:"Free Spin Prodigy", condJa:"フリースピンを通算50回発動させる"},
  {key:"allThemesWin", ja:"全テーマ制覇者", en:"Master of All Themes", condJa:"4テーマ全部で1回以上勝利する"},
  {key:"shopComplete", ja:"旅商人の上得意", en:"Merchant's Best Customer", condJa:"旅商人ショップの主要アイテムを全部購入する"},
  {key:"betAllLevels", ja:"全ベット段階制覇", en:"Every Bet Level", condJa:"22段階あるベット額を全部一度は使う"},
  {key:"treeClicker", ja:"木の妖精", en:"Tree Spirit", condJa:"木を5回クリックする", hidden:true, hintJa:"木を5回クリックする", hintEn:"Click the tree 5 times"},
  {key:"mushroomClicker", ja:"キノコの妖精", en:"Mushroom Spirit", condJa:"キノコを5回クリックする", hidden:true, hintJa:"キノコを5回クリックする", hintEn:"Click the mushroom 5 times"},
  {key:"achievementHunter", ja:"実績ハンター", en:"Achievement Hunter", condJa:"実績を通算50個解除する"},
  {key:"ghostHunter100", ja:"幽霊退治マスター", en:"Ghost Hunt Master", condJa:"幽霊退治で通算100体退治する"},
  {key:"ghostHunter250", ja:"幽霊祓いの賢者", en:"Ghost Hunt Sage", condJa:"幽霊退治で通算250体退治する"},
  {key:"mysteryPotMax", ja:"大当たりの神", en:"Jackpot Deity", condJa:"ミステリーポットで白金貨10枚以上を獲得する"},
  {key:"quizPerfect", ja:"テラリア博士", en:"Terraria Scholar", condJa:"テラリアクイズで5問全問正解する"},
  {key:"quizMaster", ja:"クイズマイスター", en:"Quiz Master", condJa:"テラリアクイズに通算10回挑戦する"},
  {key:"fishMythic", ja:"クリスタルの釣り人", en:"Crystal Angler", condJa:"釣りでクリスタルサーペントを釣り上げる"},
  {key:"fishVeteran", ja:"釣り名人", en:"Master Angler", condJa:"釣りで通算20匹釣り上げる"},
  {key:"drawJackpot", ja:"抽選の女神", en:"Goddess of the Draw", condJa:"抽選所で特大当たりを引く"},
  {key:"drawRegular", ja:"抽選所の常連", en:"Lucky Draw Regular", condJa:"抽選所に通算30回挑戦する"},
  {key:"coinflipStreak5", ja:"コイントスの覇者", en:"Coin Toss Champion", condJa:"コインフリップで5連勝する"},
  {key:"rouletteBigWin", ja:"ルーレットの大勝負", en:"Roulette High Roller", condJa:"ルーレットで1回に100枚以上のメダルを獲得する"},
];
const ACH_PAGE_SIZE = 10;
let achPage = 0;
function renderAchBubble(){
  const ach = state.achievements||{};
  const unlockedCount = ACHIEVEMENT_DEFS.filter(d=>ach[d.key]).length;
  const pageCount = Math.ceil(ACHIEVEMENT_DEFS.length/ACH_PAGE_SIZE);
  achPage = Math.max(0, Math.min(achPage, pageCount-1));
  let html = `<div class="ach-header">
    <span class="ach-title">${state.lang==="en"?`Achievements (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`:`実績 (${unlockedCount}/${ACHIEVEMENT_DEFS.length})`}</span>
    <button class="ach-sharebtn" id="achShareBtn" title="${state.lang==="en"?"Make a shareable stats card":"シェア用カードを作る"}"><img class="spr" src="${SPR.icon_frame}"></button>
  </div>`;
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
  document.getElementById("achShareBtn").onclick=(e)=>{ e.stopPropagation(); achBubble.classList.remove("show"); renderShareCard(); };
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
// Shareable stats card: this is a static, backend-less site with no way for terrariajp
// members to see each other's progress, so this renders a downloadable image players can
// post in Discord themselves instead (see README.md's "気になる点" for the fuller context).
function loadImgAsync(src){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = src;
  });
}
async function renderShareCard(){
  if(document.fonts && document.fonts.ready) await document.fonts.ready;
  const en = state.lang==="en";
  const canvas = document.getElementById("shareCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const PIXEL = "'Press Start 2P',monospace";

  ctx.fillStyle = "#120c1a"; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = "#e8c14a"; ctx.lineWidth = 4; ctx.strokeRect(6,6,W-12,H-12);

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8c14a";
  ctx.font = `20px ${PIXEL}`;
  ctx.fillText("TERRARIA SLOTS", W/2, 50);
  ctx.font = `11px ${PIXEL}`;
  ctx.fillStyle = "#f1e3c6";
  ctx.fillText(en?"STATS CARD":"実績カード", W/2, 78);

  const highestTheme = THEME_ORDER.slice().reverse().find(id=>state.themeUnlocked && state.themeUnlocked[id]) || "mimic";
  const themeIcon = await loadImgAsync(SPR[THEME_DEFS[highestTheme].iconKey]);
  if(themeIcon){ const size=72; ctx.drawImage(themeIcon, W/2-size/2, 96, size, size); }

  const unlockedCount = ACHIEVEMENT_DEFS.filter(d=>state.achievements && state.achievements[d.key]).length;
  const rows = [
    [en?"Achievements":"実績", `${unlockedCount} / ${ACHIEVEMENT_DEFS.length}`],
    [en?"Furthest Theme":"到達テーマ", en?THEME_DEFS[highestTheme].nameEn:THEME_DEFS[highestTheme].nameJa],
    [en?"Total Spins":"総スピン数", (state.totalSpins||0).toLocaleString()],
    [en?"Balance":"所持金", formatCoins(state.balance)],
    [en?"Defender Medals":"防衛メダル", (state.defenderMedals||0).toLocaleString()],
    [en?"Biggest Jackpot":"最大ジャックポット", formatCoins(state.biggestJackpot||0)],
    [en?"Bonus Mode Triggers":"確変発動回数", (state.kakuhenTriggers||0).toLocaleString()],
    [en?"Zenith Assembled":"ゼニス完成回数", (state.zenithAssembles||0).toLocaleString()],
  ];
  ctx.textAlign = "left";
  let y = 210;
  rows.forEach(([label,val])=>{
    ctx.fillStyle = "#8577a3"; ctx.font = "12px 'DotGothic16',monospace";
    ctx.fillText(label, 36, y);
    ctx.fillStyle = "#f1e3c6"; ctx.font = `13px ${PIXEL}`;
    ctx.fillText(val, 36, y+22);
    y += 44;
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "#8577a3"; ctx.font = "8px 'DotGothic16',monospace";
  ctx.fillText(en?"Non-commercial Terraria fan game - terrariajp Discord":"非商用Terrariaファンメイド - terrariajpサーバー", W/2, H-24);

  document.getElementById("shareCardModal").classList.add("show");
}
document.getElementById("shareCardClose").onclick=()=>{ document.getElementById("shareCardModal").classList.remove("show"); };
document.getElementById("shareCardModal").onclick=(e)=>{ if(e.target.id==="shareCardModal") e.currentTarget.classList.remove("show"); };
document.getElementById("shareCardDownload").onclick=()=>{
  const canvas = document.getElementById("shareCanvas");
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "terraria_slots_stats.png";
  document.body.appendChild(a); a.click(); a.remove();
};
document.getElementById("exportSaveBtn").onclick=()=>{
  saveState();
  const blob = new Blob([localStorage.getItem(SAVE_KEY) || JSON.stringify(state)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `terraria_slots_save_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast(state.lang==="en" ? "Save file downloaded!" : "セーブデータを書き出しました!");
};
document.getElementById("importSaveInput").onchange=(e)=>{
  const file = e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file again later
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    let parsed;
    try{ parsed = JSON.parse(reader.result); }
    catch(err){ showToast(state.lang==="en" ? "That file isn't a valid save." : "セーブデータとして読み込めませんでした"); return; }
    if(typeof parsed !== "object" || parsed===null || !("balance" in parsed)){
      showToast(state.lang==="en" ? "That file isn't a valid save." : "セーブデータとして読み込めませんでした");
      return;
    }
    const ok = confirm(state.lang==="en"
      ? "Load this save? Your current progress on this device will be overwritten."
      : "このセーブデータを読み込みますか?この端末の現在の進行状況は上書きされます。");
    if(!ok) return;
    localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
    location.reload();
  };
  reader.readAsText(file);
};
document.getElementById("infoClose").onclick=()=>{ document.getElementById("infoModal").classList.remove("show"); };
document.getElementById("infoModal").onclick=(e)=>{ if(e.target.id==="infoModal") e.currentTarget.classList.remove("show"); };
document.getElementById("decoMushroom").onclick=()=>{
  document.getElementById("devlogModal").classList.add("show");
  state.mushroomClicks=(state.mushroomClicks||0)+1;
  if(state.mushroomClicks>=5) unlockAch("mushroomClicker"); else saveState();
};
document.getElementById("devlogClose").onclick=()=>{ document.getElementById("devlogModal").classList.remove("show"); };
document.getElementById("devlogModal").onclick=(e)=>{ if(e.target.id==="devlogModal") e.currentTarget.classList.remove("show"); };
document.getElementById("decoTree").onclick=()=>{
  document.getElementById("changelogModal").classList.add("show");
  state.treeClicks=(state.treeClicks||0)+1;
  if(state.treeClicks>=5) unlockAch("treeClicker"); else saveState();
};
document.getElementById("changelogClose").onclick=()=>{ document.getElementById("changelogModal").classList.remove("show"); };
document.getElementById("changelogModal").onclick=(e)=>{ if(e.target.id==="changelogModal") e.currentTarget.classList.remove("show"); };

// Secret, entirely undiscoverable-by-UI strategy guide viewer: no button, no menu entry, no
// hint anywhere in the game (not even the dev diary). Only reachable by typing this exact
// word anywhere on the page. Renders the same guide page published as an Artifact, embedded
// verbatim via SECRET_GUIDE_HTML. That ~50KB data file is loaded lazily (only once this exact
// word is typed) rather than unconditionally on every page load, since the overwhelming
// majority of players will never trigger it.
(function setupSecretGuide(){
  const CODE = "utoutoneko";
  let buffer = "";
  let loadStarted = false;
  function showGuide(){
    const frame = document.getElementById("secretGuideFrame");
    if(!frame.hasAttribute("data-loaded")){
      frame.srcdoc = SECRET_GUIDE_HTML;
      frame.setAttribute("data-loaded","1");
    }
    document.getElementById("secretGuideModal").classList.add("show");
  }
  document.addEventListener("keydown", (e)=>{
    if(e.key.length !== 1) return; // ignore Shift/Enter/arrows/etc.
    buffer = (buffer + e.key.toLowerCase()).slice(-CODE.length);
    if(buffer === CODE){
      buffer = "";
      if(typeof SECRET_GUIDE_HTML !== "undefined"){ showGuide(); return; }
      if(loadStarted) return; // fetch already in flight from an earlier trigger
      loadStarted = true;
      const script = document.createElement("script");
      script.src = "secretguide_data.js";
      script.onload = showGuide;
      document.body.appendChild(script);
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
  // 2026-09-28: 実績を50→100種に拡張(スロット4テーマ分の絵柄図鑑・レア絵柄・テーマ解禁・
  // 既存カテゴリの上位ランク等)。詳細はDEVLOG.md参照。
  if(SLIME_SYMBOLS.every(s=>state.symbolsWon[s.id])) unlockAch("allSymbolsSlime");
  if(ZOMBIE_SYMBOLS.every(s=>state.symbolsWon[s.id])) unlockAch("allSymbolsZombie");
  if(ZENITH_SYMBOLS.every(s=>state.symbolsWon[s.id])) unlockAch("allSymbolsZenith");
  if(state.activeTheme==="slime" && wins.length>0) unlockAch("firstWinSlime");
  if(state.activeTheme==="zombie" && wins.length>0) unlockAch("firstWinZombie");
  if(state.activeTheme==="zenith" && wins.length>0) unlockAch("firstWinZenith");
  if(state.symbolsWon.slime_king) unlockAch("slimeKingFound");
  if(state.symbolsWon.slime_queen) unlockAch("slimeQueenFound");
  if(state.symbolsWon.slime_golden) unlockAch("slimeGoldenFound");
  if(state.symbolsWon.zombie_bride) unlockAch("zombieBrideFound");
  if(state.symbolsWon.zombie_groom) unlockAch("zombieGroomFound");
  if(state.symbolsWon.zombie_doctorbones) unlockAch("zombieDoctorBonesFound");
  if(state.symbolsWon.zenith_meowmere) unlockAch("zenithMeowmereFound");
  if(state.symbolsWon.zenith_terrablade) unlockAch("zenithTerrabladeFound");
  if(state.symbolsWon.zenith_horseman) unlockAch("zenithHorsemanFound");
  if((state.zenithAssembles||0)>=1) unlockAch("zenithAssemble1");
  if((state.zenithAssembles||0)>=10) unlockAch("zenithAssemble10");
  if((state.zenithAssembles||0)>=50) unlockAch("zenithAssemble50");
  if((state.totalSpins||0)>=10000) unlockAch("spins10000");
  if((state.totalSpins||0)>=25000) unlockAch("spins25000");
  if((state.totalSpins||0)>=50000) unlockAch("spins50000");
  if(state.streak>=15) unlockAch("streak15");
  if(state.streak>=20) unlockAch("streak20");
  if(payoutRatio>=300) unlockAch("megaWin300");
  if(payoutRatio>=500) unlockAch("megaWin500");
  if(payoutRatio>=1000) unlockAch("megaWin1000");
  if((state.totalDigs||0)>=500) unlockAch("digMaster500");
  if((state.totalDigs||0)>=1000) unlockAch("digMaster1000");
  if(state.balance>=500*PLATINUM) unlockAch("balance500P");
  if(state.balance>=1000*PLATINUM) unlockAch("balance1000P");
  if((state.jackpotWins||0)>=5) unlockAch("jackpotStreak5");
  if((state.jackpotWins||0)>=10) unlockAch("jackpotStreak10");
  if((state.kakuhenTriggers||0)>=25) unlockAch("kakuhenVeteran25");
  if((state.kakuhenTriggers||0)>=50) unlockAch("kakuhenVeteran50");
  if((state.bottleUsedCount||0)>=25) unlockAch("bottleAddict25");
  if(((state.bottles||0)+(state.superBottles||0))>=10) unlockAch("bottleHoarder10");
  if((state.freeSpinTriggers||0)>=50) unlockAch("freeSpinFan50");
  if(MIMIC_SYMBOLS.some(s=>state.symbolsWon[s.id]) && SLIME_SYMBOLS.some(s=>state.symbolsWon[s.id])
    && ZOMBIE_SYMBOLS.some(s=>state.symbolsWon[s.id]) && ZENITH_SYMBOLS.some(s=>state.symbolsWon[s.id])) unlockAch("allThemesWin");
  if(state.autoSpinForceUnlocked && state.turboUnlocked && state.digGhostFastCooldown
    && state.mimicPetOwned && state.luckyCoinOwned && state.achGuideOwned) unlockAch("shopComplete");
  if(Object.keys(state.betLevelsUsed||{}).length>=BET_STEPS.length) unlockAch("betAllLevels");
  if((state.totalGhosts||0)>=100) unlockAch("ghostHunter100");
  if((state.totalGhosts||0)>=250) unlockAch("ghostHunter250");
  if((state.biggestJackpot||0)>=10*PLATINUM) unlockAch("mysteryPotMax");
  if(Object.keys(state.achievements||{}).length>=50) unlockAch("achievementHunter");
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
    if(!state.betLevelsUsed) state.betLevelsUsed={};
    state.betLevelsUsed[betIndex]=true;
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
  // bonus mode: a new trigger mid-bonus extends kakuhenRemaining (see startKakuhen) instead of being wasted
  if(wins.length>0 && state.streak===KAKU_STREAK_TRIGGER){
    startKakuhen(`${KAKU_STREAK_TRIGGER}連勝!確変突入`, `${KAKU_STREAK_TRIGGER}-win streak! Bonus mode`);
  } else if(!kakuActive && (state.pityCount||0)>=PITY_LIMIT){
    startKakuhen("天井到達!確変突入","Pity reached! Bonus mode", true);
  } else if(kakuActive && kakuhenRemaining===0){
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

// First-ever visit to this browser (no save existed yet): open the guide once up front,
// since the UI is dense with icons/decorations and nothing else points a brand-new player
// at the rules. Marked via a save write so it never reopens automatically again.
if(isFirstEverVisit){
  document.getElementById("infoModal").classList.add("show");
  saveState();
}
