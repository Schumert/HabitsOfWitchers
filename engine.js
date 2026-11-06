/* Habits of Witchers — oyun motoru (DOM yok).
 * Arayüz (app.js) ve testler (tests.js) aynı motoru kullanır:
 *   const E = KM.createEngine(state, { now: () => new Date(), random: Math.random });
 * Eylemler { ok: true } ya da { err: 'mesaj' } döndürür. Kart açılışları E.ev.reveals, bildirimler E.ev.toasts kuyruğuna düşer.
 *
 * Kayıt iki parçalıdır:
 *  - Genel (karakterden bağımsız): ana görev, zincir, günler (kayıtlar), yan görevler, günlük, Okul salonu (hall).
 *  - Karakter: seviye, TP, oren, koleksiyon, kart bağları, kılıçlar, avlanan canavarlar, bölge, kontrat tabelası.
 *    Yeniden doğuşta karakter Okul salonuna eklenir ve bu kısım sıfırlanır.
 */
(function (root) {
'use strict';

/* ---------- dil: L('Türkçe', 'English'). Dil cihaz başına seçilir (app.js, localStorage). ---------- */
const lang = () => (root.KM_LANG === 'en' ? 'en' : 'tr');
const L = (tr, en) => (lang() === 'en' ? en : tr);
// nesnenin metin alanlarını o anki dile göre okunur yapar: bi(o, { name: 'English name' })
const bi = (o, en) => {
  for (const k of Object.keys(en || {})) { const tr = o[k], e = en[k]; Object.defineProperty(o, k, { get: () => L(tr, e), enumerable: true, configurable: true }); }
  return o;
};
// dile göre değişen dizi (DAYS[3], MONTHS.length ...)
const biArr = (tr, en) => new Proxy([], { get: (_, p) => { const a = L(tr, en); const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; } });

/* ---------- zaman yardımcıları ---------- */
const pad = n => String(n).padStart(2, '0');
const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dk(d); };
const at = (k, t) => { const [h, m] = t.split(':').map(Number); const d = fromKey(k); d.setHours(h, m, 0, 0); return d; };
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mondayOf = k => { const d = fromKey(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dk(d); };
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const DAYS = biArr(['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MONTHS = biArr(['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const longDate = k => { const d = fromKey(k); return L(`${d.getDate()} ${MONTHS[d.getMonth()]} ${DAYS[d.getDay()]}`, `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`); };
const uid = () => Math.random().toString(36).slice(2, 10);
const hashStr = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
/* Türkçe saat ekleri: sfx('08:30','da') -> 08:30'da, sfx('08:00','e') -> 08:00'e */
const NUMW = n => { const u = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'], t = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli']; return n % 10 ? u[n % 10] : (n ? t[n / 10] : 'sıfır'); };
const sfx = (time, kind) => {
  const [h, m] = time.split(':').map(Number), w = m ? NUMW(m) : NUMW(h), fr = /[eiöü][^aeıioöuü]*$/.test(w);
  if (kind === 'da') return `${time}'${/[fstkçşhp]$/.test(w) ? 't' : 'd'}${fr ? 'e' : 'a'}`;
  return `${time}'${/[aeıioöuü]$/.test(w) ? 'y' : ''}${fr ? 'e' : 'a'}`;
};
/* isme yönelme eki: Grifon'a, Wight'e, Bruxa'ya */
const dat = name => { const v = (name.match(/[aeıioöuü](?=[^aeıioöuü]*$)/i) || ['e'])[0].toLowerCase(); const back = 'aıou'.includes(v); return /[aeıioöuü]$/i.test(name) ? (back ? "'ya" : "'ye") : (back ? "'a" : "'e"); };

/* ---------- sabit veriler ---------- */
const ART = (a, q = 'medium') => `https://gwent.one/image/gwent/assets/card/art/${q}/${a}.jpg`;
const CARDS = root.GWENT_CARDS || [];
const CARD_BY_ART = Object.fromEntries(CARDS.map(c => [c.a, c]));
const RAR = ['Common', 'Rare', 'Epic', 'Legendary'];
const RAR_TR = bi({ Common: 'Sıradan', Rare: 'Nadir', Epic: 'Destansı', Legendary: 'Efsanevi' }, { Common: 'Common', Rare: 'Rare', Epic: 'Epic', Legendary: 'Legendary' });
const SCRAP = { Common: 5, Rare: 10, Epic: 25, Legendary: 50 };
const CRAFT = { Common: 30, Rare: 80, Epic: 200, Legendary: 500 };
const FACTIONS = ['Monster', 'Nilfgaard', 'Northern Realms', 'Scoiatael', 'Skellige', 'Syndicate'];
// fraksiyonların görünen adları (özel isimler çevrilmez)
const FACTION_TR = { Monster: 'Monsters', Nilfgaard: 'Nilfgaard', 'Northern Realms': 'Northern Realms', Scoiatael: "Scoia'tael", Skellige: 'Skellige', Syndicate: 'Syndicate', Neutral: 'Neutral' };
// açıklama metni canavarın Gwent kartının flavor'ından gelir (cards.js indirilen veridir, depoda yoktur; toplanamayan kartların metni GWENT_EXTRA'da)
const MONSTERS = (root.KM_MONSTERS || []).map(m => bi({ ...m, lore: m.lore || CARD_BY_ART[m.art]?.fl || (root.GWENT_EXTRA || {})[m.art] || '' }, m.name_en ? { name: m.name_en } : {}));
const CLASSES = root.KM_CLASSES || {};
const CLASS_EN = { Beast: 'Beasts', Relict: 'Relicts', Insectoid: 'Insectoids', Ogroid: 'Ogroids', Vampire: 'Vampires', Necrophage: 'Necrophages', Specter: 'Specters', Plant: 'Plants', Dragon: 'Draconids', Human: 'Cursed Ones', Construct: 'Constructs' };
Object.entries(CLASSES).forEach(([k, c]) => bi(c, { tr: CLASS_EN[k] || k }));
const REGIONS = root.KM_REGIONS || [{ id: 'all', name: 'Dünya', min: 1, max: 30, boss: null }];
/* kademeler: her kademe 4 seviye (0 → 1–4 … 7 → 29–32). Aynı kademedeki bölgeler birlikte açılır.
 * Veride tier yoksa (eski biçim) bölgenin sırası kademesidir. */
REGIONS.forEach((g, i) => { if (g.tier == null) g.tier = i; g.min = g.tier * 4 + 1; g.max = g.tier * 4 + 4; });
REGIONS.forEach(g => bi(g, { ...(g.name_en ? { name: g.name_en } : {}), ...(g.desc_en ? { desc: g.desc_en } : {}) }));
const BAND_COUNT = Math.max(1, ...REGIONS.map(g => g.tier + 1));
const bandRegions = b => REGIONS.map((g, i) => i).filter(i => REGIONS[i].tier === b);
const regionTier = r => REGIONS[r]?.tier ?? 0;
const monById = id => MONSTERS.find(m => m.id === id) || MONSTERS[0];
const monImg = (m, q = 'medium') => m.art ? ART(m.art, q) : m.img;
const cardCats = c => (c.c || '').split(',').map(x => x.trim()).filter(Boolean);
const SWORDS = root.KM_SWORDS || [];
const SWORD_TIERS = root.KM_SWORD_TIERS || {};
const SWORD_TIER_EN = { 1: 'Common', 2: 'Masterwork', 3: 'Magic', 4: 'Legendary', 5: 'School set', 6: 'Ancient' };
Object.entries(SWORD_TIERS).forEach(([k, t]) => bi(t, { name: SWORD_TIER_EN[k] || t.name }));
const swordById = id => SWORDS.find(w => w.id === id) || null;

const SCHOOLS = {
  wolf:    { name: 'Wolf School',    art: 1476, desc: 'Dengeli yol. Zincirindeki her halka günlük ödülü %5 artırır (en çok +%50).' },
  cat:     { name: 'Cat School',     art: 2342, desc: 'Kumarbaz. Canavar ödülleri ×1.3, ama aldığın hasar ×1.5.' },
  bear:    { name: 'Bear School',    art: 2352, desc: 'Dayanıklı. 140 can, aldığın hasar ×0.6, ama ödüller ×0.85.' },
  griffin: { name: 'Griffin School', art: 2362, desc: 'Disiplinli. Aralıkta yatış (meditasyon) sabah ödülünü ×1.5 yerine ×1.8 yapar.' },
  viper:   { name: 'Viper School',   art: 2312, desc: 'Dakik. Aralığın ilk 10 dakikasında (ya da daha erken) yaparsan ödül ×1.4.' },
};
const SCHOOL_EN = {
  wolf: 'Balanced. Every link in your chain raises daily rewards by 5% (up to +50%).',
  cat: 'Gambler. Monster rewards ×1.3, but damage taken ×1.5.',
  bear: 'Tough. 140 HP, damage taken ×0.6, but rewards ×0.85.',
  griffin: 'Disciplined. Going to bed in your window (meditation) makes the morning reward ×1.8 instead of ×1.5.',
  viper: 'Punctual. Do it in the first 10 minutes of the window (or earlier) for ×1.4 rewards.',
};
Object.entries(SCHOOL_EN).forEach(([k, d]) => bi(SCHOOLS[k], { desc: d }));
// zincir: mult = günlük ödül çarpanı, dmg = hasar bonusu (%)
const TIERS = [
  { name: 'Demir',   at: 0,  mult: 1,    dmg: 0,  color: '#7d838b', min: null },
  { name: 'Çelik',   at: 7,  mult: 1.1,  dmg: 5,  color: '#a9b8c8', min: 'Rare' },
  { name: 'Gümüş',   at: 14, mult: 1.2,  dmg: 10, color: '#eef3f8', min: 'Epic' },
  { name: 'Altın',   at: 30, mult: 1.35, dmg: 15, color: '#e0b44c', min: 'Legendary' },
  { name: 'Göktaşı', at: 60, mult: 1.5,  dmg: 20, color: '#d0673a', min: 'Legendary' },
];
['Iron', 'Steel', 'Silver', 'Gold', 'Meteorite'].forEach((n, i) => bi(TIERS[i], { name: n }));
const tierOf = len => { let t = 0; TIERS.forEach((x, i) => { if (len >= x.at) t = i; }); return t; };
const REPAIR_NEED = 2;
const QUEST_MIN = 14, QUEST_MAX = 60;
const MASTERY_MULT = 0.5, MASTERY_DMG = 0.75;

/* ---------- denge ayarları (simülasyonla ayarlandı: tests.html)
 * Simülasyon (yükseltmeli): kusursuz uyku ~60 günde, gerçekçi (%70) ~90 günde, günlük görev (%80) ~75 günde son seviye. ---------- */
const MAX_LEVEL = 32;                                            // 8 bölge × 4 seviye
const xpNeed = l => 100 + 6 * (l - 1);                          // seviye başına gereken TP
const DMG = { wake: 20, prep: 10, daily: 30, side: 3 };          // başarı başına canavara temel hasar
const DAY_XP = { wake: 5, prep: 2, daily: 6, late: 1 };           // günlük TP (asıl TP canavarlardan gelir)
const DAY_GOLD = { wake: 5, prep: 2, daily: 6 };                  // günlük oren (asıl oren canavar ödülünden gelir)
const CARDS_PER = { first: 2, next: 1, prepBonus: 1, levelUp: 3, kill: 2, boss: 5 };   // günün ilk başarısı 2, sonrakiler 1 kart
/* Bölge başına EN YÜKSEK değerler. Her canavar bunların str (0.55–1) katını alır: canı az olanın ödülü de azdır.
 * Can, öldürme süresi hedefinden hesaplandı (kusursuz + yükseltmeli oyuncu): White Orchard 1–2 gün,
 * Toussaint'te en güçlüsü en fazla 5 gün, arası kademeli. Yükseltmesiz oyuncu son bölgede ~%40 daha yavaş. */
/* ---------- idle savaş ----------
 * Av sürekli akar (uygulama kapalıyken de; açılınca geçen süre STEP_MIN dakikalık adımlarla hesaplanır).
 * Oyuncu: seviyeye göre temel hasar/saat (powerAt) × hasar bonusu × ceza; can seviyeyle artar (hpAt).
 * Canavar değerleri kademe başına hedef av süresinden türetilir: kademe seviyesindeki ortalama donanımlı oyuncu
 * str 1 bir canavarı BAND_HOURS saatte keser. Kademe başına hedef gün: TIER_DAYS (toplam ~5 ay). */
const STEP_MIN = 5;
const XP_SCALE = 0.8;                                     // simülasyonla ayarlandı: gerçekçi oyuncu ~5 ay
const FAIL_HIT = 0.3;                                      // str 1 normal canavar, kesilene kadar oyuncunun can barının bu kadarını vurur
const BAND_HOURS = [6, 8, 10, 12, 14, 16, 18, 22];
const REF_BONUS = [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.05];        // kademe seviyesinde beklenen hasar bonusu
const TIER_DAYS = [10, 14, 16, 18, 20, 22, 24, 26];                    // kademe başına hedef gün
const powerAt = L => 20 * Math.pow(1.11, L - 1);                       // seviyeye göre temel hasar / saat
const hpAt = L => Math.round(100 + 12 * (L - 1));                      // seviyeye göre en yüksek can
const REG = (() => {
  const OLD_GOLD = [55, 75, 100, 130, 170, 220, 280, 350];
  const reg = { hp: [], gold: [], xp: [], hit: [] };
  for (let t = 0; t < 8; t++) {
    const L = t * 4 + 2.5, dph = powerAt(L) * (1 + REF_BONUS[t]);
    const killsPerDay = 24 / (BAND_HOURS[t] * 0.8 * 1.25);              // ortalama güç 0.8, %25 dinlenme payı
    reg.hp.push(Math.round(dph * BAND_HOURS[t]));
    reg.hit.push(Math.round(FAIL_HIT * hpAt(L)));                         // kaçırılan günde vuruş: kademe seviyesindeki canın FAIL_HIT kadarı
    reg.xp.push(Math.round(XP_SCALE * 4 * (100 + 6 * (L - 1)) / (TIER_DAYS[t] * killsPerDay)));
    reg.gold.push(Math.round(OLD_GOLD[t] / killsPerDay * 1.2));
  }
  return reg;
})();
const BOSS = { hp: 2.5, gold: 2.5, xp: 1.5, hit: 1.5 };     // boss başarısızlıkta daha sert vurur
const POTION = { cap: 10, heal: L => 40 + 3 * L, price: L => 40 + 2 * L };   // Swallow (can iksiri): canı sadece bu doldurur
const REST = { regen: 0.25, resume: 0.9, monHeal: 0.02 };    // dinlenirken saatte canın %25'i; %90'da ava dönülür; canavar saatte %2 toparlanır
const DEFEAT = { hours: 6, monHeal: 0.25 };                 // yenilince 6 saat toparlanma; canavar canının %25'ini geri kazanır
const EFFECTS = { tired: { pct: 15, hours: 12 }, exhausted: { pct: 30, hours: 24 } };
const EFFECT_CAP = 60;
const BURST = { habit: 1, prep: 0.5, side: 0.25 };          // başarı anında kaç saatlik hasar vurulur
const HONEY_MAX = 3;
const CRIT_EVENT = 0.1;                                      // kritik an: adım başına şans = kritik% × 0.1
const HEAVY = { chance: 0.05, hours: 0.75 };                 // canavarın ağır darbesi: adım başına %5, 45 dakikalık hasar      // boss TP'si normal: asıl ödülü yeni bölge          // boss: bölgenin en güçlüsünün katları
const BOARD_SIZE = 5;                                               // haftalık kontrat tabelasındaki canavar sayısı
const MON_HEAL = 0.05;
const FAINT_GOLD = 0.2, FAINT_GOLD_MAX = 300;                       // bayılınca oren'in %20'si (en çok 300) gider
const CRIT_MULT = 1.5;
/* hasar bonusu tavan yerine azalan getiriyle işler: [eşik, bu dilimin geçerlilik oranı]
 * ör. ham +%120 → 60 + 60×0.75 = +%105 */
const BONUS_STEPS = [[60, 1], [120, 0.75], [180, 0.45], [Infinity, 0.2]];
function effectiveBonus(raw) {
  let left = raw, prev = 0, eff = 0;
  for (const [to, rate] of BONUS_STEPS) { const part = Math.max(0, Math.min(left, to - prev)); eff += part * rate; left -= part; prev = to; if (left <= 0) break; }
  return Math.round(eff * 10) / 10;
}
/* kılıç güçlendirme: +1..+5. Her kademe gümüşe +%6 hasar, çeliğe +%2 kritik verir.
 * Bedel: kılıç fiyatının katı kadar oren + kırıntı (tekrar gelen kartlardan) */
const UPGRADE = { max: 5, silver: 6, steel: 2, goldMult: [0.25, 0.4, 0.6, 0.85, 1.2], scraps: [10, 20, 35, 50, 75] };
const LINK_SIZE = 5, LINK_BONUS = 3, LINK_MAX = 10;
const SHOP_DAILY = 5;
/* yenileme bedelleri: demirci aynı gün her yenilemede 100 oren artar; kontrat tabelası ucuz, bölgeyle ve aynı haftadaki tekrarla artar */
const REROLL = { shop: 100, boardBase: 20, boardPerRegion: 10 };
const BANE = 15;                                                    // kılıcın bane sınıfındaki canavara ek ham hasar (%)
/* güçlendirme aktarımı: hedef kılıcın fiyatının %25'i. eritme: fiyatın ve güçlendirme orenin %20'si, kırıntının %50'si geri gelir */
const TRANSFER_FEE = 0.25, DISMANTLE = { gold: 0.2, scraps: 0.5 };
const DIAGRAM_FROM_REGION = 3;                                     // 4. kademeden (seviye 13–16: Flotsam, Novigrad) itibaren her boss bir okul seti şeması düşürür
const SET_CRAFT_SCRAPS = 100;
const RETRO_HOURS = 24;
/* son oyun (efsane olduktan sonra): kesilmiş canavarlar ve bölge boss'ları elit olarak geri döner; 32'den sonraki TP Ün (★) olur */
const ELITE = { hp: 1.3, gold: 1.25, xp: 1.25 };
const FAME = { gold: 75 };                                             // kaçırılan gün, kaçırıldı sayıldıktan sonra bu kadar saat içinde sonradan işlenebilir
/* Okul mirası: Okul'daki her efsane karakter yeni karakterlere +%3 oren (en çok %15), her karakter +%1 TP (en çok %10) */
const LEGACY = { goldPerLegend: 3, goldMax: 15, xpPerChar: 1, xpMax: 10 };
/* Başarımlar: genel (karakterden bağımsız), bir kez açılır. h = o anki sayımlar (createEngine içinde hesaplanır) */
const ACHIEVEMENTS = [
  { id: 'first-dawn', group: 'Alışkanlık', icon: '🌅', name: 'İlk Şafak', desc: 'İlk başarılı gün.', gold: 25, test: h => h.success >= 1, prog: h => [h.success, 1] },
  { id: 'rest', group: 'Alışkanlık', icon: '⏸', name: 'Dinlen, Witcher', desc: 'İlk dinlenme gününü önceden ilan et.', gold: 25, test: h => h.rests >= 1 },
  { id: 'chain-7', group: 'Alışkanlık', icon: '⛓', name: 'Çelik Zincir', desc: '7 halkalık zincir.', gold: 50, test: h => h.chainBest >= 7, prog: h => [h.chainBest, 7] },
  { id: 'chain-14', group: 'Alışkanlık', icon: '⛓', name: 'Gümüş Zincir', desc: '14 halkalık zincir.', gold: 100, test: h => h.chainBest >= 14, prog: h => [h.chainBest, 14] },
  { id: 'chain-30', group: 'Alışkanlık', icon: '⛓', name: 'Altın Zincir', desc: '30 halkalık zincir.', gold: 200, card: 'Epic', test: h => h.chainBest >= 30, prog: h => [h.chainBest, 30] },
  { id: 'chain-60', group: 'Alışkanlık', icon: '☄', name: 'Göktaşı', desc: '60 halkalık zincir.', gold: 400, card: 'Legendary', test: h => h.chainBest >= 60, prog: h => [h.chainBest, 60] },
  { id: 'repair', group: 'Alışkanlık', icon: '⚒', name: 'Kefaret', desc: 'Kırılan zinciri kefaretle onar.', gold: 75, test: h => h.repairs >= 1 },
  { id: 'perfect-week', group: 'Alışkanlık', icon: '🗓', name: 'Kusursuz Hafta', desc: 'Pazartesiden pazara 7 günün hepsi başarılı.', gold: 150, test: h => h.perfectWeek },
  { id: 'bedtime-30', group: 'Alışkanlık', icon: '🧘', name: 'Gece Kuşu Evcilleşti', desc: '30 kez yatış aralığında meditasyon.', gold: 150, test: h => h.medOnTime >= 30, prog: h => [h.medOnTime, 30] },
  { id: 'days-50', group: 'Alışkanlık', icon: '☀', name: 'Elli Sabah', desc: '50 başarılı gün.', gold: 150, test: h => h.success >= 50, prog: h => [h.success, 50] },
  { id: 'days-100', group: 'Alışkanlık', icon: '☀', name: 'Yüz Sabah', desc: '100 başarılı gün.', gold: 300, card: 'Epic', test: h => h.success >= 100, prog: h => [h.success, 100] },
  { id: 'days-250', group: 'Alışkanlık', icon: '🌞', name: 'Usta Witcher', desc: '250 başarılı gün.', gold: 600, card: 'Legendary', test: h => h.success >= 250, prog: h => [h.success, 250] },
  { id: 'quest-1', group: 'Alışkanlık', icon: '🏆', name: 'Alışkanlık Edinildi', desc: 'İlk ana görevini tamamla.', gold: 150, test: h => h.questsDone >= 1 },
  { id: 'quest-3', group: 'Alışkanlık', icon: '🏆', name: 'Üç Alışkanlık', desc: '3 ana görev tamamla.', gold: 400, card: 'Legendary', test: h => h.questsDone >= 3, prog: h => [h.questsDone, 3] },
  { id: 'first-blood', group: 'Av', icon: '🗡', name: 'İlk Kontrat', desc: 'İlk canavarını öldür.', gold: 25, test: h => h.kills >= 1 },
  { id: 'kills-25', group: 'Av', icon: '🗡', name: 'Avcı', desc: '25 canavar (tüm karakterler).', gold: 150, test: h => h.kills >= 25, prog: h => [h.kills, 25] },
  { id: 'kills-100', group: 'Av', icon: '⚔', name: 'Canavar Avcısı', desc: '100 canavar (tüm karakterler).', gold: 500, card: 'Legendary', test: h => h.kills >= 100, prog: h => [h.kills, 100] },
  { id: 'first-boss', group: 'Av', icon: '👑', name: 'Bölge Bekçisi', desc: 'İlk bölge boss\'unu yen.', gold: 100, test: h => h.bosses >= 1 },
  { id: 'region-clear', group: 'Av', icon: '🧹', name: 'Temizlik', desc: 'Bir bölgedeki bütün canavarları (boss dahil) tek karakterle öldür.', gold: 300, card: 'Epic', test: h => h.regionCleared },
  { id: 'legend', group: 'Av', icon: '🐺', name: 'Efsane', desc: 'Son boss\'u yen.', gold: 500, card: 'Legendary', test: h => h.legend },
  { id: 'first-sword', group: 'Teçhizat', icon: '🗡', name: 'İlk Kılıç', desc: 'İlk kılıcını edin.', gold: 25, test: h => h.swords >= 1 },
  { id: 'swords-10', group: 'Teçhizat', icon: '🛡', name: 'Silahlık', desc: 'Aynı anda 10 kılıca sahip ol.', gold: 150, test: h => h.swords >= 10, prog: h => [h.swords, 10] },
  { id: 'plus-five', group: 'Teçhizat', icon: '⚒', name: 'Usta Demirci', desc: 'Bir kılıcı +5\'e çıkar.', gold: 200, test: h => h.maxUp >= 5, prog: h => [h.maxUp, 5] },
  { id: 'school-set', group: 'Teçhizat', icon: '📜', name: 'Okulun Mirası', desc: 'Kendi okulunun bir set kılıcını yaptır.', gold: 200, test: h => h.ownSchoolSet },
  { id: 'legendary-card', group: 'Kartlar', icon: '🃏', name: 'Efsanevi Kart', desc: 'İlk efsanevi kartını bul.', gold: 50, test: h => h.legendaryCards >= 1 },
  { id: 'cards-150', group: 'Kartlar', icon: '🃏', name: 'Koleksiyoncu', desc: 'Bir karakterle 150 farklı kart.', gold: 200, test: h => h.uniqueCards >= 150, prog: h => [h.uniqueCards, 150] },
  { id: 'links-5', group: 'Kartlar', icon: '🔗', name: 'Bağ Ustası', desc: '5 tamamlanmış kart bağı.', gold: 150, test: h => h.links >= 5, prog: h => [h.links, 5] },
  { id: 'links-10', group: 'Kartlar', icon: '🔗', name: 'Bağların Efendisi', desc: '10 tamamlanmış kart bağı.', gold: 300, card: 'Epic', test: h => h.links >= 10, prog: h => [h.links, 10] },
  { id: 'rebirth', group: 'Okul', icon: '♻', name: 'Yeniden Doğuş', desc: 'İlk kez yeniden doğ.', gold: 200, test: h => h.hall >= 1 },
];
const ACH_GROUP_EN = { 'Alışkanlık': 'Habit', 'Av': 'Hunt', 'Teçhizat': 'Gear', 'Kartlar': 'Cards', 'Okul': 'School' };
const ACH_EN = {
  'first-dawn': ['First Dawn', 'First successful day.'],
  rest: ['Rest, Witcher', 'Declare your first rest day in advance.'],
  'chain-7': ['Steel Chain', 'A chain of 7 links.'],
  'chain-14': ['Silver Chain', 'A chain of 14 links.'],
  'chain-30': ['Golden Chain', 'A chain of 30 links.'],
  'chain-60': ['Meteorite', 'A chain of 60 links.'],
  repair: ['Atonement', 'Repair a broken chain through atonement.'],
  'perfect-week': ['Perfect Week', 'All 7 days from Monday to Sunday successful.'],
  'bedtime-30': ['Night Owl Tamed', 'Meditate within your bedtime window 30 times.'],
  'days-50': ['Fifty Mornings', '50 successful days.'],
  'days-100': ['A Hundred Mornings', '100 successful days.'],
  'days-250': ['Master Witcher', '250 successful days.'],
  'quest-1': ['Habit Formed', 'Complete your first main quest.'],
  'quest-3': ['Three Habits', 'Complete 3 main quests.'],
  'first-blood': ['First Contract', 'Kill your first monster.'],
  'kills-25': ['Hunter', '25 monsters (all characters).'],
  'kills-100': ['Monster Slayer', '100 monsters (all characters).'],
  'first-boss': ['Region Warden', 'Defeat your first region boss.'],
  'region-clear': ['Clean Sweep', 'Kill every monster in a region (boss included) with one character.'],
  legend: ['Legend', 'Defeat the final boss.'],
  'first-sword': ['First Sword', 'Get your first sword.'],
  'swords-10': ['Armory', 'Own 10 swords at once.'],
  'plus-five': ['Master Smith', 'Upgrade a sword to +5.'],
  'school-set': ['School Legacy', 'Have a set sword of your own school crafted.'],
  'legendary-card': ['Legendary Card', 'Find your first legendary card.'],
  'cards-150': ['Collector', '150 different cards with one character.'],
  'links-5': ['Link Master', '5 completed card links.'],
  'links-10': ['Lord of Links', '10 completed card links.'],
  rebirth: ['Rebirth', 'Be reborn for the first time.'],
};
ACHIEVEMENTS.forEach(a => bi(a, { group: ACH_GROUP_EN[a.group] || a.group, name: ACH_EN[a.id]?.[0] || a.name, desc: ACH_EN[a.id]?.[1] || a.desc }));
const SHOP = [
  { id: 'keg', name: 'Kart Fıçısı', desc: '3 kart, biri en az Nadir.', price: 60 },
  { id: 'bigkeg', name: 'Büyük Fıçı', desc: '5 kart, biri en az Destansı.', price: 180 },
  { id: 'swallow', name: 'Swallow', desc: 'Can iksiri. Canın kendiliğinden dolmaz; savaş panelinden içersin. En fazla 10 tane.', price: 40 },
  { id: 'honey', name: 'White Honey', desc: 'Kaçırılan bir günde kendiliğinden içilir: "Bitkin" olmazsın. Zinciri korumaz. En fazla 3 tane.', price: 60 },
];
const SHOP_EN = {
  keg: ['Card Keg', '3 cards, at least one Rare.'],
  bigkeg: ['Large Keg', '5 cards, at least one Epic.'],
  swallow: ['Swallow', "Healing potion. HP doesn't refill on its own; drink it from the combat panel. Max 10."],
  honey: ['White Honey', 'Drunk automatically on a missed day: you don\'t become "Exhausted". Doesn\'t protect the chain. Max 3.'],
};
SHOP.forEach(i => bi(i, { name: SHOP_EN[i.id][0], desc: SHOP_EN[i.id][1] }));
/* canavar değerleri: bölgenin en yüksek değerleri × canavarın bölge içi gücü (str) */
function monStats(m, elite = false) {
  const r = Math.min(REG.hp.length - 1, regionTier(m.region || 0));
  const f = m.str || 0.75, b = m.boss, e = elite ? ELITE : { hp: 1, gold: 1, xp: 1 };
  return {
    hp: Math.round(REG.hp[r] * f * (b ? BOSS.hp : 1) * e.hp),
    gold: Math.max(5, Math.round(REG.gold[r] * f * (b ? BOSS.gold : 1) * e.gold / 5) * 5),
    xp: Math.max(1, Math.round(REG.xp[r] * f * (b ? BOSS.xp : 1) * e.xp)),
    hit: Math.round(REG.hit[r] * (0.6 + 0.4 * f) * (b ? BOSS.hit : 1) * (elite ? 1.15 : 1)),   // başarısızlıkta (kaçırma) vuruşu
  };
}

/* ---------- savaş günlüğü: ilginç anlar (TR/EN). {m} canavar, {d} sayı ---------- */
const FLAVOR = {
  start: [
    ['{m} izini buldun. Kılıcını çektin, av başladı.', 'You found the trail of {m}. You draw your sword; the hunt begins.'],
    ['Madalyonun titredi: {m} yakında. Yağını sürdün ve ilerledin.', 'Your medallion trembles: {m} is close. You apply your oil and move in.'],
    ['{m} ile karşı karşıyasın. Rüzgârı arkana aldın.', 'You face {m}. You put the wind at your back.'],
    ['Kırık dallar, kan izleri… {m} burada. Sessizce yaklaştın.', 'Broken branches, blood trails… {m} is here. You close in quietly.'],
  ],
  crit: [
    ['Temiz bir piruetle {m} canavarına derin bir kesik attın: {d} hasar.', 'A clean pirouette and a deep cut across {m}: {d} damage.'],
    ['Aard ile dengesini bozdun, ardından kılıcın boğazına indi: {d} hasar.', 'Aard knocked it off balance, then your blade found its throat: {d} damage.'],
    ['{m} açık verdi; gümüş kılıcın kemiğe kadar işledi: {d} hasar.', '{m} left an opening; your silver bit to the bone: {d} damage.'],
    ['Yandan bir adım, ters bir savuruş: {m} sendeledi. {d} hasar.', 'A sidestep, a backhand swing: {m} staggers. {d} damage.'],
    ['Igni alevleri arasından saldırdın; {m} çığlık attı: {d} hasar.', 'You strike through Igni\'s flames; {m} shrieks: {d} damage.'],
    ['Quen kalkanı darbeyi emdi, sen karşılığını verdin: {d} hasar.', 'Quen soaked the blow and you answered in kind: {d} damage.'],
  ],
  dodge: [
    ['{m} üzerine atıldı ama yuvarlanarak kurtuldun.', '{m} lunged, but you rolled clear.'],
    ['Son anda geri sıçradın; pençeler havayı yırttı.', 'You leapt back at the last moment; claws tore the air.'],
    ['Quen kalkanın parladı ve darbeyi yuttu.', 'Your Quen shield flared and swallowed the blow.'],
    ['{m} hamlesini okudun ve yana kaydın.', 'You read the attack of {m} and slid aside.'],
  ],
  heavy: [
    ['{m} canavarının ezici hamlesinden kaçamadın: −{d} can.', 'You couldn\'t escape the crushing blow of {m}: −{d} HP.'],
    ['{m} seni yere serdi. Kalkman biraz sürdü: −{d} can.', '{m} knocked you down. It took a moment to get up: −{d} HP.'],
    ['Bir anlık dalgınlık pahalıya patladı: −{d} can.', 'A moment\'s distraction cost you dearly: −{d} HP.'],
  ],
  heavyBy: {
    Vampire: [['{m} gölgeden süzüldü ve boynuna saldırdı: −{d} can.', '{m} slipped from the shadows and went for your neck: −{d} HP.']],
    Necrophage: [['{m} kokuşmuş pençeleriyle zırhını yırttı: −{d} can.', '{m} tore your armour with rotting claws: −{d} HP.']],
    Specter: [['{m} içinden geçti; iliklerine kadar üşüdün: −{d} can.', '{m} passed through you; you froze to the marrow: −{d} HP.']],
    Ogroid: [['{m} kocaman yumruğunu indirdi, kaburgaların inledi: −{d} can.', '{m} brought down a huge fist; your ribs groaned: −{d} HP.']],
    Insectoid: [['{m} zehirli iğnesini sapladı: −{d} can.', '{m} drove in its venomous stinger: −{d} HP.']],
    Beast: [['{m} dişlerini bacağına geçirdi: −{d} can.', '{m} sank its teeth into your leg: −{d} HP.']],
    Dragon: [['{m} alev püskürttü; pelerinin tutuştu: −{d} can.', '{m} breathed fire; your cloak caught alight: −{d} HP.']],
    Relict: [['{m} toprağı titretti, ayağın kaydı: −{d} can.', '{m} shook the earth and you lost your footing: −{d} HP.']],
    Plant: [['{m} dikenli kollarıyla seni sardı: −{d} can.', '{m} wrapped you in thorny limbs: −{d} HP.']],
    Construct: [['{m} taş yumruğunu kalkanına indirdi: −{d} can.', '{m} slammed a stone fist into your guard: −{d} HP.']],
    Human: [['{m} lanetli bir öfkeyle üstüne atıldı: −{d} can.', '{m} hurled itself at you in cursed fury: −{d} HP.']],
  },
  potion: [
    ['Bir Swallow içtin, yaraların kapanmaya başladı: +{d} can.', 'You drank a Swallow and your wounds began to close: +{d} HP.'],
    ['Geri çekilip bir yudum Swallow aldın: +{d} can.', 'You stepped back and took a swig of Swallow: +{d} HP.'],
  ],
  buy: [['Çantada iksir kalmamıştı; yanındaki tüccardan bir Swallow aldın ({d} oren).', 'Your pouch was empty; you bought a Swallow from a passing trader ({d} crowns).']],
  retreat: [
    ['İksirin kalmadı. {m} karşısında geri çekilip yaralarını sarmaya gittin.', 'Out of potions. You withdrew from {m} to tend your wounds.'],
    ['Daha fazla dayanamazdın; geri çekildin. {m} de soluklanıyor.', 'You couldn\'t take more; you fell back. {m} catches its breath too.'],
  ],
  resume: [
    ['Yaraların sarıldı. Ava döndün.', 'Your wounds are dressed. Back to the hunt.'],
    ['Dinlendin ve kılıcını biledin. {m} seni bekliyor.', 'Rested and sharpened your blade. {m} awaits.'],
  ],
  defeat: [
    ['{m} seni yendi. Bir köylü seni yol kenarında buldu; toparlanman saatler sürecek.', '{m} beat you. A peasant found you by the road; recovery will take hours.'],
    ['Karanlık… {m} son darbeyi indirdi. Bir meyhanede uyandın, her yerin sargılı.', 'Darkness… {m} landed the final blow. You woke in a tavern, bandaged all over.'],
  ],
  smash: [
    ['{m} bütün gücüyle vurdu; kalkanın parçalandı: −{d} can!', '{m} struck with all its might and shattered your guard: −{d} HP!'],
    ['{m} öfkeyle kükredi ve seni duvara fırlattı: −{d} can!', '{m} roared in fury and hurled you into a wall: −{d} HP!'],
    ['Yer yarıldı sandın: {m} ezici bir darbe indirdi. −{d} can!', 'You thought the ground split: {m} landed a crushing blow. −{d} HP!'],
  ],
  mend: [
    ['{m} düştü. Bir sonraki ava geçmeden yaralarını sardın.', '{m} fell. You tended your wounds before the next hunt.'],
    ['{m} cesedinin başında soluklandın; kanamayı durdurdun.', 'You caught your breath over the body of {m} and stopped the bleeding.'],
  ],
  strikeMiss: [
    ['Görevini aksattın; {m} fırsatı kaçırmadı ve üstüne atıldı: −{d} can.', 'You slipped on your quest; {m} seized the moment and lunged: −{d} HP.'],
    ['Bugün yolunu şaşırdın. {m} pusudan çıkıp seni yaraladı: −{d} can.', 'You lost your way today. {m} burst from ambush and wounded you: −{d} HP.'],
    ['Dikkatin dağıldı; {m} tam kalbinin üstünden vurdu: −{d} can.', 'Your focus broke; {m} struck right over your heart: −{d} HP.'],
  ],
  strikeLate: [
    ['Geç kaldın; {m} gardını düşürdüğün anı yakaladı: −{d} can.', 'You were late; {m} caught you with your guard down: −{d} HP.'],
    ['Bir adım geride kaldın ve {m} bunu fark etti: −{d} can.', 'You fell a step behind and {m} noticed: −{d} HP.'],
  ],
  recover: [['Toparlandın; tam canla ava döndün.', 'You\'ve recovered and returned to the hunt at full health.']],
};
const pickF = (arr, seed) => arr[Math.abs(seed) % arr.length];
let flavorSeed = 0;
function flavorText(kind, m, d) {
  let pool = FLAVOR[kind] || [['', '']];
  if (kind === 'heavy' && m && FLAVOR.heavyBy[m.cls] && (flavorSeed % 2)) pool = FLAVOR.heavyBy[m.cls];
  const [tr, en] = pickF(pool, flavorSeed++);
  return L(tr, en).replace(/\{m\}/g, m ? m.name : L('canavar', 'the monster')).replace(/\{d\}/g, d ?? '');
}

/* ---------- alışkanlıklar (ana görevler) ----------
 * Türler: sleep (yatış + kalkış aralığı), window (tek saat aralığı), count (günlük adet hedefi), check (gün içinde yaptım/yapmadım).
 * Her alışkanlığın kendi zinciri, günleri ve ilerlemesi vardır. En fazla MAX_HABITS tane aynı anda. */
const HABIT_TYPES = ['sleep', 'window', 'count', 'check'];
const MAX_HABITS = 5;
const CHAIN_WEIGHTS = [1, 0.5, 1 / 3, 0.25, 0.2];                  // zincir hasar bonusu: en güçlüsü tam, sonrakiler azalarak
const DAY_END = '03:00';                                           // adet ve yaptım/yapmadım türlerinde gün ertesi gece bu saate kadar sürer
const habitTypeName = t => ({ sleep: L('Uyku', 'Sleep'), window: L('Saat aralığı', 'Time window'), count: L('Adet', 'Count'), check: L('Yaptım / yapmadım', 'Done / not done') }[t] || t);
function makeQuest(cfg) {
  const type = cfg.type === 'daily' ? 'window' : HABIT_TYPES.includes(cfg.type) ? cfg.type : 'sleep';
  const defName = { sleep: L('Uyku düzeni', 'Sleep schedule'), window: L('Günlük alışkanlık', 'Daily habit'), count: L('Günlük hedef', 'Daily target'), check: L('Her gün yap', 'Do it every day') }[type];
  const q = {
    id: cfg.id || uid(),
    name: (cfg.name || '').trim() || defName,
    type,
    days: Math.round(+cfg.days || 30),
    lateMin: Math.max(15, Math.min(240, Math.round(+cfg.lateMin || 60))),
    progress: cfg.progress || 0, status: 'active', start: cfg.start || null,
  };
  if (q.type === 'sleep') q.sleep = { bedStart: '00:00', bedEnd: '02:00', wakeStart: '08:00', wakeEnd: '08:30', ...(cfg.sleep || {}) };
  else if (q.type === 'window') q.daily = { start: '18:00', end: '22:00', ...(cfg.daily || {}) };
  else if (q.type === 'count') q.count = { target: Math.max(1, Math.round(+cfg.count?.target || 8)), unit: String(cfg.count?.unit || '').trim().slice(0, 20) };
  return q;
}
function makeHabit(cfg) {
  const h = makeQuest(cfg);
  h.chain = cfg.chain || freshChain(); h.entries = cfg.entries || {}; h.lastProcessed = cfg.lastProcessed || null;
  return h;
}
/* eski tek görevli yapıyla uyum: state.quest / chain / days / lastProcessed ilk alışkanlığı gösterir (kayda yazılmaz) */
function attachAliases(s) {
  if (!s || !Array.isArray(s.habits)) return s;
  const def = (k, get, set) => Object.defineProperty(s, k, { get, set, enumerable: false, configurable: true });
  def('quest', () => s.habits[0], v => { s.habits[0] = v; });
  def('chain', () => s.habits[0]?.chain, v => { s.habits[0].chain = v; });
  def('days', () => s.habits[0]?.entries, v => { s.habits[0].entries = v; });
  def('lastProcessed', () => s.habits[0]?.lastProcessed, v => { s.habits[0].lastProcessed = v; });
  return s;
}
function validateQuest(q) {
  if (!(q.days >= QUEST_MIN && q.days <= QUEST_MAX)) return L(`Süre ${QUEST_MIN} ile ${QUEST_MAX} gün arasında olmalı.`, `Duration must be between ${QUEST_MIN} and ${QUEST_MAX} days.`);
  if (!q.name) return L('Görevin bir adı olmalı.', 'The quest needs a name.');
  if (q.type === 'sleep') {
    const s = q.sleep;
    if (![s.bedStart, s.bedEnd, s.wakeStart, s.wakeEnd].every(t => /^\d\d:\d\d$/.test(t || ''))) return L('Tüm saatleri doldur.', 'Fill in all times.');
    const night = t => toMin(t) >= 720 ? toMin(t) - 1440 : toMin(t);
    if (night(s.bedEnd) <= night(s.bedStart)) return L('Yatış aralığının sonu başından sonra olmalı.', 'The bedtime window must end after it starts.');
    if (toMin(s.wakeEnd) <= toMin(s.wakeStart)) return L('Kalkış aralığının sonu başından sonra olmalı.', 'The wake-up window must end after it starts.');
    if (toMin(s.wakeStart) >= 720) return L('Kalkış aralığı öğleden önce başlamalı.', 'The wake-up window must start before noon.');
    if (night(s.bedEnd) + 120 > toMin(s.wakeStart)) return L('Yatış aralığının sonu ile kalkış arasında en az 2 saat olmalı.', 'There must be at least 2 hours between the end of bedtime and wake-up.');
  } else if (q.type === 'window') {
    const d = q.daily;
    if (!/^\d\d:\d\d$/.test(d.start || '') || !/^\d\d:\d\d$/.test(d.end || '')) return L('Saat aralığını doldur.', 'Fill in the time window.');
    if (toMin(d.end) <= toMin(d.start)) return L('Aralığın sonu başından sonra olmalı (aynı gün içinde).', 'The window must end after it starts (on the same day).');
  } else if (q.type === 'count') {
    if (!(q.count.target >= 1 && q.count.target <= 10000)) return L('Günlük hedef 1 ile 10000 arasında olmalı.', 'The daily target must be between 1 and 10000.');
  }
  return null;
}

/* ---------- yeni kayıt / karakter ---------- */
function freshChain() { return { len: 0, rust: false, repair: null, links: [], best: 0, bestTier: 0 }; }
function freshCharacter({ name, school, faction, nowDate }) {
  return {
    charId: uid(), charStart: nowDate.toISOString(),
    name: name || 'Witcher', school: SCHOOLS[school] ? school : 'wolf', faction: FACTIONS.includes(faction) ? faction : null, avatar: null,
    hp: school === 'bear' ? 140 : 100, xp: 0, level: 1, gold: 50, scraps: 0, swallow: 3, honey: 1, combat: null, queue: [],
    collection: {}, links: [], swords: { owned: [], silver: null, steel: null, up: {} }, diagrams: [],
    trophies: [], region: 0, boards: {}, rerolls: {}, contract: null, legend: false, fame: 0, draws: 0, pity: 0,
    stats: { goldEarned: 0, dmg: 0, crits: 0 },
  };
}
const CHAR_KEYS = Object.keys(freshCharacter({ nowDate: new Date() }));
function newState({ name, school, faction, quest, nowDate }) {
  return attachAliases({
    v: 12, created: nowDate.toISOString(), settings: { notify: false, autoPotion: true },
    ...freshCharacter({ name, school, faction, nowDate }),
    habits: [makeHabit(quest || {})], restDays: {}, effects: [], questHistory: [],
    hall: [],
    achievements: {}, counters: { repairs: 0 }, weekStats: null, weekly: [], pendingSummary: null,
    quests: [{ id: uid(), name: L('Yatakta telefon yok', 'No phone in bed'), xp: 8, gold: 5 }, { id: uid(), name: L('10 dk yürüyüş / esneme', '10 min walk / stretch'), xp: 5, gold: 3 }],
    questLog: {}, log: [], notified: {},
  });
}
function migrate(s) {
  if (!s) return s;
  if (!s.v || s.v < 2) {
    const len = s.streak || 0;
    s.chain = { ...freshChain(), len, best: Math.max(len, s.best || 0), bestTier: tierOf(len) };
    if (s.week && s.week.hp != null) {
      const max = 5;
      s.week = { key: s.week.key, id: s.week.id, max, dist: s.week.killed ? 0 : Math.max(1, Math.ceil(s.week.hp / s.week.max * max)), killed: s.week.killed, qp: 0 };
    }
    delete s.streak; delete s.best;
    s.v = 2;
  }
  if (s.v < 3) {
    const st = s.settings || {};
    const bed = st.bed || '00:30', wake = st.wake || '08:00';
    const q = makeQuest({
      name: 'Uyku düzeni', type: 'sleep', days: 30, lateMin: st.lateMin || 60,
      sleep: { bedStart: fromMin(toMin(bed) - 30), bedEnd: fromMin(toMin(bed) + 90), wakeStart: wake, wakeEnd: st.deadline || fromMin(toMin(wake) + 30) },
    });
    q.start = s.lastProcessed ? addDays(s.lastProcessed, 1) : dk(new Date(s.created || Date.now()));
    Object.entries(s.days || {}).forEach(([k, d]) => {
      if (d.wake && !d.check) { d.check = d.wake; delete d.wake; }
      if (k >= q.start) d.q = q.id;
    });
    q.progress = Object.entries(s.days || {}).filter(([k, d]) => k >= q.start && d.result === 'success').length;
    s.quest = q; s.questHistory = [];
    s.settings = { notify: !!st.notify };
    delete s.rewards;
    s.v = 3;
  }
  if (s.v < 4) {
    if (s.week && s.week.hp == null) {
      const ratio = s.week.killed ? 0 : Math.max(0.1, Math.min(1, (s.week.dist ?? s.week.max) / (s.week.max || 5)));
      s.week = { key: s.week.key, id: s.week.id, max: 100, hp: Math.round(100 * ratio), killed: !!s.week.killed };
    }
    s.swords ||= { owned: [], silver: null, steel: null };
    s.links ||= [];
    s.v = 4;
  }
  if (s.v < 5) {
    // haftalık tek canavar -> bölgeler + kontrat tabelası; günlük oren yatırma kalktı
    s.charId ||= uid(); s.charStart ||= s.created;
    s.faction = null;                         // eski karakter: tüm fraksiyonlar
    s.region = Math.min(BAND_COUNT - 1, Math.floor(((s.level || 1) - 1) / 4));
    s.contract = null; s.board = null; s.legend = false;
    if (s.week && !s.week.killed) {
      const m = MONSTERS.find(x => x.id === s.week.id);
      if (m && regionTier(m.region || 0) === s.region && !m.boss) {
        const max = monStats(m).hp;
        s.contract = { id: m.id, max, hp: Math.max(1, Math.round(max * (s.week.hp / (s.week.max || 100)))) };
      }
    }
    delete s.week;
    s.trophies = (s.trophies || []).map(t => ({ id: t.id, at: t.at || t.week }));
    s.stats ||= { goldEarned: 0, dmg: 0, crits: 0 };
    s.hall ||= [];
    s.v = 5;
  }
  if (s.v < 6) {
    // witcherdb canavarları -> Gwent kartı canavarlar, 8 bölge, bölge başına tabela
    const known = new Set(MONSTERS.map(m => m.id));
    s.boards = {}; delete s.board;
    if (s.contract && !known.has(s.contract.id)) s.contract = null;
    if (s.contract) {   // canavar yeni listede de var: kalan can oranını koruyarak yeni değerlere çevir
      const max = monStats(MONSTERS.find(m => m.id === s.contract.id)).hp, ratio = s.contract.hp / (s.contract.max || 1);
      s.contract = { id: s.contract.id, max, hp: Math.max(1, Math.round(max * ratio)), since: null };
    }
    s.trophies = (s.trophies || []).filter(t => known.has(t.id));
    s.region = Math.min(BAND_COUNT - 1, Math.floor(((s.level || 1) - 1) / 4));
    s.v = 6;
  }
  if (s.v < 7) { s.swords ||= { owned: [], silver: null, steel: null }; s.swords.up ||= {}; s.v = 7; }
  if (s.v < 8) { s.diagrams ||= []; s.v = 8; }
  // v9: aynı kademede birden çok bölge; state.region artık kademe. Tabelalar bölge sırasına göre tutulduğu için sıfırlanır.
  if (s.v < 9) { s.boards = {}; if (s.rerolls) delete s.rerolls.boards; s.v = 9; }
  // v10: yeni bölge (Sansretour) eklendi, bölge sıraları kaydı: tabelalar yeniden kurulsun
  if (s.v < 10) { s.boards = {}; if (s.rerolls) delete s.rerolls.boards; s.v = 10; }
  // v11: tek ana görev -> alışkanlık listesi. Görev, zinciri ve günleri ilk alışkanlık olur; dinlenme günleri genel olur.
  if (s.v < 11) {
    const h = makeHabit({ ...(s.quest || {}), chain: s.chain || freshChain(), lastProcessed: s.lastProcessed || null });
    Object.assign(h, { progress: s.quest?.progress || 0, status: s.quest?.status || 'active', start: s.quest?.start || null });
    if (s.quest?.completedAt) h.completedAt = s.quest.completedAt;
    if (s.quest?.awaitingChoice) h.awaitingChoice = true;
    s.restDays = {};
    for (const [k, d] of Object.entries(s.days || {})) {
      if (k.includes('#')) {               // eski görevlerden kalan günler: geçmiş kaydının içine
        const [day, qid] = k.split('#'), hist = (s.questHistory || []).find(x => x.id === qid);
        if (hist) (hist.entries ||= {})[day] = d;
        continue;
      }
      if (d.rest) { s.restDays[k] = d.restAt || true; }
      h.entries[k] = d;
    }
    s.habits = [h];
    delete s.quest; delete s.chain; delete s.days; delete s.lastProcessed;
    s.v = 11;
  }
  s.restDays ||= {};
  // v12: idle savaş. Eski Swallow (ceza koruması) White Honey oldu; Swallow artık can iksiri.
  if (s.v < 12) {
    s.honey = Math.min(HONEY_MAX, s.swallow ?? 1); s.swallow = 3;
    s.effects = []; s.combat = null; s.queue = [];
    s.settings ||= {}; if (s.settings.autoPotion === undefined) s.settings.autoPotion = true;
    s.v = 12;
  }
  s.effects ||= []; s.queue ||= [];
  s.rerolls ||= {};
  s.achievements ||= {}; s.counters ||= { repairs: 0 }; s.weekly ||= []; if (s.pendingSummary === undefined) s.pendingSummary = null;
  // denge değerleri değiştiyse aktif kontratın canını kalan oranı koruyarak güncel değere çevir
  if (s.contract) {
    const m = MONSTERS.find(x => x.id === s.contract.id);
    if (!m) s.contract = null;
    else {
      const max = monStats(m, !!s.contract.elite).hp;
      if (s.contract.max !== max) s.contract = { ...s.contract, max, hp: Math.max(1, Math.round(max * s.contract.hp / (s.contract.max || max))) };
    }
  }
  (s.log || []).forEach(l => { l.id ||= uid(); });
  s.questHistory ||= [];
  s.habits.forEach(h => { if (h.type === 'daily') h.type = 'window'; h.chain ||= freshChain(); h.entries ||= {}; });
  return attachAliases(s);
}

/* ---------- motor ---------- */
function createEngine(state, opts = {}) {
  const now = opts.now || (() => new Date());
  const random = opts.random || Math.random;
  const rnd = a => a[Math.floor(random() * a.length)];
  const ev = { reveals: [], toasts: [], sfx: [] };
  const fx = name => ev.sfx.push(name);   // ses/efekt olayı (sfx: saat eki yardımcısıyla karışmasın)
  attachAliases(state);
  state.effects ||= []; state.queue ||= [];
  /* alışkanlık bağlamı: gün/zincir/pencere işlemleri "o anki" alışkanlık (H) üzerinde çalışır; varsayılan ilk alışkanlık */
  let H = null;
  const habitById = id => state.habits.find(h => h.id === id);
  const Q = () => H || state.habits[0];
  const C = () => Q().chain;
  const on = (hid, fn) => { const prev = H; H = (hid && typeof hid === 'object') ? hid : (hid && habitById(hid)) || Q(); try { return fn(); } finally { H = prev; } };
  const sc = () => state.school;
  const isSleep = () => Q().type === 'sleep';
  const maxHp = () => Math.round(hpAt(state.level || 1) * (sc() === 'bear' ? 1.4 : 1));
  const idle = opts.idle !== false;
  let logClock = null;                                     // geçmişe dönük savaş hesabında olayların zamanı
  const clockNow = () => logClock || now();
  const getDay = k => (Q().entries[k] ||= {});
  const isRest = k => !!state.restDays?.[k];
  const bestChainLen = () => Math.max(0, ...state.habits.map(h => h.chain.len));
  const toast = (msg, type = '') => ev.toasts.push({ msg, type });
  const ok = () => ({ ok: true });
  const err = msg => ({ err: msg });
  // state.region: ulaşılan kademe (0–7). Kademenin bölgeleri birlikte açıktır.
  const band = () => Math.max(0, Math.min(state.region, BAND_COUNT - 1));
  const bandInfo = (b = band()) => ({ i: b, min: b * 4 + 1, max: b * 4 + 4, regions: bandRegions(b) });
  const homeRegion = () => bandRegions(band())[0] ?? 0;
  const region = () => REGIONS[homeRegion()];
  const killedSet = () => new Set(state.trophies.map(t => t.id));

  function log(text, type = '') {
    state.log.unshift({ id: uid(), t: clockNow().toISOString(), text, type });
    state.log.length = Math.min(state.log.length, 300);
  }
  /* Okul mirası */
  function legacy() {
    const legends = (state.hall || []).filter(h => h.legend).length, chars = (state.hall || []).length;
    return { gold: Math.min(LEGACY.goldMax, legends * LEGACY.goldPerLegend), xp: Math.min(LEGACY.xpMax, chars * LEGACY.xpPerChar), legends, chars };
  }
  /* haftalık istatistik (genel) */
  function weekTrack(field, n) { ensureWeekStats(); state.weekStats[field] = (state.weekStats[field] || 0) + n; }
  function addGold(x) {
    if (x > 0) x *= 1 + legacy().gold / 100;
    x = Math.round(x); state.gold += x;
    if (x > 0) { state.stats.goldEarned += x; weekTrack('gold', x); }
    return x;
  }

  /* --- pencereler: k = görevin günü (uykuda uyanılan sabahın tarihi) --- */
  function W(k) {
    const q = Q();
    if (q.type === 'sleep') {
      const s = q.sleep;
      const onNight = t => (toMin(t) >= 720 ? addDays(k, -1) : k);
      const prepStart = at(onNight(s.bedStart), s.bedStart), prepEnd = at(onNight(s.bedEnd), s.bedEnd);
      const checkStart = at(k, s.wakeStart), checkEnd = at(k, s.wakeEnd);
      return {
        prepStart, prepEnd, prepOpen: addMin(prepStart, -60), prepClose: addMin(prepEnd, 60),
        checkOpen: addMin(checkStart, -180), checkStart, checkEnd, lateLimit: addMin(checkEnd, q.lateMin), restBy: prepEnd,
      };
    }
    const dayStart = at(k, '00:00');
    if (q.type === 'count' || q.type === 'check') {
      // gün boyunca açık; gece DAY_END'e kadar hâlâ o güne sayılır
      const end = at(addDays(k, 1), DAY_END);
      return { checkOpen: dayStart, checkStart: dayStart, checkEnd: end, lateLimit: q.type === 'count' ? end : addMin(end, q.lateMin), restBy: dayStart };
    }
    const d = q.daily, checkStart = at(k, d.start), checkEnd = at(k, d.end);
    return { checkOpen: dayStart, checkStart, checkEnd, lateLimit: addMin(checkEnd, q.lateMin), restBy: dayStart };
  }
  function upcoming(n = now()) {
    const t = dk(n);
    for (const k of [addDays(t, -1), t, addDays(t, 1), addDays(t, 2)]) {
      if (Q().start && k < Q().start) continue;
      if (Q().entries[k]?.result) continue;
      if (n > W(k).lateLimit) continue;
      return k;
    }
    return addDays(t, 1);
  }
  function phase(k, n = now()) {
    const w = W(k);
    if (n >= w.checkOpen) return 'check';
    if (isSleep()) {
      if (n >= w.prepOpen && n <= w.prepClose) return 'prep';
      if (n > w.prepClose) return 'sleep';
    }
    return 'day';
  }
  const restUsedInWeek = k => { const m = mondayOf(k); return Object.keys(state.restDays || {}).some(d => mondayOf(d) === m); };
  /* dinlenme günü bütün alışkanlıklar için geçerlidir; en erken başlayan alışkanlığın penceresinden önce ilan edilmelidir */
  const restBy = k => new Date(Math.min(...state.habits.map(h => on(h, () => W(k).restBy).getTime())));
  function restTarget(n = now()) { const t = dk(n); for (const k of [t, addDays(t, 1), addDays(t, 2)]) if (n < restBy(k)) return k; return addDays(t, 2); }
  const logicalToday = () => dk(addMin(now(), -300));

  /* --- seviye: bölge sınırı boss ölmeden aşılamaz --- */
  const capLevel = () => Math.min(MAX_LEVEL, bandInfo().max);
  const atCap = () => state.level >= capLevel();
  function levelUps() {
    let need;
    while (state.level < capLevel() && state.xp >= (need = xpNeed(state.level))) {
      state.xp -= need; state.level++; fx('level');
      state.swallow = Math.min(POTION.cap, (state.swallow || 0) + 1);
      log(L(`Seviye atladın! Artık ${state.level}. seviyesin. En yüksek canın ${maxHp()} oldu ve bir Swallow kazandın.`, `Level up! You are now level ${state.level}. Your max HP is now ${maxHp()}, and you earned a Swallow.`), 'epic');
      const bossRegs = bandInfo().regions.filter(x => REGIONS[x].boss && !killedSet().has(REGIONS[x].boss));
      if (state.level === capLevel() && !state.legend && bossRegs.length) {
        const names = bossRegs.map(x => `${monById(REGIONS[x].boss).name} (${REGIONS[x].name})`).join(L(' ya da ', ' or '));
        log(L(`Seviye sınırına (${capLevel()}) ulaştın. Devam etmek için bu kademenin boss'larından birini yen: ${names}. Biri yeter; diğeri sonra da beklemeye devam eder.`,
          `You reached the level cap (${capLevel()}). To go on, defeat one of this tier's bosses: ${names}. One is enough; the other keeps waiting.`), 'epic');
        toast(L('Boss açıldı', 'Boss unlocked'), 'good');
      }
    }
  }
  /* sınırdayken en fazla bir seviyelik TP birikir: boss'u yenince bir sonraki bölgenin aralığı atlanmaz */
  const xpBank = () => (atCap() ? xpNeed(state.level) : Infinity);
  const fameNeed = () => xpNeed(MAX_LEVEL);
  function gainXp(x) {
    x = Math.round(x * (1 + legacy().xp / 100));
    state.xp += x; if (x > 0) weekTrack('xp', x);
    levelUps(); if (state.xp > xpBank() && state.level < MAX_LEVEL) state.xp = xpBank();
    // son seviyede TP boşa gitmez: Ün (★) seviyesine dönüşür
    while (state.level >= MAX_LEVEL && state.xp >= fameNeed()) {
      state.xp -= fameNeed(); state.fame = (state.fame || 0) + 1; fx('level');
      log(L(`Ün kazandın: ★${state.fame}. +${FAME.gold} oren ve bir Swallow.`, `Renown gained: ★${state.fame}. +${FAME.gold} crowns and a Swallow.`), 'epic');
      toast(L(`★${state.fame} Ün`, `★${state.fame} Renown`), 'good');
      addGold(FAME.gold); state.swallow = Math.min(POTION.cap, (state.swallow || 0) + 1);
    }
  }
  /* --- etkiler (alışkanlık cezaları): hasarı düşürür, süre bitince kalkar --- */
  function expireEffects(t = clockNow()) { state.effects = (state.effects || []).filter(e => new Date(e.until) > t); }
  const debuffPct = (t = clockNow()) => Math.min(EFFECT_CAP, (state.effects || []).filter(e => new Date(e.until) > t).reduce((s, e) => s + e.pct, 0));
  function addEffect(kind, src) {
    const d = EFFECTS[kind], t = clockNow();
    const e = { id: uid(), kind, pct: d.pct, until: addMin(t, d.hours * 60).toISOString(), src };
    state.effects.push(e);
    const nm = kind === 'tired' ? L('Yorgun', 'Tired') : L('Bitkin', 'Exhausted');
    log(L(`${nm}: ${d.hours} saat boyunca hasarın −%${d.pct}${src ? ` (${src})` : ''}.`, `${nm}: −${d.pct}% damage for ${d.hours} hours${src ? ` (${src})` : ''}.`), 'bad');
    return e.id;
  }

  /* --- zincir --- */
  function addLink(k, t) {
    C().links.push({ d: k, t });
    if (C().links.length > 60) C().links.splice(0, C().links.length - 60);
  }
  function chainSuccess(k) {
    const c = C(), before = tierOf(c.len);
    c.len++; c.rust = false; addLink(k, 'ok');
    if (c.repair) {
      c.repair.got++;
      if (c.repair.got >= REPAIR_NEED) {
        c.len = c.repair.preLen + c.repair.got;
        state.counters ||= {}; state.counters.repairs = (state.counters.repairs || 0) + 1;
        log(L(`Kefaret tamamlandı! Kırık halka onarıldı, zincir ${c.len} halkaya döndü.`, `Atonement complete! The broken link is repaired; your chain is back to ${c.len} links.`), 'epic');
        toast(L('Zincir onarıldı!', 'Chain repaired!'), 'good');
        c.repair = null;
      } else log(L(`Kefaret ${c.repair.got}/${REPAIR_NEED}. Bir gün daha başarırsan ${c.repair.preLen} halka geri gelecek.`, `Atonement ${c.repair.got}/${REPAIR_NEED}. One more successful day brings back ${c.repair.preLen} links.`), 'good');
    }
    c.best = Math.max(c.best, c.len);
    const after = tierOf(c.len);
    if (after > before) {
      log(L(`Zincir ${TIERS[after].name} oldu! Ödüllerin ×${TIERS[after].mult}, hasarın +%${TIERS[after].dmg}.`, `Your chain is now ${TIERS[after].name}! Rewards ×${TIERS[after].mult}, damage +${TIERS[after].dmg}%.`), 'epic');
      if (after > c.bestTier) { c.bestTier = after; drawCards(1, TIERS[after].min, L(`${TIERS[after].name} zincir ödülü`, `${TIERS[after].name} chain reward`)); }
    }
    if (c.len >= 90 && (c.len - 60) % 30 === 0) drawCards(1, 'Legendary', L(`${c.len} halkalık zincir`, `${c.len}-link chain`));
  }
  function chainBreak(k, why) {
    const c = C(), preLen = c.len, t = tierOf(preLen);
    c.len = t > 0 ? TIERS[t - 1].at : 0;
    c.rust = false;
    c.repair = preLen > c.len ? { preLen, got: 0, from: k } : null;
    addLink(k, 'break'); fx('bad');
    if (preLen === 0) { log(L(`Zincir kırıldı (${why}), ama zaten boştu.`, `Chain broken (${why}), but it was already empty.`), 'bad'); return; }
    log(L(`Zincir kırıldı (${why})! ${preLen} → ${c.len} halka${t > 0 ? `, ${TIERS[t].name} → ${TIERS[t - 1].name}` : ''}. Kefaret: sonraki ${REPAIR_NEED} günü başarırsan ${preLen} halka geri gelir.`,
      `Chain broken (${why})! ${preLen} → ${c.len} links${t > 0 ? `, ${TIERS[t].name} → ${TIERS[t - 1].name}` : ''}. Atonement: succeed the next ${REPAIR_NEED} days and ${preLen} links come back.`), 'bad');
    toast(L('Zincir kırıldı! Kefaret yolu açık.', 'Chain broken! The path of atonement is open.'), 'bad');
  }
  function chainLate(k) {
    const c = C();
    if (c.rust) return chainBreak(k, L('üst üste iki paslı halka', 'two rusty links in a row'));
    c.rust = true; addLink(k, 'rust');
    if (c.repair) { log(L('Geç kalmak kefareti bozdu. Kırık halka kalıcı oldu.', 'Being late ruined the atonement. The broken link is permanent.'), 'bad'); c.repair = null; }
    log(L('Paslı halka: zincir kırılmadı, ama bir sonraki gecikmede kırılır.', "Rusty link: the chain didn't break, but it will on your next late day."), 'bad');
  }

  /* --- kontrat tabelaları: açık her bölgede haftalık 3 canavar --- */
  const openRegions = () => REGIONS.map((r, i) => i).filter(i => REGIONS[i].tier <= band());
  const postGame = () => !!state.legend;
  const isElite = id => postGame() && killedSet().has(id);
  /* boss: kendi kademesinin sınırında açılır; alt kademelerde kesilmemiş boss'lar da açık kalır. Son oyunda hepsi elit olarak tekrar savaşılır. */
  function bossAvailable(r = homeRegion()) {
    const b = REGIONS[r]?.boss;
    if (!b || REGIONS[r].tier > band()) return false;
    if (postGame()) return true;
    if (killedSet().has(b)) return false;
    return REGIONS[r].tier < band() || atCap();
  }
  function ensureBoard(r = homeRegion(), k = upcoming()) {
    const key = mondayOf(k);
    state.boards ||= {};
    const cur = state.boards[r];
    if (cur && cur.key === key) return cur;
    const killed = killedSet();
    let pool = MONSTERS.filter(m => (m.region || 0) === r && !m.boss && !killed.has(m.id) && m.id !== state.contract?.id);
    // son oyun: önce kesilmemişler, sonra elit olarak geri dönenler
    if (postGame() && pool.length < BOARD_SIZE) pool = pool.concat(MONSTERS.filter(m => (m.region || 0) === r && !m.boss && killed.has(m.id) && m.id !== state.contract?.id && !pool.includes(m)));
    const ids = [];
    while (ids.length < BOARD_SIZE && pool.length) ids.push(pool.splice(Math.floor(random() * pool.length), 1)[0].id);
    state.boards[r] = { key, ids };
    return state.boards[r];
  }
  const boardRerolls = r => { const b = state.rerolls?.boards?.[r]; return b && b.key === mondayOf(upcoming()) ? b.n : 0; };
  const boardRerollCost = r => (REROLL.boardBase + REROLL.boardPerRegion * r) * (boardRerolls(r) + 1);
  function rerollBoard(r = homeRegion()) {
    if (!REGIONS[r] || REGIONS[r].tier > band()) return err(L('Bu bölge kilitli.', 'This region is locked.'));
    const cost = boardRerollCost(r);
    if (state.gold < cost) return err(L(`${cost} oren gerekiyor.`, `You need ${cost} crowns.`));
    const board = ensureBoard(r), killed = killedSet();
    const keep = board.ids.filter(id => id === state.contract?.id);          // aktif kontrat yerinde kalır
    const fresh = MONSTERS.filter(m => (m.region || 0) === r && !m.boss && !killed.has(m.id) && !board.ids.includes(m.id) && m.id !== state.contract?.id);
    const fallback = MONSTERS.filter(m => (m.region || 0) === r && !m.boss && !killed.has(m.id) && !keep.includes(m.id) && m.id !== state.contract?.id && !fresh.includes(m));
    if (!fresh.length && !fallback.length) return err(L('Bu bölgede tabelaya asılacak başka canavar kalmadı.', 'No other monsters left to post in this region.'));
    state.gold -= cost;
    const ids = [...keep];
    for (const pool of [fresh, fallback]) while (ids.length < BOARD_SIZE && pool.length) ids.push(pool.splice(Math.floor(random() * pool.length), 1)[0].id);
    state.boards[r] = { key: board.key, ids };
    state.rerolls ||= {}; state.rerolls.boards ||= {};
    state.rerolls.boards[r] = { key: board.key, n: boardRerolls(r) + 1 };
    log(L(`${REGIONS[r].name} kontrat tabelası yenilendi (${cost} oren): ${ids.map(id => monById(id).name).join(', ')}.`, `${REGIONS[r].name} contract board refreshed (${cost} crowns): ${ids.map(id => monById(id).name).join(', ')}.`));
    return ok();
  }
  function boardEntries(r = homeRegion()) {
    if (!REGIONS[r] || REGIONS[r].tier > band()) return [];
    const board = ensureBoard(r), killed = killedSet();
    const list = board.ids.map(monById).map(m => { const el = isElite(m.id); return { m, elite: el, stats: monStats(m, el), killed: killed.has(m.id) && !el, active: state.contract?.id === m.id }; });
    if (bossAvailable(r)) { const b = monById(REGIONS[r].boss), el = isElite(b.id); list.push({ m: b, elite: el, stats: monStats(b, el), boss: true, killed: false, active: state.contract?.id === b.id }); }
    return list;
  }
  function takeContract(id) {
    const m = MONSTERS.find(x => x.id === id);
    if (!m) return err(L('Böyle bir canavar yok.', 'No such monster.'));
    if (killedSet().has(id) && !postGame()) return err(L('Bu canavarı zaten öldürdün.', 'You already killed this monster.'));
    if (regionTier(m.region) > band()) return err(L('Bu bölge henüz kilitli.', 'This region is still locked.'));
    if (!boardEntries(m.region).some(e => e.m.id === id)) return err(L('Bu canavar o bölgenin tabelasında değil.', "This monster isn't on that region's board."));
    if (state.contract?.id === id) return err(L('Bu kontrat zaten sende.', 'You already have this contract.'));
    state.queue = (state.queue || []).filter(x => x !== id);
    if (state.contract && state.contract.hp < state.contract.max) log(L(`${monById(state.contract.id).name} kontratı bırakıldı (ilerleme sıfırlandı).`, `Dropped the ${monById(state.contract.id).name} contract (progress reset).`), 'bad');
    const el = isElite(id), st = monStats(m, el);
    state.contract = { id, max: st.hp, hp: st.hp, since: now().toISOString(), ...(el ? { elite: true } : {}) };
    log(L(`Kontrat alındı (${REGIONS[m.region].name}): ${el ? 'Elit ' : ''}${m.name} (${st.hp} can, ödül ${st.gold} oren).`, `Contract taken (${REGIONS[m.region].name}): ${el ? 'Elite ' : ''}${m.name} (${st.hp} HP, reward ${st.gold} crowns).`), 'epic');
    return ok();
  }
  /* av sırası: canavar ölünce sıradaki kontrat alınır */
  function queueAdd(id) {
    state.queue ||= [];
    if (state.queue.includes(id) || state.contract?.id === id) return err(L('Zaten sırada.', 'Already queued.'));
    if (state.queue.length >= 5) return err(L('Sırada en fazla 5 kontrat olur.', 'At most 5 contracts can be queued.'));
    const m = monById(id);
    if (!boardEntries(m.region).some(e => e.m.id === id && !e.killed)) return err(L('Bu canavar panoda değil.', "This monster isn't on the board."));
    state.queue.push(id); return ok();
  }
  function queueRemove(id) { state.queue = (state.queue || []).filter(x => x !== id); return ok(); }
  function ensureContract() {
    if (state.contract) return state.contract;
    while ((state.queue || []).length) {
      const id = state.queue.shift(), m = MONSTERS.find(x => x.id === id);
      const e = m && boardEntries(m.region).find(x => x.m.id === id && !x.killed);
      if (e) {
        state.contract = { id, max: e.stats.hp, hp: e.stats.hp, since: clockNow().toISOString(), ...(e.elite ? { elite: true } : {}) };
        log(L(`Sıradaki kontrat: ${e.m.name} (${REGIONS[m.region].name}).`, `Next contract: ${e.m.name} (${REGIONS[m.region].name}).`), '');
        return state.contract;
      }
    }
    // kendiliğinden seçim: önce bu kademenin panolarındaki en kolay canavar, yoksa alt kademeler
    const easiest = rs => rs.flatMap(r => boardEntries(r).filter(x => !x.killed && !x.boss).map(x => ({ ...x, r }))).sort((a, b) => a.stats.hp - b.stats.hp)[0];
    const pick = easiest(bandRegions(band())) || easiest(openRegions());
    if (pick) {
      const e = pick, r = pick.r;
      {
        state.contract = { id: e.m.id, max: e.stats.hp, hp: e.stats.hp, since: clockNow().toISOString(), ...(e.elite ? { elite: true } : {}) };
        log(L(`Kontrat seçmediğin için ${REGIONS[r].name} panosundaki en kolay iş alındı: ${e.m.name}.`, `You had no contract, so the easiest job on the ${REGIONS[r].name} board was taken: ${e.m.name}.`), '');
        return state.contract;
      }
    }
    return null;
  }
  const completeLinks = () => state.links.filter(l => l.cards.length >= LINK_SIZE);
  const upLevel = id => (state.swords.up || {})[id] || 0;
  /* kılıcın güncel değeri: taban + güçlendirme + kendi okulunun seti */
  function swordValue(w) {
    if (!w) return 0;
    const own = w.school && w.school === sc();
    return w.type === 'silver' ? w.bonus + upLevel(w.id) * UPGRADE.silver + (own ? 5 : 0) : w.bonus + upLevel(w.id) * UPGRADE.steel + (own ? 3 : 0);
  }
  const baneOf = (w, m) => (w && m && w.bane === m.cls ? BANE : 0);
  /* zincirlerin hasar katkısı: en güçlüsü tam, ikincisi yarım, üçüncüsü üçte bir ... */
  function chainDamage() {
    const list = state.habits.map(h => ({ h, dmg: TIERS[tierOf(h.chain.len)].dmg })).sort((a, b) => b.dmg - a.dmg);
    list.forEach((x, i) => { x.w = CHAIN_WEIGHTS[i] ?? 0.2; x.eff = +(x.dmg * x.w).toFixed(1); });
    return { total: +list.reduce((s, x) => s + x.eff, 0).toFixed(1), list };
  }
  function damageBonus(m = state.contract ? monById(state.contract.id) : null) {
    const parts = []; let raw = 0;
    const sv = swordById(state.swords.silver), stl0 = swordById(state.swords.steel);
    if (sv) { const b = swordValue(sv); raw += b; parts.push(`${sv.name}${upLevel(sv.id) ? ' +' + upLevel(sv.id) : ''} ${L(`+%${b}`, `+${b}%`)}`); }
    for (const w of [sv, stl0]) { const bb = baneOf(w, m); if (bb) { raw += bb; parts.push(L(`${w.name}: ${CLASSES[m.cls]?.tr || m.cls} avcısı +%${bb}`, `${w.name}: ${CLASSES[m.cls]?.tr || m.cls} bane +${bb}%`)); } }
    const ch = chainDamage();
    if (ch.total) { raw += ch.total; parts.push(L(`zincirler +%${ch.total}`, `chains +${ch.total}%`)); }
    const nl = Math.min(LINK_MAX, completeLinks().length);
    if (nl) { raw += nl * LINK_BONUS; parts.push(L(`${nl} kart bağı +%${nl * LINK_BONUS}`, `${nl} card links +${nl * LINK_BONUS}%`)); }
    const stl = swordById(state.swords.steel);
    return { pct: effectiveBonus(raw), raw, parts, crit: swordValue(stl) };
  }
  /* oyuncunun hasar/saat değeri: seviye × (1 + bonus) × ceza */
  function playerStats(m = state.contract ? monById(state.contract.id) : null) {
    const b = damageBonus(m), deb = debuffPct();
    return { dph: powerAt(state.level) * (1 + b.pct / 100) * (1 - deb / 100), crit: b.crit, deb, bonus: b };
  }
  /* başarı anında birkaç saatlik hasar (alışkanlık / yan görev) */
  function burst(hours, why) {
    if (state.combat?.mode === 'recover') return 0;
    const c = ensureContract(); if (!c) return 0;
    return hitMonster(Math.max(1, Math.round(playerStats(monById(c.id)).dph * hours)), why);
  }
  function hitMonster(base, why) {
    const c = ensureContract();
    if (!c || base <= 0) return 0;
    const b = damageBonus(monById(c.id));
    const isCrit = b.crit > 0 && random() * 100 < b.crit;
    const dmg = Math.max(1, Math.round(base * (isCrit ? CRIT_MULT : 1)));
    c.hp = Math.max(0, c.hp - dmg);
    state.stats.dmg += dmg; if (isCrit) state.stats.crits++;
    weekTrack('dmg', dmg); fx(isCrit ? 'crit' : 'hit');
    const m = monById(c.id);
    if (c.hp > 0) { log(L(`${why}: ${m.name} ${dmg} hasar aldı${isCrit ? ' (KRİTİK!)' : ''}. Kalan can ${Math.ceil(c.hp)}/${c.max}.`, `${why}: ${m.name} took ${dmg} damage${isCrit ? ' (CRITICAL!)' : ''}. HP left ${Math.ceil(c.hp)}/${c.max}.`), 'good'); return dmg; }
    killMonster(m, dmg, isCrit, why);
    return dmg;
  }
  function killMonster(m, dmg, isCrit, why) {
    const el = !!state.contract?.elite, s = monStats(m, el);
    // kaç günde öldü: kontratın alındığı andan bu yana geçen süre (24 saate kadar 1 gün, 48'e kadar 2 gün...)
    const since = state.contract?.since;
    const sinceTs = since ? (since.length > 10 ? new Date(since) : fromKey(since)) : null;
    const tk = clockNow();
    state.trophies.push({ id: m.id, at: dk(tk), days: sinceTs ? Math.max(1, Math.ceil((tk - sinceTs) / 86400000)) : null, hours: sinceTs ? +((tk - sinceTs) / 3600000).toFixed(1) : null });
    state.contract = null;
    const gold = addGold(s.gold * (sc() === 'cat' ? 1.3 : sc() === 'bear' ? 0.85 : 1));
    log(L(`${why}: ${dmg} hasarlık${isCrit ? ' kritik' : ''} son darbe! ${el ? 'Elit ' : ''}${m.name} öldü. Ödül: ${gold} oren, ${s.xp} TP.`, `${why}: a ${dmg}-damage${isCrit ? ' critical' : ''} finishing blow! ${el ? 'Elite ' : ''}${m.name} is dead. Reward: ${gold} crowns, ${s.xp} XP.`), 'epic');
    toast(L(`${m.name} öldürüldü! +${gold} oren`, `${m.name} slain! +${gold} crowns`), 'good');
    // kupa: öldürdüğün canavarın kendi Gwent kartı (fraksiyon odağından bağımsız)
    const tc = CARD_BY_ART[m.art];
    if (tc) ev.reveals.push({ title: L(`${m.name} kupası`, `${m.name} trophy`), cards: [giveCard(tc)], trophy: true });
    weekTrack('kills', 1); if (m.boss) weekTrack('bosses', 1);
    fx(m.boss ? 'boss' : 'kill');
    if (m.boss && regionTier(m.region) >= DIAGRAM_FROM_REGION) dropDiagram();
    // sadece içinde bulunulan kademenin boss'u bir sonraki kademeyi açar (alt kademedeki boss'lar ek içeriktir)
    if (m.boss && regionTier(m.region) === band()) {
      if (band() < BAND_COUNT - 1) {
        state.region = band() + 1;
        const bi2 = bandInfo(), names = bi2.regions.map(x => REGIONS[x].name).join(', ');
        log(L(`${m.name} yenildi! Yeni bölgeler açıldı: ${names} (seviye ${bi2.min}–${bi2.max}).`, `${m.name} defeated! New regions unlocked: ${names} (levels ${bi2.min}–${bi2.max}).`), 'epic');
        toast(L(`Yeni bölgeler: ${names}`, `New regions: ${names}`), 'good');
        bi2.regions.forEach(x => ensureBoard(x));
      } else {
        if (!state.legend) {
          state.legend = true;
          log(L(`Son boss ${m.name} yenildi! ${state.name} artık bir efsane. Ya Okul'da yeniden doğ ya da bu karakterle devam et: kestiğin canavarlar ve bölge boss'ları artık elit olarak geri dönüyor, 32'den sonraki TP Ün (★) kazandırıyor.`,
            `Final boss ${m.name} defeated! ${state.name} is now a legend. Be reborn in the School, or keep playing this character: slain monsters and region bosses now return as elites, and XP past level 32 earns Renown (★).`), 'epic');
          toast(L(`${state.name} bir efsane oldu!`, `${state.name} became a legend!`), 'good');
          for (const i of openRegions()) { delete state.boards[i]; ensureBoard(i); }   // tabelalar son oyuna göre yenilensin
        }
      }
    }
    gainXp(s.xp);
  }
  /* ---------- sürekli av ----------
   * Sen canavara sürekli vurursun; canavar sana SADECE alışkanlıklarında başarısız olduğunda vurur
   * (gecikme: yarım vuruş, kaçırma: tam vuruş). Can kendiliğinden dolmaz; sadece Swallow (iksir) doldurur.
   * Can biterse yenilirsin: canavarın canı tamamen dolar, 6 saat toparlanır ve tam canla dönersin. */
  const cbState = () => (state.combat ||= { t: now().toISOString(), mode: 'fight', until: null, last: {} });
  const potionHeal = () => POTION.heal(state.level);
  const potionPrice = () => POTION.price(state.level);
  const schoolHurt = () => (sc() === 'cat' ? 1.5 : sc() === 'bear' ? 0.6 : 1);
  /* başarısızlıkta canavarın vuruşu (kaçırma: tam, gecikme: yarım) */
  function failHit(missed, c = state.contract) {
    const m = c ? monById(c.id) : null;
    const base = m ? monStats(m, !!c.elite).hit : Math.round(REG.hit[Math.min(band(), REG.hit.length - 1)] * 0.8);
    return Math.max(1, Math.round(base * (missed ? 1 : 0.5) * schoolHurt()));
  }
  /* günlüğe ilginç anlar: aynı türden satırlar arasında en az birkaç dakika (oyun zamanı) */
  const FLAVOR_GAP = { start: 0, crit: 0, dodge: 90, potion: 0, defeat: 0, recover: 0, strikeLate: 0, strikeMiss: 0 };
  let flavorBudget = 40;
  function flavor(kind, m, d, type = '') {
    const cb = cbState(), t = clockNow(), last = cb.last?.[kind];
    if (FLAVOR_GAP[kind] && last && t - new Date(last) < FLAVOR_GAP[kind] * 60000) return;
    if (FLAVOR_GAP[kind] && flavorBudget <= 0) return;
    flavorBudget--;
    (cb.last ||= {})[kind] = t.toISOString();
    log(flavorText(kind, m, d), type || (kind === 'defeat' || kind === 'strikeLate' || kind === 'strikeMiss' ? 'bad' : kind === 'crit' ? 'good' : ''));
  }
  /* yenilgi: canavarın canı dolar, 6 saat toparlanırsın */
  function defeat(m, c) {
    const cb = cbState(), t = clockNow();
    state.hp = 0; cb.mode = 'recover'; cb.until = addMin(t, DEFEAT.hours * 60).toISOString();
    if (c) c.hp = c.max;
    flavor('defeat', m); fx('bad'); state.stats.defeats = (state.stats.defeats || 0) + 1;
    toast(L(`${m ? m.name : 'Canavar'} seni yendi! Canı tamamen doldu; ${DEFEAT.hours} saat toparlanacaksın.`, `${m ? m.name : 'The monster'} defeated you! It's back to full HP; you'll recover for ${DEFEAT.hours} hours.`), 'bad');
  }
  /* başarısızlık: canavar vurur. Döndürür: geri alma için bilgi */
  function monsterStrike(missed, why) {
    const c = state.contract, m = c ? monById(c.id) : null;
    const before = { hp: state.hp, contract: c ? { ...c } : null, combat: { ...cbState() } };
    if (cbState().mode === 'recover') return { dealt: 0, before };
    const d = failHit(missed, c);
    state.hp -= d;
    flavor(missed ? 'strikeMiss' : 'strikeLate', m, d);
    const died = state.hp <= 0;
    if (died) defeat(m, c);
    return { dealt: d, died, before };
  }
  /* elle iksir: savaş panelindeki düğme */
  function drinkPotion() {
    if ((state.swallow || 0) <= 0) return err(L('Swallow yok.', 'No Swallow left.'));
    if (state.hp >= maxHp()) return err(L('Canın zaten dolu.', 'Your HP is already full.'));
    if (cbState().mode === 'recover') return err(L('Toparlanıyorsun; toparlanınca canın zaten dolacak.', "You're recovering; your HP will be full when you're back."));
    advanceCombat(now());
    state.swallow--; state.stats.potions = (state.stats.potions || 0) + 1;
    state.hp = Math.min(maxHp(), state.hp + potionHeal());
    log(L(`Bir Swallow içtin: +${potionHeal()} can (${Math.round(state.hp)}/${maxHp()}).`, `You drank a Swallow: +${potionHeal()} HP (${Math.round(state.hp)}/${maxHp()}).`), 'good');
    return ok();
  }
  /* avı 'to' anına kadar ilerlet. Döndürür: özet (öldürülen canavar, kazanılan oren/TP) */
  function advanceCombat(to = now()) {
    if (!idle) return null;
    const cb = cbState();
    let t = new Date(cb.t);
    if (!(t < to)) return null;
    if (to - t > 60 * 864e5) t = new Date(to - 60 * 864e5);              // en fazla 60 günlük geri hesap
    const sum = { minutes: Math.round((to - t) / 60000), kills: 0, gold: 0, xp: 0, potions: 0, defeats: 0, dmg: 0, major: false };
    const g0 = state.stats.goldEarned, lv0 = state.level, xp0 = state.xp;
    flavorBudget = 40;
    if (cb.mode === 'rest') cb.mode = 'fight';                             // eski kayıt: dinlenme kalktı
    while (t < to) {
      const dt = Math.min(STEP_MIN, (to - t) / 60000), h = dt / 60;
      t = new Date(t.getTime() + dt * 60000); logClock = t;
      if (cb.mode === 'recover') {
        if (t >= new Date(cb.until)) { cb.mode = 'fight'; cb.until = null; state.hp = maxHp(); flavor('recover'); sum.major = true; }
        continue;
      }
      const c = ensureContract();
      if (!c) continue;
      const m = monById(c.id), ps = playerStats(m);
      if (!c.started) { c.started = true; flavor('start', m); }
      // kritik: seyrek ama büyük bir an; ortalama katkısı "%crit şansla ×1.5" ile aynı
      const sf = dt / STEP_MIN;
      let pd = ps.dph * h * (0.85 + random() * 0.3);
      const crit = ps.crit > 0 && random() < ps.crit / 100 * CRIT_EVENT * sf;
      if (crit) { pd += ps.dph * (CRIT_MULT - 1) / (12 * CRIT_EVENT); state.stats.crits++; }
      c.hp -= pd; state.stats.dmg += pd; sum.dmg += pd; weekTrack('dmg', Math.round(pd));
      if (crit) flavor('crit', m, Math.max(1, Math.round(pd)));
      else if (random() < 0.03 * sf) flavor('dodge', m);
      if (c.hp <= 0) { c.hp = 0; killMonster(m, Math.round(pd), crit, L('Av', 'Hunt')); sum.kills++; sum.major = true; }
    }
    logClock = null;
    cb.t = to.toISOString();
    expireEffects(to);
    sum.defeats = 0;
    Object.assign(sum, { gold: state.stats.goldEarned - g0, xp: state.level > lv0 ? null : state.xp - xp0, levels: state.level - lv0 });
    if (sum.levels > 0) sum.major = true;
    return sum;
  }
  /* savaş paneli için anlık durum */
  function combatInfo() {
    const cb = cbState(), c = state.contract, m = c ? monById(c.id) : null;
    const ps = playerStats(m);
    const eta = c && ps.dph > 0 ? c.hp / ps.dph : null;
    return { mode: cb.mode === 'rest' ? 'fight' : cb.mode, until: cb.until, dph: Math.round(ps.dph), crit: ps.crit, deb: ps.deb,
      hitLate: failHit(false, c), hitMiss: failHit(true, c),
      eta, potions: state.swallow, potionCap: POTION.cap, potionHeal: potionHeal(), potionPrice: potionPrice(), honey: state.honey || 0,
      effects: (state.effects || []).filter(e => new Date(e.until) > now()) };
  }

  /* --- kartlar (karakterin fraksiyonu + tarafsız) --- */
  const inPool = c => !state.faction || c.f === state.faction || c.f === 'Neutral';
  const poolOf = r => CARDS.filter(c => c.r === r && inPool(c));
  function rollRarity(min) {
    const bonus = Math.min(0.03, bestChainLen() * 0.002);
    const w = { Common: 0.60, Rare: 0.28, Epic: 0.09, Legendary: 0.03 + bonus };
    if (state.pity >= 9 && RAR.indexOf(min) < 2) min = 'Epic';
    const allowed = RAR.slice(RAR.indexOf(min));
    const total = allowed.reduce((s, r) => s + w[r], 0);
    let x = random() * total, r = allowed[0];
    for (const a of allowed) { if ((x -= w[a]) <= 0) { r = a; break; } }
    state.pity = RAR.indexOf(r) >= 2 ? 0 : state.pity + 1;
    return r;
  }
  function giveCard(card) {
    const isNew = !state.collection[card.a];
    state.collection[card.a] = (state.collection[card.a] || 0) + 1;
    if (!isNew) state.scraps += SCRAP[card.r];
    state.draws++; weekTrack('cards', 1);
    return { ...card, isNew };
  }
  function drawCards(count, min = 'Common', title = L('Ganimet', 'Loot')) {
    const got = [];
    for (let i = 0; i < count; i++) got.push(giveCard(rnd(poolOf(rollRarity(i === 0 ? (min || 'Common') : 'Common')))));
    got.forEach(c => { if (c.r === 'Legendary') log(L(`Efsanevi kart: ${c.n}!`, `Legendary card: ${c.n}!`), 'epic'); });
    ev.reveals.push({ title, cards: got });
    return got;
  }

  /* --- ana görev --- */
  function completeQuest(k) {
    const q = Q();
    q.status = 'mastery'; q.completedAt = k; q.awaitingChoice = true;
    state.questHistory.push({ id: q.id, name: q.name, type: q.type, days: q.days, start: q.start, end: k, result: 'completed', successes: q.progress, char: state.name });
    addGold(150);
    log(L(`ANA GÖREV TAMAMLANDI: "${q.name}" ${q.days} günde edinildi! +150 oren, +100 TP, Efsanevi kart.`, `MAIN QUEST COMPLETE: "${q.name}" formed in ${q.days} days! +150 crowns, +100 XP, a Legendary card.`), 'epic');
    toast(L(`"${q.name}" alışkanlığı edinildi!`, `Habit formed: "${q.name}"!`), 'good'); fx('achieve');
    drawCards(1, 'Legendary', L(`${q.name} edinildi`, `${q.name} formed`));
    gainXp(100);
  }

  /* ---------- eylemler ---------- */
  function declareRest() {
    const n = now(), k = restTarget(n);
    if (isRest(k)) return err(L('Zaten dinlenme günü.', 'Already a rest day.'));
    if (n >= restBy(k)) return err(L('Dinlenme günü, o günün ilk görev aralığı başlamadan ilan edilmeli.', "A rest day must be declared before that day's first quest window starts."));
    if (restUsedInWeek(k)) return err(L('Bu haftaki dinlenme hakkını kullandın.', "You've used this week's rest day."));
    state.restDays[k] = n.toISOString();
    log(L(`${longDate(k)} dinlenme günü ilan edildi. Bütün zincirler o gün donar.`, `${longDate(k)} declared a rest day. All chains freeze that day.`), '');
    return ok();
  }
  function prep() {
    if (!isSleep()) return err(L('Bu görevde hazırlık adımı yok.', 'This quest has no preparation step.'));
    advanceCombat(now());
    const n = now(), k = upcoming(n), day = getDay(k), w = W(k);
    if (phase(k, n) !== 'prep') return err(L('Meditasyon şu an açık değil.', "Meditation isn't open right now."));
    if (day.med) return err(L('Bu gece zaten meditasyon yaptın.', 'You already meditated tonight.'));
    return doPrep(k, n);
  }
  function doPrep(k, n) {
    const day = getDay(k), w = W(k);
    day.med = n.toISOString(); day.q = Q().id;
    day.medOnTime = n <= w.prepEnd;
    if (day.medOnTime) {
      addGold(DAY_GOLD.prep); gainXp(DAY_XP.prep);
      log(L(`Yatış aralığında meditasyona çekildin (${hm(n)}). +${DAY_XP.prep} TP, +${DAY_GOLD.prep} oren. Sabah ödülün ×${sc() === 'griffin' ? 1.8 : 1.5} ve +1 kart.`, `You meditated within your bedtime window (${hm(n)}). +${DAY_XP.prep} XP, +${DAY_GOLD.prep} crowns. Morning reward ×${sc() === 'griffin' ? 1.8 : 1.5} and +1 card.`), 'good');
      fx('prep');
      burst(BURST.prep, L('Zamanında yattın', 'You went to bed on time'));
      toast(L('Madalyon sustu. İyi uykular, witcher.', 'The medallion is still. Sleep well, witcher.'), 'good');
    } else {
      log(L(`Aralık dışında meditasyon (${hm(n)}). Sabah ödülün yine de ×1.15.`, `Meditation outside the window (${hm(n)}). Morning reward still ×1.15.`), '');
      toast(L('Geç kaldın ama hiç yoktan iyidir. Hemen uyu.', "You're late, but better than nothing. Go to sleep now."), '');
    }
    return ok();
  }
  function rewardMult(day, n, k) {
    let mult = 1; const parts = [];
    if (day.med) { const m = day.medOnTime ? (sc() === 'griffin' ? 1.8 : 1.5) : 1.15; mult *= m; parts.push(L(`meditasyon ×${m}`, `meditation ×${m}`)); }
    const tier = TIERS[tierOf(C().len)];
    if (tier.mult > 1) { mult *= tier.mult; parts.push(L(`${tier.name} zincir ×${tier.mult}`, `${tier.name} chain ×${tier.mult}`)); }
    if (sc() === 'wolf' && C().len > 0) { const m = +(1 + Math.min(10, C().len) * 0.05).toFixed(2); mult *= m; parts.push(L(`kurt ×${m}`, `wolf ×${m}`)); }
    if (sc() === 'viper' && n && n <= addMin(W(k).checkStart, 10)) { mult *= 1.4; parts.push(L('engerek dakikliği ×1.4', 'viper punctuality ×1.4')); }
    if (sc() === 'bear') { mult *= 0.85; parts.push(L('ayı ×0.85', 'bear ×0.85')); }
    if (Q().status === 'mastery') { mult *= MASTERY_MULT; parts.push(L(`ustalık ×${MASTERY_MULT}`, `mastery ×${MASTERY_MULT}`)); }
    return { mult, parts };
  }
  function checkIn() {
    advanceCombat(now());
    const n = now(), k = upcoming(n), day = getDay(k), w = W(k);
    if (day.result) return err(L('Bugün zaten işaretlendi.', 'Already marked today.'));
    if (n < w.checkOpen) return err(L('Henüz açık değil.', 'Not open yet.'));
    return doCheck(k, n);
  }
  function doCheck(k, n) {
    const day = getDay(k), w = W(k);
    day.check = n.toISOString(); day.q = Q().id;
    const q0 = Q(), verb = isSleep() ? 'kalktın' : `"${q0.name}" görevini tamamladın`, verbEn = isSleep() ? 'woke up' : `completed "${q0.name}"`;
    if (n <= w.checkEnd) {
      const { mult, parts } = rewardMult(day, n, k);
      const xp = Math.round((isSleep() ? DAY_XP.wake : DAY_XP.daily) * mult);
      const gold = addGold((isSleep() ? DAY_GOLD.wake : DAY_GOLD.daily) * mult);
      day.result = 'success'; day.reward = { xp, gold, payout: 0, mult: +mult.toFixed(2) }; fx('check');
      log(L(`${sfx(hm(n), 'da')} ${verb}! +${xp} TP, +${gold} oren${parts.length ? ` (${parts.join(', ')})` : ''}.`, `You ${verbEn} at ${hm(n)}! +${xp} XP, +${gold} crowns${parts.length ? ` (${parts.join(', ')})` : ''}.`), 'good');
      state.cardDay = state.cardDay?.k === k ? state.cardDay : { k, n: 0 };
      const nCards = (state.cardDay.n === 0 ? CARDS_PER.first : CARDS_PER.next) + (day.medOnTime ? CARDS_PER.prepBonus : 0);
      state.cardDay.n++;
      drawCards(nCards, 'Common', `${q0.name}: ${isSleep() ? L('sabah ganimeti', 'morning loot') : L('günün ganimeti', "today's loot")}`);
      chainSuccess(k);
      burst(BURST.habit, isSleep() ? L('Zamanında kalktın', 'You woke up on time') : L(`"${q0.name}" tamamlandı`, `"${q0.name}" done`));
      gainXp(xp);
      const q = Q();
      if (q.status === 'active') { q.progress++; if (q.progress >= q.days) completeQuest(k); }
    } else if (isRest(k)) {
      day.result = 'rest';
      log(L(`Dinlenme günü, ${sfx(hm(n), 'da')} ${verb}. Ceza yok, zincir donmuş halde.`, `Rest day, you ${verbEn} at ${hm(n)}. No penalty, the chain stays frozen.`), '');
      addLink(k, 'rest');
    } else {
      day.result = 'late'; fx('bad');
      log(L(`${sfx(hm(n), 'da')} ${verb}, ama aralık bitmişti (${hm(w.checkEnd)}). +${DAY_XP.late} TP, kart yok.`, `You ${verbEn} at ${hm(n)}, but the window had ended (${hm(w.checkEnd)}). +${DAY_XP.late} XP, no cards.`), 'bad');
      chainLate(k);
      addEffect('tired', Q().name);
      monsterStrike(false);
      gainXp(DAY_XP.late);
    }
    return ok();
  }
  function applyMissed(k) {
    const day = getDay(k);
    day.q ||= Q().id;
    if (Q().type === 'count' && (day.count || 0) >= Q().count.target / 2 && !isRest(k)) {
      // adet hedefinin en az yarısı: gecikme gibi sayılır
      day.result = 'late'; fx('bad');
      log(L(`"${Q().name}": ${longDate(k)} hedefin yarısına ulaştın (${day.count}/${Q().count.target}). Paslı halka, kart yok.`, `"${Q().name}": on ${longDate(k)} you reached half the target (${day.count}/${Q().count.target}). Rusty link, no cards.`), 'bad');
      chainLate(k); addEffect('tired', Q().name); monsterStrike(false); gainXp(DAY_XP.late);
      return;
    }
    if (isRest(k)) {
      day.result = 'rest'; addLink(k, 'rest');
      log(L(`${longDate(k)}: dinlenme günü. Zincir donmuş halde bekliyor.`, `${longDate(k)}: rest day. The chain waits, frozen.`), '');
      return;
    }
    day.result = 'fail';
    // sonradan işlenirse geri alınabilsin diye kaçırmanın etkileri kaydedilir
    const undo = { chain: JSON.parse(JSON.stringify(C())), honeyUsed: false, effect: null, strike: null };
    log(L(`"${Q().name}": ${longDate(k)} kaçırıldı.`, `"${Q().name}": ${longDate(k)} was missed.`), 'bad');
    chainBreak(k, L('kaçırılan gün', 'missed day'));
    if ((state.honey || 0) > 0) {
      state.honey--; undo.honeyUsed = true;
      log(L('White Honey işe yaradı: canavar vuramadı, Bitkin olmadın.', "White Honey worked: the monster couldn't strike and you didn't become Exhausted."), '');
    } else {
      undo.effect = addEffect('exhausted', Q().name);
      undo.strike = monsterStrike(true).before;
    }
    day.undo = undo;
  }

  /* --- kaçırılan günü sonradan işle (bilgisayar kapalıyken gerçekten yaptıysan) --- */
  function correctableDay(n = now()) {
    const days = Q().entries, keys = Object.keys(days).filter(x => days[x].result).sort();
    const k = keys.at(-1);
    if (!k) return null;
    const d = days[k];
    if (d.result !== 'fail' || !d.undo || (d.q && d.q !== Q().id)) return null;
    const deadline = addMin(W(k).lateLimit, RETRO_HOURS * 60);
    return n <= deadline ? { k, deadline } : null;
  }
  function correctMissed(k, { wake, bed, count } = {}) {
    const c = correctableDay();
    if (!c || c.k !== k) return err(L('Bu gün artık sonradan işlenemez (24 saat geçti ya da sonraki gün işlendi).', 'This day can no longer be entered (24 hours passed or the next day was processed).'));
    if (Q().type === 'count') {
      count = Math.round(+count);
      if (!(count >= 1)) return err(L('O gün kaç tane yaptığını gir.', 'Enter how many you did that day.'));
      wake = hm(addMin(W(k).checkEnd, -60));
    }
    if (Q().type === 'check' && !wake) wake = '12:00';
    if (!/^\d\d:\d\d$/.test(wake || '')) return err(isSleep() ? L('Kalkış saatini gir.', 'Enter your wake-up time.') : L('Görevi yaptığın saati gir.', 'Enter the time you did the quest.'));
    const w = W(k), t = at(k, wake);
    if (t < w.checkOpen) return err(L(`Bu saat çok erken (en erken ${hm(w.checkOpen)}).`, `That time is too early (earliest ${hm(w.checkOpen)}).`));
    if (t > w.lateLimit) return err(L('Bu saat zaten "kaçırıldı" sayılır.', 'That time already counts as "missed".'));
    if (t > now() && Q().type !== 'count' && Q().type !== 'check') return err(L('Gelecekteki bir saat girilemez.', "You can't enter a time in the future."));
    let tb = null;
    if (bed && isSleep()) {
      if (!/^\d\d:\d\d$/.test(bed)) return err(L('Yatış saati geçersiz.', 'Invalid bedtime.'));
      tb = at(toMin(bed) >= 720 ? addDays(k, -1) : k, bed);
      if (tb < w.prepOpen || tb > w.prepClose) return err(L(`Yatış saati ${hm(w.prepOpen)}–${hm(w.prepClose)} arasında olmalı.`, `Bedtime must be between ${hm(w.prepOpen)} and ${hm(w.prepClose)}.`));
      if (tb >= t) return err(L('Yatış saati kalkıştan önce olmalı.', 'Bedtime must be before wake-up.'));
    }
    // kaçırmanın etkilerini geri al
    const day = Q().entries[k], u = day.undo;
    Q().chain = u.chain;
    if (u.honeyUsed) state.honey = (state.honey || 0) + 1;
    if (u.effect) state.effects = state.effects.filter(e => e.id !== u.effect);
    if (u.strike) {                                            // canavarın vuruşunu (ve yenilgiyi) geri al
      state.hp = Math.min(maxHp(), u.strike.hp);
      if (state.combat?.mode === 'recover' && u.strike.combat.mode !== 'recover') { state.combat.mode = 'fight'; state.combat.until = null; }
      if (u.strike.contract && state.contract?.id === u.strike.contract.id) state.contract.hp = Math.min(state.contract.hp, u.strike.contract.hp);
    }
    delete day.result; delete day.undo; day.retro = now().toISOString();
    log(L(`📝 ${longDate(k)} sonradan işlendi: ${isSleep() ? 'kalkış' : 'saat'} ${wake}${tb ? `, yatış ${bed}` : ''}. Kaçırmanın etkileri geri alındı.`, `📝 ${longDate(k)} entered late: ${isSleep() ? 'woke' : 'time'} ${wake}${tb ? `, bed ${bed}` : ''}. The effects of missing it were undone.`), 'epic');
    if (tb && !day.med) doPrep(k, tb);
    if (Q().type === 'count') {
      day.count = count;
      if (count >= Q().count.target) doCheck(k, t);
      else { applyMissed(k); delete day.undo; }
      return ok();
    }
    doCheck(k, t);
    return ok();
  }
  function processPending() {
    let changed = false, major = false;
    const sums = [];
    // gün sonları ve savaş zaman sırasıyla: bir günün cezası, o andan sonraki savaşı etkiler
    for (let guard = 0; guard < 2000; guard++) {
      let next = null;
      for (const h of state.habits) on(h, () => {
        if (!h.start) return;
        let k = addDays(h.lastProcessed || addDays(h.start, -1), 1);
        if (k < h.start) k = h.start;
        const ll = W(k).lateLimit;
        if (now() > ll && (!next || ll < next.ll)) next = { h, k, ll };
      });
      if (!next) break;
      const s0 = advanceCombat(next.ll); if (s0) sums.push(s0);
      logClock = next.ll;
      on(next.h, () => { if (!next.h.entries[next.k]?.result) applyMissed(next.k); next.h.lastProcessed = next.k; });
      logClock = null; changed = true;
    }
    const s1 = advanceCombat(now()); if (s1) sums.push(s1);
    if (sums.length) {
      const tot = sums.reduce((a, s) => ({ minutes: a.minutes + s.minutes, kills: a.kills + s.kills, gold: a.gold + s.gold, potions: a.potions + s.potions, defeats: a.defeats + s.defeats, levels: a.levels + (s.levels || 0), dmg: a.dmg + s.dmg, major: a.major || s.major }),
        { minutes: 0, kills: 0, gold: 0, potions: 0, defeats: 0, levels: 0, dmg: 0, major: false });
      ev.combat = tot; major = tot.major;
      if (tot.minutes >= 60 && (tot.kills || tot.defeats || tot.levels)) ev.offline = tot;
    }
    const home = homeRegion(), before = state.boards?.[home]?.key, wkBefore = state.weekStats?.key;
    ensureBoard();
    ensureWeekStats();
    const ach = checkAchievements().length;
    return changed || major || ach > 0 || before !== state.boards[home].key || wkBefore !== state.weekStats.key;
  }

  /* --- ana görev yönetimi --- */
  /* alışkanlığı listeden çıkar: günleri geçmiş kaydında saklanır */
  function retireHabit(old, keepAsSide) {
    const n = now(), kOld = on(old, () => upcoming(n)), d = old.entries[kOld];
    if (d && !d.result) delete old.entries[kOld];
    const rec = state.questHistory.find(x => x.id === old.id && x.result === 'completed');
    if (old.status === 'active') {
      state.questHistory.push({ id: old.id, name: old.name, type: old.type, days: old.days, start: old.start, end: dk(n), result: 'abandoned', successes: old.progress, char: state.name, entries: old.entries });
      log(L(`"${old.name}" alışkanlığı bırakıldı (${old.progress}/${old.days}).`, `Habit "${old.name}" abandoned (${old.progress}/${old.days}).`), 'bad');
    } else {
      if (rec) rec.entries = old.entries;
      log(L(`"${old.name}" alışkanlığı listeden çıkarıldı (edinilmişti).`, `Habit "${old.name}" removed from the list (already formed).`), '');
    }
    if (keepAsSide && !state.quests.some(x => x.name === old.name)) state.quests.push({ id: uid(), name: old.name, xp: 5, gold: 3 });
    state.habits = state.habits.filter(h => h !== old);
  }
  /* yeni alışkanlık ekle; replace verilirse o alışkanlık bırakılıp yerine bu gelir */
  function startQuest(cfg, { keepAsSide = false, replace = null } = {}) {
    const { id, progress, status, start, completedAt, awaitingChoice, chain, entries, lastProcessed, ...clean } = cfg || {};
    const q = makeHabit(clean);
    const e = validateQuest(q);
    if (e) return err(e);
    const old = replace === true ? state.habits[0] : replace ? habitById(replace) : null;
    if (!old && state.habits.length >= MAX_HABITS) return err(L(`En fazla ${MAX_HABITS} alışkanlık olabilir.`, `You can have at most ${MAX_HABITS} habits.`));
    const n = now();
    if (old) { const i = state.habits.indexOf(old); retireHabit(old, keepAsSide); state.habits.splice(Math.max(0, i), 0, q); }
    else state.habits.push(q);
    on(q, () => { q.start = upcoming(n); q.lastProcessed = addDays(q.start, -1); });
    log(L(`Yeni alışkanlık: "${q.name}" (${habitTypeName(q.type)}, ${q.days} gün). İlk gün: ${longDate(q.start)}.`, `New habit: "${q.name}" (${habitTypeName(q.type)}, ${q.days} days). First day: ${longDate(q.start)}.`), 'epic');
    return { ok: true, habit: q };
  }
  function removeHabit(hid, { keepAsSide = false } = {}) {
    const h = habitById(hid);
    if (!h) return err(L('Alışkanlık bulunamadı.', 'Habit not found.'));
    if (state.habits.length <= 1) return err(L('En az bir alışkanlığın olmalı. Yerine yenisini başlatabilirsin.', 'You need at least one habit. You can start a new one in its place.'));
    retireHabit(h, keepAsSide);
    return ok();
  }
  function updateQuest(cfg, hid) {
    const old = (hid && habitById(hid)) || Q();
    const merged = makeQuest({ ...old, ...cfg, id: old.id, progress: old.progress, start: old.start, type: old.type });
    Object.assign(merged, { status: old.status, completedAt: old.completedAt, awaitingChoice: old.awaitingChoice, chain: old.chain, entries: old.entries, lastProcessed: old.lastProcessed });
    const e = validateQuest(merged);
    if (e) return err(e);
    if (old.status === 'active' && merged.days <= merged.progress) return err(L(`Süre şu anki ilerlemenden (${merged.progress}) büyük olmalı.`, `Duration must be greater than your current progress (${merged.progress}).`));
    state.habits[state.habits.indexOf(old)] = merged;
    log(L(`"${merged.name}" ayarları güncellendi.`, `"${merged.name}" settings updated.`));
    return ok();
  }
  /* adet türü: gün içinde yapılan sayıyı ekle (eksi de olabilir); hedefe ulaşınca gün başarılı olur */
  function addCount(n) {
    if (Q().type !== 'count') return err(L('Bu alışkanlık adet türünde değil.', "This habit isn't a count habit."));
    const t = now(), k = upcoming(t), day = getDay(k), w = W(k), goal = Q().count.target;
    if (day.result) return err(L('Bu günün sonucu zaten belli.', "This day's result is already set."));
    if (t < w.checkOpen) return err(L('Henüz açık değil.', 'Not open yet.'));
    day.count = Math.max(0, (day.count || 0) + Math.round(+n || 0));
    day.q = Q().id;
    if (day.count >= goal) { advanceCombat(now()); return doCheck(k, t); }
    return ok();
  }
  function continueMastery() {
    const q = Q();
    if (q.status !== 'mastery') return err(L('Görev henüz tamamlanmadı.', 'The quest is not complete yet.'));
    q.awaitingChoice = false;
    log(L(`"${q.name}" için ustalık yolu: ödüller ×${MASTERY_MULT}, hasar ×${MASTERY_DMG}.`, `Path of mastery for "${q.name}": rewards ×${MASTERY_MULT}, damage ×${MASTERY_DMG}.`), '');
    return ok();
  }

  /* --- yan görevler, tüccar, kılıçlar --- */
  function completeSide(id) {
    const t = logicalToday(), done = (state.questLog[t] ||= []);
    const q = state.quests.find(x => x.id === id);
    if (!q) return err(L('Yan görev bulunamadı.', 'Side quest not found.'));
    if (done.includes(id)) return err(L('Bugün zaten yapıldı.', 'Already done today.'));
    advanceCombat(now());
    done.push(id); addGold(+q.gold); gainXp(+q.xp);
    log(L(`Yan görev tamamlandı: ${q.name}. +${q.xp} TP, +${q.gold} oren.`, `Side quest done: ${q.name}. +${q.xp} XP, +${q.gold} crowns.`), 'good');
    burst(BURST.side, L(`Yan görev (${q.name})`, `Side quest (${q.name})`));
    return ok();
  }
  function addSide(name, xp, gold) {
    name = (name || '').trim();
    if (!name) return err(L('Ad gerekli.', 'A name is required.'));
    state.quests.push({ id: uid(), name, xp: Math.max(1, Math.min(50, +xp || 5)), gold: Math.max(0, Math.min(50, +gold || 0)) });
    return ok();
  }
  function removeSide(id) { state.quests = state.quests.filter(q => q.id !== id); return ok(); }
  function shopItems() {
    return SHOP.map(i => ({ ...i, price: i.id === 'swallow' ? potionPrice() : i.price, disabled: (i.id === 'swallow' && state.swallow >= POTION.cap) || (i.id === 'honey' && (state.honey || 0) >= HONEY_MAX) }));
  }
  function buy(id) {
    const it = shopItems().find(i => i.id === id);
    if (!it) return err(L('Böyle bir şey yok.', 'No such item.'));
    if (it.disabled) return err(L('Şu an alınamaz.', "Can't buy that right now."));
    if (state.gold < it.price) return err(L('Yeterli orenin yok.', "You don't have enough crowns."));
    state.gold -= it.price;
    if (id === 'keg') drawCards(3, 'Rare', it.name);
    if (id === 'bigkeg') drawCards(5, 'Epic', it.name);
    if (id === 'swallow') { state.swallow++; log(L(`Swallow aldın (${state.swallow}/${POTION.cap}).`, `You bought a Swallow (${state.swallow}/${POTION.cap}).`)); }
    if (id === 'honey') { state.honey = (state.honey || 0) + 1; log(L(`White Honey aldın (${state.honey}/${HONEY_MAX}).`, `You bought White Honey (${state.honey}/${HONEY_MAX}).`)); }
    return ok();
  }
  /* demirci: her gün tür başına 5 kılıç (tarih + karaktere göre sabit, sahip olunanlar hariç) */
  const shopRerolls = (k = dk(now())) => (state.rerolls?.shop?.date === k ? state.rerolls.shop.n : 0);
  const shopRerollCost = () => REROLL.shop * (shopRerolls() + 1);
  function rerollShop() {
    const k = dk(now()), cost = shopRerollCost();
    if (state.gold < cost) return err(L(`${cost} oren gerekiyor.`, `You need ${cost} crowns.`));
    state.gold -= cost;
    state.rerolls ||= {};
    state.rerolls.shop = { date: k, n: shopRerolls(k) + 1 };
    log(L(`Demirci stoğunu yeniledi (${cost} oren).`, `The blacksmith restocked (${cost} crowns).`));
    return ok();
  }
  function dailySwords(type, k = dk(now())) {
    const n = shopRerolls(k);
    const r = seeded(hashStr(`${k}|${state.charId}|${type}${n ? '|' + n : ''}`));
    // seviyene göre: 3 kılıç senin kademenden, 1 alt kademeden, 1 üst kademeden (hedef). okul setleri satılmaz (boss şeması).
    const avail = SWORDS.filter(w => w.type === type && !w.set && !state.swords.owned.includes(w.id));
    const tiers = [...new Set(SWORDS.filter(w => w.type === type && !w.set).map(w => w.tier))].sort((a, b) => a - b);
    const myTier = tiers.filter(t => SWORDS.some(w => w.type === type && !w.set && w.tier === t && w.level <= state.level)).pop() || tiers[0];
    const ti = tiers.indexOf(myTier);
    const want = [[myTier, 3], [tiers[ti - 1], 1], [tiers[ti + 1], 1]];
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const out = [];
    for (const [t, n] of want) if (t != null) out.push(...shuffle(avail.filter(w => w.tier === t)).slice(0, n));
    // bir kademe tükendiyse en yakın kademelerden tamamla
    const rest = shuffle(avail.filter(w => !out.includes(w))).sort((a, b) => Math.abs(a.tier - myTier) - Math.abs(b.tier - myTier));
    while (out.length < SHOP_DAILY && rest.length) out.push(rest.shift());
    return out.slice(0, SHOP_DAILY).sort((a, b) => a.tier - b.tier || a.price - b.price);
  }
  function buySword(id) {
    const w = swordById(id);
    if (!w) return err(L('Böyle bir kılıç yok.', 'No such sword.'));
    if (w.set) return err(L('Okul setleri satılmaz; boss şemasıyla yapılır.', "School sets aren't sold; they're crafted from boss diagrams."));
    if (state.swords.owned.includes(id)) return err(L('Bu kılıç zaten sende.', 'You already own this sword.'));
    if (!dailySwords(w.type).some(x => x.id === id)) return err(L('Demirci bugün bu kılıcı satmıyor.', "The blacksmith isn't selling this sword today."));
    if (state.level < w.level) return err(L(`Bu kılıç için en az ${w.level}. seviye olmalısın.`, `You need to be at least level ${w.level} for this sword.`));
    if (state.gold < w.price) return err(L('Yeterli orenin yok.', "You don't have enough crowns."));
    state.gold -= w.price; state.swords.owned.push(id);
    if (!state.swords[w.type]) state.swords[w.type] = id;
    log(L(`${w.name} satın alındı (${w.price} oren).${state.swords[w.type] === id ? ' Kuşandın.' : ''}`, `Bought ${w.name} (${w.price} crowns).${state.swords[w.type] === id ? ' Equipped.' : ''}`), 'epic');
    return ok();
  }
  function upgradeCost(id) {
    const w = swordById(id), u = upLevel(id);
    if (!w || u >= UPGRADE.max) return null;
    return { to: u + 1, gold: Math.round(w.price * UPGRADE.goldMult[u] / 5) * 5, scraps: UPGRADE.scraps[u] };
  }
  function upgradeSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    const c = upgradeCost(id);
    if (!c) return err(L(`Bu kılıç zaten +${UPGRADE.max}.`, `This sword is already +${UPGRADE.max}.`));
    if (state.gold < c.gold) return err(L(`${c.gold} oren gerekiyor.`, `You need ${c.gold} crowns.`));
    if (state.scraps < c.scraps) return err(L(`${c.scraps} kırıntı gerekiyor.`, `You need ${c.scraps} scraps.`));
    state.gold -= c.gold; state.scraps -= c.scraps;
    state.swords.up ||= {}; state.swords.up[id] = c.to;
    log(L(`${w.name} +${c.to} oldu (${c.gold} oren, ${c.scraps} kırıntı). ${w.type === 'silver' ? `Hasar +%${swordValue(w)}` : `Kritik %${swordValue(w)}`}.`, `${w.name} is now +${c.to} (${c.gold} crowns, ${c.scraps} scraps). ${w.type === 'silver' ? `Damage +${swordValue(w)}%` : `Crit ${swordValue(w)}%`}.`), 'epic');
    return ok();
  }
  function upgradeSpent(id) {
    const w = swordById(id); let gold = 0, scraps = 0;
    for (let u = 0; u < upLevel(id); u++) { gold += Math.round(w.price * UPGRADE.goldMult[u] / 5) * 5; scraps += UPGRADE.scraps[u]; }
    return { gold, scraps };
  }
  const transferFee = id => Math.round(swordById(id).price * TRANSFER_FEE / 5) * 5;
  function transferUpgrades(fromId, toId) {
    const a = swordById(fromId), b = swordById(toId);
    if (!a || !b || !state.swords.owned.includes(fromId) || !state.swords.owned.includes(toId)) return err(L('İki kılıç da sende olmalı.', 'You must own both swords.'));
    if (a.type !== b.type) return err(L('Güçlendirme sadece aynı türdeki (gümüş↔gümüş, çelik↔çelik) kılıca aktarılır.', 'Upgrades only transfer between swords of the same type (silver↔silver, steel↔steel).'));
    if (upLevel(fromId) <= upLevel(toId)) return err(L('Hedef kılıç zaten en az bu kadar güçlendirilmiş.', 'The target sword is already upgraded at least this much.'));
    const fee = transferFee(toId);
    if (state.gold < fee) return err(L(`${fee} oren gerekiyor.`, `You need ${fee} crowns.`));
    state.gold -= fee;
    state.swords.up[toId] = upLevel(fromId); state.swords.up[fromId] = 0;
    log(L(`${a.name} üzerindeki +${state.swords.up[toId]} güçlendirme ${b.name}'a aktarıldı (${fee} oren).`, `Transferred the +${state.swords.up[toId]} upgrade from ${a.name} to ${b.name} (${fee} crowns).`), 'epic');
    return ok();
  }
  function dismantleValue(id) {
    const w = swordById(id), sp = upgradeSpent(id);
    return { gold: Math.round((w.price + sp.gold) * DISMANTLE.gold), scraps: Math.round(sp.scraps * DISMANTLE.scraps) };
  }
  function dismantleSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    if (state.swords[w.type] === id) return err(L('Kuşandığın kılıcı eritemezsin.', "You can't dismantle an equipped sword."));
    const v = dismantleValue(id);
    state.swords.owned = state.swords.owned.filter(x => x !== id); delete state.swords.up[id];
    state.gold += v.gold; state.scraps += v.scraps;
    log(L(`${w.name} eritildi: +${v.gold} oren, +${v.scraps} kırıntı.`, `${w.name} dismantled: +${v.gold} crowns, +${v.scraps} scraps.`));
    return ok();
  }
  /* okul seti şemaları: önce kendi okulunun seti (çelik, sonra gümüş), sonra diğer okullar */
  function dropDiagram() {
    const have = new Set([...state.swords.owned, ...state.diagrams]);
    const sets = SWORDS.filter(w => w.set && !have.has(w.id));
    if (!sets.length) return null;
    const mine = sets.filter(w => w.school === sc()).sort((a, b) => (a.type === 'steel' ? 0 : 1) - (b.type === 'steel' ? 0 : 1));
    const w = mine[0] || rnd(sets);
    state.diagrams.push(w.id);
    log(L(`Boss bir şema düşürdü: ${w.name}. Demircide yaptırabilirsin.`, `The boss dropped a diagram: ${w.name}. You can have it crafted at the blacksmith.`), 'epic');
    toast(L(`Şema: ${w.name}`, `Diagram: ${w.name}`), 'good');
    return w;
  }
  const craftCost = id => ({ gold: swordById(id).price, scraps: SET_CRAFT_SCRAPS });
  function craftSword(id) {
    const w = swordById(id);
    if (!w || !state.diagrams.includes(id)) return err(L('Bu kılıcın şeması sende yok.', "You don't have this sword's diagram."));
    if (state.level < w.level) return err(L(`Bu kılıç için en az ${w.level}. seviye olmalısın.`, `You need to be at least level ${w.level} for this sword.`));
    const c = craftCost(id);
    if (state.gold < c.gold) return err(L(`${c.gold} oren gerekiyor.`, `You need ${c.gold} crowns.`));
    if (state.scraps < c.scraps) return err(L(`${c.scraps} kırıntı gerekiyor.`, `You need ${c.scraps} scraps.`));
    state.gold -= c.gold; state.scraps -= c.scraps;
    state.diagrams = state.diagrams.filter(x => x !== id); state.swords.owned.push(id);
    if (!state.swords[w.type]) state.swords[w.type] = id;
    log(L(`Demirci ${w.name}'ı yaptı (${c.gold} oren, ${c.scraps} kırıntı).`, `The blacksmith crafted ${w.name} (${c.gold} crowns, ${c.scraps} scraps).`), 'epic');
    return ok();
  }
  /* bir canavara karşı en iyi kılıç: güçlendirme + okul + bane dahil */
  function bestSwordFor(type, m) {
    const owned = state.swords.owned.map(swordById).filter(w => w && w.type === type);
    const score = w => swordValue(w) * (type === 'steel' ? 0.5 : 1) + baneOf(w, m);
    return owned.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function equipBest(m = state.contract ? monById(state.contract.id) : null) {
    let changed = false;
    for (const type of ['silver', 'steel']) { const w = bestSwordFor(type, m); if (w && state.swords[type] !== w.id) { state.swords[type] = w.id; changed = true; } }
    if (changed) log(L('Bu kontrat için en iyi kılıçlar kuşanıldı.', 'Equipped the best swords for this contract.'));
    return ok();
  }
  function equipSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    state.swords[w.type] = id;
    log(L(`${w.name} kuşanıldı.`, `${w.name} equipped.`));
    return ok();
  }
  function craft(a) {
    const c = CARD_BY_ART[a];
    if (!c) return err(L('Kart yok.', 'No such card.'));
    if (!inPool(c)) return err(L('Bu kart karakterinin fraksiyonunda değil.', "This card isn't in your character's faction."));
    if (state.scraps < CRAFT[c.r]) return err(L('Yeterli kırıntı yok.', 'Not enough scraps.'));
    state.scraps -= CRAFT[c.r];
    ev.reveals.push({ title: L('Üretilen kart', 'Crafted card'), cards: [giveCard(c)] });
    log(L(`${c.n} kartını ${CRAFT[c.r]} kırıntıyla ürettin.`, `You crafted ${c.n} for ${CRAFT[c.r]} scraps.`), 'epic');
    return ok();
  }

  /* --- kart bağları --- */
  const usedInLinks = () => new Set(state.links.flatMap(l => l.cards));
  function linkOptions(faction) {
    const used = usedInLinks(), counts = {};
    CARDS.filter(c => c.f === faction && state.collection[c.a] && !used.has(c.a))
      .forEach(c => cardCats(c).forEach(cat => { counts[cat] = (counts[cat] || 0) + 1; }));
    return counts;
  }
  function eligibleForLink(linkId) {
    const l = state.links.find(x => x.id === linkId); if (!l) return [];
    const used = usedInLinks();
    return CARDS.filter(c => c.f === l.f && state.collection[c.a] && !used.has(c.a) && cardCats(c).includes(l.cat));
  }
  function createLink(f, cat) {
    if (!f || !cat) return err(L('Fraksiyon ve tür seç.', 'Pick a faction and a category.'));
    const l = { id: uid(), f, cat, cards: [] };
    state.links.push(l);
    return { ok: true, link: l };
  }
  function addToLink(linkId, a) {
    const l = state.links.find(x => x.id === linkId), c = CARD_BY_ART[a];
    if (!l || !c) return err(L('Bulunamadı.', 'Not found.'));
    if (l.cards.length >= LINK_SIZE) return err(L(`Bir bağda en fazla ${LINK_SIZE} kart olur.`, `A link holds at most ${LINK_SIZE} cards.`));
    if (!state.collection[a]) return err(L('Bu kart sende yok.', "You don't have this card."));
    if (c.f !== l.f) return err(L('Kart bu fraksiyondan değil.', "The card isn't from this faction."));
    if (!cardCats(c).includes(l.cat)) return err(L(`Kartın türleri arasında "${l.cat}" yok.`, `The card doesn't have the "${l.cat}" category.`));
    if (usedInLinks().has(a)) return err(L('Bu kart başka bir bağda.', 'This card is in another link.'));
    l.cards.push(a);
    if (l.cards.length === LINK_SIZE) {
      const n = completeLinks().length;
      log(L(`Kart bağı tamamlandı: ${l.f} · ${l.cat}. ${n <= LINK_MAX ? `Hasar +%${LINK_BONUS}.` : `(En çok ${LINK_MAX} bağ sayılır.)`}`, `Card link complete: ${l.f} · ${l.cat}. ${n <= LINK_MAX ? `Damage +${LINK_BONUS}%.` : `(At most ${LINK_MAX} links count.)`}`), 'epic');
      toast(L(`Bağ tamamlandı: ${l.cat} (+%${LINK_BONUS} hasar)`, `Link complete: ${l.cat} (+${LINK_BONUS}% damage)`), 'good');
    }
    return ok();
  }
  function removeFromLink(linkId, a) {
    const l = state.links.find(x => x.id === linkId);
    if (!l) return err(L('Bulunamadı.', 'Not found.'));
    l.cards = l.cards.filter(x => x !== a);
    return ok();
  }
  function deleteLink(linkId) { state.links = state.links.filter(l => l.id !== linkId); return ok(); }

  /* --- okul + yeniden doğuş --- */
  function changeSchool(id) {
    if (!SCHOOLS[id] || id === sc()) return err(L('Aynı okul.', 'Same school.'));
    if (state.gold < 150) return err(L('150 oren gerekiyor.', 'You need 150 crowns.'));
    state.gold -= 150; state.school = id; state.avatar = null; state.hp = Math.min(state.hp, maxHp());
    log(L(`Okul değişti: ${SCHOOLS[id].name}.`, `School changed: ${SCHOOLS[id].name}.`), 'epic');
    return ok();
  }
  function snapshot() {
    return {
      id: state.charId, name: state.name, school: state.school, faction: state.faction, avatar: state.avatar,
      level: state.level, fame: state.fame || 0, region: state.region, legend: state.legend, start: state.charStart, end: now().toISOString(),
      collection: { ...state.collection }, links: state.links.map(l => ({ ...l, cards: [...l.cards] })),
      trophies: state.trophies.map(t => ({ ...t })), swords: [...state.swords.owned], swordUps: { ...(state.swords.up || {}) }, diagrams: [...(state.diagrams || [])],
      draws: state.draws, stats: { ...state.stats }, gold: state.gold,
    };
  }
  function rebirth({ name, school, faction } = {}) {
    if (faction === 'all') faction = null;                          // tüm fraksiyonlar
    if (faction !== null && !FACTIONS.includes(faction)) return err(L('Yeni karakter için bir fraksiyon seç.', 'Pick a faction for the new character.'));
    const old = snapshot();
    state.hall.push(old);
    const fresh = freshCharacter({ name: name || old.name, school, faction, nowDate: now() });
    CHAR_KEYS.forEach(k => { state[k] = fresh[k]; });
    log(L(`${old.name} (seviye ${old.level}${old.legend ? ', efsane' : ''}) Okul salonuna katıldı. Yeni karakter: ${state.name}, ${SCHOOLS[state.school].name}, ${faction ? FACTION_TR[faction] : 'tüm fraksiyonlar'}.`,
      `${old.name} (level ${old.level}${old.legend ? ', legend' : ''}) joined the School hall. New character: ${state.name}, ${SCHOOLS[state.school].name}, ${faction ? FACTION_TR[faction] : 'all factions'}.`), 'epic');
    ensureBoard();
    drawCards(3, 'Rare', L('Yeni yolun ilk kartları', 'First cards of a new path'));
    return ok();
  }
  function init() {
    state.hp ||= maxHp();
    for (const h of state.habits) on(h, () => { if (!h.start) h.start = upcoming(); if (!h.lastProcessed) h.lastProcessed = addDays(h.start, -1); });
    log(L(`${state.name} yemin etti: ${SCHOOLS[sc()].name}${state.faction ? `, ${FACTION_TR[state.faction]}` : ''}. İlk alışkanlık: "${Q().name}" (${Q().days} gün).`, `${state.name} took the oath: ${SCHOOLS[sc()].name}${state.faction ? `, ${FACTION_TR[state.faction]}` : ''}. First habit: "${Q().name}" (${Q().days} days).`), 'epic');
    ensureBoard();
    drawCards(3, 'Rare', L('Hoş geldin hediyesi', 'Welcome gift'));
    return ok();
  }

  /* --- haftalık özet --- */
  function ensureWeekStats() {
    const wk = mondayOf(logicalToday());
    if (!state.weekStats) { state.weekStats = { key: wk, chainStart: bestChainLen() }; return; }
    if (state.weekStats.key === wk) return;
    const ws = state.weekStats, keys = Array.from({ length: 7 }, (_, i) => addDays(ws.key, i));
    const ds = state.habits.flatMap(h => keys.map(k => h.entries[k]).filter(d => d && d.result));
    const cnt = r => ds.filter(d => d.result === r).length;
    const sleeps = ds.filter(d => d.med && d.check).map(d => (new Date(d.check) - new Date(d.med)) / 3600000).filter(x => x > 0 && x < 16);
    const summary = { ...ws, end: keys[6], success: cnt('success'), late: cnt('late'), fail: cnt('fail'), rest: cnt('rest'), total: ds.filter(d => d.result !== 'rest').length,
      medOnTime: ds.filter(d => d.medOnTime).length, chainEnd: bestChainLen(), sleepAvg: sleeps.length ? +(sleeps.reduce((a, b) => a + b, 0) / sleeps.length).toFixed(2) : null };
    state.weekly = [summary, ...(state.weekly || [])].slice(0, 26);
    // sadece içinde bir şey olan haftaları göster
    if (ds.length || ws.gold || ws.kills) state.pendingSummary = summary.key;
    state.weekStats = { key: wk, chainStart: bestChainLen() };
  }

  /* --- başarımlar --- */
  function achStats() {
    const allDays = [...state.habits.flatMap(h => Object.values(h.entries)), ...state.questHistory.flatMap(q => Object.values(q.entries || {}))];
    // kusursuz hafta: bir alışkanlıkta pazartesiden pazara 7 başarı
    const perfect = state.habits.some(h => { const w = {}; Object.entries(h.entries).forEach(([k, d]) => { if (d.result === 'success') { const m = mondayOf(k); w[m] = (w[m] || 0) + 1; } }); return Object.values(w).some(n => n >= 7); });
    const chars = [...(state.hall || []), { trophies: state.trophies, collection: state.collection, links: state.links, legend: state.legend }];
    const allTrophies = chars.flatMap(c => c.trophies || []);
    const regionCleared = chars.some(c => { const t = new Set((c.trophies || []).map(x => x.id)); return REGIONS.some((r, i) => MONSTERS.filter(m => m.region === i).every(m => t.has(m.id))); });
    return {
      success: allDays.filter(d => d.result === 'success').length, rests: Object.keys(state.restDays || {}).length,
      chainBest: Math.max(0, ...state.habits.map(h => h.chain.best)), repairs: state.counters?.repairs || 0, perfectWeek: perfect,
      medOnTime: allDays.filter(d => d.medOnTime).length, questsDone: state.questHistory.filter(q => q.result === 'completed').length,
      kills: allTrophies.length, bosses: allTrophies.filter(t => MONSTERS.find(m => m.id === t.id)?.boss).length, regionCleared,
      legend: chars.some(c => c.legend), swords: state.swords.owned.length,
      maxUp: Math.max(0, ...Object.values(state.swords.up || {})),
      ownSchoolSet: state.swords.owned.some(id => { const w = swordById(id); return w && w.set && w.school === sc(); }),
      legendaryCards: chars.some(c => Object.keys(c.collection || {}).some(a => CARD_BY_ART[a]?.r === 'Legendary')) ? 1 : 0,
      uniqueCards: Math.max(...chars.map(c => Object.keys(c.collection || {}).length)),
      links: completeLinks().length, hall: (state.hall || []).length,
    };
  }
  function checkAchievements() {
    state.achievements ||= {};
    const h = achStats(), got = [];
    for (const a of ACHIEVEMENTS) {
      if (state.achievements[a.id] || !a.test(h)) continue;
      state.achievements[a.id] = now().toISOString();
      got.push(a);
      addGold(a.gold);
      log(L(`Başarım açıldı: ${a.icon} ${a.name} — ${a.desc} +${a.gold} oren${a.card ? `, ${RAR_TR[a.card]} kart` : ''}.`, `Achievement unlocked: ${a.icon} ${a.name} — ${a.desc} +${a.gold} crowns${a.card ? `, a ${RAR_TR[a.card]} card` : ''}.`), 'epic');
      toast(L(`Başarım: ${a.name}`, `Achievement: ${a.name}`), 'good'); fx('achieve');
      if (a.card) drawCards(1, a.card, L(`Başarım: ${a.name}`, `Achievement: ${a.name}`));
    }
    return got;
  }

  /* --- test yardımcıları (sadece test modunda arayüzden çağrılır) --- */
  const dev = {
    completeQuest(hid) { return on(hid, () => { const q = Q(); if (q.status !== 'active') return err(L('Görev zaten tamamlanmış.', 'Quest already complete.')); q.progress = q.days; completeQuest(upcoming()); return ok(); }); },
    addGold(n = 500) { addGold(n); log(L(`[Test] +${n} oren.`, `[Test] +${n} crowns.`)); return ok(); },
    addXp(n = 500) { gainXp(n); log(L(`[Test] +${n} TP.`, `[Test] +${n} XP.`)); return ok(); },
    rerollBoard() { state.boards = {}; state.contract = null; ensureBoard(); log(L('[Test] Kontrat tabelaları yenilendi.', '[Test] Contract boards refreshed.')); return ok(); },
    killContract() { const c = ensureContract(); if (!c) return err(L('Aktif kontrat yok.', 'No active contract.')); c.hp = 1; hitMonster(1, '[Test]'); return ok(); },
    heal() { state.hp = maxHp(); const cb = cbState(); cb.mode = 'fight'; cb.until = null; log('[Test] ' + L('Can doldu.', 'HP restored.')); return ok(); },
  };

  function projectedMult(k) { return rewardMult(Q().entries[k] || {}, null, k).mult; }
  if (idle) cbState();                                      // savaş saati motorun kurulduğu andan başlar

  return {
    state, ev, now, logicalToday, maxHp, xpNeed,
    W: (k, hid) => on(hid, () => W(k)), upcoming: (n = now(), hid) => on(hid, () => upcoming(n)), phase: (k, n = now(), hid) => on(hid, () => phase(k, n)),
    projectedMult: (k, hid) => on(hid, () => projectedMult(k)), isSleep: hid => on(hid, () => isSleep()),
    prep: hid => on(hid, () => prep()), checkIn: hid => on(hid, () => checkIn()), addCount: (n, hid) => on(hid, () => addCount(n)),
    continueMastery: hid => on(hid, () => continueMastery()), correctableDay: hid => on(hid, () => correctableDay()),
    correctMissed: (k, o = {}, hid) => on(hid ?? o.hid, () => correctMissed(k, o)),
    habitById, chainDamage, advanceCombat, combatInfo, drinkPotion, failHit, playerStats, queueAdd, queueRemove, debuffPct, isRest, restTarget, restBy: k => restBy(k), restUsedInWeek, removeHabit, habitTypeName,
    declareRest, processPending, completeSide, addSide, removeSide, shopItems, buy, craft,
    changeSchool, startQuest, updateQuest, init, drawCards, log,
    damageBonus, completeLinks, buySword, equipSword, dailySwords, rerollShop, transferUpgrades, transferFee, dismantleSword, dismantleValue,
    craftSword, craftCost, bestSwordFor, equipBest, dropDiagram, shopRerollCost, rerollBoard, boardRerollCost, upgradeSword, upgradeCost, upLevel, swordValue, linkOptions, eligibleForLink, createLink, addToLink, removeFromLink, deleteLink,
    region, band, bandInfo, homeRegion, capLevel, atCap, xpBank, bossAvailable, postGame, isElite, fameNeed, boardEntries, ensureBoard, takeContract, openRegions, inPool, rebirth, snapshot, dev,
    legacy, checkAchievements, achStats, ensureWeekStats,
  };
}

root.KM = {
  L, lang, bi, habitTypeName,
  createEngine, newState, migrate, makeQuest, makeHabit, validateQuest, monStats, HABIT_TYPES, MAX_HABITS, CHAIN_WEIGHTS,
  time: { pad, dk, fromKey, addDays, at, addMin, hm, mondayOf, toMin, fromMin, longDate, sfx, DAYS, MONTHS },
  data: {
    ART, CARDS, CARD_BY_ART, RAR, RAR_TR, SCRAP, CRAFT, MONSTERS, CLASSES, REGIONS, BAND_COUNT, bandRegions, regionTier, monById, monImg, SCHOOLS, TIERS, tierOf, REPAIR_NEED,
    QUEST_MIN, QUEST_MAX, MASTERY_MULT, MASTERY_DMG, SHOP, DMG, DAY_XP, DAY_GOLD, CARDS_PER, REG, BOSS, BOARD_SIZE, MAX_LEVEL, xpNeed,
    BONUS_STEPS, effectiveBonus, POTION, REST, DEFEAT, EFFECTS, EFFECT_CAP, BURST, HONEY_MAX, powerAt, hpAt, BAND_HOURS, TIER_DAYS, STEP_MIN, UPGRADE, CRIT_MULT, LINK_SIZE, LINK_BONUS, LINK_MAX, SWORDS, SWORD_TIERS, swordById, cardCats, dat, FACTIONS, FACTION_TR, SHOP_DAILY, REROLL, BANE, TRANSFER_FEE, DISMANTLE, DIAGRAM_FROM_REGION, SET_CRAFT_SCRAPS, LEGACY, ACHIEVEMENTS, RETRO_HOURS, ELITE, FAME,
  },
  uid,
};
})(typeof window !== 'undefined' ? window : globalThis);
