/* Habits of Witchers — arayüz. Kurallar engine.js içinde.
 * Baslat.bat ile çalıştır. Test modu: Test.bat (ayrı veritabanı + zaman yolculuğu paneli).
 */
(() => {
'use strict';
/* dil: cihaz başına (localStorage). İlk açılışta tarayıcı dili Türkçe değilse İngilizce. */
const LANG_KEY = 'hw_lang';
window.KM_LANG = localStorage.getItem(LANG_KEY) || ((navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en');
document.documentElement.lang = window.KM_LANG;
const { createEngine, newState, migrate, makeQuest, monStats, L, habitTypeName, MAX_HABITS, MAX_ITEMS, time: T, data: DATA } = window.KM;
const DAY_END_UI = '03:00';
const { pad, dk, fromKey, addDays, addMin, hm, mondayOf, longDate, sfx, DAYS, MONTHS } = T;
const { ART, CARDS, CARD_BY_ART, RAR, RAR_TR, SCRAP, CRAFT, MONSTERS, CLASSES, REGIONS, BAND_COUNT, bandRegions, monById, monImg, SCHOOLS, TIERS, tierOf, REPAIR_NEED,
  QUEST_MIN, QUEST_MAX, MASTERY_MULT, MASTERY_DMG, DMG, CARDS_PER, POTION, CRIT_MULT, rarityOdds, AERONDIGHT, SWORD_UP, SCRAP_PER_KILL, LINK_SIZE, LINK_BONUS, LINK_MAX, LINK_RAR, LINK_EXTRA, LINK_SCHOOL, SCHOOL_CATS, SWORDS, SWORD_TIERS, swordById,
  FACTIONS, FACTION_TR, MAX_LEVEL, xpNeed, BOARD_SIZE, SHOP_DAILY, START_KIT, cardCats, BANE, DISMANTLE, ACHIEVEMENTS, LEGACY } = DATA;

/* ---------- zaman + kayıt yeri ---------- */
const params = new URLSearchParams(location.search);
const SLOT = params.get('slot') || 'main';
const TEST = SLOT !== 'main' || params.has('dev');
const API = `/api/state?slot=${encodeURIComponent(SLOT)}`;
const OFFSET_KEY = 'km_offset_' + SLOT;
let offset = 0;
if (params.get('now')) { const t = new Date(params.get('now')); if (!isNaN(t)) offset = t - Date.now(); }
else if (TEST && localStorage.getItem(OFFSET_KEY)) offset = +localStorage.getItem(OFFSET_KEY) || 0;
const now = () => new Date(Date.now() + offset);

let E = null;
const st = () => E.state;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? L(`${Math.floor(m / 60)} sa ${m % 60} dk`, `${Math.floor(m / 60)} h ${m % 60} min`) : L(`${m} dk`, `${m} min`); };
const $ = s => document.querySelector(s);
const facName = f => f ? (FACTION_TR[f] || f) : L('Tüm fraksiyonlar', 'All factions');

/* ---------- sunucu ---------- */
let saveTimer = null, saveFailed = false;
let rev = null;                      // sunucudaki kaydın sürümü: başka cihaz değiştirdiyse üzerine yazmayız
const REV_API = `/api/rev?slot=${encodeURIComponent(SLOT)}`;
async function load() {
  const r = await fetch(API, { cache: 'no-store' });
  if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  rev = j.rev ?? null;
  return j.state ? migrate(j.state) : null;
}
/* başka cihazdaki değişikliği yükle */
async function reloadFromServer(msg) {
  const s = await load();
  if (!s) return;
  E = createEngine(s, { now }); E.processPending();
  render(); if (msg) toast(msg, '');
}
async function checkRemote() {
  if (!E || saveTimer || flushing || document.hidden) return;
  try {
    const r = await fetch(REV_API, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (rev != null && j.rev != null && j.rev !== rev) await reloadFromServer(L('Başka bir cihazdaki değişiklikler yüklendi.', 'Loaded changes made on another device.'));
  } catch { /* sessiz */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRemote(); });
function showPinLogin(msg = '') {
  openModal(`<h2>🔒 Kaer Morhen</h2><p>${L("Bu cihazdan girmek için bilgisayarda belirlediğin PIN'i yaz.", 'Enter the PIN you set on your computer to sign in from this device.')}</p>
    <input id="pinIn" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" style="font-size:1.4rem;width:180px">
    <p class="bad-text">${esc(msg)}</p>
    <div class="row"><button class="btn big" data-act="pinlogin">${L('Gir', 'Enter')}</button></div>`);
  setTimeout(() => $('#pinIn')?.focus(), 50);
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
/* kayıtlar sırayla gider: aynı anda tek istek; arada değişiklik olduysa bittiğinde bir kez daha kaydedilir.
   (paralel istekler sunucuya ters sırada varırsa eski veri yenisinin üzerine yazabilirdi) */
let flushing = false, dirty = false;
async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!E) return;
  if (flushing) { dirty = true; return; }
  flushing = true;
  try {
    do {
      dirty = false;
      const r = await fetch(`${API}&rev=${rev ?? ''}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st()) });
      if (r.status === 409) {        // başka cihaz bizden önce kaydetmiş: onun halini yükle, bizimki geçersiz
        const j = await r.json(); rev = j.rev;
        E = createEngine(migrate(j.state), { now }); E.processPending(); render();
        toast(L('Başka bir cihazda daha yeni bir kayıt vardı; o yüklendi. Son işlemini tekrar yap.', 'Another device had a newer save; it was loaded. Please redo your last action.'), 'bad');
        dirty = false; break;
      }
      if (r.status === 401) { showPinLogin(); break; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (j.rev != null) rev = j.rev;
    } while (dirty);
    if (saveFailed) { saveFailed = false; $('#offline')?.remove(); toast(L('Sunucu bağlantısı geri geldi, kaydedildi.', 'Server connection is back, saved.'), 'good'); }
  } catch {
    if (!saveFailed) {
      saveFailed = true;
      const b = document.createElement('div'); b.id = 'offline'; b.className = 'offline';
      b.textContent = L('Sunucuya ulaşılamıyor, değişiklikler kaydedilmedi. Baslat.bat çalışıyor mu?', "Can't reach the server; changes weren't saved. Is the server (Baslat.bat / server.py) running?");
      document.body.appendChild(b);
    }
    setTimeout(save, 5000);
  } finally { flushing = false; }
}
window.addEventListener('pagehide', () => {
  if (saveTimer && E) navigator.sendBeacon(`${API}&rev=${rev ?? ''}`, new Blob([JSON.stringify(st())], { type: 'application/json' }));
});

/* ---------- ortak ---------- */
let currentTab = 'home';
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function openModal(html, cls = '') { $('#modalBox').innerHTML = html; $('#modalBox').className = 'modal-box ' + cls; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
const modalOpen = () => !$('#modal').classList.contains('hidden');
function act(r) { if (r && r.err) { toast(r.err, 'bad'); return false; } commit(); return true; }
function commit() {
  E.checkAchievements();
  save(); render();
  E.ev.toasts.splice(0).forEach(t => toast(t.msg, t.type));
  playEvents(E.ev.sfx.splice(0));
  showQueue();
}

/* ---------- ses (WebAudio ile üretilir, dosya yok) ---------- */
let actx = null;
const soundOn = () => !E || st().settings.sound !== false;
function tone(freq, start, dur, type = 'sine', vol = 0.15, slide = 0) {
  const t0 = actx.currentTime + start, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(start, dur, vol = 0.08, hp = 1200) {
  const t0 = actx.currentTime + start, n = actx.sampleRate * dur, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
  src.connect(f).connect(g).connect(actx.destination); src.start(t0);
}
const SOUNDS = {
  check: () => { tone(660, 0, 0.25, 'triangle'); tone(990, 0.12, 0.35, 'triangle'); },
  prep: () => { tone(392, 0, 0.6, 'sine', 0.1); tone(523, 0.15, 0.7, 'sine', 0.08); },
  hit: () => { noise(0, 0.12, 0.06, 900); tone(140, 0, 0.12, 'square', 0.05, -60); },
  crit: () => { noise(0, 0.18, 0.1, 600); tone(220, 0, 0.2, 'sawtooth', 0.08, -120); tone(880, 0.05, 0.15, 'square', 0.04); },
  kill: () => { tone(110, 0, 0.35, 'sawtooth', 0.12, -60); noise(0, 0.3, 0.1, 300); [523, 659, 784].forEach((f, i) => tone(f, 0.25 + i * 0.09, 0.4, 'triangle', 0.09)); },
  boss: () => { tone(80, 0, 0.6, 'sawtooth', 0.14, -40); noise(0, 0.5, 0.12, 200); [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35 + i * 0.11, 0.6, 'triangle', 0.09)); },
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.1, 0.35, 'square', 0.06)),
  achieve: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.08, 0.5, 'triangle', 0.08)); },
  bad: () => { tone(196, 0, 0.35, 'sawtooth', 0.07, -60); tone(147, 0.18, 0.4, 'sawtooth', 0.06, -40); },
  card: () => noise(0, 0.12, 0.05, 2500),
  rare: () => { noise(0, 0.1, 0.04, 2500); tone(880, 0.05, 0.3, 'sine', 0.07); tone(1320, 0.12, 0.35, 'sine', 0.06); },
  legendary: () => { noise(0, 0.1, 0.05, 2500); [659, 880, 1109, 1319, 1760].forEach((f, i) => tone(f, 0.05 + i * 0.07, 0.6, 'triangle', 0.08)); },
};
const SOUND_RANK = ['card', 'hit', 'crit', 'prep', 'check', 'bad', 'kill', 'level', 'boss', 'achieve', 'rare', 'legendary'];
function playSound(name) {
  if (!soundOn() || !SOUNDS[name]) return;
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); SOUNDS[name](); } catch { /* ses yoksa sessiz */ }
}
function playEvents(list) {
  if (!list.length) return;
  // aynı anda çok ses çalmasın: en önemli iki tanesi
  const uniq = [...new Set(list)].sort((a, b) => SOUND_RANK.indexOf(b) - SOUND_RANK.indexOf(a)).slice(0, 2);
  uniq.forEach((n, i) => setTimeout(() => playSound(n), i * 350));
  if (list.includes('kill') || list.includes('boss')) flashEl('#monsterPanel', list.includes('boss') ? 'boss-flash' : 'kill-flash');
  if (list.includes('level')) flashEl('#lvl', 'pulse');
  if (list.includes('crit')) flashEl('#monsterPanel', 'shake');
}
function flashEl(sel, cls) { const el = $(sel); if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 1200); }

// görsel yüklenemezse (gwent.one erişilemezse) kırık resim yerine sade bir zemin görünsün
document.addEventListener('error', e => { if (e.target?.tagName === 'IMG') e.target.classList.add('broken'); }, true);
/* dış görseller kendi sunucumuzun önbelleğinden (/img) gelir: bir kez indirilir, hofw-gorsel.db'de saklanır */
const IMG_HOSTS = /^https:\/\/(gwent\.one|static\.wikia\.nocookie\.net|witcherdb\.com)\//;
const imgSrc = src => (location.protocol.startsWith('http') && IMG_HOSTS.test(src || '') ? `/img?u=${encodeURIComponent(src)}` : src);
const imgTag = (src, cls = '', alt = '') => `<img class="${cls}" src="${esc(imgSrc(src))}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
function cardHtml(c, opts = {}) {
  const cats = opts.cats ? `<div class="ccats">${cardCats(c).map(x => x === opts.cats ? `<b>${esc(x)}</b>` : esc(x)).join(' · ')}</div>` : '';
  return `<div class="card ${c.r}${opts.locked ? ' locked' : ''}" ${opts.noAct ? '' : 'data-act="card"'} data-a="${c.a}" ${opts.cats ? '' : `title="${esc(c.n)} — ${RAR_TR[c.r]}"`}>${cats}
    ${imgTag(ART(c.a, opts.q || 'low'))}
    ${opts.count > 1 ? `<span class="count">×${opts.count}</span>` : ''}
    ${opts.isNew ? `<span class="newtag">${L('YENİ', 'NEW')}</span>` : ''}
    <div class="cname">${esc(c.n)}</div></div>`;
}
const avatarTop = (s = st()) => (!s.avatar && SCHOOLS[s.school]?.img ? 'center top' : '');   // yerel okul görselleri dikey: yüz üstte
const avatarSrc = (s = st()) => imgSrc(s.avatar ? ART(s.avatar, 'low') : DATA.schoolImg(s.school, 'low'));
const SWORD_ICON = w => `<div class="sword-ph t${w.tier}"><svg viewBox="0 0 64 64"><path d="M50 6 L58 6 L58 14 L28 44 L20 36 Z" fill="currentColor" opacity=".9"/><path d="M16 34 L30 48 L26 52 L22 48 L14 56 L8 50 L16 42 L12 38 Z" fill="currentColor" opacity=".55"/></svg></div>`;
const swordImg = w => w.img ? imgTag(w.img) : SWORD_ICON(w);

/* ---------- üst bar ---------- */
function renderTop() {
  const s = st(), best = s.habits.reduce((a, h) => (h.chain.len > a.chain.len ? h : a), s.habits[0]), tier = TIERS[tierOf(best.chain.len)];
  $('#heroName').textContent = s.name;
  $('#heroSchool').textContent = `${SCHOOLS[s.school].name} · ${facName(s.faction)}${s.legend ? L(' · Efsane', ' · Legend') : ''}`;
  $('#medallion').classList.toggle('aero-full', !!E.combatInfo().aero?.full);
  $('#medallion').style.backgroundImage = `url(${avatarSrc()})`; $('#medallion').style.backgroundPosition = avatarTop();
  $('#hpFill').style.width = `${Math.max(0, s.hp) / E.maxHp() * 100}%`;
  $('#hpText').textContent = `${L('Can', 'HP')} ${Math.round(Math.max(0, s.hp))} / ${E.maxHp()}`;
  const need = xpNeed(s.level), max = s.level >= MAX_LEVEL;
  $('#xpFill').style.width = `${max ? 100 : Math.min(100, s.xp / need * 100)}%`;
  if (max) $('#xpFill').style.width = `${Math.min(100, s.xp / E.fameNeed() * 100)}%`;
  $('#xpText').textContent = max ? `${L('Ün', 'Renown')} ★${s.fame || 0} · ${L('TP', 'XP')} ${s.xp} / ${E.fameNeed()}` : E.atCap() ? L(`TP dolu · boss: ${bandBossNames()}`, `XP full · boss: ${bandBossNames()}`) : `${L('TP', 'XP')} ${s.xp} / ${need}`;
  $('#lvl').textContent = s.level + (s.fame ? ` ★${s.fame}` : '');
  $('#gold').textContent = s.gold;
  $('#scraps').textContent = s.scraps;
  $('#chainLen').textContent = best.chain.len;
  $('#chainLen').style.color = tier.color;
  $('#chainStat').title = s.habits.map(h => `${h.name}: ${h.chain.len} ${L('halka', 'links')} (${TIERS[tierOf(h.chain.len)].name})`).join('\n');
  $('#swallow').textContent = `${s.swallow}/${POTION.cap}`;
}

/* ---------- ana sayfa: bugünün alışkanlıkları ---------- */
const RES_ICON = { success: '✅', late: '🌗', fail: '❌', rest: '⏸' };
const typeBadge = h => `<span class="badge type-${h.type}">${esc(habitTypeName(h.type))}</span>`;
/* birden çok zincirde sıraya göre sayılan pay: 1 → tamamı, 0.5 → yarısı ... */
const shareName = w => (w >= 1 ? L('tamamı', 'all of it') : w === 0.5 ? L('yarısı', 'half') : Math.abs(w - 1 / 3) < 0.01 ? L('üçte biri', 'a third') : w === 0.25 ? L('dörtte biri', 'a quarter') : L('beşte biri', 'a fifth'));
const MULTI_CHAIN_TXT = () => L('Birden fazla alışkanlığın varsa en yüksek zincir bonusu tamamen eklenir; ikinci zincirin bonusunun yarısı, üçüncününkinin üçte biri eklenir. Örnek: Gümüş (+%20) ve Çelik (+%10) zincir → %20 + %5 = +%25 hasar.',
  'With several habits, your highest chain bonus is added in full; half of the second chain\'s bonus and a third of the third\'s are added. Example: a Silver (+20%) and a Steel (+10%) chain → 20% + 5% = +25% damage.');
/* zincir kademesinin ne işe yaradığı (üzerine gelince) */
const tierTip = (t, i = TIERS.indexOf(t)) => L(
  `${t.name} zincir (${t.at}+ halka)\n• Canavara verdiğin hasar +%${t.dmg}\n• Bu alışkanlığı tamamlayınca aldığın TP ve oren ×${t.mult}${t.min ? `\n• İlk ulaştığında en az ${RAR_TR[t.min]} bir kart` : ''}${i > 0 ? `\n• Kırılırsa ${TIERS[i - 1].name} başına (${TIERS[i - 1].at} halka) düşer; kefaretle geri gelir` : ''}`,
  `${t.name} chain (${t.at}+ links)\n• Damage to monsters +${t.dmg}%\n• XP and crowns for completing this habit ×${t.mult}${t.min ? `\n• First time you reach it: a card of at least ${RAR_TR[t.min]} rarity` : ''}${i > 0 ? `\n• If it breaks it drops to the start of ${TIERS[i - 1].name} (${TIERS[i - 1].at} links); atonement brings it back` : ''}`);
const chainChip = h => { const t = TIERS[tierOf(h.chain.len)]; return `<small class="chain-chip" style="color:${t.color}" title="${esc(tierTip(t))}">⛓ ${h.chain.len}${h.chain.rust ? ' 🟤' : ''}${h.chain.repair ? ' ⚒' : ''}</small>`; };
function habitProgress(h) {
  const pct = Math.min(100, h.progress / h.days * 100);
  return `<div class="bar qbar thin"><div class="fill" style="width:${pct}%"></div><span>${h.status === 'mastery' ? L(`Edinildi · ustalık ×${MASTERY_MULT}`, `Formed · mastery ×${MASTERY_MULT}`) : L(`${h.progress} / ${h.days} gün`, `${h.progress} / ${h.days} days`)}</span></div>`;
}
/* son işlenen günün sonucu (bugün ya da dün) */
function lastResult(h, k) {
  const prev = addDays(k, -1), d = h.entries[prev];
  if (!d?.result) return '';
  const when = prev === dk(now()) ? L('bugün', 'today') : prev === addDays(dk(now()), -1) ? L('dün', 'yesterday') : longDate(prev);
  const R = { success: L('tamamlandı', 'done'), late: L('gecikti', 'late'), fail: L('kaçırıldı', 'missed'), rest: L('dinlenme', 'rest') };
  return `<div class="hc-last ${d.result}">${RES_ICON[d.result]} ${when}: ${R[d.result]}${d.check && h.type !== 'count' ? ` (${hm(new Date(d.check))})` : ''}</div>`;
}
/* alt görev listesi: işaretlenebilir (gün tamamlandıysa sadece gösterim) */
function subList(h, day, readOnly = false) {
  if (!h.items?.length) return '';
  const done = new Set(day.done || []);
  return `<div class="subtasks">${h.items.map(x => readOnly
    ? `<span class="sub ${done.has(x) ? 'done' : ''}">${done.has(x) ? '☑' : '☐'} ${esc(x)}</span>`
    : `<button type="button" class="sub ${done.has(x) ? 'done' : ''}" data-act="subtoggle" data-h="${h.id}" data-item="${esc(x)}" title="${done.has(x) ? L('İşareti kaldır', 'Untick') : L('Yaptım', 'Done')}">${done.has(x) ? '☑' : '☐'} ${esc(x)}</button>`).join('')}</div>`;
}
function habitCard(h, n) {
  const hid = h.id;
  let k = E.upcoming(n, hid);
  // gündüz alışkanlıkları: bugün tamamlandıysa gün bitene kadar bugünü (tamamlanmış haliyle) göster, yarına atlama
  const td = dk(n);
  if (h.type !== 'sleep' && k > td && h.entries[td]?.result) k = td;
  const w = E.W(k, hid), ph = E.phase(k, n, hid), day = h.entries[k] || {}, rest = E.isRest(k);
  const inTime = n <= w.checkEnd, early = n < w.checkStart;
  let body = '';
  if (h.type !== 'sleep' && day.result) {
    const R = { success: L('Tamamlandı', 'Done'), late: L('Gecikti', 'Late'), fail: L('Kaçırıldı', 'Missed'), rest: L('Dinlenme', 'Rest') };
    const goal = h.count?.target, c = day.count || 0, unit = esc(h.count?.unit || '');
    body = `${subList(h, day, true)}${h.type === 'count' ? `<div class="bar qbar thin count"><div class="fill" style="width:${Math.min(100, c / goal * 100)}%"></div><span>${c} / ${goal} ${unit}</span></div>` : ''}
      <div class="hc-done">${RES_ICON[day.result]} ${R[day.result]}${day.check ? ` (${hm(new Date(day.check))})` : ''} · ${L('Sıradaki gün yarın başlıyor.', 'The next day starts tomorrow.')}</div>`;
  } else if (h.type === 'sleep') {
    const bed = day.med ? `${L('Yatış', 'Bed')} ${hm(new Date(day.med))} ${day.medOnTime ? '✓' : L('· geç', '· late')}` : `${L('Yatış', 'Bed')} ${h.sleep.bedStart}–${h.sleep.bedEnd}`;
    const info = `<small class="muted">${bed} · ${L('Kalkış', 'Wake')} ${hm(w.checkStart)}–${hm(w.checkEnd)}</small>`;
    if (ph === 'day') body = `${info}<div class="hc-state">${L(`Yatış hazırlığı ${sfx(hm(w.prepOpen), 'da')} açılır (${fmtDur(w.prepOpen - n)} sonra).`, `Bedtime prep opens at ${hm(w.prepOpen)} (in ${fmtDur(w.prepOpen - n)}).`)}</div>`;
    else if (ph === 'prep') body = day.med
      ? `${info}<div class="hc-state">${L('Madalyon sustu. Ekranı kapat ve uyu.', 'The medallion is still. Close the screen and sleep.')}</div>`
      : `${info}<div class="hc-state">${n < w.prepStart ? L(`Aralık ${fmtDur(w.prepStart - n)} sonra başlıyor; şimdi yatmak da sayılır.`, `The window starts in ${fmtDur(w.prepStart - n)}; going to bed now counts too.`) : n <= w.prepEnd ? L(`Aralığın bitmesine ${fmtDur(w.prepEnd - n)} var.`, `${fmtDur(w.prepEnd - n)} left in the window.`) : L('Aralık bitti; yine de meditasyon yap ve hemen uyu.', 'The window is over; meditate anyway and sleep now.')}</div>
         <button class="btn" data-act="prep" data-h="${hid}">🧘 ${L('Meditasyona çekil', 'Meditate')}</button>`;
    else if (ph === 'sleep') body = `${info}<div class="hc-state">${L(`Uyku vakti. Kalkış ${sfx(hm(w.checkOpen), 'da')} açılır.`, `Sleep time. Wake-up opens at ${hm(w.checkOpen)}.`)}</div>`;
    else body = `${info}<div class="hc-state">${inTime ? (early ? L(`Aralık ${sfx(hm(w.checkStart), 'da')} başlıyor; erken kalkmak da sayılır.`, `The window starts at ${hm(w.checkStart)}; waking early counts too.`) : L(`Aralığın bitmesine ${fmtDur(w.checkEnd - n)} var.`, `${fmtDur(w.checkEnd - n)} left in the window.`)) : L('Aralık bitti: gecikme sayılır.', 'The window is over: it counts as late.')}</div>
      <button class="btn ${inTime || rest ? '' : 'red'}" data-act="check" data-h="${hid}">${L('☀ Uyandım', "☀ I'm up")}</button>`;
  } else if (h.type === 'window') {
    const info = `<small class="muted">${L('Aralık', 'Window')} ${hm(w.checkStart)}–${hm(w.checkEnd)} · ${L('tolerans', 'tolerance')} ${h.lateMin} ${L('dk', 'min')}</small>`;
    body = `${info}<div class="hc-state">${early ? L(`Aralık ${fmtDur(w.checkStart - n)} sonra başlıyor; erken yapmak da sayılır.`, `The window starts in ${fmtDur(w.checkStart - n)}; doing it early counts too.`) : inTime ? L(`Aralığın bitmesine ${fmtDur(w.checkEnd - n)} var.`, `${fmtDur(w.checkEnd - n)} left in the window.`) : L('Aralık bitti: gecikme sayılır.', 'The window is over: it counts as late.')}</div>
      <button class="btn ${inTime || rest ? '' : 'red'}" data-act="check" data-h="${hid}">${L('✔ Tamamladım', '✔ Done')}</button>`;
  } else if (h.type === 'check' && h.items?.length) {
    const n = (day.done || []).filter(x => h.items.includes(x)).length;
    body = `<small class="muted">${L(`Gün içinde, hepsini işaretle · gece ${DAY_END_UI}'e kadar`, `During the day, tick them all · until ${DAY_END_UI} at night`)}</small>
      <div class="bar qbar thin count"><div class="fill" style="width:${n / h.items.length * 100}%"></div><span>${n} / ${h.items.length}</span></div>
      ${subList(h, day)}
      <div class="hc-state">${inTime ? L(`${longDate(k)} için açık.`, `Open for ${longDate(k)}.`) : L('Gün bitti: gecikme sayılır.', 'The day is over: it counts as late.')}</div>`;
  } else if (h.type === 'check') {
    body = `<small class="muted">${L(`Gün içinde herhangi bir saatte · gece ${DAY_END_UI}'e kadar`, `Any time during the day · until ${DAY_END_UI} at night`)}</small>
      <div class="hc-state">${inTime ? L(`${longDate(k)} için açık.`, `Open for ${longDate(k)}.`) : L('Gün bitti: gecikme sayılır.', 'The day is over: it counts as late.')}</div>
      <button class="btn ${inTime || rest ? '' : 'red'}" data-act="check" data-h="${hid}">${L('✔ Yaptım', '✔ Did it')}</button>`;
  } else if (h.type === 'count') {
    const c = day.count || 0, goal = h.count.target, unit = esc(h.count.unit || '');
    if (h.items?.length) body = `<small class="muted">${L(`Günlük hedef: ${goal} alt görev · yarısı gecikme sayılır`, `Daily target: ${goal} sub-tasks · half counts as late`)}</small>
      <div class="bar qbar thin count"><div class="fill" style="width:${Math.min(100, c / goal * 100)}%"></div><span>${c} / ${goal}</span></div>
      ${subList(h, day)}`;
    else body = `<small class="muted">${L(`Günlük hedef ${goal} ${unit} · yarısı gecikme sayılır`, `Daily target ${goal} ${unit} · half counts as late`)}</small>
      <div class="bar qbar thin count"><div class="fill" style="width:${Math.min(100, c / goal * 100)}%"></div><span>${c} / ${goal} ${unit}</span></div>
      <div class="row count-row"><button class="btn sm ghost" data-act="addcount" data-h="${hid}" data-n="-1">−1</button>
        <button class="btn sm" data-act="addcount" data-h="${hid}" data-n="1">+1</button>
        ${goal >= 10 ? `<button class="btn sm" data-act="addcount" data-h="${hid}" data-n="${Math.max(5, Math.round(goal / 10))}">+${Math.max(5, Math.round(goal / 10))}</button>` : ''}
        <input type="number" min="1" id="cnt-${hid}" placeholder="${L('adet', 'amount')}" style="width:80px"><button class="btn sm" data-act="addcountin" data-h="${hid}">${L('Ekle', 'Add')}</button></div>`;
  }
  return `<div class="habit-card ${h.status}">
    <div class="hc-head"><b>${esc(h.name)}</b>${typeBadge(h)}${chainChip(h)}<span class="hc-date muted">${h.type === 'sleep' ? L(`${longDate(k)} sabahı`, `Morning of ${longDate(k)}`) : longDate(k)}</span></div>
    ${habitProgress(h)}
    ${rest ? `<div class="hc-rest">⏸ ${L('Dinlenme günü: yaparsan ödül alırsın, yapmazsan ceza yok.', 'Rest day: do it for rewards, skip it with no penalty.')}</div>` : ''}
    ${day.result ? '' : lastResult(h, k)}
    <div class="hc-body">${body}</div>
  </div>`;
}
function retroBox(h) {
  const cor = E.correctableDay(h.id); if (!cor) return '';
  const sleep = h.type === 'sleep', hid = h.id;
  const input = h.type === 'count' ? `<label style="margin:0">${L('Adet', 'Amount')} <input type="number" min="1" id="retroCount-${hid}" style="width:90px"></label>`
    : `<label style="margin:0">${sleep ? L('Kalkış', 'Woke') : L('Saat', 'Time')}${h.type === 'check' ? L(' (isteğe bağlı)', ' (optional)') : ''} <input type="time" id="retroWake-${hid}"></label>
       ${sleep ? `<label style="margin:0">${L('Yatış (isteğe bağlı)', 'Bedtime (optional)')} <input type="time" id="retroBed-${hid}"></label>` : ''}`;
  return `<div class="box retro"><b>📝 ${esc(h.name)}: ${L(`${longDate(cor.k)} kaçırıldı olarak işlendi.`, `${longDate(cor.k)} was recorded as missed.`)}</b>
    <p class="muted" style="margin:6px 0">${L(`Gerçekten yaptıysan ${longDate(dk(cor.deadline))} ${sfx(hm(cor.deadline), 'e')} kadar girebilirsin; kaçırmanın etkileri geri alınır.`, `If you really did it, you can enter it until ${longDate(dk(cor.deadline))} ${hm(cor.deadline)}; the effects of missing it are undone.`)}</p>
    <div class="row">${input}<button class="btn" data-act="retro" data-h="${hid}" data-k="${cor.k}">${L('Kaydet', 'Save')}</button></div></div>`;
}
function renderContract() {
  const n = now(), s = st(), rk = E.restTarget(n);
  const restUi = E.isRest(rk) ? `<small class="muted">⏸ ${L(`${longDate(rk)} dinlenme günü.`, `${longDate(rk)} is a rest day.`)}</small>`
    : E.restUsedInWeek(rk) ? `<small class="muted">${L('Bu haftaki dinlenme hakkını kullandın.', "You've used this week's rest day.")}</small>`
    : `<button class="btn sm ghost" data-act="rest" title="${L('Haftada 1 kez, sadece önceden. O gün bütün zincirler donar.', 'Once a week, only in advance. All chains freeze that day.')}">⏸ ${L(`${longDate(rk)} dinlenme günü olsun`, `Make ${longDate(rk)} a rest day`)}</button>`;
  $('#contractPanel').innerHTML = `<div class="row" style="justify-content:space-between;align-items:center">
      <div><small class="muted">${L('ALIŞKANLIKLAR', 'HABITS')} · ${s.habits.length}/${MAX_HABITS}</small><h2 style="margin:0">${L('Bugünün görevleri', "Today's quests")}</h2></div>
      <div class="clock" id="clock">${hm(n)}</div></div>
    ${s.habits.map(retroBox).join('')}
    <div class="habit-list">${s.habits.map(h => habitCard(h, n)).join('')}</div>
    <div class="row" style="justify-content:space-between;margin-top:10px;gap:8px">${restUi}
      ${s.habits.length < MAX_HABITS ? `<button class="btn sm ghost" data-act="tab" data-tab="mainquest">＋ ${L('Alışkanlık ekle', 'Add a habit')}</button>` : ''}</div>
    <div class="hint">${L(`Günün ilk başarısı ${CARDS_PER.first} kart, sonrakiler ${CARDS_PER.next} kart verir.`, `The day's first success gives ${CARDS_PER.first} cards, later ones ${CARDS_PER.next}.`)}${s.pity >= 9 ? L(' · Sıradaki kart en az Destansı!', ' · Next card is at least Epic!') : ''}</div>`;
}

/* ---------- av: aktif kontrat + kontrat tabelası ---------- */
const bandBossNames = () => E.bandInfo().regions.filter(r => E.bossAvailable(r)).map(r => monById(REGIONS[r].boss).name).join(' / ') || '—';
const dmgRange = () => `${Math.round(E.playerStats().dph)}`;
/* hasar dökümü (üzerine gelince) */
function dmgTip() {
  const ps = E.playerStats(), b = ps.bonus, r = n => Math.round(n * 10) / 10;
  const lines = [
    L(`Saatlik vuruş = (seviye gücü + gümüş kılıç) × (1 + bonus)${ps.buf ? ' × odak' : ''}${ps.deb ? ' × ceza' : ''}${ps.wounded ? ' × yaralı' : ''}`,
      `Hourly hit = (level power + silver sword) × (1 + bonus)${ps.buf ? ' × focus' : ''}${ps.deb ? ' × penalty' : ''}${ps.wounded ? ' × wounded' : ''}`),
    L(`• Seviye gücü: ${r(ps.level)}`, `• Level power: ${r(ps.level)}`),
    b.swordName ? L(`• ${b.swordName}: +${b.sword}`, `• ${b.swordName}: +${b.sword}`) : L('• Gümüş kılıç yok', '• No silver sword'),
    L(`• Bonus +%${b.pct}: ${b.parts.join(', ') || 'zincirler, kart bağları ve kılıcın avcı (bane) bonusu'}`,
      `• Bonus +${b.pct}%: ${b.parts.join(', ') || 'chains, card links and sword bane bonus'}`),
    L(`• Zincir +%${b.chain}: ${E.chainDamage().list.filter(x => x.dmg).map(x => x.w < 1 ? `${x.h.name}: +%${x.dmg} → ${shareName(x.w)} = +%${x.eff}` : `${x.h.name} +%${x.dmg}`).join(', ') || 'henüz Çelik zincir yok (7 halka)'}`,
      `• Chain +${b.chain}%: ${E.chainDamage().list.filter(x => x.dmg).map(x => x.w < 1 ? `${x.h.name}: ${shareName(x.w)} of +${x.dmg}% = +${x.eff}%` : `${x.h.name} +${x.dmg}%`).join(', ') || 'no Steel chain yet (7 links)'}`),
  ];
  if (ps.buf) lines.push(L(`• Odak +%${ps.buf}`, `• Focus +${ps.buf}%`));
  if (ps.deb) lines.push(L(`• Ceza −%${ps.deb} (Yorgun / Bitkin)`, `• Penalty −${ps.deb}% (Tired / Exhausted)`));
  if (ps.wounded) lines.push(L('• Yaralı −%20 (can %50 altında)', '• Wounded −20% (HP below 50%)'));
  if (b.crit) lines.push(L(`• Kritik: her saatlik vuruş %${b.crit} şansla ×1.5`, `• Crit: each hourly hit has a ${b.crit}% chance of ×1.5`));
  lines.push(L(`Ortalama: ${Math.round(ps.dph)}/sa`, `Average: ${Math.round(ps.dph)}/h`));
  return lines.join('\n');
}
function renderHunt() {
  const s = st(), bnd = E.bandInfo(), c = s.contract, b = E.damageBonus(), ci = E.combatInfo();
  const sv = swordById(s.swords.silver), sl = swordById(s.swords.steel);
  const slot = (x, label) => `<div class="eq-slot" title="${x ? esc(x.name) : L('Boş', 'Empty')}">${x ? swordImg(x) : '<div class="sword-ph empty">—</div>'}<small>${label}${x ? ` ${L('Sv', 'Lv')} ${E.swordLv(x.id)}` : ''}</small></div>`;
  const dur = h => fmtDur(h * 3600000);
  let active = `<p class="muted">${L('Aktif kontrat yok. Haritadan bir ilan panosu açıp kontrat seç; seçmezsen panodaki ilk iş kendiliğinden alınır.', "No active contract. Open a notice board from the map and pick one; otherwise the first job on the board is taken automatically.")}</p>`;
  if (c) {
    const m = monById(c.id), ms = monStats(m, !!c.elite), cls = CLASSES[m.cls] || {};
    active = `<div class="monster">
      <div class="monster-art">${imgTag(monImg(m))}</div>
      <div style="flex:1">
        <h3>${c.elite ? `<span class="badge elite">${L('ELİT', 'ELITE')}</span> ` : ''}${esc(m.name)} ${m.boss ? '<span class="badge red">BOSS</span>' : ''}</h3>
        <small class="muted">${esc(REGIONS[m.region]?.name || '')} · ${esc(cls.tr || m.cls)} · ${L(`Ödül ${ms.gold} oren, ${ms.xp} TP`, `Reward ${ms.gold} crowns, ${ms.xp} XP`)}</small>
        <div class="bar mon" style="margin:10px 0"><div class="fill" style="width:${Math.max(0, c.hp) / c.max * 100}%"></div><span>${Math.ceil(c.hp)} / ${c.max}</span></div>
        <div class="cb-stats"><span title="${esc(dmgTip())}">⚔ ${dmgRange()}/${L('sa', 'h')}</span>
          <span title="${L('Görevinde başarısız olursan canavarın vuruşu: gecikme / kaçırma', 'What the monster hits you for if you fail a quest: late / missed')}">🩸 −${ci.hitLate} / −${ci.hitMiss}</span>
          ${ci.mode === 'fight' && ci.eta != null ? `<span title="${L('Bu hızla kalan süre', 'Time left at this pace')}">⏳ ~${dur(ci.eta)}</span>` : ''}</div>
        ${ci.aero ? `<div class="aero-charge ${ci.aero.full ? 'full' : ''}" title="${esc(DATA.UNIQUE_BY_ID.aerondight.desc)}"><span>✨ Aerondight ${ci.aero.charge}/${ci.aero.max} · +${L('%' + ci.aero.pct, ci.aero.pct + '%')}${ci.aero.full ? L(` · Göl Hanımı'nın Darbesi ${ci.aero.next} vuruş sonra`, ` · Lady's Strike in ${ci.aero.next} hits`) : L(` · sonraki şarj ${ci.aero.toNext} saat sonra`, ` · next charge in ${ci.aero.toNext} h`)}</span><div class="bar"><div class="fill" style="width:${ci.aero.charge / ci.aero.max * 100}%"></div></div></div>` : ''}
        <p class="flavor">${esc(m.lore)}</p>
        <button class="btn sm ghost" data-act="regions" title="${L('Panodan başka bir kontrat seçersen bu kontratın ilerlemesi sıfırlanır.', "Picking another contract from a board resets this contract's progress.")}">🔁 ${L('Kontratı değiştir', 'Change contract')}</button>
      </div></div>`;
  }
  const status = ci.mode === 'recover' ? `<div class="cb-status recover">🩹 ${L(`Yenildin; ${sfx(hm(new Date(ci.until)), 'e')} kadar toparlanıyorsun, sonra tam canla ava dönersin.`, `You were defeated; recovering until ${hm(new Date(ci.until))}, then you return at full HP.`)}</div>`
    : c ? `<div class="cb-status fight">⚔ ${L('Avdasın; uygulama kapalıyken de devam eder. Canavar sana sadece görevlerinde başarısız olunca vurur.', 'Hunting; it continues while the app is closed. The monster only hits you when you fail a quest.')}</div>` : '';
  const wound = ci.wounded ? `<span class="effect exhausted" title="${L('Canın %50 altında', 'HP below 50%')}">🩸 ${L('Yaralı', 'Wounded')} −20%</span>` : '';
  const effects = ci.effects.length || wound ? `<div class="cb-effects">${wound}${ci.effects.map(e => `<span class="effect ${e.kind}" title="${esc(e.src || '')}">${e.kind === 'tired' ? '😩 ' + L('Yorgun', 'Tired') + ` −${e.pct}%` : e.kind === 'focus' ? '🎯 ' + L('Odak', 'Focus') + ` +${e.pct}%` : e.kind === 'thunder' ? `⚡ Thunderbolt +${e.pct}%` : e.kind === 'early' || e.kind === 'discipline' ? `✦ ${esc(DATA.UNIQUE_BY_ID[e.kind].name)} +${e.pct}%` : '🥀 ' + L('Bitkin', 'Exhausted') + ` −${e.pct}%`} · ${fmtDur(new Date(e.until) - now())}</span>`).join('')}
      ${ci.deb ? `<small class="muted">${L(`Toplam hasar cezası −%${ci.deb}`, `Total damage penalty −${ci.deb}%`)}</small>` : ''}</div>` : '';
  const potions = `<div class="cb-potions">
      <span title="${L(`İçince +${ci.potionHeal} can. Can avda saatte %${+(ci.regen.fight * 100).toFixed(2)} dolar; yenilince saatte %${Math.round(ci.regen.idle * 100)} toparlanırsın.`, `Drinking gives +${ci.potionHeal} HP. HP regenerates ${+(ci.regen.fight * 100).toFixed(2)}%/h while hunting; after a defeat you recover ${Math.round(ci.regen.idle * 100)}%/h.`)}">🧪 Swallow <b>${ci.potions}/${ci.potionCap}</b></span>
      <button class="btn sm" data-act="drink" ${ci.potions < 1 || s.hp >= E.maxHp() ? 'disabled' : ''} title="+${ci.potionHeal} ${L('can', 'HP')}">🧪 ${L('İç', 'Drink')}</button>
      <button class="btn sm ghost" data-act="buy" data-id="swallow" ${ci.potions >= ci.potionCap || s.gold < ci.potionPrice ? 'disabled' : ''}>${L('Al', 'Buy')} · ${ci.potionPrice} 🪙</button>
      <span title="${L('Kaçırılan bir günde kendiliğinden içilir: canavar vuramaz, Bitkin olmazsın', 'Drunk automatically on a missed day: the monster can\'t strike and you don\'t become Exhausted')}">🍯 White Honey <b>${ci.honey}</b></span></div>
    <div class="cb-potions">
      <span title="${L(`${DATA.THUNDER.hours} saat boyunca hasar +%${DATA.THUNDER.pct}`, `+${DATA.THUNDER.pct}% damage for ${DATA.THUNDER.hours} hours`)}">⚡ Thunderbolt <b>${ci.thunder}/${ci.thunderCap}</b></span>
      <button class="btn sm" data-act="thunder" ${ci.thunder < 1 ? 'disabled' : ''}>⚡ ${L('İç', 'Drink')}</button>
      <button class="btn sm ghost" data-act="buy" data-id="thunder" ${ci.thunder >= ci.thunderCap || s.gold < ci.thunderPrice ? 'disabled' : ''}>${L('Al', 'Buy')} · ${ci.thunderPrice} 🪙</button>
      <span title="${L(`Canavara ${ci.dancingMin}–${ci.dancingMax} hasar (3–10 saatlik); canın −${ci.dancingCost}`, `${ci.dancingMin}–${ci.dancingMax} damage to the monster (3–10 hours' worth); costs you ${ci.dancingCost} HP`)}">✴ Dancing Star <b>${ci.dancing}/${ci.dancingCap}</b></span>
      <button class="btn sm" data-act="dancing" ${ci.dancing < 1 || !c || ci.mode === 'recover' || s.hp <= ci.dancingCost ? 'disabled' : ''} title="${L(`${ci.dancingMin}–${ci.dancingMax} hasar · −${ci.dancingCost} can (canın %50'nin üstünde olmalı)`, `${ci.dancingMin}–${ci.dancingMax} damage · −${ci.dancingCost} HP (HP must be above 50%)`)}">✴ ${L('At', 'Throw')} · ${ci.dancingMin}–${ci.dancingMax}</button>
      <button class="btn sm ghost" data-act="buy" data-id="dancing" ${ci.dancing >= ci.dancingCap || s.gold < ci.dancingPrice ? 'disabled' : ''}>${L('Al', 'Buy')} · ${ci.dancingPrice} 🪙</button></div>`;
  const queue = (s.queue || []).length ? `<div class="cb-queue"><small class="muted">${L('Av sırası', 'Hunt queue')}:</small> ${s.queue.map(id => `<span class="q-item">${esc(monById(id).name)} <button class="btn sm ghost" data-act="unqueue" data-id="${id}" title="${L('Sıradan çıkar', 'Remove')}">✕</button></span>`).join('')}</div>` : '';
  const atCap = E.atCap();
  const levelInfo = s.legend ? L("Efsanesin. Bu karakterle devam edebilirsin: kestiğin canavarlar ve bölge boss'ları elit olarak geri dönüyor, TP Ün (★) kazandırıyor. İstersen Okul'da yeniden doğabilirsin.", "You are a legend. Keep playing this character: slain monsters and region bosses return as elites, and XP earns Renown (★). You can also be reborn in the School.")
    : atCap ? L(`Seviye sınırındasın (${bnd.max}). İlerlemek için bu kademenin boss'larından birini yen: ${bandBossNames()}.`, `You're at the level cap (${bnd.max}). Defeat one of this tier's bosses to advance: ${bandBossNames()}.`)
    : L(`Seviye ${s.level}. Bu kademenin sınırı ${bnd.max}; sınıra gelince boss'lar açılır.`, `Level ${s.level}. This tier caps at ${bnd.max}; at the cap the bosses unlock.`);
  $('#regionPanel').innerHTML = `<div class="region-strip">
      <div class="rs-main"><small class="muted">${L('KADEME', 'TIER')} ${bnd.i + 1}/${BAND_COUNT} · ${L('Seviye', 'Levels')} ${bnd.min}–${bnd.max}</small><h2 style="margin:0">${esc(bandLabel(bnd.i))}</h2></div>
      <p class="muted rs-info">${levelInfo}</p>
      <div class="row rs-act"><button class="btn ${c ? '' : 'big'}" data-act="regions">🗺 ${L('Harita ve ilan panoları', 'Map and notice boards')}</button>
        ${bnd.regions.some(r => E.bossAvailable(r)) ? `<span class="badge red">${L('Boss açık', 'Boss open')}: ${esc(bandBossNames())}</span>` : ''}</div></div>`;
  $('#monsterPanel').innerHTML = `<small class="muted">${L('AKTİF KONTRAT', 'ACTIVE CONTRACT')}</small>
    ${active}${status}${effects}${potions}${queue}
    <div class="eq-row">${slot(sv, L('Gümüş', 'Silver'))}${slot(sl, L('Çelik', 'Steel'))}
      <div class="eq-info" title="${esc(dmgTip())}"><div>${L('Saatlik hasar', 'Damage per hour')}: <b class="mult">${dmgRange()}</b>
          · ${L('Bonus', 'Bonus')} <b class="mult">${L(`+%${b.pct}`, `+${b.pct}%`)}</b>${b.chain ? ` <small>${L(`(zincir +%${b.chain} dahil)`, `(incl. chain +${b.chain}%)`)}</small>` : ''}${b.crit ? ` · ${L('Kritik', 'Crit')} <b class="mult">${L(`%${b.crit}`, `${b.crit}%`)}</b>` : ''}</div>
        <small class="muted">${L('Ayrıntı için üzerine gel.', 'Hover for details.')}${b.parts.length ? ' · ' + esc(b.parts.join(' · ')) : ''}</small>
        ${(() => { if (!c) return ''; const m = monById(c.id), bs = E.bestSwordFor('silver', m), bt = E.bestSwordFor('steel', m);
          const better = (bs && bs.id !== s.swords.silver) || (bt && bt.id !== s.swords.steel);
          return better ? `<div class="row" style="margin-top:6px"><small class="mult">${L('Bu canavara karşı daha iyi bir kılıcın var.', 'You have a better sword against this monster.')}</small><button class="btn sm" data-act="equipbest">⚔ ${L('En iyisini kuşan', 'Equip the best')}</button></div>` : ''; })()}</div></div>
    <p class="hint">${L('Av sürekli akar ve canavarlar sana kendiliğinden vurmaz: sadece bir görevi geciktirince (yarım) ya da kaçırınca (tam) vururlar. Can avda saatte yaklaşık %0,3 (okula göre %0,2–0,5), dolar; yenilince saatte %15 (Bear %30) toparlanırsın. Acil durumda Swallow iç. Canın biterse yenilirsin: canavarın canı dolar, orenin %10 kadarı gider. Zincirlerin hasarını artırır; gecikmek "Yorgun", kaçırmak "Bitkin" de yapar.',
      'The hunt never stops and monsters don\'t hit you on their own: they only strike when you are late on a quest (half) or miss it (full). HP regenerates about 0.3%/h while hunting (0.2–0.5% by school) ; after a defeat you recover 15%/h (Bear 30%). Drink a Swallow in an emergency. If your HP runs out you are defeated: the monster heals fully and you lose 10% of your crowns. Your chains raise your damage; being late also makes you "Tired", missing "Exhausted".')}</p>`;
}
const strLabel = m => m.boss ? (REGIONS[m.region]?.tier >= 5 ? L('Efsanevi boss', 'Legendary boss') : 'Boss') : m.str < 0.7 ? L('Zayıf', 'Weak') : m.str < 0.86 ? L('Orta', 'Medium') : L('Güçlü', 'Strong');
const bandLabel = b => bandRegions(b).map(r => REGIONS[r].name).join(' / ');
/* ---------- harita: kendi çizdiğimiz Kıta haritası; bölgeler sınırlarıyla tıklanır ---------- */
const KMAP = window.KM_MAP || { w: 1000, h: 870, land: '', isles: [], rivers: [] };
function mapSvg() {
  const s = st(), killed = new Set(s.trophies.map(t => t.id));
  // önce deniz bölgesi, sonra karadakiler (adalar denizin üstünde tıklanabilsin)
  const order = REGIONS.map((r, i) => i).sort((a, b) => (REGIONS[b].id === 'skelligeseas') - (REGIONS[a].id === 'skelligeseas'));
  const areas = order.map(i => {
    const r = REGIONS[i], locked = r.tier > s.region, cur = r.tier === s.region && !s.legend, done = killed.has(r.boss);
    const bossOpen = !locked && E.bossAvailable(i);
    const cls = locked ? 'locked' : cur ? 'current' : 'open';
    const sea = r.id === 'skelligeseas';
    return `<g class="reg-area ${cls} ${sea ? 'sea' : ''}" data-act="board" data-r="${i}" tabindex="0">
      <title>${esc(r.name)} · ${L('Seviye', 'Levels')} ${r.min}–${r.max}${locked ? ' · ' + L('kilitli', 'locked') : ''}</title>
      <path d="${r.map?.d || ''}"/></g>`;
  }).join('');
  const labels = order.map(i => {
    const r = REGIONS[i], locked = r.tier > s.region, done = killed.has(r.boss), bossOpen = !locked && E.bossAvailable(i);
    const { x, y } = r.map || { x: 0, y: 0 }, sea = r.id === 'skelligeseas';
    const lx = sea ? x - 20 : x, ly = sea ? y + 70 : y;
    return `<g class="reg-label ${locked ? 'locked' : ''}" transform="translate(${lx},${ly})">
      <text class="lbl" text-anchor="middle">${locked ? '🔒 ' : done ? '✓ ' : bossOpen ? '👑 ' : ''}${esc(r.name)}</text>
      <text class="lvl" y="15" text-anchor="middle">${r.min}–${r.max}</text></g>`;
  }).join('');
  return `<svg class="worldmap" viewBox="0 0 ${KMAP.w} ${KMAP.h}" role="img" aria-label="${L('Kıta haritası', 'Map of the Continent')}">
    <defs><radialGradient id="parch" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#cfc29c"/><stop offset="1" stop-color="#8f7b52"/></radialGradient>
      <pattern id="waves" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M0,9 q10,-7 20,0 t20,0" fill="none" stroke="#6d5d3d" stroke-width="1" opacity=".3"/></pattern>
      <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#5d4d35" stroke-width="2" opacity=".35"/></pattern></defs>
    <rect width="${KMAP.w}" height="${KMAP.h}" fill="url(#parch)"/><rect width="${KMAP.w}" height="${KMAP.h}" fill="url(#waves)"/>
    <path d="${KMAP.land}" class="land"/>
    ${areas}
    ${KMAP.isles.map(d => `<path d="${d}" class="isle"/>`).join('')}
    ${KMAP.rivers.map(d => `<path d="${d}" class="river"/>`).join('')}
    ${(KMAP.labels || []).map(g => `<text class="geo ${g.sea ? 'sea' : ''}" x="${g.x}" y="${g.y}" text-anchor="middle">${esc(L(g.tr, g.en))}</text>`).join('')}
    ${labels}
    <g class="compass" transform="translate(${KMAP.w - 70},${KMAP.h - 70})"><circle r="34"/><path d="M0,-30 L7,0 L0,30 L-7,0 Z"/><text y="-38" text-anchor="middle">N</text></g>
    <text x="${KMAP.w / 2}" y="34" class="maptitle" text-anchor="middle">${L('Kıta', 'The Continent')}</text>
  </svg>`;
}
function showRegions() {
  const s = st();
  const tiers = Array.from({ length: BAND_COUNT }, (_, b) => {
    const locked = b > s.region;
    return `<div class="tier-line ${locked ? 'locked' : ''} ${b === s.region && !s.legend ? 'current' : ''}"><small>${L('Seviye', 'Levels')} ${b * 4 + 1}–${b * 4 + 4}</small>
      ${bandRegions(b).map(r => `<button class="btn sm ${locked ? 'ghost' : ''}" data-act="board" data-r="${r}" ${locked ? 'disabled' : ''}>${locked ? '🔒 ' : ''}${esc(REGIONS[r].name)}</button>`).join('')}</div>`;
  }).join('');
  openModal(`<div class="row" style="justify-content:space-between"><h2 style="margin:0">🗺 ${L('Kıta haritası', 'Map of the Continent')}</h2><button class="btn ghost" data-act="close">${L('Kapat', 'Close')}</button></div>
    <p class="muted">${L(`Bir bölgeye tıkla, ilan panosundan kontrat seç. Her kademede (4 seviye) birden çok bölge açılır; her panoda haftada ${BOARD_SIZE} ilan olur (pazartesi yenilenir). Kademenin sınırına gelince boss'larından birini yenmek bir sonraki kademeyi açar.`,
      `Click a region and pick a contract from its notice board. Each tier (4 levels) opens several regions; every board shows ${BOARD_SIZE} notices a week (refreshed on Monday). At the tier's level cap, defeating one of its bosses unlocks the next tier.`)}</p>
    <div class="map-wrap">${mapSvg()}</div>
    <div class="tier-list">${tiers}</div>`, 'wide map');
}
/* ---------- ilan panosu ---------- */
let boardSel = { r: 0, id: null };
const NOTE_ROT = [-3, 2, -1.5, 3, -2.5, 1.5, -1];
function contractText(m, r) {
  const place = REGIONS[r].name, cls = CLASSES[m.cls]?.tr || m.cls;
  if (m.boss) return L(`${place} bölgesinin en tehlikeli yaratığı: ${m.name}. Onu yenen witcher'ın adı dilden dile dolaşır, önündeki yollar açılır.`,
    `The most dangerous creature of ${place}: ${m.name}. The witcher who defeats it will be known far and wide, and new roads will open.`);
  const k = [...m.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 3;
  return [
    L(`${place} halkı yardım istiyor. ${cls} türünden bir yaratık, ${m.name}, geceleri yolcuları ve sürüleri hedef alıyor. Onu durduracak cesur birine ödül verilecek.`,
      `The people of ${place} ask for help. A creature of the ${cls.toLowerCase()} kind, ${m.name}, preys on travellers and herds at night. Whoever stops it will be rewarded.`),
    L(`İLAN: ${place} civarında ${m.name} görüldü. Köylüler tarlalara çıkamıyor, tüccarlar yolu değiştiriyor. İşini bilen bir witcher aranıyor.`,
      `NOTICE: ${m.name} has been sighted near ${place}. Farmers won't go to the fields and merchants take other roads. A witcher who knows the trade is wanted.`),
    L(`${place} muhtarından: "${m.name} yüzünden kimse dışarı adım atamıyor. Kesemiz dar ama derdimiz büyük. Gelen ödülünü alır."`,
      `From the elder of ${place}: "Nobody dares step outside because of ${m.name}. Our purse is thin but our trouble is great. Whoever comes will be paid."`),
  ][k];
}
function boardDetail(r) {
  const list = E.boardEntries(r), e = list.find(x => x.m.id === boardSel.id) || list.find(x => x.active) || list[0];
  if (!e) return `<div class="cdetail"><p class="muted">${L('Bu hafta bu panoda ilan kalmadı. Pazartesi yenilenir.', 'No notices left on this board this week. It refreshes on Monday.')}</p></div>`;
  boardSel.id = e.m.id;
  const cls = CLASSES[e.m.cls] || {};
  return `<div class="cdetail">
    <h3>${L('Kontrat', 'Contract')}: ${e.elite ? L('Elit ', 'Elite ') : ''}${esc(e.m.name)}</h3>
    <div class="cd-art">${imgTag(monImg(e.m))}</div>
    <p>${esc(contractText(e.m, r))}</p>
    ${e.m.lore ? `<p class="flavor">${esc(e.m.lore)}</p>` : ''}
    <p class="cd-stats">${esc(cls.tr || e.m.cls)} · ${strLabel(e.m)}${e.elite ? ` · <span class="badge elite">${L('ELİT', 'ELITE')}</span>` : ''}<br>
      ❤ ${e.stats.hp} · <span title="${L('Kaçırılan günde vuruşu', 'Hit on a missed day')}">🩸 −${e.stats.hit}</span> · 🪙 ${e.stats.gold} · ${L('TP', 'XP')} ${e.stats.xp}</p>
    <div class="row" style="justify-content:center">${e.killed ? '☠' : e.active ? `<span class="badge gold">${L('Aktif kontratın', 'Your active contract')}</span>`
      : `<button class="btn big" data-act="take" data-id="${e.m.id}">${L('Kontratı al', 'Take contract')}</button>
         ${(st().queue || []).includes(e.m.id) ? `<span class="badge">${L('Sırada', 'Queued')}</span>` : `<button class="btn ghost" data-act="queue" data-id="${e.m.id}" title="${L('Şu anki canavar ölünce bu kontrat alınır', 'Taken when the current monster dies')}">＋ ${L('Sıraya ekle', 'Queue')}</button>`}`}</div></div>`;
}
function showBoard(r) {
  if (r !== boardSel.r) boardSel = { r, id: null };
  const s = st(), reg = REGIONS[r];
  if (!reg || reg.tier > s.region) return toast(L('Bu bölge henüz kilitli.', 'This region is still locked.'), 'bad');
  const list = E.boardEntries(r), cost = E.boardRerollCost(r);
  const notes = list.map((e, i) => `<div class="note ${e.boss ? 'boss' : ''} ${e.m.id === (boardSel.id || list.find(x => x.active)?.m.id || list[0]?.m.id) ? 'sel' : ''} ${e.active ? 'active' : ''} ${e.killed ? 'done' : ''}"
      style="--rot:${NOTE_ROT[i % NOTE_ROT.length]}deg" data-act="boardsel" data-id="${e.m.id}">
      <div class="note-img">${imgTag(monImg(e.m, 'low'))}</div>
      <b>${e.elite ? L('Elit ', 'Elite ') : ''}${esc(e.m.name)}</b>
      <small>❤ ${e.stats.hp} · 🪙 ${e.stats.gold}</small>
      ${e.killed ? `<span class="slain"><span class="skull">💀</span>${L('ÖLDÜ', 'SLAIN')}</span>` : ''}
      ${e.boss ? '<span class="seal"></span>' : ''}${e.active ? `<span class="pinned">${L('Aktif', 'Active')}</span>` : ''}</div>`).join('');
  openModal(`<div class="row" style="justify-content:space-between;gap:8px">
      <div><small class="muted">${esc(reg.game || '')} · ${L('Seviye', 'Levels')} ${reg.min}–${reg.max}</small><h2 style="margin:0">${esc(reg.name)}</h2></div>
      <div class="row"><button class="btn sm" data-act="rerollboard" data-r="${r}" ${s.gold < cost ? 'disabled' : ''} title="${L('Panoya yeni ilanlar as. Aktif kontratın yerinde kalır.', 'Post new notices. Your active contract stays.')}">🔁 ${L('Yenile', 'Refresh')} · ${cost} 🪙</button>
        <button class="btn sm ghost" data-act="regions">🗺 ${L('Harita', 'Map')}</button><button class="btn sm ghost" data-act="close">${L('Kapat', 'Close')}</button></div></div>
    <p class="muted" style="margin:6px 0 10px">${esc(reg.desc || '')}</p>
    <div class="board-wrap"><div class="cboard">${notes || `<p class="muted" style="color:#d9c79c">${L('Panoda ilan yok.', 'No notices on the board.')}</p>`}</div>
      <div class="carve"></div>${boardDetail(r)}</div>`, 'wide board');
}

function renderChain() {
  const RN = st().school === 'griffin' ? 1 : REPAIR_NEED;
  const names = { ok: L('başarılı', 'success'), rust: L('gecikme (paslı)', 'late (rusty)'), rest: L('dinlenme', 'rest'), break: L('kırıldı', 'broken') };
  const cd = E.chainDamage(), w = new Map(cd.list.map(x => [x.h.id, x]));
  const rows = st().habits.map(h => {
    const c = h.chain, t = tierOf(c.len), tier = TIERS[t], next = TIERS[t + 1], x = w.get(h.id);
    const prog = next ? (c.len - tier.at) / (next.at - tier.at) * 100 : 100;
    const links = c.links.slice(-30).map(l => l.t === 'break'
      ? `<span class="link break" title="${longDate(l.d)}: ${names.break}">⚡</span>`
      : `<span class="link ${l.t}" title="${longDate(l.d)}: ${names[l.t]}"></span>`).join('');
    let status = '';
    if (c.repair) status += `<div class="chain-note repair">⚒ <b>${L('Kefaret', 'Atonement')} ${c.repair.got}/${RN}:</b> ${L(`Sonraki ${RN - c.repair.got} günü başarırsan zincir <b>${c.repair.preLen + RN}</b> halkaya döner.`, `Succeed the next ${RN - c.repair.got} days and the chain returns to <b>${c.repair.preLen + RN}</b> links.`)}</div>`;
    if (c.rust) status += `<div class="chain-note rust">🟤 <b>${L('Paslı halka', 'Rusty link')}:</b> ${L('Bir sonraki gecikme zinciri kırar.', 'The next late day breaks the chain.')}</div>`;
    return `<div class="chain-row">
      <div class="cr-head"><b>${esc(h.name)}</b> <span class="chain-len" style="color:${tier.color}">${L(`${c.len} halka`, `${c.len} ${c.len === 1 ? 'link' : 'links'}`)} · ${tier.name}</span>
        <small class="muted" title="${esc(tierTip(tier))}">${(() => { const d = x ? +x.dmg.toFixed(1) : tier.dmg, ms = h.status === 'mastery' && tier.dmg ? L(` (ustalıkta %${tier.dmg} yerine)`, ` (instead of ${tier.dmg}%, in mastery)`) : '';
          return L(`En uzun ${c.best} · hasar +%${d}${ms} · ödül ×${tier.mult}`, `Best ${c.best} · damage +${d}%${ms} · reward ×${tier.mult}`); })()}${x && x.dmg && x.w < 1 ? ` <span title="${esc(MULTI_CHAIN_TXT())}">(${L(`bu zincirin ${shareName(x.w)} eklenir: +%${x.eff}`, `${shareName(x.w)} of it is added: +${x.eff}%`)})</span>` : ''}</small></div>
      <div class="bar chainbar thin"><div class="fill" style="width:${prog}%;background:${next ? next.color : tier.color}"></div><span title="${next ? esc(tierTip(next)) : ''}">${next ? L(`${next.name} için ${next.at - c.len} halka (hasar +%${next.dmg}, ödül ×${next.mult})`, `${next.at - c.len} links to ${next.name} (damage +${next.dmg}%, reward ×${next.mult})`) : L('En üst malzeme', 'Top material')}</span></div>
      <div class="chain" style="--c:${tier.color}">${links || `<small class="muted">${L('İlk halka, ilk başarılı günle dövülecek.', 'The first link will be forged on your first successful day.')}</small>`}</div>${status}</div>`;
  }).join('');
  $('#chainPanel').innerHTML = `<div class="chain-head"><div><h2>${L('Zincirler', 'Chains')}</h2>
      <small>${L(`Zincirlerinden gelen hasar: <b class="mult">+%${cd.total}</b>. Kademelerin üzerine gelince ne verdiklerini görürsün.`, `Damage from your chains: <b class="mult">+${cd.total}%</b>. Hover a tier to see what it gives.`)}${st().habits.length > 1 ? `<br>${MULTI_CHAIN_TXT()}` : ''}</small></div>
      <div class="tier-row">${TIERS.map(x => `<div class="tier on" style="--c:${x.color}" title="${esc(tierTip(x))}"><span class="tier-dot"></span><small>${x.name}<br>${x.at} · ${L(`+%${x.dmg}`, `+${x.dmg}%`)}</small></div>`).join('')}</div></div>
    ${rows}`;
}
const dayIcon = d => !d ? '' : d.result ? RES_ICON[d.result] : '';
function renderWeek() {
  const today = dk(now()), mon = mondayOf(today), keys = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const head = keys.map(k => { const dd = fromKey(k); return `<th class="${k === today ? 'today' : ''}">${DAYS[dd.getDay()]} ${dd.getDate()}${E.isRest(k) ? ' ⏸' : ''}</th>`; }).join('');
  const rows = st().habits.map(h => `<tr><td class="wh-name">${esc(h.name)}</td>${keys.map(k => {
    const d = h.entries[k];
    const icon = dayIcon(d) || (k === today ? '⏳' : k < today && k >= (h.start || k) ? '·' : '');
    const sub = d?.count != null ? `${d.count}` : d?.check ? hm(new Date(d.check)) : '';
    return `<td class="${k === today ? 'today' : ''}"><div class="s">${icon}</div><small>${sub}${d?.medOnTime ? ' 🧘' : ''}</small></td>`;
  }).join('')}</tr>`).join('');
  $('#weekStrip').innerHTML = `<h2>${L('Bu hafta', 'This week')}</h2><div class="table-wrap"><table class="week-grid"><tr><th></th>${head}</tr>${rows}</table></div>`;
}
function renderLog() {
  $('#logList').innerHTML = st().log.slice(0, 60).map(l => {
    const d = new Date(l.t);
    return `<li class="${l.type}"><time>${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${hm(d)}</time>${esc(l.text)}</li>`;
  }).join('') || `<li class="muted">${L('Henüz kayıt yok.', 'No entries yet.')}</li>`;
}

/* ---------- Alışkanlıklar (ana görevler) ---------- */
const TYPE_HELP = {
  sleep: () => L('Yatış ve kalkış aralığı. Yatışta meditasyon sabah ödülünü artırır.', 'A bedtime and a wake-up window. Meditating at bedtime boosts the morning reward.'),
  window: () => L('Belli bir saat aralığında yapılır (ör. 18:00–22:00 spor).', 'Done within a time window (e.g. exercise 18:00–22:00).'),
  count: () => L('Günlük bir sayı hedefi (ör. 8 bardak su, 30 şınav). Gün içinde ekledikçe ilerler; yarısı gecikme sayılır.', 'A daily number target (e.g. 8 glasses of water, 30 push-ups). Add as you go; half counts as late.'),
  check: () => L('Gün içinde herhangi bir saatte yapıp işaretlersin (ör. kitap okuma).', 'Do it any time during the day and mark it (e.g. reading).'),
};
function questForm(q, mode) {
  const type = q.type === 'daily' ? 'window' : q.type, fid = mode + (q.id ? '_' + q.id : '');
  const s = q.sleep || { bedStart: '00:00', bedEnd: '02:00', wakeStart: '08:00', wakeEnd: '08:30' };
  const d = q.daily || { start: '18:00', end: '22:00' };
  const c = q.count || { target: 8, unit: '' };
  const sec = (types, html) => `<div class="qsec" data-t="${types}" ${types.split(' ').includes(type) ? '' : 'hidden'}>${html}</div>`;
  return `<div class="qform" data-mode="${mode}" data-qtype="${type}">
    <label>${L('Alışkanlık', 'Habit')}</label><input data-q="name" value="${esc(q.name || '')}" placeholder="${L('ör. Spor, kitap okuma, su içmek', 'e.g. exercise, reading, drinking water')}">
    ${mode === 'new' ? `<label>${L('Tür', 'Type')}</label>
    <div class="type-pick">${['check', 'count', 'window', 'sleep'].map(t => `<label class="radio type-opt"><input type="radio" name="qtype_${fid}" data-q="type" value="${t}" ${type === t ? 'checked' : ''}>
      <b>${esc(habitTypeName(t))}</b><small class="muted">${TYPE_HELP[t]()}</small></label>`).join('')}</div>` : `<p class="muted" style="margin:4px 0">${L('Tür', 'Type')}: ${typeBadge({ type })} ${TYPE_HELP[type]()}</p>`}
    <div class="row">
      <div><label>${L(`Hedef süre (gün, ${QUEST_MIN}–${QUEST_MAX})`, `Goal (days, ${QUEST_MIN}–${QUEST_MAX})`)}</label><input type="number" data-q="days" min="${QUEST_MIN}" max="${QUEST_MAX}" value="${q.days || 30}" style="width:110px"></div>
      ${sec('sleep window check', `<label>${L('Gecikme toleransı (dk)', 'Late tolerance (min)')}</label><input type="number" data-q="lateMin" min="15" max="240" value="${q.lateMin || 60}" style="width:110px">`)}
    </div>
    ${sec('sleep', `<div class="row">
      <div><label>${L('Yatış aralığı', 'Bedtime window')}</label><div class="row"><input type="time" data-q="bedStart" value="${s.bedStart}"> – <input type="time" data-q="bedEnd" value="${s.bedEnd}"></div></div>
      <div><label>${L('Kalkış aralığı', 'Wake-up window')}</label><div class="row"><input type="time" data-q="wakeStart" value="${s.wakeStart}"> – <input type="time" data-q="wakeEnd" value="${s.wakeEnd}"></div></div></div>`)}
    ${sec('window', `<label>${L('Görev aralığı (aynı gün içinde)', 'Quest window (within one day)')}</label><div class="row"><input type="time" data-q="start" value="${d.start}"> – <input type="time" data-q="end" value="${d.end}"></div>`)}
    ${sec('count', `<div class="row"><div><label>${L('Günlük hedef', 'Daily target')}</label><input type="number" data-q="target" min="1" max="10000" value="${c.target}" style="width:110px"></div>
      <div><label>${L('Birim (isteğe bağlı)', 'Unit (optional)')}</label><input data-q="unit" value="${esc(c.unit)}" placeholder="${L('bardak, sayfa, şınav…', 'glasses, pages, push-ups…')}" style="width:160px"></div></div>`)}
    ${sec('count check', `<label>${L('Alt görevler (isteğe bağlı, her satıra bir tane)', 'Sub-tasks (optional, one per line)')}</label>
      <textarea data-q="items" rows="4" placeholder="${L('ör. Vitamin al →\nD vitamini\nOmega 3\nB12', 'e.g. Take vitamins →\nVitamin D\nOmega 3\nB12')}">${esc((q.items || []).join('\n'))}</textarea>
      <small class="muted">${L(`Her biri kartta ayrı işaretlenir (en fazla ${MAX_ITEMS}). Adet türünde günlük hedef alt görev sayısı olur; yaptım/yapmadım türünde hepsi işaretlenince gün tamamlanır. Yarısı yapıldıysa gecikme sayılır.`, `Each one is ticked separately on the card (up to ${MAX_ITEMS}). For count habits the daily target becomes the number of sub-tasks; for done/not-done habits the day is complete once all are ticked. Half counts as late.`)}</small>`)}
    ${sec('sleep window check', `<p class="hint">${L('Aralık bittikten sonra tolerans içinde yaparsan "gecikme", hiç yapmazsan "kaçırıldı" olur. Yaptım/yapmadım türünde gün gece 03:00\'e kadar sürer.', 'Doing it after the window, within the tolerance, is "late"; not doing it at all is "missed". For done/not-done habits the day lasts until 03:00 at night.')}</p>`)}
  </div>`;
}
function readQuestForm(root) {
  const v = n => root.querySelector(`[data-q="${n}"]${n === 'type' ? ':checked' : ''}`)?.value;
  const type = v('type') || root.querySelector('.qform')?.dataset.qtype || root.dataset?.qtype || 'check';
  return {
    name: v('name'), type, days: +v('days'), lateMin: +v('lateMin') || 60,
    sleep: { bedStart: v('bedStart'), bedEnd: v('bedEnd'), wakeStart: v('wakeStart'), wakeEnd: v('wakeEnd') },
    daily: { start: v('start'), end: v('end') },
    count: { target: +v('target'), unit: v('unit') || '' },
    items: (root.querySelector('[data-q="items"]')?.value || '').split('\n').map(x => x.trim()).filter(Boolean),
  };
}
function habitRanges(h) {
  if (h.type === 'sleep') return `${L('Yatış', 'Bed')} ${h.sleep.bedStart}–${h.sleep.bedEnd} · ${L('Kalkış', 'Wake')} ${h.sleep.wakeStart}–${h.sleep.wakeEnd}`;
  if (h.type === 'window') return `${L('Aralık', 'Window')} ${h.daily.start}–${h.daily.end}`;
  if (h.items?.length) return `${L('Alt görevler', 'Sub-tasks')}: ${h.items.map(esc).join(', ')}`;
  if (h.type === 'count') return `${L('Hedef', 'Target')} ${h.count.target} ${esc(h.count.unit || '')}`;
  return L('Gün içinde', 'During the day');
}
function renderMainQuest() {
  const s = st(), hist = s.questHistory.slice().reverse();
  const cards = s.habits.map(h => `<details class="box habit-box" ${s.habits.length === 1 ? 'open' : ''}>
    <summary><b>${esc(h.name)}</b> ${typeBadge(h)} ${chainChip(h)} ${h.status === 'mastery' ? `<span class="badge gold">${L('Ustalık', 'Mastery')}</span>` : ''}</summary>
    ${habitProgress(h)}
    <p class="muted">${habitRanges(h)} · ${L('Başlangıç', 'Start')}: ${h.start ? longDate(h.start) : '—'}</p>
    <div class="habit-edit" data-h="${h.id}">${questForm(h, 'edit')}
      <div class="row" style="margin-top:8px;justify-content:space-between"><button class="btn" data-act="questsave" data-h="${h.id}">${L('Kaydet', 'Save')}</button>
        ${s.habits.length > 1 ? `<span class="row"><label class="radio" style="margin:0"><input type="checkbox" id="keepSide-${h.id}"> ${L('Yan göreve dönüştür', 'Turn into a side quest')}</label>
          <button class="btn red sm" data-act="habitdel" data-h="${h.id}">${h.status === 'mastery' ? L('Listeden çıkar', 'Remove') : L('Bırak', 'Abandon')}</button></span>` : ''}</div></div>
  </details>`).join('');
  $('#mainQuestPanel').innerHTML = `<h2>${L('Alışkanlıklar', 'Habits')} · ${s.habits.length}/${MAX_HABITS}</h2>
    <p class="muted">${L(`Her alışkanlığın kendi zinciri ve hedefi var. Alışkanlığı <b>hedef gün kadar başarıyla</b> edinirsin (art arda olması gerekmez): 150 oren, 100 TP ve bir Efsanevi kart. Sonra ustalıkla sürdürür ya da listeden çıkarıp yerine yenisini eklersin. ${MULTI_CHAIN_TXT()} Alışkanlıklar karakterden bağımsızdır; yeniden doğsan da sürer.`,
      `Each habit has its own chain and goal. You form a habit after <b>as many successful days as its goal</b> (not necessarily in a row): 150 crowns, 100 XP and a Legendary card. Then keep it in mastery or remove it and add a new one. ${MULTI_CHAIN_TXT()} Habits don't belong to the character; they carry on even if you're reborn.`)}</p>
    ${cards}
    ${s.habits.length < MAX_HABITS ? `<details class="box" open><summary><b>＋ ${L('Yeni alışkanlık', 'New habit')}</b></summary><div class="habit-new">${questForm({ type: 'check', days: 30, lateMin: 60 }, 'new')}
      <div class="row" style="margin-top:10px"><button class="btn" data-act="questnew">${L('Alışkanlığı başlat', 'Start the habit')}</button></div></div></details>`
      : `<p class="muted">${L(`En fazla ${MAX_HABITS} alışkanlık. Yenisi için birini listeden çıkar.`, `At most ${MAX_HABITS} habits. Remove one to add another.`)}</p>`}
    <h3>${L('Geçmiş', 'History')}</h3>
    ${hist.length ? `<table><tr><th>${L('Alışkanlık', 'Habit')}</th><th>${L('Tarih', 'Dates')}</th><th>${L('Karakter', 'Character')}</th><th>${L('Sonuç', 'Result')}</th></tr>${hist.map(h => `<tr><td>${esc(h.name)}</td>
      <td>${h.start ? longDate(h.start) : '—'} → ${h.end ? longDate(h.end) : '—'}</td><td>${esc(h.char || '—')}</td><td>${h.result === 'completed' ? L(`🏆 Edinildi (${h.days} gün)`, `🏆 Formed (${h.days} days)`) : L(`Bırakıldı (${h.successes}/${h.days})`, `Abandoned (${h.successes}/${h.days})`)}</td></tr>`).join('')}</table>`
      : `<p class="muted">${L('Henüz edinilen ya da bırakılan alışkanlık yok.', 'No formed or abandoned habits yet.')}</p>`}`;
}
function showQuestDone() {
  const q = st().habits.find(h => h.awaitingChoice); if (!q) return;
  openModal(`<h2>🏆 ${L(`"${esc(q.name)}" edinildi!`, `"${esc(q.name)}" formed!`)}</h2>
    <p>${L(`${q.days} başarılı gün. Bu alışkanlık artık senin. Şimdi ne yapmak istersin?`, `${q.days} successful days. This habit is yours now. What do you want to do next?`)}</p>
    <div class="grid2">
      <div class="box"><h3>${L('Ustalık yolu', 'Path of mastery')}</h3><p class="muted">${L(`Aynı alışkanlıkla ve zincirle devam et. Günlük ödüller ×${MASTERY_MULT}, hasar ×${MASTERY_DMG}.`, `Keep the same habit and chain. Daily rewards ×${MASTERY_MULT}, damage ×${MASTERY_DMG}.`)}</p><button class="btn" data-act="mastery" data-h="${q.id}">${L('Ustalıkla devam et', 'Continue in mastery')}</button></div>
      <div class="box"><h3>${L('Yeni alışkanlık', 'New habit')}</h3><p class="muted">${L('Alışkanlıklar sekmesinde bunu listeden çıkarıp (istersen yan göreve dönüştürüp) yerine yenisini ekleyebilirsin.', 'In the Habits tab you can remove this one (optionally turning it into a side quest) and add a new one.')}</p><button class="btn" data-act="gonewquest" data-h="${q.id}">${L('Alışkanlıklara git', 'Go to habits')}</button></div>
    </div>`);
}

/* ---------- yan görevler ---------- */
function renderQuests() {
  const t = E.logicalToday(), done = st().questLog[t] || [];
  $('#questPanel').innerHTML = `<h2>${L('Yan görevler', 'Side quests')} · ${longDate(t)}</h2>
    <p class="muted">${L(`Günlük küçük işler: her biri TP ve oren verir ve aktif kontratındaki canavara ${DMG.side} hasar vurur. Yapmamanın cezası yok.`, `Small daily tasks: each gives XP and crowns and deals ${DMG.side} damage to your contract's monster. No penalty for skipping them.`)}</p>
    ${st().quests.map(q => `<div class="quest ${done.includes(q.id) ? 'done' : ''}">
      <div><b>${esc(q.name)}</b> <small>+${q.xp} ${L('TP', 'XP')} · +${q.gold} 🪙</small></div>
      <div class="row">${done.includes(q.id) ? '✓' : `<button class="btn" data-act="side" data-id="${q.id}">${L('Tamamla', 'Complete')}</button>`}
        <button class="btn ghost" data-act="delside" data-id="${q.id}" title="${L('Sil', 'Delete')}">✕</button></div></div>`).join('')}
    <h3>${L('Yeni yan görev', 'New side quest')}</h3>
    <div class="row"><input id="qName" placeholder="${L('ör. 20 sayfa kitap', 'e.g. read 20 pages')}" style="flex:1;min-width:200px">
      <input id="qXp" type="number" value="5" min="1" max="50" style="width:80px" title="${L('TP', 'XP')}">
      <input id="qGold" type="number" value="3" min="0" max="50" style="width:80px" title="${L('Oren', 'Crowns')}">
      <button class="btn" data-act="addside">${L('Ekle', 'Add')}</button></div>`;
}

/* ---------- koleksiyon ---------- */
let colFilter = { owned: 'owned', rar: '', fac: '', q: '', page: 0 };
const poolFactions = () => {
  const own = new Set(Object.keys(st().collection).map(a => CARD_BY_ART[a]?.f).filter(Boolean));
  const base = st().faction ? [st().faction, 'Neutral'] : [...FACTIONS, 'Neutral'];
  return [...base, ...[...own].filter(f => !base.includes(f))];
};
function renderCollection() {
  const col = st().collection, owned = Object.keys(col).length;
  const pool = CARDS.filter(c => E.inPool(c) || col[c.a]);   // odak dışı kupa kartları da görünür
  const list = pool.filter(c =>
    (colFilter.owned === 'all' || col[c.a]) && (!colFilter.rar || c.r === colFilter.rar) &&
    (!colFilter.fac || c.f === colFilter.fac) && (!colFilter.q || c.n.toLowerCase().includes(colFilter.q.toLowerCase())));
  list.sort((a, b) => RAR.indexOf(b.r) - RAR.indexOf(a.r) || a.n.localeCompare(b.n));
  const per = 48, pages = Math.max(1, Math.ceil(list.length / per));
  colFilter.page = Math.min(colFilter.page, pages - 1);
  const slice = list.slice(colFilter.page * per, colFilter.page * per + per);
  const byR = RAR.map(r => `<span class="rar-${r}">${RAR_TR[r]}: ${pool.filter(c => c.r === r && col[c.a]).length}/${pool.filter(c => c.r === r).length}</span>`).join(' · ');
  $('#collectionPanel').innerHTML = `<h2>${L('Koleksiyon', 'Collection')} · ${owned} / ${pool.length}</h2>
    <p class="muted">${L(`Bu karakter <b>${facName(st().faction)}</b>${st().faction ? ' ve tarafsız' : ''} kartları topluyor.`, `This character collects <b>${facName(st().faction)}</b>${st().faction ? ' and Neutral' : ''} cards.`)} ${byR}<br>${L('Tekrar gelen kartlar kırıntıya dönüşür; kırıntıyla "Tümü" görünümünden istediğin kartı üretebilirsin.', 'Duplicate cards turn into scraps; use scraps to craft any card from the "All" view.')}</p>
    <div class="filters">
      <select data-f="owned"><option value="owned">${L('Sahip olduklarım', 'Owned')}</option><option value="all">${L('Tümü', 'All')}</option></select>
      <select data-f="rar"><option value="">${L('Tüm nadirlikler', 'All rarities')}</option>${RAR.map(r => `<option value="${r}">${RAR_TR[r]}</option>`).join('')}</select>
      <select data-f="fac"><option value="">${L('Tüm fraksiyonlar', 'All factions')}</option>${poolFactions().map(f => `<option value="${f}">${facName(f)}</option>`).join('')}</select>
      <input data-f="q" placeholder="${L('Ara...', 'Search...')}" value="${esc(colFilter.q)}">
    </div>
    ${slice.length ? `<div class="cards">${slice.map(c => cardHtml(c, { locked: !col[c.a], count: col[c.a] })).join('')}</div>` : `<p class="muted">${L('Burada henüz kart yok.', 'No cards here yet.')}</p>`}
    <div class="pager">${pages > 1 ? `<button class="btn" data-act="page" data-v="-1" ${colFilter.page === 0 ? 'disabled' : ''}>‹</button>
      <span>${colFilter.page + 1} / ${pages}</span><button class="btn" data-act="page" data-v="1" ${colFilter.page >= pages - 1 ? 'disabled' : ''}>›</button>` : ''}</div>`;
  for (const k of ['owned', 'rar', 'fac']) $(`#collectionPanel [data-f="${k}"]`).value = colFilter[k];
}
function showCardDetail(a) {
  const c = CARD_BY_ART[a]; if (!c) return;
  const cnt = st().collection[a] || 0;
  openModal(`<div class="card-detail">${cardHtml(c, { q: 'medium', locked: !cnt, noAct: true })}
    <div style="flex:1;min-width:240px">
      <h2>${esc(c.n)}</h2>
      <p><span class="rar-${c.r}">${RAR_TR[c.r]}</span> · ${esc(facName(c.f))} · ${esc(c.c || c.t)}</p>
      ${c.fl ? `<p class="flavor">${esc(c.fl)}</p>` : ''}
      <p>${cnt ? `${L('Koleksiyonda', 'In collection')}: <b>${cnt}</b>` : L('Henüz sende yok.', "You don't have it yet.")}</p>
      <div class="row">
        ${cnt ? `<button class="btn" data-act="avatar" data-a="${a}">${L('Madalyon resmi yap', 'Use as medallion')}</button>` :
          E.inPool(c) ? `<button class="btn" data-act="craft" data-a="${a}" ${st().scraps < CRAFT[c.r] ? 'disabled' : ''}>${L('Üret', 'Craft')} (${CRAFT[c.r]} ✦)</button>` : ''}
        <button class="btn ghost" data-act="close">${L('Kapat', 'Close')}</button>
      </div>
    </div></div>`);
}

/* ---------- kart bağları ---------- */
let linkFaction = '';
function renderLinks() {
  const s = st(), done = E.completeLinks().length, facs = poolFactions();
  if (!facs.includes(linkFaction)) linkFaction = facs[0];
  const opts = Object.entries(E.linkOptions(linkFaction)).sort((x, y) => y[1] - x[1]);
  const links = s.links.slice().sort((x, y) => (y.cards.length >= LINK_SIZE) - (x.cards.length >= LINK_SIZE) || x.f.localeCompare(y.f));
  const lsum = E.countedLinks().reduce((t, x) => t + x.v.total, 0), fav = SCHOOL_CATS[s.school] || [];
  $('#linksPanel').innerHTML = `<h2>${L('Kart Bağları', 'Card Links')} · ${L(`${done} tamamlandı · ${s.links.length}/${LINK_MAX} bağ · toplam +%${+lsum.toFixed(1)} hasar`, `${done} complete · ${s.links.length}/${LINK_MAX} links · total +${+lsum.toFixed(1)}% damage`)}</h2>
    <p class="muted">${L(`Aynı fraksiyondan, en az bir türü ortak olan ${LINK_SIZE} kartı birbirine bağla (ör. Scoia'tael · Elf). Bağın değeri kartların nadirliğinden gelir: Sıradan %${LINK_RAR.Common}, Nadir %${LINK_RAR.Rare}, Destansı %${LINK_RAR.Epic}, Efsanevi %${LINK_RAR.Legendary}. Beş kartın da paylaştığı her <b>ek tür</b> (ör. Human bağında hepsi Soldier da ise) +%${LINK_EXTRA}. Bağın türü okulunun sevdiği türlerdense (<b>${fav.join(', ')}</b>) bağ ×${LINK_SCHOOL}. En fazla ${LINK_MAX} bağ kurabilirsin; bir kart tek bir bağda olabilir. En iyi kombinasyonu bulmaya çalış.`,
      `Link ${LINK_SIZE} cards of the same faction that share at least one category (e.g. Scoia'tael · Elf). A link's value comes from card rarity: Common ${LINK_RAR.Common}%, Rare ${LINK_RAR.Rare}%, Epic ${LINK_RAR.Epic}%, Legendary ${LINK_RAR.Legendary}%. Every <b>extra category</b> all five cards share (e.g. a Human link where all are also Soldiers) adds +${LINK_EXTRA}%. If the link's category is one your school favours (<b>${fav.join(', ')}</b>), the link counts ×${LINK_SCHOOL}. You can have at most ${LINK_MAX} links; a card can be in only one link. Find the best combination.`)}</p>
    <div class="box"><h3 style="margin-top:0">${L('Yeni bağ', 'New link')}</h3><div class="row">
      <select id="linkFac">${facs.map(f => `<option value="${f}" ${f === linkFaction ? 'selected' : ''}>${facName(f)}</option>`).join('')}</select>
      <select id="linkCat">${opts.length ? opts.map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${L(`${n} kartın var`, `you have ${n}`)})</option>`).join('') : `<option value="">${L('Bu fraksiyonda bağlanabilir kartın yok', 'No linkable cards in this faction')}</option>`}</select>
      <button class="btn" data-act="newlink" ${opts.length && s.links.length < LINK_MAX ? '' : 'disabled'}>${L('Bağ oluştur', 'Create link')}</button></div></div>
    ${links.length ? links.map(l => {
      const full = l.cards.length >= LINK_SIZE;
      const favCat = fav.includes(l.cat);
      const cardsIn = l.cards.map(a => CARD_BY_ART[a]).filter(Boolean);
      const sharedNow = cardsIn.length ? cardCats(cardsIn[0]).filter(x => x !== l.cat && cardsIn.every(c => cardCats(c).includes(x))) : [];
      const rarSum = cardsIn.reduce((t, c) => t + LINK_RAR[c.r], 0);
      const byRar = RAR.map(r => [r, cardsIn.filter(c => c.r === r).length]).filter(x => x[1]).map(([r, n]) => `${n}× ${RAR_TR[r]} (+${pct(n * LINK_RAR[r])})`).join(', ');
      const sumLine = `<p class="muted link-sum">${cardsIn.length ? `${L('Kartlar', 'Cards')}: ${byRar} = +${pct(rarSum)}` : L('Henüz kart yok.', 'No cards yet.')}${sharedNow.length ? ` · ${L('ek ortak tür', 'extra shared category')}: ${esc(sharedNow.join(', '))} (+${pct(sharedNow.length * LINK_EXTRA)}${full ? '' : L(', son karta kadar korunursa', ', if kept to the last card')})` : ''}${favCat ? ` · ${L('okul uyumu', 'school affinity')} ×${LINK_SCHOOL}` : ''}${full ? '' : ` · ${L('şu an', 'so far')} ≈ +${pct((rarSum + sharedNow.length * LINK_EXTRA) * (favCat ? LINK_SCHOOL : 1))} ${L(`(${LINK_SIZE} kart olunca sayılır)`, `(counts at ${LINK_SIZE} cards)`)}`}</p>`;
      const slots = Array.from({ length: LINK_SIZE }, (_, i) => {
        const a = l.cards[i];
        if (a) { const c = CARD_BY_ART[a], cv = LINK_RAR[c.r] * (favCat ? LINK_SCHOOL : 1);
          return `<div class="link-slot filled" data-act="unlink" data-link="${l.id}" data-a="${a}" title="${esc(c.n)} — ${RAR_TR[c.r]}: +${pct(LINK_RAR[c.r])}${favCat ? ` ×${LINK_SCHOOL}` : ''}\n${L('Türler', 'Categories')}: ${esc(cardCats(c).join(', '))}\n${L('çıkarmak için tıkla', 'click to remove')}">${cardHtml(c, { noAct: true, cats: l.cat })}<span class="lc">+${pct(cv)}</span></div>`; }
        return `<div class="link-slot" data-act="linkpick" data-link="${l.id}" title="${L('Kart ekle', 'Add card')}">＋</div>`;
      }).join('');
      const v = E.linkValue(l);
      const tip = v ? L(`Nadirlik: +%${v.rar}${v.shared.length ? `\nEk ortak tür (${v.shared.join(', ')}): +%${v.extra}` : '\nEk ortak tür yok'}${v.fav ? `\nOkul uyumu: ×${LINK_SCHOOL}` : ''}\nToplam: +%${v.total}`,
        `Rarity: +${v.rar}%${v.shared.length ? `\nExtra shared category (${v.shared.join(', ')}): +${v.extra}%` : '\nNo extra shared category'}${v.fav ? `\nSchool affinity: ×${LINK_SCHOOL}` : ''}\nTotal: +${v.total}%`) : '';
      return `<div class="link-row ${full ? 'full' : ''}"><div class="link-head"><b>${esc(facName(l.f))} · ${esc(l.cat)}</b>${favCat ? ` <span class="badge gold" title="${L('Okulunun sevdiği tür', 'Your school favours this category')}">🏫 ×${LINK_SCHOOL}</span>` : ''} <small>${l.cards.length}/${LINK_SIZE}${v ? ` · <span class="mult" title="${esc(tip)}">${L(`+%${v.total} hasar`, `+${v.total}% damage`)}${v.shared.length ? ` (+${esc(v.shared.join(', '))})` : ''}</span>` : ''}</small>
        <button class="btn sm ghost" data-act="dellink" data-link="${l.id}" title="${L('Bağı sil', 'Delete link')}">✕</button></div><div class="link-slots">${slots}</div>${sumLine}</div>`;
    }).join('') : `<p class="muted">${L('Henüz bağ yok.', 'No links yet.')}</p>`}`;
}
const pct = n => L(`%${+n.toFixed(2)}`, `${+n.toFixed(2)}%`);
function showLinkPicker(linkId) {
  const l = st().links.find(x => x.id === linkId); if (!l) return;
  const list = E.eligibleForLink(linkId, { includeUsed: true });
  const fav = (SCHOOL_CATS[st().school] || []).includes(l.cat), cur = l.cards.map(a => CARD_BY_ART[a]).filter(Boolean);
  const shared = cur.length ? cardCats(cur[0]).filter(x => x !== l.cat && cur.every(c => cardCats(c).includes(x))) : null;
  const pick = c => {
    const from = E.linkOfCard(c.a), keep = shared ? shared.filter(x => cardCats(c).includes(x)) : [];
    const kept = shared && shared.length ? keep.length === shared.length : null;
    const tip = from ? L(`${from.f} · ${from.cat} bağında. Seçersen oradan çıkarılıp bu bağa taşınır.`, `In the ${from.f} · ${from.cat} link. Picking it moves it here.`) : '';
    return `<div class="pick ${from ? 'linked' : ''} ${kept === true ? 'keep' : kept === false ? 'breaks' : ''}" data-act="linkadd" data-link="${l.id}" data-a="${c.a}" ${tip ? `title="${esc(tip)}"` : ''}>
      ${cardHtml(c, { noAct: true, cats: l.cat })}
      ${from ? `<span class="lock">⛓ ${esc(from.cat)}${from.cards.length >= LINK_SIZE ? ' ✓' : ''}</span>` : ''}
      <span class="pick-info"><span>+${pct(LINK_RAR[c.r] * (fav ? LINK_SCHOOL : 1))}</span>${kept === true ? `<span class="good" title="${L('Ek ortak türleri korur', 'Keeps the extra shared categories')}">✓ ${esc(shared.join(', '))}</span>` : kept === false ? `<span class="bad" title="${L('Ek ortak türü bozar', 'Breaks the extra shared category')}">✗ ${esc(shared.filter(x => !keep.includes(x)).join(', '))}</span>` : ''}</span></div>`;
  };
  const byVal = (a, b) => LINK_RAR[b.r] - LINK_RAR[a.r] || a.n.localeCompare(b.n);
  const free = list.filter(c => !E.linkOfCard(c.a)).sort(byVal), linked = list.filter(c => E.linkOfCard(c.a)).sort(byVal);
  openModal(`<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">${esc(facName(l.f))} · ${esc(l.cat)} <small class="muted">${l.cards.length}/${LINK_SIZE}</small></h2>
      <button class="btn ghost" data-act="close">${L('Kapat', 'Close')}</button></div>
    <p class="muted">${L(`Kartın altında bağa katkısı yazar${fav ? ` (okul uyumu ×${LINK_SCHOOL} dahil)` : ''}; üzerine gelince bütün türleri görünür.`, `Below each card is what it adds to the link${fav ? ` (school affinity ×${LINK_SCHOOL} included)` : ''}; hover to see all its categories.`)}
      ${shared && shared.length ? L(` Bu bağın şu anki ek ortak türleri: <b>${esc(shared.join(', '))}</b> (+${pct(shared.length * LINK_EXTRA)}). Yeşil kartlar bunu korur.`, ` This link's extra shared categories so far: <b>${esc(shared.join(', '))}</b> (+${pct(shared.length * LINK_EXTRA)}). Green cards keep them.`) : ''}</p>
    ${free.length ? `<div class="picker-sec">${L('Boştaki kartlar', 'Free cards')} · ${free.length}</div><div class="pick-grid">${free.map(pick).join('')}</div>` : ''}
    ${linked.length ? `<div class="picker-sec">⛓ ${L('Başka bağdaki kartlar', 'Cards in other links')} · ${linked.length} <small class="muted">${L('seçersen bulunduğu bağdan çıkar', 'picking one moves it out of its link')}</small></div><div class="pick-grid">${linked.map(pick).join('')}</div>` : ''}
    ${list.length ? '' : `<p class="muted">${L('Bu bağa uyan kartın yok.', 'You have no cards that fit this link.')}</p>`}`, 'wide');
}

/* ---------- bestiary (bölgelere göre) ---------- */
function lifetimeKills() {
  const counts = {};
  [...st().hall.flatMap(h => h.trophies), ...st().trophies].forEach(t => { counts[t.id] = (counts[t.id] || 0) + 1; });
  return counts;
}
function renderBestiary() {
  const mine = new Set(st().trophies.map(t => t.id)), all = lifetimeKills();
  $('#bestiaryPanel').innerHTML = `<h2>Bestiary · ${L(`bu karakter ${mine.size} / ${MONSTERS.length} · tüm karakterler ${Object.keys(all).length}`, `this character ${mine.size} / ${MONSTERS.length} · all characters ${Object.keys(all).length}`)}</h2>
    <p class="muted">${L("Her bölgenin kendi canavarları ve bir boss'u var. Bir canavarı bu karakterle bir kez öldürebilirsin (efsane olunca elit olarak geri döner). Sağdaki sayı tüm karakterlerin toplamı.", 'Each region has its own monsters and a boss. A character kills each monster once (they return as elites after you become a legend). The number on the right is the total across all characters.')}</p>
    ${REGIONS.map((r, i) => {
      const list = MONSTERS.filter(m => m.region === i).sort((a, b) => (a.boss ? 1 : 0) - (b.boss ? 1 : 0) || a.str - b.str);
      const locked = r.tier > st().region;
      return `<h3>${esc(r.name)} <small class="muted">· ${esc(r.game || '')} · ${L('seviye', 'levels')} ${r.min}–${r.max} · ${list.filter(m => mine.has(m.id)).length}/${list.length}${locked ? L(' · kilitli', ' · locked') : r.tier === st().region ? L(' · şu anki kademe', ' · current tier') : ''}</small></h3>
      <div class="trophies">${list.map(m => {
        const ms = monStats(m), seen = all[m.id];
        return `<div class="trophy ${mine.has(m.id) ? '' : 'unseen'} ${m.boss ? 'boss' : ''}" title="${seen ? esc(m.lore) : L('Henüz avlanmadı', 'Not hunted yet')}">
          <div class="monster-art">${imgTag(monImg(m))}</div>
          <div class="cinzel">${seen ? esc(m.name) : '???'} ${m.boss ? '👑' : ''}</div>
          <small>${mine.has(m.id) ? L('☠ bu karakter', '☠ this character') : (CLASSES[m.cls]?.tr || '')} · 🪙${ms.gold}${seen ? ` · ×${seen}` : ''}</small></div>`;
      }).join('')}</div>`;
    }).join('')}`;
}

/* ---------- tüccar + demirci ---------- */
function renderShop() {
  const s = st(), lvNow = s.level;
  const typeName = w => (w.type === 'silver' ? L('Gümüş', 'Silver') : L('Çelik', 'Steel'));
  /* kılıcın gücü: sahip olunan kılıçta kendi seviyesinde, satılıkta senin seviyende */
  const bonusTxt = (w, lv) => {
    if (w.type === 'silver') {
      const d = E.swordDmg(w, lv);
      return `<span title="${L(`Saatlik vuruşa eklenir (seviye gücünün üstüne). Gücü kılıcın seviyesine ve kademesine bağlı${w.school ? '; kendi okulunun seti +%15' : ''}.`, `Added to every hourly hit (on top of your level power). Depends on the sword's level and rarity${w.school ? "; your own school's set +15%" : ''}.`)}">${L(`Hasar +${d}/sa`, `Damage +${d}/h`)}</span>`;
    }
    return `<span title="${L(`Her saatlik vuruşun kritik (×${CRIT_MULT}) olma şansı. Kılıcın seviyesine ve kademesine bağlı${w.school ? '; kendi okulunun seti +%3' : ''}.`, `Chance that an hourly hit is critical (×${CRIT_MULT}). Depends on the sword's level and rarity${w.school ? "; your own school's set +3%" : ''}.`)}">${L(`Kritik %${E.swordValue(w, lv)}`, `Crit ${E.swordValue(w, lv)}%`)}</span>`;
  };
  const curCls = s.contract ? monById(s.contract.id).cls : null;   // aktif kontratın türü vurgulanır
  const baneTxt = w => { const list = (w.banes || [w.bane]).map(c => c === curCls ? `<b>${esc(CLASSES[c]?.tr || c)}</b>` : esc(CLASSES[c]?.tr || c)).join(' · ');
    return `<span title="${L('Bu türlerdeki canavarlara ek hasar. Kalın olan, aktif kontratının türü.', 'Extra damage against monsters of these types. Bold is your active contract\'s type.')}">${L(`Avcı +%${w.banePct ?? BANE}: ${list}`, `Bane +${w.banePct ?? BANE}%: ${list}`)}</span>`; };
  const uniqTxt = w => { const u = w.unique && DATA.UNIQUE_BY_ID[w.unique]; return u ? `<small class="unique ${w.tier === 6 ? 'aero' : ''}">✦ <b>${esc(u.name)}</b>: ${esc(u.desc)}</small>` : ''; };
  const tag = w => (w.tier === 6 ? `<span class="rare-tag r2">${L('✦ Çok nadir', '✦ Very rare')}</span>` : w.tier === 4 ? `<span class="rare-tag r1">${L('✦ Efsanevi', '✦ Legendary')}</span>` : '');
  const glow = w => (w.tier === 6 ? 'rare r2' : w.tier === 4 ? 'rare r1' : '');
  const swordCard = (w, mode) => {
    const eq = s.swords[w.type] === w.id, lv = mode === 'own' ? E.swordLv(w.id) : lvNow;
    let foot;
    if (mode === 'own') {
      const c = E.upgradeCost(w.id), dv = E.dismantleValue(w.id);
      const next = c ? (w.type === 'silver' ? L(`hasar +${E.swordDmg(w, c.to)}/sa`, `damage +${E.swordDmg(w, c.to)}/h`) : L(`kritik %${E.swordValue(w, c.to)}`, `crit ${E.swordValue(w, c.to)}%`)) : '';
      const up = c ? `<button class="btn sm" data-act="upgrade" data-id="${w.id}" ${s.gold < c.gold || s.scraps < c.scraps ? 'disabled' : ''} title="${L(`Seviye ${c.to}: ${next}`, `Level ${c.to}: ${next}`)}">⬆ ${L('Sv', 'Lv')} ${c.to} · ${c.gold}🪙 ${c.scraps}✦</button>`
        : `<span class="badge" title="${L('Kılıcın seviyesi senin seviyeni geçemez. Seviye atlayınca yükseltebilirsin.', "A sword can't go above your level. Level up to upgrade it.")}">${L('Seviyende', 'At your level')}</span>`;
      const more = eq ? '' : `<button class="btn sm ghost" data-act="dismantle" data-id="${w.id}" title="${L(`Erit: ${dv.gold} oren, ${dv.scraps} kırıntı geri gelir`, `Dismantle: get back ${dv.gold} crowns, ${dv.scraps} scraps`)}">🔥 ${L('Erit', 'Dismantle')}</button>`;
      foot = (eq ? `<span class="badge gold">${L('Kuşanıldı', 'Equipped')}</span>` : `<button class="btn sm" data-act="equip" data-id="${w.id}">${L('Kuşan', 'Equip')}</button>`) + up + more;
    } else {
      const price = E.shopPrice(w);
      foot = `<span class="price">${price} 🪙</span><button class="btn sm" data-act="buysword" data-id="${w.id}" ${s.gold < price ? 'disabled' : ''}>${L('Satın al', 'Buy')}</button>`;
    }
    return `<div class="sword t${w.tier} ${eq && mode === 'own' ? 'equipped' : ''} ${glow(w)}"><div class="sword-img">${swordImg(w)}</div>
      <div class="sword-body">${tag(w)}<b>${esc(w.name)} <span class="up">${L('Sv', 'Lv')} ${lv}</span></b>
        <small class="tier-name t${w.tier}">${SWORD_TIERS[w.tier].name} · ${typeName(w)}${w.school ? ' · ' + SCHOOLS[w.school]?.name : ''}</small>
        <small>${bonusTxt(w, lv)}</small>
        ${w.bane ? `<small class="bane">⚔ ${baneTxt(w)}</small>` : ''}${uniqTxt(w)}
        <div class="row" style="justify-content:space-between;margin-top:6px;flex-wrap:wrap;gap:4px">${foot}</div></div></div>`;
  };
  const owned = s.swords.owned.map(swordById).filter(Boolean).sort((a, b) => a.type.localeCompare(b.type) || E.swordValue(b) - E.swordValue(a));
  const diagrams = (s.diagrams || []).map(swordById).filter(Boolean);
  const diagramCard = w => { const c = E.craftCost(w.id);
    return `<div class="sword t${w.tier}"><div class="sword-img">${swordImg(w)}</div><div class="sword-body"><b>📜 ${esc(w.name)} <span class="up">${L('Sv', 'Lv')} ${lvNow}</span></b>
      <small class="tier-name t${w.tier}">${L('Okul seti', 'School set')} · ${typeName(w)} · ${SCHOOLS[w.school]?.name || w.school}</small>
      <small>${bonusTxt(w, lvNow)}</small>${w.bane ? `<small class="bane">⚔ ${baneTxt(w)}</small>` : ''}
      <div class="row" style="justify-content:space-between;margin-top:6px"><span class="price">${c.gold} 🪙 ${c.scraps} ✦</span>
        <button class="btn sm" data-act="craftsword" data-id="${w.id}" ${s.gold < c.gold || s.scraps < c.scraps ? 'disabled' : ''}>${L('Yaptır', 'Craft')}</button></div></div></div>`; };
  const odds = rarityOdds(lvNow);
  const tomorrow = new Date(now()); tomorrow.setHours(24, 0, 0, 0);
  $('#shopPanel').innerHTML = `<h2>${L('Tüccar', 'Merchant')}</h2>
    <div class="shop-grid">${E.shopItems().map(i => `<div class="shop-item"><h3>${i.name}</h3><div class="muted">${i.desc}</div>
      <div class="row" style="justify-content:space-between;margin-top:auto"><span class="price">${i.price} 🪙</span>
      <button class="btn" data-act="buy" data-id="${i.id}" ${i.disabled || s.gold < i.price ? 'disabled' : ''}>${L('Satın al', 'Buy')}</button></div></div>`).join('')}</div>
    <div class="row" style="justify-content:space-between;margin-top:26px"><h2 style="margin:0">${L('Demirci', 'Blacksmith')} <small class="muted">· ${L(`bugünün kılıçları, ${fmtDur(tomorrow - now())} sonra kendiliğinden yenilenir`, `today's swords, restocks by itself in ${fmtDur(tomorrow - now())}`)}</small></h2>
      <button class="btn" data-act="rerollshop" ${s.gold < E.shopRerollCost() ? 'disabled' : ''}>🔁 ${L('Stoğu yenile', 'Restock')} · ${E.shopRerollCost()} 🪙</button></div>
    <p class="muted">${L(`Demirci her gün ${SHOP_DAILY} gümüş ve ${SHOP_DAILY} çelik kılıç getirir; hepsi <b>senin seviyende</b> (${lvNow}) gelir. <b>Gümüş</b> saatlik vuruşuna hasar ekler, <b>çelik</b> kritik vuruş şansı verir (×${CRIT_MULT}). Kılıcın gücü seviyesine ve kademesine bağlı; seviye şartı yok. Elindeki kılıcın seviyesini oren ve kırıntıyla yükseltebilirsin (en fazla kendi seviyene kadar). Kırıntı tekrar gelen kartlardan ve kazandığın her dövüşten (+${SCRAP_PER_KILL}) gelir. Her kılıç canavar türlerine karşı avcıdır: Sıradan 1, Usta işi 2, Büyülü 3 türe +%15; Efsanevi 3 türe +%25 (okul seti 4 türe +%20, Kadim 5 türe +%25). Okul setleri satılmaz: Lyria ve Vizima'dan itibaren bölge boss'ları şemalarını düşürür, demircide senin seviyende yaptırırsın; kendi okulunun seti ekstra bonus verir. Aerondight ${AERONDIGHT.minLevel}. seviyeden sonra çok nadiren çıkar.`,
      `Every day the blacksmith brings ${SHOP_DAILY} silver and ${SHOP_DAILY} steel swords, all at <b>your level</b> (${lvNow}). <b>Silver</b> adds damage to your hourly hit, <b>steel</b> gives a critical hit chance (×${CRIT_MULT}). A sword's power depends on its level and rarity; there are no level requirements. Raise the level of a sword you own with crowns and scraps (up to your own level). Scraps come from duplicate cards and from every fight you win (+${SCRAP_PER_KILL}). Every sword is a bane to monster types: Common 1, Masterwork 2, Magic 3 types at +15%; Legendary 3 types at +25% (school set 4 at +20%, Ancient 5 at +25%). School sets aren't sold: from Lyria and Vizima on, region bosses drop their diagrams and the blacksmith crafts them at your level; your own school's set gives an extra bonus. Aerondight shows up very rarely after level ${AERONDIGHT.minLevel}.`)}</p>
    <p class="odds" title="${L('Demircideki her kılıcın kademesi bu olasılıklarla belirlenir; seviyen arttıkça iyi kademeler artar.', "Each sword's rarity at the blacksmith is rolled with these odds; better rarities grow with your level.")}">🎲 ${L(`Seviye ${lvNow} olasılıkları`, `Odds at level ${lvNow}`)}: ${[1, 2, 3, 4].map(t => `<span class="tier-name t${t}">${SWORD_TIERS[t].name} ${L(`%${odds[t]}`, `${odds[t]}%`)}</span>`).join(' · ')}</p>
    <h3>${L('Gümüş', 'Silver')}</h3><div class="sword-grid">${E.dailySwords('silver').map(w => swordCard(w, 'buy')).join('') || `<p class="muted">${L('Satılık gümüş kılıç kalmadı.', 'No silver swords left for sale.')}</p>`}</div>
    <h3>${L('Çelik', 'Steel')}</h3><div class="sword-grid">${E.dailySwords('steel').map(w => swordCard(w, 'buy')).join('') || `<p class="muted">${L('Satılık çelik kılıç kalmadı.', 'No steel swords left for sale.')}</p>`}</div>
    ${diagrams.length ? `<h2 style="margin-top:26px">${L('Şemalar', 'Diagrams')} · ${diagrams.length}</h2><div class="sword-grid">${diagrams.map(diagramCard).join('')}</div>` : ''}
    <h2 style="margin-top:26px">${L('Kılıçların', 'Your swords')} · ${owned.length} / ${SWORDS.length}</h2>
    <p class="muted">${L(`Kılıcın seviyesini yükseltmenin bedeli, yeni seviyedeki fiyatının %${SWORD_UP.goldShare * 100}'i kadar oren ve biraz kırıntıdır. Kuşanmadığın kılıcı eritirsen fiyatının %${DISMANTLE.gold * 100}'i ve seviyesinin yarısı kadar kırıntı geri gelir.`,
      `Raising a sword's level costs ${SWORD_UP.goldShare * 100}% of its price at the new level in crowns, plus some scraps. Dismantling an unequipped sword returns ${DISMANTLE.gold * 100}% of its price and scraps equal to half its level.`)}</p>
    ${owned.length ? `<div class="sword-grid">${owned.map(w => swordCard(w, 'own')).join('')}</div>` : `<p class="muted">${L('Henüz kılıcın yok.', 'You have no swords yet.')}</p>`}`;
}

/* ---------- Okul: karakter salonu + yeniden doğuş ---------- */
function charSummary(c, current) {
  const kills = c.trophies.length, bosses = c.trophies.filter(t => monById(t.id)?.boss).length;
  const links = c.links.filter(l => l.cards.length >= LINK_SIZE).length;
  const legends = Object.keys(c.collection).filter(a => CARD_BY_ART[a]?.r === 'Legendary').length;
  return `<div class="char ${current ? 'current' : ''} ${c.legend ? 'legend' : ''}" ${current ? '' : `data-act="hallview" data-id="${c.id}"`}>
    <div class="char-medal" style="background-image:url(${avatarSrc(c)});${avatarTop(c) ? 'background-position:center top' : ''}"></div>
    <div class="char-body">
      <b>${esc(c.name)}</b> ${c.legend ? `<span class="badge gold">${L('Efsane', 'Legend')}</span>` : ''} ${current ? `<span class="badge">${L('Şu anki', 'Current')}</span>` : ''}
      <small class="muted">${SCHOOLS[c.school]?.name} · ${facName(c.faction)} · ${L('Seviye', 'Level')} ${c.level}${c.fame ? ` ★${c.fame}` : ''} · ${esc(bandLabel(c.region || 0))}</small>
      <small>${L(`☠ ${kills} canavar (${bosses} boss) · 🃏 ${Object.keys(c.collection).length} kart (${legends} efsanevi) · 🔗 ${links} bağ · ⚔ ${(c.swords || []).length} kılıç · 🪙 ${c.stats?.goldEarned || 0} kazanıldı`, `☠ ${kills} monsters (${bosses} bosses) · 🃏 ${Object.keys(c.collection).length} cards (${legends} legendary) · 🔗 ${links} links · ⚔ ${(c.swords || []).length} swords · 🪙 ${c.stats?.goldEarned || 0} earned`)}</small>
      <small class="muted">${longDate(dk(new Date(c.start || c.charStart)))}${c.end ? ' → ' + longDate(dk(new Date(c.end))) : L(' → bugün', ' → today')}</small>
    </div></div>`;
}
function renderHall() {
  const s = st();
  const cur = { ...E.snapshot(), swords: s.swords.owned, end: null };
  $('#hallPanel').innerHTML = `<h2>${L('Okul', 'School')}</h2>
    <p class="muted">${L("Yeniden doğduğunda bu karakter Okul'a kalıcı olarak eklenir: seviyesi, kartları, bağları, kılıçları ve öldürdüğü canavarlar burada saklanır. Yeni karakter sıfırdan başlar ve yeni bir fraksiyona odaklanır. Ana görev, zincir, yan görevler ve kayıtlar karakterden bağımsızdır, olduğu gibi kalır.", "When you're reborn, this character joins the School for good: its level, cards, links, swords and slain monsters are kept here. The new character starts from scratch with a new faction focus. The main quest, chain, side quests and records don't belong to the character and stay as they are.")}</p>
    ${(() => { const lg = E.legacy(); return `<div class="box"><b>🏛 ${L('Okul mirası', 'School legacy')}:</b> ${L(`${lg.legends} efsane, ${lg.chars} karakter`, `${lg.legends} legends, ${lg.chars} characters`)} →
      <span class="mult">${L(`+%${lg.gold} oren`, `+${lg.gold}% crowns`)}</span>, <span class="mult">${L(`+%${lg.xp} TP`, `+${lg.xp}% XP`)}</span> <small class="muted">${L(`(her efsane +%${LEGACY.goldPerLegend} oren, en çok %${LEGACY.goldMax}; her karakter +%${LEGACY.xpPerChar} TP, en çok %${LEGACY.xpMax})`, `(each legend +${LEGACY.goldPerLegend}% crowns, up to ${LEGACY.goldMax}%; each character +${LEGACY.xpPerChar}% XP, up to ${LEGACY.xpMax}%)`)}</small></div>`; })()}
    ${charSummary(cur, true)}
    <div class="row" style="margin:12px 0 24px"><button class="btn ${s.legend ? '' : 'ghost'}" data-act="rebirth">♻ ${L('Yeniden doğ', 'Be reborn')}</button>
      <small class="muted">${s.legend ? L('Son boss yenildi, yeni bir yola hazırsın. İstersen bu karakterle devam da edebilirsin.', 'The final boss is defeated; you are ready for a new path. You can also keep playing this character.') : L("İstediğin zaman yapabilirsin, ama genelde son boss'tan sonra yapılır.", "You can do it anytime, but it's usually done after the final boss.")}</small></div>
    <h3>${L('Salon', 'Hall')} · ${L(`${s.hall.length} karakter`, `${s.hall.length} characters`)}</h3>
    ${s.hall.length ? s.hall.slice().reverse().map(h => charSummary(h, false)).join('') : `<p class="muted">${L("Henüz Okul'a katılmış bir karakter yok.", 'No character has joined the School yet.')}</p>`}`;
}
function showHallChar(id) {
  const h = st().hall.find(x => x.id === id); if (!h) return;
  const counts = {};
  h.trophies.forEach(t => { counts[t.id] = (counts[t.id] || 0) + 1; });
  const cards = Object.keys(h.collection).map(a => CARD_BY_ART[a]).filter(Boolean).sort((a, b) => RAR.indexOf(b.r) - RAR.indexOf(a.r));
  const none = `<small class="muted">${L('yok', 'none')}</small>`;
  openModal(`<h2>${esc(h.name)} ${h.legend ? `<span class="badge gold">${L('Efsane', 'Legend')}</span>` : ''}</h2>
    <p class="muted">${SCHOOLS[h.school]?.name} · ${facName(h.faction)} · ${L('Seviye', 'Level')} ${h.level}${h.fame ? ` ★${h.fame}` : ''} · ${esc(bandLabel(h.region || 0))} · ${L(`${h.stats?.goldEarned || 0} oren kazandı · ${h.stats?.dmg || 0} hasar verdi · ${h.draws} kart çekti`, `earned ${h.stats?.goldEarned || 0} crowns · dealt ${h.stats?.dmg || 0} damage · drew ${h.draws} cards`)}</p>
    <h3>${L('Öldürdüğü canavarlar', 'Monsters slain')} · ${h.trophies.length}</h3>
    <div class="mini-list">${Object.entries(counts).map(([mid, n]) => { const m = monById(mid); return `<span class="mini" title="${esc(m.name)}">${imgTag(monImg(m, 'low'))}<small>${esc(m.name)}${n > 1 ? ' ×' + n : ''}${m.boss ? ' 👑' : ''}</small></span>`; }).join('') || none}</div>
    <h3>${L('Kart bağları', 'Card links')} · ${L(`${h.links.filter(l => l.cards.length >= LINK_SIZE).length} tamamlandı`, `${h.links.filter(l => l.cards.length >= LINK_SIZE).length} complete`)}</h3>
    ${h.links.map(l => `<div class="link-row ${l.cards.length >= LINK_SIZE ? 'full' : ''}"><div class="link-head"><b>${esc(facName(l.f))} · ${esc(l.cat)}</b> <small>${l.cards.length}/${LINK_SIZE}</small></div>
      <div class="link-slots">${l.cards.map(a => CARD_BY_ART[a] ? `<div class="link-slot filled">${cardHtml(CARD_BY_ART[a], { noAct: true })}</div>` : '').join('')}</div></div>`).join('') || none}
    <h3>${L('Kılıçlar', 'Swords')} · ${h.swords.length}</h3>
    <div class="mini-list">${h.swords.map(swordById).filter(Boolean).map(w => `<span class="mini">${swordImg(w)}<small>${esc(w.name)}</small></span>`).join('') || none}</div>
    <h3>${L('Koleksiyon', 'Collection')} · ${L(`${cards.length} kart`, `${cards.length} cards`)}</h3>
    <div class="cards">${cards.slice(0, 60).map(c => cardHtml(c, { noAct: true, count: h.collection[c.a] })).join('')}</div>
    ${cards.length > 60 ? `<p class="muted">${L(`… ve ${cards.length - 60} kart daha (en nadirleri gösteriliyor).`, `… and ${cards.length - 60} more cards (rarest shown).`)}</p>` : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-act="close">${L('Kapat', 'Close')}</button></div>`, 'wide');
}
function showRebirth() {
  pickSchool = st().school; pickFaction = st().faction ? (FACTIONS.find(f => f !== st().faction) || 'all') : FACTIONS[0];
  openModal(`<h2>♻ ${L('Yeniden doğuş', 'Rebirth')}</h2>
    <p>${L(`<b>${esc(st().name)}</b> Okul'a kalıcı olarak eklenecek. Yeni karakter seviye 1'den, White Orchard'dan, boş koleksiyonla başlar. Ana görevin, zincirin, yan görevlerin ve kayıtların olduğu gibi kalır.`, `<b>${esc(st().name)}</b> will join the School for good. The new character starts at level 1 in White Orchard with an empty collection. Your main quest, chain, side quests and records stay as they are.`)}</p>
    <label>${L('Yeni karakterin adı', "New character's name")}</label><input id="rbName" value="">
    <label>${L('Okul', 'School')}</label>${schoolGrid()}
    <label>${L('Odak fraksiyon (sadece bu fraksiyon + tarafsız kartlar düşer; istersen tümü)', 'Faction focus (only this faction + Neutral cards drop; or pick all)')}</label>${factionGrid()}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-act="close">${L('Vazgeç', 'Cancel')}</button><button class="btn" data-act="rebirthgo">${L('Yeniden doğ', 'Be reborn')}</button></div>`);
}

/* ---------- başarımlar ---------- */
function renderAchievements() {
  const got = st().achievements || {}, h = E.achStats();
  const n = Object.keys(got).length;
  const groups = [...new Set(ACHIEVEMENTS.map(a => a.group))];
  $('#achPanel').innerHTML = `<h2>${L('Başarımlar', 'Achievements')} · ${n} / ${ACHIEVEMENTS.length}</h2>
    <p class="muted">${L('Bir kez açılırlar ve karakterden bağımsızdır; yeniden doğsan da kalırlar. Her biri oren, bazıları kart verir.', "They unlock once and don't belong to the character; they stay even if you're reborn. Each gives crowns, some give cards.")}</p>
    ${groups.map(g => `<h3>${g}</h3><div class="ach-grid">${ACHIEVEMENTS.filter(a => a.group === g).map(a => {
      const on = got[a.id], pr = !on && a.prog ? a.prog(h) : null;
      return `<div class="ach ${on ? 'on' : ''}"><div class="ach-icon">${a.icon}</div><div class="ach-body"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
        <small class="muted">${on ? `✓ ${longDate(dk(new Date(on)))}` : pr ? `${Math.min(pr[0], pr[1])} / ${pr[1]}` : L('kilitli', 'locked')} · +${a.gold} 🪙${a.card ? L(` + ${RAR_TR[a.card]} kart`, ` + ${RAR_TR[a.card]} card`) : ''}</small>
        ${pr ? `<div class="bar ach-bar"><div class="fill" style="width:${Math.min(100, pr[0] / pr[1] * 100)}%"></div></div>` : ''}</div></div>`;
    }).join('')}</div>`).join('')}`;
}

/* ---------- uyku istatistikleri (SVG) ---------- */
const minOfDay = d => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
const fmtMin = m => `${pad(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad(Math.round(((m % 1440) + 1440) % 1440 % 60))}`;
function sleepCharts() {
  const q = st().habits.find(h => h.type === 'sleep');
  if (!q) return `<p class="muted">${L('Uyku türünde bir alışkanlığın yok.', "You don't have a sleep habit.")}</p>`;
  const days = q.entries;
  const keys = Object.keys(days).sort().slice(-30);
  const rows = keys.map(k => ({ k, d: days[k] })).filter(x => x.d.result);
  if (!rows.length) return `<p class="muted">${L('Grafikler için henüz yeterli gün yok.', 'Not enough days for charts yet.')}</p>`;
  const W = 720, H = 180, pl = 40, pb = 22, n = rows.length, bw = (W - pl - 10) / n;
  const col = { success: '#5f9b4f', late: '#c9a45c', fail: '#a52a2a', rest: '#4b5560' };
  // 1) uyku süresi (yatış -> kalkış)
  const dur = rows.map(r => r.d.med && r.d.check ? (new Date(r.d.check) - new Date(r.d.med)) / 3600000 : null);
  const maxH = Math.max(10, ...dur.filter(x => x != null));
  const y1 = h => H - pb - (h / maxH) * (H - pb - 10);
  const bars = rows.map((r, i) => dur[i] == null ? `<rect x="${pl + i * bw + 2}" y="${H - pb - 3}" width="${bw - 4}" height="3" fill="${col[r.d.result]}" opacity=".5"><title>${longDate(r.k)}: ${L('yatış kaydı yok', 'no bedtime recorded')}</title></rect>`
    : `<rect x="${pl + i * bw + 2}" y="${y1(dur[i])}" width="${bw - 4}" height="${H - pb - y1(dur[i])}" fill="${col[r.d.result]}" rx="2"><title>${longDate(r.k)}: ${dur[i].toFixed(1)} ${L('saat', 'h')}</title></rect>`).join('');
  const grid1 = [0, 4, 6, 8, 10].filter(h => h <= maxH).map(h => `<line x1="${pl}" x2="${W}" y1="${y1(h)}" y2="${y1(h)}" stroke="#2a2721"/><text x="${pl - 6}" y="${y1(h) + 4}" text-anchor="end">${h}${L('s', 'h')}</text>`).join('');
  // 2) yatış ve kalkış saatleri (gece yarısına göre dakika), hedef aralıkları gölgeli
  const night = m => (m >= 720 ? m - 1440 : m);
  const beds = rows.map(r => r.d.med ? night(minOfDay(r.d.med)) : null), wakes = rows.map(r => r.d.check ? minOfDay(r.d.check) : null);
  const all = [...beds, ...wakes].filter(x => x != null);
  let lo = Math.min(...all, -120), hi = Math.max(...all, 600);
  if (q.type === 'sleep') { lo = Math.min(lo, night(toMinT(q.sleep.bedStart)) - 30); hi = Math.max(hi, toMinT(q.sleep.wakeEnd) + 30); }
  const y2 = m => 10 + (m - lo) / (hi - lo) * (H - pb - 10);
  const band = (a, b, c) => `<rect x="${pl}" y="${y2(a)}" width="${W - pl}" height="${Math.max(2, y2(b) - y2(a))}" fill="${c}" opacity=".12"/>`;
  const bands = q.type === 'sleep' ? band(night(toMinT(q.sleep.bedStart)), night(toMinT(q.sleep.bedEnd)), '#7a9cff') + band(toMinT(q.sleep.wakeStart), toMinT(q.sleep.wakeEnd), '#ffd36e') : '';
  const dots = (arr, c, label) => arr.map((m, i) => m == null ? '' : `<circle cx="${pl + i * bw + bw / 2}" cy="${y2(m)}" r="4" fill="${c}"><title>${longDate(rows[i].k)} ${label}: ${fmtMin(m)}</title></circle>`).join('');
  const path = (arr, c) => { const pts = arr.map((m, i) => m == null ? null : `${pl + i * bw + bw / 2},${y2(m)}`).filter(Boolean); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.5" opacity=".6"/>` : ''; };
  const ticks = []; for (let m = Math.ceil(lo / 120) * 120; m <= hi; m += 120) ticks.push(m);
  const grid2 = ticks.map(m => `<line x1="${pl}" x2="${W}" y1="${y2(m)}" y2="${y2(m)}" stroke="#2a2721"/><text x="${pl - 6}" y="${y2(m) + 4}" text-anchor="end">${fmtMin(m)}</text>`).join('');
  const xl = rows.map((r, i) => (i % Math.ceil(n / 10) === 0) ? `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${fromKey(r.k).getDate()}</text>` : '').join('');
  const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const aBed = avg(beds), aWake = avg(wakes), aDur = avg(dur);
  return `<div class="stats" style="margin:8px 0 12px">
      <div class="stat"><b>${aBed == null ? '—' : fmtMin(aBed)}</b><small>${L('Ort. yatış', 'Avg. bedtime')}</small></div>
      <div class="stat"><b>${aWake == null ? '—' : fmtMin(aWake)}</b><small>${L('Ort. kalkış', 'Avg. wake-up')}</small></div>
      <div class="stat"><b>${aDur == null ? '—' : aDur.toFixed(1) + L(' sa', ' h')}</b><small>${L('Ort. uyku', 'Avg. sleep')}</small></div>
    </div>
    <h3>${L('Uyku süresi (yatış → kalkış)', 'Sleep duration (bed → wake)')} <small class="muted">· ${L(`son ${n} gün`, `last ${n} days`)}</small></h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}">${grid1}${bars}${xl}</svg>
    <h3>${L('Yatış ve kalkış saatleri', 'Bedtimes and wake-ups')} <small class="muted">· ${L('🔵 yatış, 🟡 kalkış, gölgeler hedef aralıklar', '🔵 bedtime, 🟡 wake-up, shaded bands are your windows')}</small></h3>
    <svg class="chart" viewBox="0 0 ${W} ${H}">${bands}${grid2}${path(beds, '#7a9cff')}${path(wakes, '#ffd36e')}${dots(beds, '#7a9cff', L('yatış', 'bedtime'))}${dots(wakes, '#ffd36e', L('kalkış', 'wake-up'))}${xl}</svg>
    <p class="hint">${L('Yatış saati meditasyon düğmesine bastığın andır. Meditasyon yapmadığın günlerde uyku süresi hesaplanamaz.', "Bedtime is when you press the meditate button. Sleep duration can't be calculated on days you don't meditate.")}</p>`;
}
const toMinT = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ---------- kayıtlar (genel, karakterden bağımsız) ---------- */
function renderHistory() {
  // bütün alışkanlıkların (bırakılanlar dahil) günleri tek listede
  const rowsAll = [...st().habits, ...st().questHistory.filter(h => h.entries)].flatMap(h => Object.entries(h.entries).filter(([, d]) => d.result).map(([k, d]) => ({ k, d, name: h.name })))
    .sort((a, b) => b.k.localeCompare(a.k));
  const since = addDays(dk(now()), -30), last30 = rowsAll.filter(x => x.k >= since);
  const counted = last30.filter(x => x.d.result !== 'rest');
  const succ = counted.filter(x => x.d.result === 'success').length;
  const meds = last30.filter(x => x.d.medOnTime).length;
  const all = rowsAll.filter(x => x.d.result !== 'rest'), allSucc = all.filter(x => x.d.result === 'success').length;
  const R = { success: L('✅ Aralıkta', '✅ In window'), late: L('🌗 Gecikme', '🌗 Late'), fail: L('❌ Kaçırıldı', '❌ Missed'), rest: L('⏸ Dinlenme', '⏸ Rest') };
  const chars = st().hall.length + 1, kills = st().hall.reduce((n, h) => n + h.trophies.length, 0) + st().trophies.length;
  $('#historyPanel').innerHTML = `<h2>${L('Kayıtlar', 'Records')} <small class="muted">· ${L('tüm karakterler', 'all characters')}</small></h2>
    <div class="stats" style="margin-bottom:16px">
      <div class="stat"><b>${counted.length ? Math.round(succ / counted.length * 100) : 0}%</b><small>${L('Başarı (30 gün)', 'Success (30 days)')}</small></div>
      <div class="stat"><b>${all.length ? Math.round(allSucc / all.length * 100) : 0}%</b><small>${L('Başarı (tümü)', 'Success (all time)')}</small></div>
      <div class="stat"><b>${meds}</b><small>${L('Aralıkta yatış (30 gün)', 'On-time bedtimes (30 days)')}</small></div>
      <div class="stat"><b>${Math.max(0, ...st().habits.map(h => h.chain.best))}</b><small>${L('En uzun zincir', 'Longest chain')}</small></div>
      <div class="stat"><b>${kills}</b><small>${L('Avlanan canavar', 'Monsters hunted')}</small></div>
      <div class="stat"><b>${chars}</b><small>${L('Karakter', 'Characters')}</small></div>
      <div class="stat"><b>${st().questHistory.filter(h => h.result === 'completed').length}</b><small>${L('Edinilen alışkanlık', 'Habits formed')}</small></div>
    </div>
    ${st().habits.some(h => h.type === 'sleep') ? `<h2 style="margin-top:20px">${L('Uyku', 'Sleep')}</h2>${sleepCharts()}` : ''}
    ${(st().weekly || []).length ? `<h2 style="margin-top:20px">${L('Haftalık raporlar', 'Weekly reports')}</h2>${st().weekly.slice(0, 8).map((w, i, arr) => `<details class="box" ${i === 0 ? 'open' : ''}><summary>${longDate(w.key)} – ${longDate(w.end)} · ${L(`${w.success || 0}/${w.total ?? 7} başarılı`, `${w.success || 0}/${w.total ?? 7} successful`)}</summary>${weekCard(w, arr[i + 1])}</details>`).join('')}` : ''}
    <h2 style="margin-top:20px">${L('Günler', 'Days')}</h2>
    <table><tr><th>${L('Gün', 'Day')}</th><th>${L('Alışkanlık', 'Habit')}</th><th>${L('Yatış', 'Bed')}</th><th>${L('Saat / adet', 'Time / count')}</th><th>${L('Sonuç', 'Result')}</th><th>${L('Ödül', 'Reward')}</th></tr>
    ${rowsAll.slice(0, 60).map(({ k, d, name }) => `<tr><td>${longDate(k.slice(0, 10))}</td><td>${esc(name)}</td>
      <td>${d.med ? hm(new Date(d.med)) + (d.medOnTime ? ' ✓' : '') : '—'}</td><td>${d.count != null ? d.count : d.check ? hm(new Date(d.check)) : '—'}</td>
      <td>${R[d.result]}${d.retro ? ` <span title="${L('Sonradan işlendi', 'Entered late')}">📝</span>` : ''}</td><td>${d.reward ? `+${d.reward.xp} ${L('TP', 'XP')}, +${d.reward.gold + (d.reward.payout || 0)} 🪙 (×${d.reward.mult})` : ''}</td></tr>`).join('')
      || `<tr><td colspan="6" class="muted">${L('Henüz tamamlanmış gün yok.', 'No completed days yet.')}</td></tr>`}</table>
    <p class="hint">${L('Tüm geçmiş hofw.db dosyasında (tablolar: habit_days, log). Her gün ilk açılışta backups/ klasörüne yedek alınır.', 'Your full history is in hofw.db (tables: habit_days, log). A backup goes to the backups/ folder on the first start of each day.')}</p>`;
}

/* ---------- ayarlar ---------- */
function renderSettings() {
  $('#settingsPanel').innerHTML = `<h2>${L('Ayarlar', 'Settings')}</h2>
    <div class="grid2"><div>
      <h3>🌐 Dil / Language</h3>
      <div class="row"><button class="btn ${window.KM_LANG === 'tr' ? '' : 'ghost'}" data-act="lang" data-v="tr">Türkçe</button><button class="btn ${window.KM_LANG === 'en' ? '' : 'ghost'}" data-act="lang" data-v="en">English</button></div>
      <p class="hint">${L('Bu cihaz için geçerlidir. Geçmiş günlük kayıtları yazıldıkları dilde kalır.', 'Applies to this device. Past log entries stay in the language they were written in.')}</p>
      <label>${L('Karakter adı', 'Character name')}</label><div class="row"><input id="sName" value="${esc(st().name)}"><button class="btn" data-act="savename">${L('Kaydet', 'Save')}</button></div>
      <p class="hint">${L('Saat aralıkları ve süre "Ana Görev" sekmesinde.', 'Time windows and duration are on the "Main Quest" tab.')}</p>
      <h3>${L('Bildirimler', 'Notifications')}</h3>
      <p class="muted">${L('Sekme açıksa yatış aralığından 30 dk önce ve görev aralığının başında bildirim gönderir. Alarm yerine geçmez.', 'While the tab is open, notifies you 30 min before your bedtime window and when your quest window starts. Not a replacement for an alarm.')}</p>
      <button class="btn" data-act="notify">${st().settings.notify ? L('Bildirimleri kapat', 'Turn off notifications') : L('Bildirimleri aç', 'Turn on notifications')}</button>
      <h3>${L('Ses', 'Sound')}</h3>
      <div class="row"><button class="btn" data-act="sound">${st().settings.sound === false ? L('🔇 Sesleri aç', '🔇 Turn sound on') : L('🔊 Sesleri kapat', '🔊 Turn sound off')}</button><button class="btn ghost" data-act="soundtest">${L('Dene', 'Test')}</button></div>
      <h3>📱 ${L('Telefondan erişim', 'Phone access')}</h3><div id="accessBox"><small class="muted">${L('Yükleniyor…', 'Loading…')}</small></div>
      <h3>${L('Okul', 'School')}</h3><p class="muted">${L(`Şu an: ${SCHOOLS[st().school].name}. Okul değiştirmek 150 oren.`, `Current: ${SCHOOLS[st().school].name}. Changing school costs 150 crowns.`)}</p>
      <button class="btn" data-act="changeschool">${L('Okul değiştir', 'Change school')}</button>
      <h3>${L('Kart odağı', 'Card focus')}</h3>${(() => { const f = st().faction, p = E.factionProgress();
        if (!f) return `<p class="muted">${L('Bütün fraksiyonlardan kart topluyorsun.', 'You collect cards from every faction.')}</p>`;
        const done = p.have >= p.total, others = FACTIONS.filter(x => x !== f);
        return `<p class="muted">${L(`Şu an: <b>${facName(f)}</b> + tarafsız · ${p.have}/${p.total} ${facName(f)} kartı. Bu fraksiyonun bütün kartlarını toplayınca başka bir fraksiyona geçebilirsin; topladıkların koleksiyonunda kalır.`, `Current: <b>${facName(f)}</b> + neutral · ${p.have}/${p.total} ${facName(f)} cards. Once you collect every card of this faction you can switch to another; your cards stay in your collection.`)}${(st().factionsDone || []).length ? L(` Tamamlananlar: ${st().factionsDone.map(facName).join(', ')}.`, ` Completed: ${st().factionsDone.map(facName).join(', ')}.`) : ''}</p>
          <div class="bar qbar thin"><div class="fill" style="width:${p.have / p.total * 100}%"></div><span>${p.have} / ${p.total}</span></div>
          <div class="row" style="margin-top:6px"><select id="newFaction" ${done ? '' : 'disabled'}>${others.map(x => `<option value="${x}" ${(st().factionsDone || []).includes(x) ? '' : ''}>${facName(x)}${(st().factionsDone || []).includes(x) ? ' ✓' : ''}</option>`).join('')}<option value="all">${L('Bütün fraksiyonlar', 'All factions')}</option></select>
            <button class="btn" data-act="changefaction" ${done ? '' : 'disabled'} title="${done ? '' : L('Önce bu fraksiyonun bütün kartlarını topla', 'Collect every card of this faction first')}">${L('Odağı değiştir', 'Change focus')}</button></div>`; })()}
    </div><div>
      <h3>${L('Yedek', 'Backup')}</h3>
      <div class="row"><button class="btn" data-act="export">${L('Dışa aktar (JSON)', 'Export (JSON)')}</button>
        <label class="btn" style="margin:0;color:var(--gold2)">${L('İçe aktar', 'Import')}<input type="file" id="importFile" accept=".json" hidden></label></div>
      <p class="hint">${L('Asıl kayıt hofw.db. Günlük otomatik yedekler backups/ klasöründe.', 'The main save is hofw.db. Daily automatic backups are in the backups/ folder.')}</p>
      <h3>${L('Kurallar', 'Rules')}</h3><button class="btn" data-act="rules">${L('Nasıl oynanır?', 'How to play')}</button>
      <h3>Test</h3><p class="muted">${L('Test.bat ayrı bir test kaydıyla açar: zamanı ileri sarabilir, her şeyi gerçek kaydına dokunmadan deneyebilirsin.', 'Test.bat (or server.py --open "?slot=test") opens a separate test save: you can move time forward and try anything without touching your real save.')}</p>
      <a class="btn" href="/tests.html" target="_blank">${L('Otomatik testleri çalıştır', 'Run automated tests')}</a>
      <h3>${L('Tehlikeli bölge', 'Danger zone')}</h3><button class="btn red" data-act="reset">${L('Her şeyi sıfırla', 'Reset everything')}</button>
      <h3>${L('Hakkında', 'About')}</h3><p class="hint">Habits of Witchers. ${L("Resmi olmayan, ticari olmayan bir hayran projesidir; CD PROJEKT RED ile bağlantısı yoktur. The Witcher, Gwent ve ilgili isimler, kart görselleri ve metinler CD PROJEKT S.A.'ya aittir. Kart verisi ve görseller gwent.one üzerinden alınır.", 'An unofficial, non-commercial fan project; not affiliated with CD PROJEKT RED. The Witcher, Gwent and related names, card art and texts are the property of CD PROJEKT S.A. Card data and images are loaded from gwent.one.')}</p>
    </div></div>`;
}

async function renderAccess() {
  const box = $('#accessBox'); if (!box) return;
  try {
    const j = await (await fetch('/api/access', { cache: 'no-store' })).json();
    if (!j.local) { box.innerHTML = `<p class="muted">${L('Bu cihazdan bağlısın. PIN ayarları sadece bilgisayardan değiştirilebilir.', 'You are connected from another device. PIN settings can only be changed on the computer.')}</p>`; return; }
    const urls = (j.urls || []).map(u => `<li><code>${esc(u)}</code></li>`).join('') || `<li class="muted">${L('Ağ adresi bulunamadı', 'No network address found')}</li>`;
    box.innerHTML = `<p class="muted">${L("Telefonun bilgisayarla <b>aynı Wi‑Fi</b>'deyken uygulamayı telefonun tarayıcısından açabilirsin.", "While your phone is on the <b>same Wi‑Fi</b> as the computer, you can open the app in the phone's browser.")}</p>
      ${j.lan ? `<p>✅ ${L('<b>Açık.</b> Telefonda şu adresi aç:', '<b>On.</b> Open this address on your phone:')}</p><ul>${urls}</ul>
        ${j.listening ? '' : `<p class="bad-text">${L('Sunucu eski sürümle çalışıyor: Baslat.bat penceresini bir kez kapatıp yeniden aç.', 'The server is running an old version: close the server window once and start it again.')}</p>`}
        <p class="hint">${L('Tarayıcı menüsünden "Ana ekrana ekle" dersen uygulama gibi açılır. Windows güvenlik duvarı izin sorarsa "Özel ağlar"a izin ver.', 'Use "Add to Home screen" in the browser menu to open it like an app. If the Windows firewall asks, allow "Private networks".')}</p>
        <div class="row"><button class="btn red" data-act="lanoff">${L('Telefondan erişimi kapat', 'Turn off phone access')}</button></div>`
      : `<p>${L('Kapalı.', 'Off.')}</p><div class="row"><button class="btn big" data-act="lanon">📱 ${L('Telefondan erişimi aç', 'Turn on phone access')}</button></div>
        <p class="hint">${L("Açınca ev Wi‑Fi'ındaki cihazlar PIN sormadan girebilir. İstersen aşağıdan PIN de ekleyebilirsin.", 'When on, devices on your home Wi‑Fi can get in without a PIN. You can add a PIN below if you like.')}</p>`}
      <details class="box"><summary>PIN ${j.pin ? L('(açık)', '(on)') : L('(isteğe bağlı)', '(optional)')}</summary>
        <p class="muted">${L('PIN eklersen telefon ilk girişte bir kez sorar, sonra hatırlar.', 'With a PIN, the phone asks once on first sign-in and then remembers.')}</p>
        <div class="row"><input id="pinSet" type="password" inputmode="numeric" placeholder="${j.pin ? L('Yeni PIN', 'New PIN') : L('PIN (4–8 rakam)', 'PIN (4–8 digits)')}" style="width:160px">
          <button class="btn" data-act="pinsave">${j.pin ? L('PIN’i değiştir', 'Change PIN') : L('PIN ekle', 'Add PIN')}</button>
          ${j.pin ? `<button class="btn ghost" data-act="pinoff">${L('PIN’i kaldır', 'Remove PIN')}</button>` : ''}</div>
      </details>`;
  } catch { box.innerHTML = `<p class="muted">${L('Sunucuya ulaşılamadı.', "Couldn't reach the server.")}</p>`; }
}
function render() {
  if (!E) return;
  renderTop();
  if (currentTab === 'home') { renderContract(); renderHunt(); renderChain(); renderWeek(); renderLog(); }
  if (currentTab === 'mainquest') renderMainQuest();
  if (currentTab === 'quests') renderQuests();
  if (currentTab === 'collection') renderCollection();
  if (currentTab === 'links') renderLinks();
  if (currentTab === 'bestiary') renderBestiary();
  if (currentTab === 'shop') renderShop();
  if (currentTab === 'hall') renderHall();
  if (currentTab === 'history') renderHistory();
  if (currentTab === 'settings') { renderSettings(); renderAccess(); }
  if (currentTab === 'achievements') renderAchievements();
  renderDev();
}
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
  render();
}

/* ---------- haftalık özet ---------- */
function weekCard(w, prev) {
  const diff = (a, b, unit = '') => b == null ? '' : a > b ? ` <small class="good-text">▲ ${a - b}${unit}</small>` : a < b ? ` <small class="bad-text">▼ ${b - a}${unit}</small>` : '';
  const sl = x => x == null ? '—' : fmtDur(x * 3600000);
  return `<div class="stats week-sum">
    <div class="stat"><b>${w.success || 0}/${w.total ?? 7}</b><small>${L('Başarılı gün', 'Successful days')}</small>${diff(w.success || 0, prev?.success)}</div>
    <div class="stat"><b>${w.late || 0}·${w.fail || 0}</b><small>${L('Gecikme · kaçırma', 'Late · missed')}</small></div>
    <div class="stat"><b>${w.medOnTime || 0}</b><small>${L('Aralıkta yatış', 'On-time bedtimes')}</small></div>
    <div class="stat"><b>${sl(w.sleepAvg)}</b><small>${L('Ort. uyku', 'Avg. sleep')}</small></div>
    <div class="stat"><b>${w.kills || 0}</b><small>${L('Canavar', 'Monsters')}${w.bosses ? ` (${w.bosses} boss)` : ''}</small>${diff(w.kills || 0, prev?.kills)}</div>
    <div class="stat"><b>${w.gold || 0}</b><small>${L('Oren', 'Crowns')}</small></div>
    <div class="stat"><b>${w.cards || 0}</b><small>${L('Kart', 'Cards')}</small></div>
    <div class="stat"><b>${w.chainStart ?? 0}→${w.chainEnd ?? 0}</b><small>${L('Zincir', 'Chain')}</small></div>
  </div>`;
}
function showWeekly() {
  const list = st().weekly || [], w = list.find(x => x.key === st().pendingSummary) || list[0];
  if (!w) { st().pendingSummary = null; return; }
  const prev = list[list.indexOf(w) + 1];
  const ratio = (w.success || 0) / Math.max(1, w.total ?? 7);
  const verdict = ratio >= 6 / 7 ? L('Kusursuza yakın bir hafta. Kaer Morhen seninle gurur duyuyor.', 'A near-perfect week. Kaer Morhen is proud of you.') : ratio >= 4 / 7 ? L('İyi bir hafta. Zincir sağlam.', 'A good week. The chain holds.') : ratio >= 2 / 7 ? L('Zor bir hafta oldu; yeni hafta yeni kontrat.', 'A tough week; new week, new contract.') : L('Bu hafta canavarlar kazandı. Ama av bitmedi.', "The monsters won this week. But the hunt isn't over.");
  openModal(`<h2>📜 ${L('Haftalık rapor', 'Weekly report')} · ${longDate(w.key)} – ${longDate(w.end)}</h2>
    <p>${verdict}</p>${weekCard(w, prev)}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-act="weeklyok">${L('Yeni haftaya başla', 'Start the new week')}</button></div>`);
}

/* ---------- kart açma ekranı ---------- */
function showQueue() {
  if (modalOpen() || !E) return;
  const next = E.ev.reveals.shift();
  if (!next) { if (st().habits.some(h => h.awaitingChoice)) showQuestDone(); else if (st().pendingSummary) showWeekly(); return; }
  const { title, cards } = next;
  const best = cards.reduce((b, c) => RAR.indexOf(c.r) > RAR.indexOf(b) ? c.r : b, 'Common');
  openModal(`<h2 style="text-align:center">${esc(title)}</h2>
    <p class="muted" style="text-align:center">${L('Kartlara tıkla ve aç', 'Click the cards to reveal them')}${best === 'Epic' || best === 'Legendary' ? L('. Bir şey parlıyor...', '. Something is glowing...') : ''}${E.ev.reveals.length ? L(` · sırada ${E.ev.reveals.length} ganimet daha`, ` · ${E.ev.reveals.length} more loot waiting`) : ''}</p>
    <div class="reveal">${cards.map((c, i) => `<div class="flip glow-${c.r}" data-act="flip" data-i="${i}">
      <div class="face back">🐺</div><div class="face front">${cardHtml(c, { q: 'medium', isNew: c.isNew, noAct: true })}</div></div>`).join('')}</div>
    <p class="muted" style="text-align:center" id="revealInfo"></p>
    <div class="row" style="justify-content:center"><button class="btn" data-act="flipall">${L('Hepsini aç', 'Reveal all')}</button><button class="btn" data-act="closereveal">${L('Devam', 'Continue')}</button>
      ${E.ev.reveals.length ? `<button class="btn ghost" data-act="skipreveals">${L('Hepsini atla', 'Skip all')}</button>` : ''}</div>`);
  $('#modalBox').dataset.cards = JSON.stringify(cards.map(c => ({ n: c.n, r: c.r, isNew: c.isNew })));
}
function flipInfo() {
  const cards = JSON.parse($('#modalBox').dataset.cards || '[]');
  const open = [...document.querySelectorAll('.flip.open')].map(el => cards[+el.dataset.i]);
  $('#revealInfo').innerHTML = open.map(c => `<span class="rar-${c.r}">${esc(c.n)} (${RAR_TR[c.r]})</span>${c.isNew ? L(' · yeni!', ' · new!') : L(` · tekrar, +${SCRAP[c.r]} ✦`, ` · duplicate, +${SCRAP[c.r]} ✦`)}`).join('<br>');
}

/* ---------- açılış ---------- */
let pickSchool = 'wolf', pickFaction = 'Scoiatael';
const schoolGrid = () => `<div class="schools">${Object.entries(SCHOOLS).map(([id, s]) => `<div class="school ${id === pickSchool ? 'sel' : ''}" data-act="pickschool" data-id="${id}">
  <div class="simg">${imgTag(DATA.schoolImg(id, 'low'), s.img ? 'top' : '')}</div><div class="sbody"><b>${s.name}</b>${s.desc}<small class="muted" style="display:block;margin-top:4px">${kitText(id)}</small></div></div>`).join('')}</div>`;
const kitText = id => { const k = START_KIT[id], sw = [k.silver, k.steel].map(swordById).filter(Boolean).map(w => w.name).join(', ');
  return L(`Başlangıç: ${k.gold} oren · ${k.swallow} Swallow · ${k.honey} White Honey${k.thunder ? ` · ${k.thunder} Thunderbolt` : ''}${k.dancing ? ` · ${k.dancing} Dancing Star` : ''}${k.scraps ? ` · ${k.scraps} kırıntı` : ''}${sw ? ` · ${sw}` : ''}`,
    `Start: ${k.gold} crowns · ${k.swallow} Swallow · ${k.honey} White Honey${k.thunder ? ` · ${k.thunder} Thunderbolt` : ''}${k.dancing ? ` · ${k.dancing} Dancing Star` : ''}${k.scraps ? ` · ${k.scraps} scraps` : ''}${sw ? ` · ${sw}` : ''}`); };
const FACTION_ART = { Monster: 1652, Nilfgaard: 1285, 'Northern Realms': 2357, Scoiatael: 1189, Skellige: 2347, Syndicate: 1843 };
const factionGrid = () => `<div class="schools">${FACTIONS.map(f => `<div class="school ${f === pickFaction ? 'sel' : ''}" data-act="pickfaction" data-id="${f}">
  <div class="simg">${imgTag(ART(FACTION_ART[f], 'low'))}</div><div class="sbody"><b>${facName(f)}</b>${L(`${CARDS.filter(c => c.f === f).length} kart + ${CARDS.filter(c => c.f === 'Neutral').length} tarafsız`, `${CARDS.filter(c => c.f === f).length} cards + ${CARDS.filter(c => c.f === 'Neutral').length} Neutral`)}</div></div>`).join('')}
  <div class="school ${pickFaction === 'all' ? 'sel' : ''}" data-act="pickfaction" data-id="all">
  <div class="simg">${imgTag(ART(1007, 'low'))}</div><div class="sbody"><b>${L('Tüm fraksiyonlar', 'All factions')}</b>${L(`${CARDS.length} kart · odak yok, koleksiyon daha yavaş tamamlanır`, `${CARDS.length} cards · no focus, the collection fills more slowly`)}</div></div></div>`;
function showOnboarding() {
  openModal(`<div class="row" style="justify-content:flex-end"><button class="btn sm ${window.KM_LANG === 'tr' ? '' : 'ghost'}" data-act="lang" data-v="tr" data-ob="1">Türkçe</button><button class="btn sm ${window.KM_LANG === 'en' ? '' : 'ghost'}" data-act="lang" data-v="en" data-ob="1">English</button></div>
    <h2>${L("Kaer Morhen'e hoş geldin", 'Welcome to Kaer Morhen')}</h2>
    <p>${L('Her gün ana görevini aralığında yaparsan Gwent kartları, oren ve tecrübe kazanırsın, zincirine bir halka eklenir ve kontrat tabelasından seçtiğin canavara hasar verirsin. Canavarları kestikçe seviye atlar, bölge bölge ilerlersin.', 'Do your main quest inside its window every day to earn Gwent cards, crowns and experience, add a link to your chain, and damage the monster you picked from the contract board. Slay monsters to level up and advance region by region.')}</p>
    <label>${L('Adın', 'Your name')}</label><input id="obName" placeholder="${L('ör. Geralt', 'e.g. Geralt')}" value="">
    <label>${L('Okulunu seç', 'Choose your school')}</label>${schoolGrid()}
    <label>${L('Odak fraksiyonun (sadece bu fraksiyon + tarafsız kartlar düşer; istersen tümü)', 'Your faction focus (only this faction + Neutral cards drop; or pick all)')}</label>${factionGrid()}
    <h3>${L('İlk ana görevin', 'Your first main quest')}</h3>
    ${questForm({ name: L('Uyku düzeni', 'Sleep schedule'), type: 'sleep', days: 30, lateMin: 60 }, 'new')}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn big" data-act="oath">${L('Yemin et', 'Take the oath')}</button></div>`);
}
function showRules() {
  if (window.KM_LANG === 'en') return showRulesEn();
  openModal(`<h2>Nasıl oynanır?</h2>
  <h3>Ana görev</h3>
  <p>Edinmek istediğin tek bir alışkanlık. <b>Uyku düzeni</b>nde bir yatış, bir de kalkış aralığı vardır; <b>günlük alışkanlık</b>ta tek bir aralık. Aralığın içinde ne zaman yaptığın fark etmez. ${QUEST_MIN}–${QUEST_MAX} günlük bir hedef seçersin; o kadar başarılı gün biriktirince alışkanlık edinilir.</p>
  <h3>Her gün</h3>
  <p><b>Yatış (uyku):</b> aralıkta meditasyon küçük ödül verir, sabahı ×1.5 ve +1 kart yapar. <b>Kalkış / görev:</b> aralıkta yaparsan başarı: kart, TP, oren ve zincirine bir halka. Aralık sonrası tolerans içinde yaparsan gecikme, hiç yapmazsan kaçırma.</p>
  <h3>Kontratlar ve bölgeler</h3>
  <p>Açık her bölgenin ilan panosuna her pazartesi ${BOARD_SIZE} canavar asılır. Haritadan istediğin bölgeden birini seçersin, başarılı günlerin ona hasar verir. Her canavarın canı ve ödülü farklıdır: canı az olanın ödülü de azdır. Ölünce oren, TP ve kart alırsın. Aynı canavar bu karakterle bir daha gelmez (efsane olduktan sonra elit olarak döner). Asıl TP canavarlardan gelir.</p>
  <p>Kademeler: ${Array.from({ length: BAND_COUNT }, (_, b) => `${bandLabel(b)} (${b * 4 + 1}–${b * 4 + 4})`).join(' → ')}. Aynı kademedeki bölgeler birlikte açılır. Kademenin üst seviyesine gelince TP birikmeye devam eder (en fazla bir seviyelik), ama ilerlemek için kademenin boss'larından birini yenmen gerekir; diğer boss sonra da kesilebilir. Son boss'u yenen karakter efsane olur; istersen onunla devam edersin: canavarlar ve boss'lar elit olarak geri gelir, 32'den sonraki TP Ün (★) verir.</p>
  <h3>Hasar</h3>
  <p>Saat başı bir vuruş yaparsın: (seviye gücü + gümüş kılıç) × (1 + bonus). Gümüş kılıç hasar ekler, çelik kılıç kritik şansı verir (×1.5); güçleri kılıcın seviyesine ve kademesine bağlı. Zincir ana güç kaynağıdır: Çelik +%10, Gümüş +%20, Altın +%30, Mithril +%50, Göktaşı +%100. ${MULTI_CHAIN_TXT()} Zincir, kart bağı ve avcı bonusları düz toplanır; tavan yok. Kılıçlar demircide senin seviyende çıkar; seviyesini oren ve kırıntıyla kendi seviyene kadar yükseltebilirsin.</p>
  <h3>Av (idle)</h3>
  <p>Karakterin kontrattaki canavarla sürekli dövüşür; uygulama kapalıyken de. Saatlik hasarın seviyenden, kılıçlarından, zincirlerinden ve kart bağlarından gelir. Canavar sana kendiliğinden vurmaz: bir görevi geciktirirsen yarım, kaçırırsan tam vurur (boss'lar daha sert). Can avdayken saatte yaklaşık %0,3 dolar (okula göre: Bear %0,5, Griffin %0,35, Wolf %0,3, Viper %0,25, Cat %0,2, Manticore %0,3); yenilip toparlanırken saatte %15 (Bear okulu %30). Kontrat hiç bitmez: istersen panodan başka bir kontrat seçersin (eskisinin ilerlemesi sıfırlanır), seçmezsen en kolay iş kendiliğinden alınır. Acil durumda Swallow içersin; Thunderbolt 12 saat hasarı +%20 artırır, Tawny Owl alınınca +10 TP verir, Dancing Star bombası canının %50'si karşılığında canavara rastgele 3–10 saatlik hasarın kadar vurur. Canın %50'nin altındayken Yaralısın: hasarın −%20. Can sıfırlanırsa yenilirsin: canavarın canı tamamen dolar, orenin %10'unu kaybedersin ve canın dolana kadar toparlanırsın. Kartlar avdan değil alışkanlıklardan gelir.</p>
  <h3>Cezalar</h3>
  <p>Gecikmek canavarın yarım vuruşu ve 12 saat "Yorgun" (hasar −%15), kaçırmak tam vuruş ve 24 saat "Bitkin" (−%30) demektir; cezalar birikir ama en çok −%60 olur. White Honey kaçırılan bir günde kendiliğinden içilir: canavar vuramaz, Bitkin olmazsın. Griffin okulu ne Yorgun ne Bitkin olur.</p>
  <h3>Zincir</h3>
  <ul>
   <li>Her başarılı gün bir halka: <b>Demir → Çelik (7) → Gümüş (14) → Altın (30) → Göktaşı (60)</b>.</li>
   <li>Gecikme paslı halka ekler, üst üste ikincisi zinciri kırar. Kaçırılan gün zinciri kırar, bir malzeme düşersin.</li>
   <li><b>Kefaret:</b> kırıldıktan sonraki ${REPAIR_NEED} günü başarırsan eski uzunluk geri gelir. <b>Dinlenme günü:</b> haftada bir, önceden ilan edilir.</li>
  </ul>
  <h3>Okul ve yeniden doğuş</h3>
  <p>Her karakter bir fraksiyona odaklanır: sadece o fraksiyonun ve tarafsız kartlar düşer. İstediğin zaman (genelde son boss'tan sonra) yeniden doğabilirsin: karakter Okul'a kalıcı olarak eklenir, yenisi sıfırdan başlar. Ana görev, zincir ve kayıtlar karakterden bağımsızdır.</p>
  <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Anladım</button></div>`);
}
function showRulesEn() {
  openModal(`<h2>How to play</h2>
  <h3>Main quest</h3>
  <p>One habit you want to build. A <b>sleep schedule</b> has a bedtime window and a wake-up window; a <b>daily habit</b> has a single window. When inside the window you do it doesn't matter. You pick a goal of ${QUEST_MIN}–${QUEST_MAX} days; collect that many successful days and the habit is formed.</p>
  <h3>Every day</h3>
  <p><b>Bedtime (sleep):</b> meditating in the window gives a small reward and makes the morning ×1.5 with +1 card. <b>Wake-up / quest:</b> doing it in the window is a success: cards, XP, crowns and a new chain link. Doing it after the window, within the tolerance, is late; not doing it at all is missed.</p>
  <h3>Contracts and regions</h3>
  <p>Every Monday each unlocked region's notice board gets ${BOARD_SIZE} monsters. Pick one from any region on the map, and your successful days damage it. Each monster has its own HP and reward: weaker monsters pay less. When it dies you get crowns, XP and cards. A monster doesn't return for the same character (after you become a legend, it returns as an elite). Most XP comes from monsters.</p>
  <p>Tiers: ${Array.from({ length: BAND_COUNT }, (_, b) => `${bandLabel(b)} (${b * 4 + 1}–${b * 4 + 4})`).join(' → ')}. Regions of the same tier unlock together. At a tier's top level your XP keeps building (up to one level), but to advance you must defeat one of the tier's bosses; the other can still be fought later. The character who beats the final boss becomes a legend and can keep playing: monsters and bosses return as elites, and XP past level 32 grants Renown (★).</p>
  <h3>Damage</h3>
  <p>You strike once an hour: (level power + silver sword) × (1 + bonus). A silver sword adds damage, a steel sword a crit chance (×1.5); their power depends on the sword's level and rarity. Chains are your main power source: Steel +10%, Silver +20%, Gold +30%, Mithril +50%, Meteorite +100%. ${MULTI_CHAIN_TXT()} Chain, card link and bane bonuses simply add up; there is no cap. Swords come at your level; raise their level with crowns and scraps up to your own.</p>
  <h3>The hunt (idle)</h3>
  <p>Your character fights the contract's monster continuously, even while the app is closed. Your damage per hour comes from your level, swords, chains and card links. Monsters don't hit you on their own: being late on a quest earns you half a hit, missing it a full hit (bosses hit harder). HP regenerates about 0.3% per hour while hunting (by school: Bear 0.5%, Griffin 0.35%, Wolf 0.3%, Viper 0.25%, Cat 0.2%, Manticore 0.3%); while recovering from a defeat, 15% per hour (Bear School 30%). The contract never ends: pick another one from a board if you like (the old one's progress resets), otherwise the easiest job is taken automatically. In an emergency, drink a Swallow; Thunderbolt raises damage by 20% for 12 hours, Tawny Owl gives +10 XP on purchase, and the Dancing Star bomb hits the monster for a random 3–10 hours of your damage at the cost of 50% of your HP. Below 50% HP you are Wounded: −20% damage. If your HP hits zero you are defeated: the monster heals completely, you lose 10% of your crowns and recover until your HP is full. Cards come from habits, not from the hunt.</p>
  <h3>Penalties</h3>
  <p>Being late means half a monster hit and 12 hours "Tired" (−15% damage); missing means a full hit and 24 hours "Exhausted" (−30%); penalties stack up to −60%. White Honey is drunk automatically on a missed day: the monster can't strike and you don't become Exhausted. The Griffin School never becomes Tired or Exhausted.</p>
  <h3>Chain</h3>
  <ul>
   <li>Each successful day adds a link: <b>Iron → Steel (7) → Silver (14) → Gold (30) → Meteorite (60)</b>.</li>
   <li>Being late adds a rusty link; a second one in a row breaks the chain. A missed day breaks the chain and you drop one material.</li>
   <li><b>Atonement:</b> succeed the ${REPAIR_NEED} days after a break and your old length comes back. <b>Rest day:</b> once a week, declared in advance.</li>
  </ul>
  <h3>School and rebirth</h3>
  <p>Each character focuses on a faction: only that faction's cards and Neutral cards drop (or pick all factions). You can be reborn anytime (usually after the final boss): the character joins the School for good and a new one starts from scratch. The main quest, chain and records don't belong to the character.</p>
  <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">Got it</button></div>`);
}
function showFileMode() {
  const old = localStorage.getItem('kaermorhen_main');
  openModal(`<h2>${L('Habits of Witchers sunucuyla çalışıyor', 'Habits of Witchers runs with a server')}</h2>
    <p>${L('Uygulamayı klasördeki <b>Baslat.bat</b> ile aç. Kayıtlar <b>hofw.db</b> dosyasında.', 'Start the app with <b>Baslat.bat</b> (or <code>python3 server.py</code>) in its folder. Your data lives in <b>hofw.db</b>.')}</p>
    ${old ? `<p>${L('Bu tarayıcıda eski bir kaydın var. Baslat.bat çalışırken butona basarsan veritabanına taşınır.', 'This browser has an old save. Press the button while the server is running to move it into the database.')}</p><button class="btn big" data-act="migratefile">${L('Eski kaydımı taşı', 'Move my old save')}</button>` : ''}
    <p class="hint">${L('Sunucu açıksa', 'If the server is running')}: <a href="http://localhost:8642/">http://localhost:8642</a></p>`);
}
async function migrateFromFile() {
  const base = 'http://localhost:8642/api/state';
  try {
    const cur = await (await fetch(base)).json();
    if (cur.state && !confirm(L('Veritabanında zaten bir kayıt var. Üzerine yazılsın mı?', 'The database already has a save. Overwrite it?'))) return;
    const s = migrate(JSON.parse(localStorage.getItem('kaermorhen_main')));
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(s) });
    if (!r.ok) throw new Error();
    localStorage.setItem('kaermorhen_migrated', localStorage.getItem('kaermorhen_main'));
    localStorage.removeItem('kaermorhen_main');
    location.href = 'http://localhost:8642/';
  } catch { toast(L("Sunucuya ulaşılamadı. Önce Baslat.bat'ı çalıştır.", "Couldn't reach the server. Start it first (Baslat.bat or server.py)."), 'bad'); }
}

/* ---------- test modu paneli ---------- */
function setOffset(ms, doTick = true) { offset = ms; localStorage.setItem(OFFSET_KEY, String(ms)); if (doTick) tick(true); }
const jumpTo = (d, doTick = true) => setOffset(d.getTime() - Date.now(), doTick);
function renderDev() {
  if (!TEST || !E) return;
  let p = $('#devpanel');
  if (!p) { p = document.createElement('div'); p.id = 'devpanel'; document.body.appendChild(p); }
  const n = now(), k = E.upcoming(n), w = E.W(k);
  const local = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  p.innerHTML = `<div class="dev-head" data-act="devtoggle">🧪 TEST · ${esc(SLOT)} · ${longDate(dk(n))} ${hm(n)} ${p.dataset.min ? '▸' : '▾'}</div>
    ${p.dataset.min ? '' : `<div class="dev-body">
      <div class="row"><button class="btn sm" data-act="devday">✔ ${L('Başarılı 1 gün geçir', 'Pass 1 successful day')}</button>
        <button class="btn sm" data-act="devquest">🏆 ${L('Alışkanlığı tamamla', 'Complete the habit')}</button></div>
      <div class="row"><button class="btn sm" data-act="devgold">+500 ${L('oren', 'crowns')}</button><button class="btn sm" data-act="devxp">+500 ${L('TP', 'XP')}</button>
        <button class="btn sm" data-act="devboard">🔁 ${L('Kontratı değiştir', 'Change contract')}</button><button class="btn sm" data-act="devkill">☠ ${L('Kontratı bitir', 'Finish contract')}</button></div>
      <div class="row">${[[L('+15 dk', '+15 min'), 15], [L('+1 sa', '+1 h'), 60], [L('+6 sa', '+6 h'), 360], [L('+1 gün', '+1 day'), 1440]].map(([l, m]) => `<button class="btn sm ghost" data-act="devadd" data-m="${m}">${l}</button>`).join('')}</div>
      <div class="row">${E.isSleep() ? `<button class="btn sm ghost" data-act="devjump" data-to="prep">→ ${L('Yatış', 'Bedtime')}</button>` : ''}
        <button class="btn sm ghost" data-act="devjump" data-to="check">→ ${E.isSleep() ? L('Kalkış', 'Wake-up') : L('Görev', 'Quest')}</button>
        <button class="btn sm ghost" data-act="devjump" data-to="late">→ ${L('Gecikme', 'Late')}</button>
        <button class="btn sm ghost" data-act="devjump" data-to="miss">→ ${L('Kaçır', 'Miss')}</button></div>
      <div class="row"><input type="datetime-local" id="devTime" value="${local}"><button class="btn sm ghost" data-act="devset">${L('Git', 'Go')}</button><button class="btn sm ghost" data-act="devreal">${L('Gerçek saat', 'Real time')}</button></div>
      <div class="row"><button class="btn sm red" data-act="devreset">${L('Test kaydını sıfırla', 'Reset test save')}</button><a class="btn sm ghost" href="/tests.html" target="_blank">${L('Otomatik testler', 'Automated tests')}</a></div>
      <small class="muted">${L(`Sıradaki gün: ${longDate(k)} · aralık ${hm(w.checkStart)}–${hm(w.checkEnd)}`, `Next day: ${longDate(k)} · window ${hm(w.checkStart)}–${hm(w.checkEnd)}`)}</small>
      ${st().lastProcessed && dk(n) <= st().lastProcessed ? `<div class="dev-warn">⚠ ${L(`Zaman, işlenmiş günlerin gerisinde (son işlenen: ${longDate(st().lastProcessed)}). Bu günler zaten tamamlandığı için komut, ödül ya da ceza çıkmaz.`, `Time is behind the processed days (last processed: ${longDate(st().lastProcessed)}). Those days are already done, so there are no prompts, rewards or penalties.`)}
        <button class="btn sm" data-act="devresume">→ ${L('Kaldığın güne git', 'Go to where you left off')}</button></div>` : ''}
    </div>`}`;
}
function devJump(to) {
  const n = now(), k = E.upcoming(n), w = E.W(k);
  if (to === 'prep') jumpTo(addMin(w.prepStart, 5));
  if (to === 'check') jumpTo(n < w.checkStart ? addMin(w.checkStart, 5) : n);
  if (to === 'late') jumpTo(addMin(w.checkEnd, 10));
  if (to === 'miss') jumpTo(addMin(w.lateLimit, 1));
}
/* sıradaki günü kusursuz geçir: (uykuda) aralıkta yatış + aralıkta kalkış/görev */
function devPerfectDay() {
  // bütün alışkanlıkları sıradaki günleri için aralıklarında tamamla (zaman sadece ileri sarılır)
  const list = st().habits.map(h => ({ h, k: E.upcoming(now(), h.id) })).map(x => ({ ...x, w: E.W(x.k, x.h.id) })).sort((a, b) => a.w.checkStart - b.w.checkStart);
  let done = 0;
  for (const { h, k } of list) {
    const w = E.W(k, h.id), day = h.entries[k] || {};
    if (now() > w.checkEnd) { toast(L(`"${h.name}": bu günün aralığı geçmiş.`, `"${h.name}": this day's window has passed.`), 'bad'); continue; }
    if (h.type === 'sleep' && !day.med && now() <= w.prepEnd) { if (now() < w.prepStart) jumpTo(addMin(w.prepStart, 5), false); E.prep(h.id); }
    if (now() < w.checkStart) jumpTo(addMin(w.checkStart, 5), false);
    const r = h.type === 'count' ? E.addCount(h.count.target - (h.entries[k]?.count || 0), h.id) : E.checkIn(h.id);
    if (r.err) toast(`${h.name}: ${r.err}`, 'bad'); else done++;
  }
  tick(true);
  if (done) toast(L(`${done} alışkanlık başarıyla geçti.`, `${done} habits passed successfully.`), 'good');
}

/* ---------- olaylar ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act], #tabs button');
  if (!t) { if (e.target.id === 'modal' && E && !$('.flip') && !st().habits.some(h => h.awaitingChoice)) closeModal(); return; }
  if (t.matches('#tabs button')) { if (E) switchTab(t.dataset.tab); return; }
  const a = t.dataset.act, id = t.dataset.id;
  switch (a) {
    case 'rest': if (confirm(L('Dinlenme günü ilan edilsin mi? Bu haftaki tek hakkın, geri alınamaz.', "Declare a rest day? It's your only one this week and can't be undone."))) act(E.declareRest()); break;
    case 'prep': act(E.prep(t.dataset.h)); break;
    case 'check': act(E.checkIn(t.dataset.h)); break;
    case 'addcount': act(E.addCount(+t.dataset.n, t.dataset.h)); break;
    case 'subtoggle': act(E.toggleItem(t.dataset.item, t.dataset.h)); break;
    case 'addcountin': { const v = +$('#cnt-' + t.dataset.h)?.value; if (!v) return toast(L('Bir sayı gir.', 'Enter a number.'), 'bad'); act(E.addCount(v, t.dataset.h)); break; }
    case 'tab': switchTab(t.dataset.tab); break;
    case 'drink': act(E.drinkPotion()); break;
    case 'thunder': act(E.drinkThunder()); break;
    case 'dancing': act(E.throwDancing()); break;
    case 'queue': if (act(E.queueAdd(id)) && $('#modalBox .cboard')) showBoard(boardSel.r); break;
    case 'unqueue': act(E.queueRemove(id)); break;
    case 'habitdel': {
      const h = E.habitById(t.dataset.h); if (!h) return;
      if (!confirm(h.status === 'active' ? L(`"${h.name}" bırakılsın mı? (${h.progress}/${h.days}) Zinciri de gider; günleri geçmişte kalır.`, `Abandon "${h.name}"? (${h.progress}/${h.days}) Its chain goes too; its days stay in the history.`) : L(`"${h.name}" listeden çıkarılsın mı? Zinciri de gider.`, `Remove "${h.name}" from the list? Its chain goes too.`))) return;
      act(E.removeHabit(h.id, { keepAsSide: $('#keepSide-' + h.id)?.checked })); break;
    }
    case 'take': {
      const c = st().contract;
      if (c && c.hp < c.max && !confirm(L(`${monById(c.id).name} kontratındaki ilerleme sıfırlanacak. Değiştirilsin mi?`, `Progress on the ${monById(c.id).name} contract will be reset. Switch?`))) return;
      if (act(E.takeContract(id)) && $('#modalBox .cboard')) showBoard(boardSel.r); break;
    }
    case 'regions': showRegions(); break;
    case 'board': showBoard(+t.dataset.r); break;
    case 'boardsel': { boardSel.id = id; const box = $('#modalBox'); box.querySelectorAll('.note').forEach(n => n.classList.toggle('sel', n.dataset.id === id));
      box.querySelector('.cdetail').outerHTML = boardDetail(boardSel.r); playSound('card'); break; }
    case 'retro': {
      const hid = t.dataset.h, h = E.habitById(hid);
      const wake = $('#retroWake-' + hid)?.value || '', bed = $('#retroBed-' + hid)?.value || null, count = $('#retroCount-' + hid)?.value;
      if (h.type === 'count' ? !count : (!wake && h.type !== 'check')) return toast(h.type === 'count' ? L('Adedi gir.', 'Enter the amount.') : L('Saati gir.', 'Enter the time.'), 'bad');
      const what = h.type === 'count' ? count : wake || L('yapıldı', 'done');
      if (!confirm(L(`"${h.name}": ${longDate(t.dataset.k)} için ${what}${bed ? ` (yatış ${bed})` : ''} olarak kaydedilsin mi? Dürüstlük sana kalmış.`, `"${h.name}": record ${longDate(t.dataset.k)} as ${what}${bed ? ` (bed ${bed})` : ''}? Honesty is up to you.`))) return;
      act(E.correctMissed(t.dataset.k, { wake, bed, count }, hid)); break;
    }
    case 'weeklyok': st().pendingSummary = null; closeModal(); save(); showQueue(); break;
    case 'sound': st().settings.sound = st().settings.sound === false; commit(); if (soundOn()) playSound('achieve'); break;
    case 'soundtest': playSound('kill'); setTimeout(() => playSound('legendary'), 700); break;
    case 'pinlogin': {
      const pin = $('#pinIn').value.trim();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      if (r.ok) location.reload(); else { const j = await r.json().catch(() => ({})); showPinLogin(j.error || L('PIN yanlış.', 'Wrong PIN.')); }
      break;
    }
    case 'pinsave': {
      const pin = $('#pinSet').value.trim();
      if (!/^\d{4,8}$/.test(pin)) return toast(L('PIN 4–8 rakam olmalı.', 'The PIN must be 4–8 digits.'), 'bad');
      const r = await fetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { toast(L('PIN kaydedildi.', 'PIN saved.'), 'good'); renderAccess(); } else toast(j.error || L('Kaydedilemedi.', "Couldn't save."), 'bad');
      break;
    }
    case 'pinoff': {
      if (!confirm(L('PIN kaldırılsın mı? Telefondan erişim açık kalır, PIN sorulmaz.', "Remove the PIN? Phone access stays on and won't ask for a PIN."))) return;
      await fetch('/api/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '' }) });
      toast(L('PIN kaldırıldı.', 'PIN removed.')); renderAccess(); break;
    }
    case 'lanon': case 'lanoff': {
      const on = a === 'lanon';
      const r = await fetch('/api/lan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || L('Değiştirilemedi.', "Couldn't change it."), 'bad');
      toast(on ? (j.restart ? L('Açıldı. Baslat.bat penceresini bir kez kapatıp yeniden aç.', 'Turned on. Close the server window once and start it again.') : L('Telefondan erişim açıldı.', 'Phone access turned on.')) : L('Telefondan erişim kapatıldı.', 'Phone access turned off.'), on ? 'good' : '');
      renderAccess(); break;
    }
    case 'rerollboard': { const r = +t.dataset.r; if (act(E.rerollBoard(r))) { boardSel.id = null; showBoard(r); } break; }
    case 'rerollshop': if (confirm(L(`Demirci stoğu ${E.shopRerollCost()} oren karşılığında yenilensin mi?`, `Restock the blacksmith for ${E.shopRerollCost()} crowns?`))) act(E.rerollShop()); break;
    case 'side': act(E.completeSide(id)); break;
    case 'delside': if (confirm(L('Bu yan görev silinsin mi?', 'Delete this side quest?'))) act(E.removeSide(id)); break;
    case 'addside': act(E.addSide($('#qName').value, $('#qXp').value, $('#qGold').value)); break;
    case 'card': if (!t.closest('.flip')) showCardDetail(+t.dataset.a); break;
    case 'page': colFilter.page += +t.dataset.v; renderCollection(); break;
    case 'avatar': st().avatar = +t.dataset.a; closeModal(); commit(); toast(L('Madalyon güncellendi.', 'Medallion updated.')); break;
    case 'craft': closeModal(); act(E.craft(+t.dataset.a)); break;
    case 'buy': act(E.buy(id)); break;
    case 'buysword': { const w = swordById(id), p = w && E.shopPrice(w); if (w && confirm(L(`${w.name} (seviye ${st().level}) için ${p} oren harcansın mı?`, `Spend ${p} crowns on ${w.name} (level ${st().level})?`))) act(E.buySword(id)); break; }
    case 'equip': act(E.equipSword(id)); break;
    case 'equipbest': act(E.equipBest()); break;
    case 'craftsword': { const w = swordById(id), c = E.craftCost(id); if (w && confirm(L(`${w.name} yaptırılsın mı? ${c.gold} oren ve ${c.scraps} kırıntı.`, `Craft ${w.name}? ${c.gold} crowns and ${c.scraps} scraps.`))) act(E.craftSword(id)); break; }
    case 'dismantle': { const w = swordById(id), v = E.dismantleValue(id); if (w && confirm(L(`${w.name} eritilsin mi? ${v.gold} oren ve ${v.scraps} kırıntı geri gelir. Geri alınamaz.`, `Dismantle ${w.name}? You get back ${v.gold} crowns and ${v.scraps} scraps. This can't be undone.`))) act(E.dismantleSword(id)); break; }
    case 'upgrade': { const w = swordById(id), c = E.upgradeCost(id); if (w && c && confirm(L(`${w.name} +${c.to} olsun mu? ${c.gold} oren ve ${c.scraps} kırıntı harcanacak.`, `Upgrade ${w.name} to +${c.to}? This costs ${c.gold} crowns and ${c.scraps} scraps.`))) act(E.upgradeSword(id)); break; }
    case 'newlink': { const r = E.createLink($('#linkFac').value, $('#linkCat').value); if (act(r)) showLinkPicker(r.link.id); break; }
    case 'linkpick': showLinkPicker(t.dataset.link); break;
    case 'linkadd': { const from = E.linkOfCard(+t.dataset.a);
      if (from && from.cards.length >= LINK_SIZE && !confirm(L(`Bu kart tamamlanmış "${from.cat}" bağında. Taşırsan o bağ eksik kalır. Taşınsın mı?`, `This card is in the complete "${from.cat}" link. Moving it leaves that link incomplete. Move it?`))) break;
      if (act(E.addToLink(t.dataset.link, +t.dataset.a))) { const l = st().links.find(x => x.id === t.dataset.link); closeModal(); if (l && l.cards.length < LINK_SIZE) showLinkPicker(l.id); } break; }
    case 'unlink': if (confirm(L('Bu kart bağdan çıkarılsın mı?', 'Remove this card from the link?'))) act(E.removeFromLink(t.dataset.link, +t.dataset.a)); break;
    case 'dellink': if (confirm(L('Bu bağ silinsin mi? Kartlar koleksiyonunda kalır.', 'Delete this link? The cards stay in your collection.'))) act(E.deleteLink(t.dataset.link)); break;
    case 'questsave': if (act(E.updateQuest(readQuestForm(t.closest('.habit-edit')), t.dataset.h))) toast(L('Alışkanlık güncellendi.', 'Habit updated.'), 'good'); break;
    case 'questnew': {
      const cfg = readQuestForm(t.closest('.habit-new'));
      if (act(E.startQuest(cfg))) { toast(L('Yeni alışkanlık başladı.', 'New habit started.'), 'good'); switchTab('home'); }
      break;
    }
    case 'mastery': closeModal(); act(E.continueMastery(t.dataset.h)); break;
    case 'gonewquest': { closeModal(); const h = E.habitById(t.dataset.h); if (h) h.awaitingChoice = false; save(); switchTab('mainquest'); break; }
    case 'hallview': showHallChar(id); break;
    case 'rebirth': showRebirth(); break;
    case 'rebirthgo': {
      const newName = $('#rbName')?.value.trim() || undefined;
      if (!confirm(L(`${st().name} Okul'a eklenecek ve yeni karakter sıfırdan başlayacak. Emin misin?`, `${st().name} will join the School and a new character will start from scratch. Are you sure?`))) return;
      closeModal();
      if (act(E.rebirth({ name: newName, school: pickSchool, faction: pickFaction }))) { switchTab('home'); toast(L('Yeni bir yol başladı.', 'A new path begins.'), 'good'); }
      break;
    }
    case 'savename': st().name = $('#sName').value.trim() || st().name; commit(); toast(L('Kaydedildi.', 'Saved.')); break;
    case 'lang': {
      window.KM_LANG = t.dataset.v === 'en' ? 'en' : 'tr';
      localStorage.setItem(LANG_KEY, window.KM_LANG); document.documentElement.lang = window.KM_LANG;
      applyStatic();
      if (t.dataset.ob) showOnboarding(); else render();
      break;
    }
    case 'notify':
      if (!st().settings.notify && 'Notification' in window) Notification.requestPermission().then(p => { st().settings.notify = p === 'granted'; commit(); });
      else { st().settings.notify = false; commit(); }
      break;
    case 'changeschool':
      if (st().gold < 150) return toast(L('150 oren gerekiyor.', 'You need 150 crowns.'), 'bad');
      pickSchool = st().school;
      openModal(`<h2>${L('Okul değiştir', 'Change school')} (150 🪙)</h2>${schoolGrid()}<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close">${L('Vazgeç', 'Cancel')}</button><button class="btn" data-act="confirmschool">${L('Değiştir', 'Change')}</button></div>`);
      break;
    case 'changefaction': { const f = $('#newFaction')?.value; if (f && confirm(L('Kart odağı değişsin mi?', 'Change card focus?'))) act(E.changeFaction(f)); break; }
    case 'confirmschool': closeModal(); if (pickSchool !== st().school) act(E.changeSchool(pickSchool)); break;
    case 'pickschool': pickSchool = id; t.parentElement.querySelectorAll('.school').forEach(el => el.classList.toggle('sel', el.dataset.id === id)); break;
    case 'pickfaction': pickFaction = id; t.parentElement.querySelectorAll('.school').forEach(el => el.classList.toggle('sel', el.dataset.id === id)); break;
    case 'oath': {
      const cfg = readQuestForm($('#modalBox .qform'));
      const check = KM.validateQuest(makeQuest(cfg));
      if (check) return toast(check, 'bad');
      const s = newState({ name: $('#obName').value.trim() || 'Witcher', school: pickSchool, faction: pickFaction === 'all' ? null : pickFaction, quest: cfg, nowDate: now() });
      E = createEngine(s, { now }); E.init();
      closeModal(); commit(); break;
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(st(), null, 1)], { type: 'application/json' });
      const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `${L('hofw-yedek', 'hofw-backup')}-${dk(now())}.json`; el.click(); break;
    }
    case 'rules': showRules(); break;
    case 'reset': { const word = L('SIFIRLA', 'RESET'); if (confirm(L('Tüm ilerleme silinecek. Emin misin?', 'All progress will be deleted. Are you sure?')) && prompt(L(`Onay için ${word} yaz`, `Type ${word} to confirm`)) === word) { E = null; currentTab = 'home'; showOnboarding(); } break; }
    case 'migratefile': migrateFromFile(); break;
    case 'retry': location.reload(); break;
    case 'flip': {
      if (!t.classList.contains('open')) { const r = JSON.parse($('#modalBox').dataset.cards || '[]')[+t.dataset.i]?.r; playSound(r === 'Legendary' ? 'legendary' : r === 'Epic' ? 'rare' : 'card'); }
      t.classList.add('open'); flipInfo(); break;
    }
    case 'flipall': {
      const rs = JSON.parse($('#modalBox').dataset.cards || '[]').map(c => c.r);
      playSound(rs.includes('Legendary') ? 'legendary' : rs.includes('Epic') ? 'rare' : 'card');
      document.querySelectorAll('.flip').forEach(f => f.classList.add('open')); flipInfo(); break;
    }
    case 'closereveal': closeModal(); render(); showQueue(); break;
    case 'skipreveals': E.ev.reveals.length = 0; closeModal(); render(); showQueue(); break;
    case 'close': closeModal(); showQueue(); break;
    // test modu
    case 'devtoggle': { const p = $('#devpanel'); if (p.dataset.min) delete p.dataset.min; else p.dataset.min = '1'; renderDev(); break; }
    case 'devday': devPerfectDay(); break;
    case 'devquest': act(E.dev.completeQuest()); break;
    case 'devgold': act(E.dev.addGold(500)); break;
    case 'devxp': act(E.dev.addXp(500)); break;
    case 'devboard': act(E.dev.rerollBoard()); break;
    case 'devkill': act(E.dev.killContract()); break;
    case 'devadd': setOffset(offset + +t.dataset.m * 60000); break;
    case 'devjump': devJump(t.dataset.to); break;
    case 'devset': { const v = $('#devTime').value; if (v) jumpTo(new Date(v)); break; }
    case 'devreal':
      if (st().lastProcessed && dk(new Date()) <= st().lastProcessed && !confirm(L('Gerçek saat, test kaydında işlenmiş günlerin gerisinde kalıyor; o günlerde komut, ödül ya da ceza çıkmaz. Yine de dönülsün mü?', 'Real time is behind the days already processed in the test save; those days give no prompts, rewards or penalties. Go back anyway?'))) return;
      setOffset(0); break;
    case 'devresume': jumpTo(new Date(fromKey(addDays(st().lastProcessed, 1)).getTime() + 12 * 3600000)); break;
    case 'devreset':
      if (!confirm(L('Test kaydı silinsin mi? (Gerçek kaydına dokunulmaz.)', "Delete the test save? (Your real save isn't touched.)"))) return;
      await fetch(API, { method: 'DELETE' });
      localStorage.removeItem(OFFSET_KEY); offset = 0; E = null; $('#devpanel')?.remove(); closeModal(); showOnboarding();
      break;
  }
});
document.addEventListener('change', e => {
  const f = e.target.dataset?.f;
  if (f) { colFilter[f] = e.target.value; colFilter.page = 0; renderCollection(); }
  if (e.target.id === 'linkFac') { linkFaction = e.target.value; renderLinks(); }
  if (e.target.dataset?.q === 'type') {
    const form = e.target.closest('.qform'); form.dataset.qtype = e.target.value;
    form.querySelectorAll('.qsec').forEach(sec => { sec.hidden = !sec.dataset.t.split(' ').includes(e.target.value); });
  }
  if (e.target.id === 'importFile' && e.target.files[0]) {
    e.target.files[0].text().then(txt => {
      try {
        const data = JSON.parse(txt);
        if (!data.days) throw 0;
        if (!confirm(L('Mevcut ilerlemenin üzerine yazılacak. Devam?', 'This will overwrite your current progress. Continue?'))) return;
        E = createEngine(migrate(data), { now }); E.processPending(); commit(); toast(L('Yedek yüklendi.', 'Backup loaded.'), 'good');
      } catch { toast(L('Geçersiz yedek dosyası.', 'Invalid backup file.'), 'bad'); }
    });
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pinIn') $('[data-act=pinlogin]')?.click(); });
document.addEventListener('input', e => {
  if (e.target.dataset?.f === 'q') {
    colFilter.q = e.target.value; colFilter.page = 0;
    clearTimeout(window.__qT); window.__qT = setTimeout(() => {
      renderCollection();
      const inp = $('#collectionPanel [data-f="q"]'); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 250);
  }
});

/* ---------- döngü ---------- */
let lastPhase = '';
/* uzun aradan sonra: sen yokken av özeti */
function showOffline() {
  const o = E?.ev.offline; if (!o) return;
  E.ev.offline = null;
  const parts = [L(`${o.kills} canavar`, `${o.kills} monsters`), L(`+${o.gold} oren`, `+${o.gold} crowns`)];
  if (o.levels) parts.push(L(`+${o.levels} seviye`, `+${o.levels} levels`));
  if (o.potions) parts.push(L(`${o.potions} Swallow içildi`, `${o.potions} Swallows drunk`));
  if (o.defeats) parts.push(L(`${o.defeats} yenilgi`, `${o.defeats} defeats`));
  const msg = L(`Sen yokken (${fmtDur(o.minutes * 60000)}): ${parts.join(', ')}.`, `While you were away (${fmtDur(o.minutes * 60000)}): ${parts.join(', ')}.`);
  if (modalOpen()) toast(msg, 'good');
  else openModal(`<h2>🌙 ${L('Sen yokken', 'While you were away')}</h2><p>${msg}</p><p class="muted">${L('Ayrıntılar günlükte.', 'Details are in the journal.')}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">${L('Devam', 'Continue')}</button></div>`);
}
function tick(force = false) {
  if (!E) return;
  const n = now();
  const changed = E.processPending();
  const ph = st().habits.map(h => { const k = E.upcoming(n, h.id); return k + E.phase(k, n, h.id); }).join('|');
  if (force || changed || ph !== lastPhase) { lastPhase = ph; commit(); }
  else if (E.ev.combat) { save(); renderTop(); if (currentTab === 'home') { renderHunt(); renderLog(); } }
  E.ev.combat = null;
  showOffline();
  const clock = $('#clock'); if (clock) clock.textContent = hm(n);
  checkRemote();
  if (st().settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    const notified = st().notified;
    const fire = (key, when, title, body) => { if (!notified[key] && n >= when && n - when < 10 * 60000) { notified[key] = 1; save(); new Notification(title, { body }); } };
    for (const h of st().habits) {
      if (h.type !== 'sleep' && h.type !== 'window') continue;      // gün boyu açık türlerde bildirim yok
      const k = E.upcoming(n, h.id), w = E.W(k, h.id), id = h.id.slice(0, 4);
      if (h.type === 'sleep') fire(`bed${id}${k}`, addMin(w.prepStart, -30), L('Yatış aralığı yaklaşıyor', 'Bedtime window is coming'), L(`30 dk sonra yatış aralığı başlıyor (${hm(w.prepStart)}–${hm(w.prepEnd)}).`, `Your bedtime window starts in 30 min (${hm(w.prepStart)}–${hm(w.prepEnd)}).`));
      fire(`check${id}${k}`, w.checkStart, h.type === 'sleep' ? L('Günaydın, witcher', 'Good morning, witcher') : h.name, `${L('Aralık', 'Window')}: ${hm(w.checkStart)}–${hm(w.checkEnd)}.`);
    }
  }
}
/* index.html'deki sabit metinler */
const STATIC_TABS = { home: ['Kontrat', 'Contract'], mainquest: ['Alışkanlıklar', 'Habits'], quests: ['Yan Görevler', 'Side Quests'], collection: ['Koleksiyon', 'Collection'],
  links: ['Kart Bağları', 'Card Links'], bestiary: ['Bestiary', 'Bestiary'], shop: ['Tüccar', 'Merchant'], achievements: ['Başarımlar', 'Achievements'],
  hall: ['Okul', 'School'], history: ['Kayıtlar', 'Records'], settings: ['Ayarlar', 'Settings'] };
function applyStatic() {
  document.querySelectorAll('#tabs button').forEach(b => { const x = STATIC_TABS[b.dataset.tab]; if (x) b.textContent = L(...x); });
  const stat = (sel, label, title) => { const el = $(sel)?.closest('.stat'); if (!el) return; el.querySelector('small').textContent = L(...label); if (title) el.title = L(...title); };
  stat('#lvl', ['Seviye', 'Level'], ['Seviye', 'Level']);
  stat('#gold', ['Oren', 'Crowns'], ['Altın (oren)', 'Gold (crowns)']);
  stat('#scraps', ['Kırıntı', 'Scraps'], ['Kırıntı (tekrar kartlardan gelir)', 'Scraps (from duplicate cards)']);
  stat('#chainLen', ['Zincir', 'Chain']);
  stat('#swallow', ['Swallow', 'Swallow'], ['Swallow: can iksiri. Savaşta canın %35\'in altına inince kendiliğinden içilir.', 'Swallow: healing potion. Drunk automatically in battle below 35% HP.']);
  const lh = $('#logPanel h2'); if (lh) lh.textContent = L('Günlük', 'Journal');
}
async function init() {
  applyStatic();
  if (location.protocol === 'file:') return showFileMode();
  if (!CARDS.length) return openModal(`<h2>${L('Kart verisi bulunamadı', 'Card data not found')}</h2><p>${L('cards.js dosyası yok. Sunucu ilk açılışta indirmeyi dener; internet bağlantını kontrol edip yeniden başlat ya da şunu çalıştır:', "cards.js is missing. The server tries to download it on first start; check your internet connection and restart it, or run:")}</p><pre>py -3 tools/fetch_cards.py</pre><button class="btn" data-act="retry">${L('Tekrar dene', 'Try again')}</button>`);
  let s;
  try { s = await load(); }
  catch (e) {
    if (e.auth) return showPinLogin();
    return openModal(`<h2>${L('Sunucuya ulaşılamadı', "Couldn't reach the server")}</h2><p>${L('Baslat.bat çalışıyor mu? Pencereyi kapattıysan yeniden aç.', 'Is the server (Baslat.bat / server.py) running? If you closed its window, start it again.')}</p><button class="btn" data-act="retry">${L('Tekrar dene', 'Try again')}</button>`);
  }
  if (!s) return showOnboarding();
  E = createEngine(s, { now });
  E.processPending();
  save();   // taşıma (migrate) olduysa yeni yapıyı kaydet
  commit();
  showOffline();
}
init();
setInterval(() => tick(), 10000);
setInterval(() => { const c = $('#clock'); if (c && E) c.textContent = hm(now()); }, 1000);
})();
