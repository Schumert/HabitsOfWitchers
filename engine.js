/* Habits of Witchers — oyun motoru (DOM yok).
 * Arayüz (app.js) ve testler (tests.js) aynı motoru kullanır:
 *   const E = KM.createEngine(state, { now: () => new Date(), random: Math.random });
 * Eylemler { ok: true } ya da { err: 'mesaj' } döndürür. Kart açılışları E.ev.reveals, bildirimler E.ev.toasts kuyruğuna düşer.
 *
 * Kayıt iki parçalıdır:
 *  - Genel (karakterden bağımsız): ana görev, zincir, günler (kayıtlar), yan görevler, günlük, Okul salonu (hall).
 *  - Karakter: seviye, TP, oren, koleksiyon, kart bağları, kılıçlar, avlanan canavarlar, bölge, kontrat tabelası.
 *    Yeniden doğuşta karakter Karakterlerim'e (hall) eklenir ve bu kısım sıfırlanır.
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
/* kılıçlar (Witcher 3'teki gibi): gücü kılıcın SEVİYESİNE ve kademesine bağlı. Kılıç, demircide senin seviyende çıkar;
 * elindeki kılıcın seviyesini oren + kırıntıyla yükseltirsin (en fazla kendi seviyene kadar). Seviye şartı yok.
 * Gümüş: saatlik hasar = taban(seviye) × kademe çarpanı. Çelik: kritik % = taban(seviye) + kademe eki. */
const swordBase = L => 6 * Math.pow(130 / 6, (Math.max(1, L) - 1) / 29);      // gümüş: 1. seviye 6 → 30. seviye 130
const critBase = L => 3 + 11 * (Math.max(1, L) - 1) / 29;                     // çelik: %3 → %14
const SILVER_MULT = { 1: 0.75, 2: 0.88, 3: 1, 4: 1.15, 6: 1.54 };             // Sıradan, Usta işi, Büyülü, Efsanevi, Kadim (Aerondight 30. seviyede 200)
const STEEL_ADD = { 1: -1, 2: 0, 3: 1, 4: 2, 6: 3 };
const swordMult = w => (w.set ? 1.15 + 0.04 * (w.v || 0) : SILVER_MULT[w.tier] ?? 1);   // okul seti: aşamaya göre ×1.15 → ×1.35
const steelAdd = w => (w.set ? 2 + Math.floor((w.v || 0) / 2) : STEEL_ADD[w.tier] ?? 0);
const swordDmgAt = (w, L) => Math.round(swordBase(L) * swordMult(w) * 10) / 10;
const swordCritAt = (w, L) => Math.max(1, Math.round(critBase(L) + steelAdd(w)));
const swordPrice = (w, L) => (w.type === 'silver'
  ? Math.max(40, Math.round(swordDmgAt(w, L) * 30 / 5) * 5)
  : Math.max(40, Math.round((swordCritAt(w, L) ** 2 * 6 + L * 20) * (1 + ((w.set ? 4 : w.tier) - 1) * 0.15) / 5) * 5));
/* demircide kademe olasılıkları (%): 1. seviyeden 30. seviyeye doğrusal değişir */
const RARITY_ODDS = { 1: [60, 10], 2: [25, 20], 3: [13, 40], 4: [2, 30] };
const rarityOdds = L => { const t = (Math.min(30, Math.max(1, L)) - 1) / 29; return Object.fromEntries(Object.entries(RARITY_ODDS).map(([k, [a, b]]) => [k, Math.round((a + (b - a) * t) * 10) / 10])); };
const AERONDIGHT = { chance: 0.01, minLevel: 25 };                          // çok nadir: 25. seviyeden sonra günlük %1
/* kılıç seviyesi yükseltme: bedeli yeni seviyedeki fiyatının %35'i kadar oren + kırıntı */
const SWORD_UP = { goldShare: 0.35, scraps: L => 4 + Math.floor(L / 2) };
const SCRAP_PER_KILL = 1;                                                    // kazanılan her dövüş 1 kırıntı

const SCHOOLS = {
  wolf:    { name: 'Wolf School',    art: 1476, desc: 'Dengeli yol. Zincirindeki her halka o alışkanlığın ödülünü %5 artırır (en çok +%50). Sevdiği kart türleri: Witcher, Soldier, Beast.' },
  cat:     { name: 'Cat School',     art: 2342, desc: 'Kumarbaz. Canavar ödülleri ×1.3, Puzzle Box’ta iyi ödüller daha sık, günlük oyun ödülü ×1.5; ama aldığın hasar ×1.5. Sevdiği kart türleri: Agent, Bandit, Crime.' },
  bear:    { name: 'Bear School',    art: 2352, desc: 'Dayanıklı. Can ×1.4, aldığın hasar ×0.6, avda saatte %0,5 iyileşirsin, yenilince iki kat hızlı toparlanırsın. Sevdiği kart türleri: Warrior, Dwarf, Ogroid.' },
  griffin: { name: 'Griffin School', art: 2362, desc: 'Disiplinli. Kırılan zincir için kefaret 2 yerine 1 gün; gecikince Yorgun, kaçırınca Bitkin olmazsın. Sevdiği kart türleri: Mage, Spell, Knight.' },
  viper:   { name: 'Viper School',   art: 2312, desc: 'Dakik. Görevi erken yaparsan (saatli türlerde aralığın ilk 10 dakikası, diğerlerinde öğleden önce) ödül ×1.4 ve 24 saat Odak: hasar +%10. Sevdiği kart türleri: Elf, Alchemy, Aristocrat.' },
  manticore: { name: 'Manticore School', img: 'img/manticore.webp', desc: 'Simyacı. İksirleri yarı fiyatına alırsın (bombalar hariç); Dancing Star %30 daha sert vurur. Sevdiği kart türleri: Cursed, Relict, Vampire.' },
};
/* okulun görseli: Gwent kart resmi ya da yerel görsel */
const schoolImg = (id, q = 'medium') => { const x = SCHOOLS[id] || SCHOOLS.wolf; return x.img || ART(x.art, q); };
const SCHOOL_EN = {
  wolf: "Balanced. Every link in a chain raises that habit's reward by 5% (up to +50%). Favoured card categories: Witcher, Soldier, Beast.",
  cat: 'Gambler. Monster rewards ×1.3, better Puzzle Box prizes more often, daily game reward ×1.5; but damage taken ×1.5. Favoured card categories: Agent, Bandit, Crime.',
  bear: 'Tough. HP ×1.4, damage taken ×0.6, heals 0.5%/h while hunting and recovers twice as fast after a defeat. Favoured card categories: Warrior, Dwarf, Ogroid.',
  griffin: "Disciplined. Atonement for a broken chain takes 1 day instead of 2; being late doesn't make you Tired and missing a day doesn't make you Exhausted. Favoured card categories: Mage, Spell, Knight.",
  viper: 'Punctual. Do a quest early (first 10 minutes of the window for timed types, before noon for the others) for ×1.4 rewards and 24 hours of Focus: +10% damage. Favoured card categories: Elf, Alchemy, Aristocrat.',
  manticore: 'Alchemist. Potions cost half (bombs excluded); Dancing Star hits 30% harder. Favoured card categories: Cursed, Relict, Vampire.',
};
Object.entries(SCHOOL_EN).forEach(([k, d]) => bi(SCHOOLS[k], { desc: d }));
/* okula göre başlangıç donanımı. Wolf referans: 100 oren, 3 Swallow, 1 Mahakam Ale, gümüş + çelik kılıç.
 * Cat: daha çok oren ve kırıntı ama az güvence, sadece çelik (kritik). Bear: az oren, çok Mahakam Ale (zaten hızlı iyileşir).
 * Griffin: kırıntı (erken güçlendirme) ve Mahakam Ale, sadece gümüş. Viper: oren ve vahşi bir gümüş, çelik; güvence az.
 * Manticore: az oren, bunun yerine Thunderbolt ve Dancing Star. */
const START_KIT = {
  wolf:    { gold: 100, swallow: 3, honey: 1, scraps: 0,  silver: 'silver-gven-nel',                  steel: 'steel-witch-hunter-s-sword' },
  cat:     { gold: 180, swallow: 2, honey: 0, scraps: 20, silver: null,                               steel: 'steel-vrihedd-brigade-sword' },
  bear:    { gold: 70,  swallow: 2, honey: 2, scraps: 0,  silver: 'silver-eirlithrad',                steel: 'steel-skellige-longsword' },
  griffin: { gold: 100, swallow: 2, honey: 2, scraps: 40, silver: 'silver-mastercrafted-silver-sword', steel: null },
  viper:   { gold: 120, swallow: 3, honey: 0, scraps: 15, silver: 'silver-disglair',                  steel: 'steel-scoia-tael-sword' },
  manticore: { gold: 80, swallow: 2, honey: 0, scraps: 0, thunder: 1, dancing: 3, silver: 'silver-the-striga',      steel: 'steel-novigrad-longsword' },
};
/* zincir: mult = alışkanlık ödülü (TP + oren) çarpanı, dmg = canavara verdiğin hasar (%).
 * Zincir hasarı ana güç kaynağıdır; kart bağları ve avcı bonusuyla toplanır (tavan ya da azaltım yok). */
const TIERS = [
  { name: 'Demir',   at: 0,  mult: 1,   dmg: 0,   color: '#7d838b', min: null },
  { name: 'Çelik',   at: 7,  mult: 1.2, dmg: 10,  color: '#a9b8c8', min: 'Rare' },
  { name: 'Gümüş',   at: 14, mult: 1.3, dmg: 20,  color: '#eef3f8', min: 'Epic' },
  { name: 'Altın',   at: 30, mult: 1.5, dmg: 30,  color: '#e0b44c', min: 'Legendary' },
  { name: 'Mithril', at: 40, mult: 1.7, dmg: 50,  color: '#8fd3e6', min: 'Legendary' },
  { name: 'Göktaşı', at: 60, mult: 2,   dmg: 100, color: '#d0673a', min: 'Legendary' },
];
['Iron', 'Steel', 'Silver', 'Gold', 'Mithril', 'Meteorite'].forEach((n, i) => bi(TIERS[i], { name: n }));
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
/* Bölge başına EN YÜKSEK değerler: her canavar bunların str (0.55–1) katını alır; canı az olanın ödülü de azdır. */
/* ---------- idle savaş ----------
 * Av sürekli akar (uygulama kapalıyken de). Saat başı bir vuruş: (seviye gücü + gümüş kılıcın hasarı) × bonuslar × zincir.
 * Bütün canavarlar boss gibi uzun sürer. Değerler kademe başına "ortalama oyuncu"dan türetilir: kademe seviyesindeki,
 * ortalama donanımlı (REF_SWORD), ortalama zincirli (REF_CHAIN) ve ortalama bağlı (REF_LINKS) bir oyuncu str 1 normal bir
 * canavarı BAND_HOURS saatte keser. Boss ×BOSS.hp. Kusursuz zincirli (Göktaşı +%100) oyuncu belirgin hızlı geçer. */
const STEP_MIN = 60;
const XP_SCALE = 0.52;                                    // simülasyonla ayarlandı
const FAIL_HIT = 0.3;                                      // kaçırılan günde str 1 normal canavarın vuruşu: kademe seviyesindeki canın bu kadarı
const BAND_HOURS = [29, 41, 52, 64, 75, 84, 93, 102];       // ortalama oyuncu: str 1 normal canavar kaç saatte ölür
const REF_SWORD = [6, 11, 18, 25, 34, 55, 70, 90];         // kademede beklenen gümüş kılıç ortalaması (güçlendirmeli)
const REF_CHAIN = [5, 12, 18, 20, 22, 25, 25, 28];         // ortalama oyuncunun zincir hasarı (%)
const REF_LINKS = [0, 3, 6, 10, 14, 18, 22, 26];           // kart bağı + bane (%)
const TIER_DAYS = [16, 20, 22, 25, 27, 30, 31, 34];        // ortalama oyuncu için kademe başına hedef gün
const powerAt = L => 20 * Math.pow(1.11, L - 1);                       // seviyeye göre temel hasar / saat
const hpAt = L => Math.round(100 + 12 * (L - 1));                      // seviyeye göre en yüksek can
const refDph = t => { const L = t * 4 + 2.5; return (powerAt(L) + REF_SWORD[t]) * (1 + (REF_LINKS[t] + REF_CHAIN[t]) / 100); };
const REG = (() => {
  const OLD_GOLD = [55, 75, 100, 130, 170, 220, 280, 350];   // oren / gün
  const reg = { hp: [], gold: [], xp: [], hit: [] };
  for (let t = 0; t < 8; t++) {
    const L = t * 4 + 2.5;
    const killsPerDay = 24 / (BAND_HOURS[t] * 0.8);                     // ortalama güç 0.8
    reg.hp.push(Math.round(refDph(t) * BAND_HOURS[t]));
    reg.hit.push(Math.round(FAIL_HIT * hpAt(L)));
    reg.xp.push(Math.round(XP_SCALE * 4 * (100 + 6 * (L - 1)) / (TIER_DAYS[t] * killsPerDay)));
    reg.gold.push(Math.round(OLD_GOLD[t] / killsPerDay * 1.2));
  }
  return reg;
})();
const BOSS = { hp: 2.5, gold: 2.5, xp: 1.5, hit: 1.5 };     // boss başarısızlıkta daha sert vurur
const POTION = { cap: 5, heal: 0.5, master: 0.8 };   // Swallow: en yüksek canın %50'si (Swallow Ustası %80)
const REST = { regen: 0.25, resume: 0.9, monHeal: 0.02 };    // dinlenirken saatte canın %25'i; %90'da ava dönülür; canavar saatte %2 toparlanır
const DEFEAT = { hours: 6, monHeal: 0.25, gold: 0.1 };      // yenilince orenin %10'u gider; toparlanma süresi = canın dolma süresi (savaş dışı iyileşme)
/* can yenilenmesi (en yüksek canın oranı / saat): avdayken yavaş, yenilgiden sonra toparlanırken hızlı (kontrat her zaman vardır) */
/* avdayken iyileşme okula göre değişir (Wolf referans: saatte %0,3) */
const REGEN = { fight: { wolf: 0.003, bear: 0.005, griffin: 0.0035, viper: 0.0025, cat: 0.002, manticore: 0.003 }, idle: 0.15, idleBear: 0.30 };   // idle: yenilgiden sonra toparlanma hızı
/* simya: Thunderbolt ve Petri’s Philter üç kademe (Normal / Gelişmiş 13. sv / Üstün 25. sv): etkiler ve fiyatlar sabit, güçlüsü pahalı.
 * Thunderbolt üst üste binmez (aynı anda tek etki), bu yüzden para "aynı zamandan daha çok hasar" için harcanır.
 * Petri’s Philter: günde en fazla 1 tane (kademe fark etmez). Dancing Star: rastgele 3–10 saatlik hasar, 48 saat bekleme süresi (can bedeli yok).
 * Manticore okulu iksirleri (Swallow, Mahakam Ale dahil; bombalar hariç) yarı fiyatına alır, Dancing Star'ı ×1,3 vurur. */
const THUNDER = { hours: 24, cap: 5, stormcaller: 1.5, grades: [
  { id: 'thunder', pct: 20, price: 120, lv: 1 }, { id: 'thunder2', pct: 30, price: 300, lv: 13 }, { id: 'thunder3', pct: 40, price: 600, lv: 25 }] };
const OWL = { grades: [
  { id: 'owl', xp: 10, price: 50, lv: 1 }, { id: 'owl2', xp: 20, price: 150, lv: 13 }, { id: 'owl3', xp: 35, price: 350, lv: 25 }] };
const THUNDER_BY = Object.fromEntries(THUNDER.grades.map(g => [g.id, g])), OWL_BY = Object.fromEntries(OWL.grades.map(g => [g.id, g]));
/* Black Blood: 24 saat kritik şansı +%10, Vampir ve Nekrofaj'a karşı +%15 daha. Thunderbolt'tan ayrı etki: ikisi birlikte içilebilir. */
const BLACKBLOOD = { crit: 10, vsCrit: 15, vs: ['Vampire', 'Necrophage'], hours: 24, price: 80, cap: 5 };
const DANCING = { price: 120, cap: 5, cooldown: 48, alchhand: 30, manticore: 1.3, minH: 3, maxH: 10 };   // 3–10 saatlik hasar (rastgele, tam saat)
const ALCH_DISCOUNT = 0.5;
const WOUNDED = { below: 0.5, pct: 20 };                      // can %50'nin altındayken "Yaralı": hasar −%20
const EFFECTS = { blackblood: { pct: BLACKBLOOD.crit, hours: BLACKBLOOD.hours, buff: true, crit: true }, tired: { pct: 15, hours: 12 }, exhausted: { pct: 30, hours: 24 }, drunk: { pct: 0, hours: 24, hurt: 2, once: true }, focus: { pct: 10, hours: 24, buff: true }, thunder: { pct: THUNDER.grades[0].pct, hours: THUNDER.hours, buff: true },
  early: { pct: 15, hours: 12, buff: true }, discipline: { pct: 20, hours: 24, buff: true } };   // early/discipline: kılıç özellikleri   // focus: Viper okulunun erken tamamlama ödülü
const EFFECT_CAP = 60;
const HONEY_MAX = 5;
const DRUNK = EFFECTS.drunk;   // Mahakam Ale: Bitkin'i götürür ama 24 saat canavarın vuruşları ×2
const HEAVY = { chance: 0.05, hours: 0.75 };                 // canavarın ağır darbesi: adım başına %5, 45 dakikalık hasar      // boss TP'si normal: asıl ödülü yeni bölge          // boss: bölgenin en güçlüsünün katları
const BOARD_SIZE = 5;                                               // haftalık kontrat tabelasındaki canavar sayısı
const MON_HEAL = 0.05;
const FAINT_GOLD = 0.2, FAINT_GOLD_MAX = 300;                       // bayılınca oren'in %20'si (en çok 300) gider
const CRIT_MULT = 1.5;
/* kart bağları: kart başına nadirliğe göre katkı (%), bağın ana türü dışında beş kartın da paylaştığı her ek tür +%1,5,
 * bağın türü okulunun sevdiği türlerdense bağ ×1,5. En fazla 10 bağ. */
const LINK_SIZE = 5, LINK_MAX = 10, LINK_EXTRA = 1.5, LINK_SCHOOL = 1.5;
const LINK_RAR = { Common: 0.5, Rare: 0.8, Epic: 1.2, Legendary: 2 };
const SCHOOL_CATS = { wolf: ['Witcher', 'Soldier', 'Beast'], cat: ['Agent', 'Bandit', 'Crime'], bear: ['Warrior', 'Dwarf', 'Ogroid'], griffin: ['Mage', 'Spell', 'Knight'], viper: ['Elf', 'Alchemy', 'Aristocrat'], manticore: ['Cursed', 'Relict', 'Vampire'] };
const LINK_BONUS = LINK_RAR.Common * LINK_SIZE;                     // eski adıyla: en düşük bağ değeri
const SHOP_DAILY = 5;
/* yenileme bedelleri: demirci aynı gün her yenilemede 100 oren artar; kontrat tabelası ucuz, bölgeyle ve aynı haftadaki tekrarla artar */
const REROLL = { shop: 100, boardBase: 20, boardPerRegion: 10 };
const BANE = 15;                                                    // kılıcın bane sınıfındaki canavara ek ham hasar (%): Sıradan–Büyülü
/* avcı özellikleri: kademe yükseldikçe kılıç bir canavar türüne daha karşı bonus kazanır; Efsanevi ve üstünde bonus daha yüksek.
 * [özellik sayısı, % bonus]. İlk tür swords.js'teki bane, ekler kılıcın kimliğinden sabit (rastgele ama her zaman aynı) seçilir. */
const BANE_TIERS = { 1: [1, 15], 2: [2, 15], 3: [3, 15], 4: [3, 25], 5: [4, 20], 6: [5, 25] };
SWORDS.forEach(w => {
  const [n, pct] = BANE_TIERS[w.tier] || [1, BANE];
  let h = hashStr('bane:' + w.id) || 1;
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const pool = Object.keys(CLASSES).filter(c => c !== w.bane), banes = w.bane ? [w.bane] : [];
  while (banes.length < n && pool.length) banes.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  w.banes = banes; w.banePct = pct;
});

/* benzersiz özellikler: her Efsanevi kılıca havuzdan bir tane (kılıcın kimliğine göre sabit, iki kılıca aynısı gelmez).
 * Kılıç kuşanılıyken çalışır; gümüş + çelik birlikte en fazla iki özellik. Hasar yüzdeleri zincir/bağ/avcı bonuslarıyla düz toplanır. */
const UNIQUE = [
  ['night', 'Gece Avcısı', '22:00–06:00 arası hasar +%30.', 'Night Hunter', '+30% damage from 22:00 to 06:00.'],
  ['dawn', 'Şafak Işığı', '06:00–12:00 arası hasar +%25.', 'Dawnlight', '+25% damage from 06:00 to 12:00.'],
  ['noon', 'Öğle Güneşi', '12:00–18:00 arası hasar +%25.', 'Noon Sun', '+25% damage from 12:00 to 18:00.'],
  ['dusk', 'Alacakaranlık', '18:00–22:00 arası hasar +%35.', 'Twilight', '+35% damage from 18:00 to 22:00.'],
  ['weekend', 'Hafta Sonu Savaşçısı', 'Cumartesi ve Pazar hasar +%25.', 'Weekend Warrior', '+25% damage on Saturday and Sunday.'],
  ['monday', 'Pazartesi Öfkesi', 'Pazartesi hasar +%50.', 'Monday Fury', '+50% damage on Monday.'],
  ['execute', 'İnfazcı', 'Canavarın canı %25\'in altındayken hasar +%50.', 'Executioner', '+50% damage while the monster is below 25% HP.'],
  ['firstblood', 'İlk Kan', 'Canavarın canı %75\'in üstündeyken hasar +%30.', 'First Blood', '+30% damage while the monster is above 75% HP.'],
  ['giant', 'Dev Avcısı', 'Boss\'lara hasar +%30.', 'Giant Slayer', '+30% damage against bosses.'],
  ['elite', 'Elit Avcısı', 'Elit canavarlara hasar +%40.', 'Elite Hunter', '+40% damage against elite monsters.'],
  ['desperate', 'Çaresizlik', 'Yaralıyken −%20 ceza yerine +%20 hasar.', 'Desperation', 'While Wounded: +20% damage instead of −20%.'],
  ['fullpower', 'Tam Güç', 'Canın %90\'ın üstündeyken hasar +%20.', 'Full Strength', '+20% damage while your HP is above 90%.'],
  ['bloodprice', 'Kan Bedeli', 'Hasar +%35, ama aldığın hasar +%25.', 'Blood Price', '+35% damage, but you take 25% more damage.'],
  ['patient', 'Sabırlı Bıçak', 'Aynı kontratta geçen her 24 saat için hasar +%5 (en çok +%40).', 'Patient Blade', '+5% damage for every 24 hours on the same contract (up to +40%).'],
  ['quick', 'Hızlı Av', 'Kontratın ilk 12 saati hasar +%50.', 'Swift Hunt', '+50% damage during a contract\'s first 12 hours.'],
  ['streak', 'Seri Katil', 'Üst üste her öldürme hasarı +%5 artırır (en çok +%25); yenilince sıfırlanır.', 'Killing Spree', 'Each kill in a row adds +5% damage (up to +25%); resets when you are defeated.'],
  ['loyal', 'Sadık Kılıç', 'Kuşanılı kaldığı her gün +%1 hasar (en çok +%30); çıkarınca sıfırlanır.', 'Loyal Blade', '+1% damage for every day it stays equipped (up to +30%); resets when unequipped.'],
  ['kin', 'Kardeş Çelik', 'Diğer kuşanılan kılıç da Efsanevi ise hasar +%15.', 'Kindred Steel', '+15% damage if your other equipped sword is also Legendary.'],
  ['lone', 'Yalnız Kurt', 'Diğer kılıç yuvası boşsa hasar +%35.', 'Lone Wolf', '+35% damage if your other sword slot is empty.'],
  ['bestiary', 'Bestiyer', 'O türden daha önce kestiğin her canavar için hasar +%1 (en çok +%20).', 'Bestiary', '+1% damage for every monster of that type you have slain (up to +20%).'],
  ['lord', 'Bölge Hakimi', 'Alt kademe canavarlarına hasar +%50.', 'Lord of the Land', '+50% damage against monsters of lower tiers.'],
  ['stranger', 'Yabancı Topraklar', 'Yeni kademe açıldıktan sonraki 7 gün hasar +%30.', 'Strange Lands', '+30% damage for 7 days after a new tier opens.'],
  ['grudge', 'Kin', 'Her aktif ceza (Yorgun/Bitkin) hasarı ayrıca +%10 artırır.', 'Grudge', 'Each active penalty (Tired/Exhausted) also adds +10% damage.'],
  ['sharp', 'Keskin Kenar', 'Kritik şansı +%8.', 'Keen Edge', '+8% crit chance.'],
  ['deadly', 'Ölümcül', 'Kritik çarpanı ×1,5 yerine ×2.', 'Deadly', 'Critical hits deal ×2 instead of ×1.5.'],
  ['bleed', 'Kan Akıtan', 'Kritikten sonraki 3 saat hasar +%25.', 'Bloodletter', '+25% damage for 3 hours after a critical hit.'],
  ['chaincrit', 'Zincirleme Kritik', 'Kritikten sonraki vuruşta kritik şansı iki katı.', 'Chain Crit', 'After a critical hit, the next hit has double crit chance.'],
  ['nightcrit', 'Gece Kritiği', '22:00–06:00 arası kritik şansı +%15.', 'Night Crit', '+15% crit chance from 22:00 to 06:00.'],
  ['lastblow', 'Son Vuruş', 'Canavarın canı %20\'nin altındayken her vuruş kritik.', 'Final Blow', 'Every hit is critical while the monster is below 20% HP.'],
  ['bounty', 'Ödül Avcısı', 'Canavar oreni +%25.', 'Bounty Hunter', '+25% crowns from monsters.'],
  ['sage', 'Bilge', 'Canavar TP\'si +%20.', 'Sage', '+20% XP from monsters.'],
  ['greedy', 'Açgözlü', 'Canavar oreni +%50, TP −%25.', 'Greedy', '+50% crowns from monsters, −25% XP.'],
  ['veteran', 'Tecrübe', 'Canavar TP\'si +%40, oren −%20.', 'Veteran', '+40% XP from monsters, −20% crowns.'],
  ['scav', 'Hurdacı', 'Öldürmede +2 kırıntı daha.', 'Scavenger', '+2 extra scraps per kill.'],
  ['collector', 'Koleksiyoncu', 'Öldürmede %25 şansla ek kart.', 'Collector', '25% chance of an extra card per kill.'],
  ['trophy', 'Kupa Ustası', 'Boss öldürünce ek bir Efsanevi kart.', 'Trophy Master', 'An extra Legendary card when you kill a boss.'],
  ['potionhunt', 'İksir Avcısı', 'Öldürmede %30 şansla Swallow.', 'Potion Hunter', '30% chance of a Swallow per kill.'],
  ['stormharvest', 'Fırtına Hasadı', 'Öldürmede %20 şansla Thunderbolt.', 'Storm Harvest', '20% chance of a Thunderbolt per kill.'],
  ['starharvest', 'Yıldız Hasadı', 'Öldürmede %20 şansla Dancing Star.', 'Star Harvest', '20% chance of a Dancing Star per kill.'],
  ['harvest', 'Hasat', 'Öldürünce canın %25\'i dolar.', 'Harvest', 'Heal 25% of your HP on a kill.'],
  ['stone', 'Taş Deri', 'Aldığın hasar −%25.', 'Stoneskin', 'You take 25% less damage.'],
  ['lifebond', 'Yaşam Bağı', 'Avda can yenilenmesi ×3.', 'Life Bond', 'HP regeneration while hunting ×3.'],
  ['leech', 'Kan Emici', 'Her saatlik vuruş canının %0,7\'sini doldurur.', 'Leech', 'Every hourly hit heals 0.7% of your HP.'],
  ['hpshield', 'Can Kalkanı', 'En yüksek can +%25.', 'Vital Ward', '+25% max HP.'],
  ['lastbreath', 'Son Nefes', 'Haftada bir kez ölümcül darbeden 1 canla kurtulursun.', 'Last Breath', 'Once a week you survive a killing blow with 1 HP.'],
  ['quickrecover', 'Çabuk Toparlanma', 'Yenilince iki kat hızlı toparlanırsın.', 'Quick Recovery', 'You recover twice as fast after a defeat.'],
  ['purse', 'Sıkı Kese', 'Yenilince oren kaybetmezsin.', 'Tight Purse', 'You lose no crowns when defeated.'],
  ['thorns', 'Diken', 'Canavar sana vurunca ona 3 saatlik hasarın kadar karşılık verirsin.', 'Thorns', 'When the monster hits you, you strike back for 3 hours of your damage.'],
  ['steady', 'Sağlam Duruş', 'Gecikmede canavar vuramaz (kaçırmada vurur).', 'Steady Stance', 'The monster can\'t strike when you are late (it still does when you miss).'],
  ['swallowmaster', 'Swallow Ustası', 'Swallow canının %50\'si yerine %80\'ini doldurur.', 'Swallow Master', 'Swallow heals 80% of your HP instead of 50%.'],
  ['stormcaller', 'Fırtına Çağıran', 'Thunderbolt\'un hasar bonusu ×1,5 (ör. +%20 yerine +%30).', 'Stormcaller', 'Thunderbolt\'s damage bonus ×1.5 (e.g. +30% instead of +20%).'],
  ['focusmind', 'Odaklı Zihin', 'Güçlendirmeler (Odak, Thunderbolt...) ×1,5.', 'Focused Mind', 'Buffs (Focus, Thunderbolt...) ×1.5.'],
  ['alchhand', 'Simyacı Eli', 'Dancing Star\'ın bekleme süresi 48 yerine 30 saat.', 'Alchemist\'s Hand', 'Dancing Star\'s cooldown is 30 hours instead of 48.'],
  ['bomber', 'Bombacı', 'Dancing Star hasarı ×1,5.', 'Bombardier', 'Dancing Star damage ×1.5.'],
  ['honeybearer', 'Bira Taşıyıcı', `Mahakam Ale taşıma sınırı ${HONEY_MAX} yerine ${HONEY_MAX * 2}.`, 'Ale Bearer', `You can carry ${HONEY_MAX * 2} Mahakam Ale instead of ${HONEY_MAX}.`],
  ['resonance', 'Zincir Rezonansı', 'Zincirlerden gelen hasar bonusu ×1,25.', 'Chain Resonance', 'Damage bonus from chains ×1.25.'],
  ['linkmaster', 'Bağ Ustası', 'Kart bağı bonusları ×1,3.', 'Link Master', 'Card link bonuses ×1.3.'],
  ['early', 'Erkenci', 'Görevi erken yapınca (Viper kuralı) 12 saat hasar +%15.', 'Early Bird', 'Doing a quest early (Viper rule) gives +15% damage for 12 hours.'],
  ['atoner', 'Kefaretçi', 'Kefaret 1 gün kısa (en az 1 gün).', 'Atoner', 'Atonement takes one day less (at least 1).'],
  ['rested', 'Dinlenmiş', 'Dinlenme günlerinde hasar +%40.', 'Well Rested', '+40% damage on rest days.'],
  ['discipline', 'Disiplin', 'Günün bütün alışkanlıkları başarılıysa ertesi gün sonuna kadar hasar +%20.', 'Discipline', 'If all of the day\'s habits succeed, +20% damage until the end of the next day.'],
  ['rustproof', 'Pas Tutmaz', 'Geciken gün zincire paslı halka eklemez (Yorgun yine olursun).', 'Rustproof', 'A late day adds no rusty link to the chain (you still become Tired).'],
  ['tireless', 'Yorulmaz', 'Yorgun olmazsın.', 'Tireless', 'You never become Tired.'],
  ['resolute', 'Kararlı', 'Bitkin süresi 24 yerine 8 saat.', 'Resolute', 'Exhausted lasts 8 hours instead of 24.'],
  ['cardluck', 'Kart Talihi', 'Alışkanlık başarısında %15 şansla ek kart.', 'Card Luck', '15% chance of an extra card on a habit success.'],
  ['goldwind', 'Altın Rüzgârı', 'Her alışkanlık başarısında +15 oren.', 'Golden Wind', '+15 crowns on every habit success.'],
].map(([id, name, desc, en, desc_en]) => bi({ id, name, desc }, { name: en, desc: desc_en }));
/* Aerondight: Göl Hanımı'nın kılıcı. Her 24 saatlik vuruşta 1 şarj (+%5 hasar, en çok 20 → +%100; kesintisiz 20 gün). Gecikme yarısını, kaçırma ya da yenilgi hepsini götürür.
 * Şarj tamken her 12. vuruş 12 saatlik hasar vurur; başarısızlık vuruşları yarıya iner, Bitkin 12 saat sürer. */
const AERO = { per: 5, max: 20, hours: 24, every: 12, burst: 12, strike: 0.5, exhausted: 12 };
const AERO_TRAIT = bi({ id: 'aerondight', name: 'Göl Hanımı\'nın Kutsaması',
  desc: `Her ${AERO.hours} saatlik vuruş bir şarj ekler: şarj başına hasar +%${AERO.per} (en çok ${AERO.max} şarj, +%${AERO.per * AERO.max}). Gecikince şarjın yarısı, kaçırınca ya da yenilince hepsi gider. Şarj tamken her ${AERO.every}. vuruş ${AERO.burst} saatlik hasar vurur, canavarın başarısızlık vuruşları yarıya iner ve Bitkin ${AERO.exhausted} saat sürer.` },
  { name: "Blessing of the Lady of the Lake", desc: `Every ${AERO.hours} hours of hits add a charge: +${AERO.per}% damage per charge (up to ${AERO.max} charges, +${AERO.per * AERO.max}%). Being late loses half the charge; missing a day or being defeated loses all of it. At full charge every ${AERO.every}th hit deals ${AERO.burst} hours of damage, monster strikes on failure are halved and Exhausted lasts ${AERO.exhausted} hours.` });
const UNIQUE_BY_ID = Object.fromEntries([...UNIQUE, AERO_TRAIT].map(u => [u.id, u]));
(() => {
  const legs = SWORDS.filter(w => w.tier === 4 && !w.set).sort((a, b) => a.id.localeCompare(b.id)), r = seeded(hashStr('unique-traits')), pool = UNIQUE.map(u => u.id);
  legs.forEach(w => { if (pool.length) w.unique = pool.splice(Math.floor(r() * pool.length), 1)[0]; });
  SWORDS.filter(w => w.tier === 6).forEach(w => { w.unique = 'aerondight'; });
})();
const DISMANTLE = { gold: 0.2 };                                   // eritince fiyatının %20'si + seviyesinin yarısı kadar kırıntı
const DIAGRAM_FROM_REGION = 1;                                     // 2. kademeden (seviye 5–8: Lyria, Vizima) itibaren her boss bir okul seti şeması düşürür (en düşük aşamadan başlayarak)
const SET_CRAFT_SCRAPS = 100;
const LEGEND_PRICE = 1.5;                                          // demircide Efsanevi ve Kadim kılıçlar %50 pahalı
const RETRO_HOURS = 24;
/* son oyun (efsane olduktan sonra): kesilmiş canavarlar ve bölge boss'ları elit olarak geri döner; 32'den sonraki TP Ün (★) olur */
const ELITE = { hp: 1.3, gold: 1.25, xp: 1.25 };
const FAME = { gold: 75 };                                             // kaçırılan gün, kaçırıldı sayıldıktan sonra bu kadar saat içinde sonradan işlenebilir
/* miras: Karakterlerim'deki her efsane karakter yeni karakterlere +%3 oren (en çok %15), her karakter +%1 TP (en çok %10) */
const LEGACY = { goldPerLegend: 3, goldMax: 15, xpPerChar: 1, xpMax: 10 };
/* Başarımlar: genel (karakterden bağımsız), bir kez açılır. h = o anki sayımlar (createEngine içinde hesaplanır) */
const ACHIEVEMENTS = [
  { id: 'first-dawn', group: 'Alışkanlık', icon: '🌅', name: 'İlk Şafak', desc: 'İlk başarılı gün.', gold: 25, test: h => h.success >= 1, prog: h => [h.success, 1] },
  { id: 'rest', group: 'Alışkanlık', icon: '⏸', name: 'Dinlen, Witcher', desc: 'İlk dinlenme gününü önceden ilan et.', gold: 25, test: h => h.rests >= 1 },
  { id: 'chain-7', group: 'Alışkanlık', icon: '⛓', name: 'Çelik Zincir', desc: '7 halkalık zincir.', gold: 50, test: h => h.chainBest >= 7, prog: h => [h.chainBest, 7] },
  { id: 'chain-14', group: 'Alışkanlık', icon: '⛓', name: 'Gümüş Zincir', desc: '14 halkalık zincir.', gold: 100, test: h => h.chainBest >= 14, prog: h => [h.chainBest, 14] },
  { id: 'chain-30', group: 'Alışkanlık', icon: '⛓', name: 'Altın Zincir', desc: '30 halkalık zincir.', gold: 200, card: 'Epic', test: h => h.chainBest >= 30, prog: h => [h.chainBest, 30] },
  { id: 'chain-40', group: 'Alışkanlık', icon: '⛓', name: 'Mithril Zincir', desc: '40 halkalık zincir.', gold: 300, card: 'Legendary', test: h => h.chainBest >= 40, prog: h => [h.chainBest, 40] },
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
  { id: 'plus-five', group: 'Teçhizat', icon: '⚒', name: 'Usta Demirci', desc: 'Kılıçlarını toplam 25 kez yükselt.', gold: 200, test: h => h.forged >= 25, prog: h => [h.forged, 25] },
  { id: 'school-set', group: 'Teçhizat', icon: '📜', name: 'Okulun Mirası', desc: 'Kendi okulunun bir set kılıcını yaptır.', gold: 200, test: h => h.ownSchoolSet },
  { id: 'legendary-card', group: 'Kartlar', icon: '🃏', name: 'Efsanevi Kart', desc: 'İlk efsanevi kartını bul.', gold: 50, test: h => h.legendaryCards >= 1 },
  { id: 'cards-150', group: 'Kartlar', icon: '🃏', name: 'Koleksiyoncu', desc: 'Bir karakterle 150 farklı kart.', gold: 200, test: h => h.uniqueCards >= 150, prog: h => [h.uniqueCards, 150] },
  { id: 'links-5', group: 'Kartlar', icon: '🔗', name: 'Bağ Ustası', desc: '5 tamamlanmış kart bağı.', gold: 150, test: h => h.links >= 5, prog: h => [h.links, 5] },
  { id: 'links-10', group: 'Kartlar', icon: '🔗', name: 'Bağların Efendisi', desc: '10 tamamlanmış kart bağı.', gold: 300, card: 'Epic', test: h => h.links >= 10, prog: h => [h.links, 10] },
  { id: 'link-legend', group: 'Kartlar', icon: '💠', name: 'Saf Efsane', desc: 'Beş efsanevi karttan bir bağ kur.', gold: 300, card: 'Legendary', test: h => h.linkAllLegend },
  { id: 'link-double', group: 'Kartlar', icon: '🔗', name: 'Çifte Uyum', desc: 'Beş kartın da en az bir ek türü paylaştığı bir bağ kur (ör. Human + Soldier).', gold: 150, test: h => h.linkExtraMax >= 1 },
  { id: 'link-triple', group: 'Kartlar', icon: '⛓', name: 'Üçlü Uyum', desc: 'Beş kartın da iki ek türü paylaştığı bir bağ kur.', gold: 300, card: 'Epic', test: h => h.linkExtraMax >= 2 },
  { id: 'link-school', group: 'Kartlar', icon: '🏫', name: 'Okulun Yolu', desc: 'Okulunun sevdiği türlerden 3 bağ kur.', gold: 200, test: h => h.linkSchool >= 3, prog: h => [h.linkSchool, 3] },
  { id: 'link-factions', group: 'Kartlar', icon: '🌍', name: 'Kıtanın Sesi', desc: '4 farklı fraksiyondan tamamlanmış bağ (tarafsız dahil).', gold: 250, card: 'Epic', test: h => h.linkFactions >= 4, prog: h => [h.linkFactions, 4] },
  { id: 'link-value', group: 'Kartlar', icon: '✨', name: 'Mükemmel Deste', desc: 'Kart bağlarından toplam +%60 hasar.', gold: 400, card: 'Legendary', test: h => h.linkTotal >= 60, prog: h => [Math.round(h.linkTotal), 60] },
  { id: 'rebirth', group: 'Okul', icon: '♻', name: 'Yeniden Doğuş', desc: 'İlk kez yeniden doğ.', gold: 200, test: h => h.hall >= 1 },
  { id: 'new-school', group: 'Okul', icon: '🏫', name: 'Yeni Yol', desc: 'Okulunu değiştir.', gold: 100, test: h => h.schoolChanges >= 1 },
  { id: 'aerondight', group: 'Teçhizat', icon: '✨', name: "Göl Hanımı'nın Armağanı", desc: "Aerondight'ı edin.", gold: 500, card: 'Legendary', test: h => h.aerondight },
  { id: 'mini-match', group: 'Günlük oyunlar', icon: '🖼', name: 'Kart Hafızası', desc: 'Kart Eşleştirme oyununu kazan.', gold: 75, test: h => h.mini.match >= 1 },
  { id: 'mini-class', group: 'Günlük oyunlar', icon: '📖', name: 'Canavar Bilgini', desc: 'Canavar Türü oyununu kazan.', gold: 75, test: h => h.mini.class >= 1 },
  { id: 'mini-missing', group: 'Günlük oyunlar', icon: '🔎', name: 'Koleksiyoncu Gözü', desc: 'Eksik Kart oyununu kazan.', gold: 75, test: h => h.mini.missing >= 1 },
  { id: 'mini-odd', group: 'Günlük oyunlar', icon: '🃏', name: 'Farkı Gören', desc: 'Yabancıyı Bul oyununu kazan.', gold: 75, test: h => h.mini.odd >= 1 },
  { id: 'mini-30', group: 'Günlük oyunlar', icon: '🎲', name: 'Günlük Antrenman', desc: '30 günlük oyun kazan.', gold: 300, card: 'Epic', test: h => h.mini.wins >= 30, prog: h => [h.mini.wins, 30] },
  { id: 'oddity', group: 'Teçhizat', icon: '🧬', name: 'Bilim Bunu Gerektirdi', desc: 'Mutagenerator\'dan bir şey çıkar.', gold: 100, test: h => h.oddities >= 1 },
  { id: 'potions-50', group: 'Teçhizat', icon: '⚗', name: 'Simyacı', desc: '50 iksir iç (tüm karakterler).', gold: 200, test: h => h.potions >= 50, prog: h => [h.potions, 50] },
];
const ACH_GROUP_EN = { 'Alışkanlık': 'Habit', 'Av': 'Hunt', 'Bölgeler': 'Regions', 'Teçhizat': 'Gear', 'Kartlar': 'Cards', 'Okul': 'School', 'Günlük oyunlar': 'Daily games' };
const ACH_EN = {
  'first-dawn': ['First Dawn', 'First successful day.'],
  rest: ['Rest, Witcher', 'Declare your first rest day in advance.'],
  'chain-7': ['Steel Chain', 'A chain of 7 links.'],
  'chain-14': ['Silver Chain', 'A chain of 14 links.'],
  'chain-30': ['Golden Chain', 'A chain of 30 links.'],
  'chain-40': ['Mithril Chain', 'A chain of 40 links.'],
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
  'plus-five': ['Master Smith', 'Upgrade your swords 25 times in total.'],
  'school-set': ['School Legacy', 'Have a set sword of your own school crafted.'],
  'new-school': ['A New Path', 'Change your school.'],
  aerondight: ["The Lady of the Lake's Gift", 'Obtain Aerondight.'],
  'mini-match': ['Card Memory', 'Win the Card Match game.'],
  'mini-class': ['Monster Scholar', 'Win the Monster Types game.'],
  'mini-missing': ["Collector's Eye", 'Win The Missing Card game.'],
  'mini-odd': ['Spot the Difference', 'Win the Odd One Out game.'],
  'mini-30': ['Daily Training', 'Win 30 daily games.'],
  oddity: ['For Science', 'Get something out of the Mutagenerator.'],
  'potions-50': ['Alchemist', 'Drink 50 potions (all characters).'],
  'legendary-card': ['Legendary Card', 'Find your first legendary card.'],
  'cards-150': ['Collector', '150 different cards with one character.'],
  'links-5': ['Link Master', '5 completed card links.'],
  'links-10': ['Lord of Links', '10 completed card links.'],
  'link-legend': ['Pure Legend', 'Build a link of five legendary cards.'],
  'link-double': ['Double Bond', 'Build a link whose five cards all share an extra category (e.g. Human + Soldier).'],
  'link-triple': ['Triple Bond', 'Build a link whose five cards share two extra categories.'],
  'link-school': ["The School's Way", "Build 3 links of your school's favoured categories."],
  'link-factions': ['Voice of the Continent', 'Completed links from 4 different factions (neutral included).'],
  'link-value': ['Perfect Deck', 'A total of +60% damage from card links.'],
  rebirth: ['Rebirth', 'Be reborn for the first time.'],
};
ACHIEVEMENTS.forEach(a => bi(a, { group: ACH_GROUP_EN[a.group] || a.group, name: ACH_EN[a.id]?.[0] || a.name, desc: ACH_EN[a.id]?.[1] || a.desc }));
/* bölge başarımları: her bölgenin bütün canavarlarını (boss dahil) tek karakterle öldür. Ödül kademeyle artar. */
REGIONS.forEach((r, i) => {
  if (r.id === 'all') return;
  const total = () => MONSTERS.filter(m => m.region === i).length;
  const a = { id: 'region-' + r.id, icon: r.tier >= 6 ? '🏰' : r.tier >= 3 ? '🗺' : '🧭', gold: 100 + 60 * r.tier,
    card: r.tier >= 5 ? 'Legendary' : r.tier >= 2 ? 'Epic' : 'Rare',
    test: h => total() > 0 && (h.regionKills[i] || 0) >= total(), prog: h => [h.regionKills[i] || 0, total()] };
  Object.defineProperty(a, 'group', { get: () => L('Bölgeler', 'Regions'), enumerable: true });
  Object.defineProperty(a, 'name', { get: () => L(`${r.name} temizlendi`, `${r.name} cleared`), enumerable: true });
  Object.defineProperty(a, 'desc', { get: () => L(`${r.name} bölgesindeki bütün canavarları (boss dahil) tek karakterle öldür.`, `Kill every monster in ${r.name} (boss included) with one character.`), enumerable: true });
  ACHIEVEMENTS.push(a);
});
/* Günlük mini oyunlar: her gün sıradaki oyun açılır (uygun değilse bir sonraki). Günde bir deneme; kazanınca seviye × 10 oren (Cat × 15). */
const MINI = { per: 5, perCat: 7.5, kinds: ['match', 'class', 'missing', 'odd'], sizes: { match: 10, class: 5, missing: 20, odd: 10 } };
const MINI_NAME = { match: ['Kart Eşleştirme', 'Card Match'], class: ['Canavar Türü', 'Monster Types'], missing: ['Eksik Kart', 'The Missing Card'], odd: ['Yabancıyı Bul', 'Odd One Out'] };
const miniName = k => L(...(MINI_NAME[k] || [k, k]));
/* Mutagenerator: içinden tuhaf, şaka eşyalar çıkar. Her biri bir kez; havuz bitince alınamaz. Sahiplik karakterler arası kalır (yeniden doğuşta silinmez).
 * card: true olanlar Koleksiyon'da kart olarak görünür, ama ancak çıkınca (öncesinde hiç görünmez). İleride havuza yenileri eklenir. */
const MUTAGEN = { price: 1000 };
const ODDITIES = [
  { id: 'freaky-snake', name: 'Freaky Snake', desc: 'Wants your feet.', img: 'img/oddities/freaky-snake.png', card: true, r: 'Legendary' },
].map(o => bi(o, {}));
const ODDITY_BY = Object.fromEntries(ODDITIES.map(o => [o.id, o]));
/* Mysterious Puzzle Box: bilmeceyi bilince kasa açılır. Ödül kademeleri: kötüden iyiye olasılık azalır; aynı kademedekiler eşit şanslı. */
const PUZZLE = { price: 100, secs: 30, grace: 2, tiers: [   // secs: cevap süresi (grace: ağ/tıklama payı)
  { w: 16, wCat: 12.5, prizes: [{ id: 'keg' }, { id: 'gold', n: 100 }, { id: 'scraps', n: 40 }] },   // normalde kademe toplamı aynı kaldı (%48); Cat'te de tek ödül şansı kötüden iyiye azalır
  { w: 10, wCat: 12, prizes: [{ id: 'gold', n: 200 }, { id: 'bigkeg' }, { id: 'scraps', n: 100 }] },   // 1 kırıntı ≈ 2 oren
  { w: 8, wCat: 11, prizes: [{ id: 'gold', n: 500 }, { id: 'scraps', n: 250 }] },
  { w: 6, wCat: 9, prizes: [{ id: 'gold', n: 1000 }] }] };   // wCat: Cat okulu (kumarbaz) iyi ödülleri daha sık görür
const PUZZLE_STOP = new Set(['the', 'of', 'and', 'a', 'an', 'to', 'in', 'on', 'de', 'la', 'van', 'der', 'von', 'aep']);
const puzzleWords = t => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !PUZZLE_STOP.has(w));
/* tüccarın günlük stoğu: her gün yenilenir. Petri’s Philter kademeleri tek stoğu paylaşır. */
const STOCK = { puzzle: 5, swallow: 3, honey: 3, blackblood: 3, dancing: 3, owl: 1, ...Object.fromEntries(THUNDER.grades.map(g => [g.id, 3])) };
const stockKey = id => (OWL.grades.some(g => g.id === id) ? 'owl' : id);
const SHOP = [
  { id: 'keg', name: 'Kart Fıçısı', desc: '3 kart, biri en az Nadir.', price: 60 },
  { id: 'bigkeg', name: 'Büyük Fıçı', desc: '5 kart, biri en az Destansı.', price: 180 },
  { id: 'swallow', name: 'Swallow', desc: `Can iksiri: en yüksek canının %${POTION.heal * 100}'si. Savaş panelinden ya da Eşyalarım'dan içersin. En fazla ${POTION.cap} tane.`, price: 100 },
  { id: 'honey', name: 'Mahakam Ale', desc: `Bitkinken içersin: Bitkin hemen geçer ama ${DRUNK.hours} saat sarhoş olursun, canavarın vuruşları ×${DRUNK.hurt}. Zinciri korumaz. Savaş panelinden ya da Eşyalarım'dan içersin. En fazla ${HONEY_MAX} tane.`, price: 40 },
  ...THUNDER.grades.map((g, i) => ({ id: g.id, lv: g.lv, name: ['Thunderbolt', 'Gelişmiş Thunderbolt', 'Üstün Thunderbolt'][i],
    desc: `İçince ${THUNDER.hours} saat boyunca hasarın +%${g.pct}. Üst üste binmez: yenisi eskisinin yerine geçer. Savaş panelinden ya da Eşyalarım'dan içersin. En fazla ${THUNDER.cap} tane.`, price: g.price })),
  ...OWL.grades.map((g, i) => ({ id: g.id, lv: g.lv, name: ['Petri’s Philter', 'Gelişmiş Petri’s Philter', 'Üstün Petri’s Philter'][i],
    desc: `Alınca hemen içilir: +${g.xp} TP. Tüccarda günde ${STOCK.owl} tane var (kademe fark etmez).`, price: g.price })),
  { id: 'blackblood', name: 'Black Blood', desc: `İçince ${BLACKBLOOD.hours} saat boyunca kritik şansın +%${BLACKBLOOD.crit}; Vampir ve Nekrofaj canavarlara karşı +%${BLACKBLOOD.vsCrit} daha. Thunderbolt'la birlikte içilebilir. Savaş panelinden ya da Eşyalarım'dan içersin. En fazla ${BLACKBLOOD.cap} tane.`, price: BLACKBLOOD.price },
  { id: 'puzzle', name: 'Mysterious Puzzle Box', desc: `Açınca bir bilmece sorar: ya bir kartın resmini gösterip adını, ya da topladığın bir kartın sözünü gösterip hangi kart olduğunu. Adından tek bir kelimeyi bile doğru yazarsan kutu açılır ve rastgele bir ödül çıkar. Cevap için ${PUZZLE.secs} saniyen var; bu sırada kartlarına bakabilirsin. Önceki kutunun bilmecesi bitmeden yenisi alınamaz. Tüccarda günde ${STOCK.puzzle} tane var.`, price: PUZZLE.price },
  { id: 'mutagen', name: 'Mutagenerator', desc: 'Bir laboratuvar harikası… ya da felaketi. İçinden ne çıkacağı belli olmaz; aynı şey iki kez çıkmaz. Hepsi çıkınca tükenir.', price: MUTAGEN.price },
  { id: 'dancing', name: 'Dancing Star', desc: `Bomba: canavara rastgele ${DANCING.minH}–${DANCING.maxH} saatlik hasarın kadar vurur. Attıktan sonra ${DANCING.cooldown} saat yenisini atamazsın. Savaş panelinden ya da Eşyalarım'dan atarsın. En fazla ${DANCING.cap} tane.`, price: DANCING.price },
];
const ALCHEMY = ['swallow', 'honey', 'blackblood', ...THUNDER.grades.map(g => g.id), ...OWL.grades.map(g => g.id)];   // Manticore indirimi bunlara (bombalar hariç)
const SHOP_EN = {
  keg: ['Card Keg', '3 cards, at least one Rare.'],
  bigkeg: ['Large Keg', '5 cards, at least one Epic.'],
  swallow: ['Swallow', `Healing potion: ${POTION.heal * 100}% of your max HP. Drink it from the combat panel or My Items. Max ${POTION.cap}.`],
  honey: ['Mahakam Ale', `Drink it while Exhausted: Exhausted ends at once, but you're drunk for ${DRUNK.hours} hours and monster hits deal ×${DRUNK.hurt}. Doesn't protect the chain. Drink it from the combat panel or My Items. Max ${HONEY_MAX}.`],
  ...Object.fromEntries(THUNDER.grades.map((g, i) => [g.id, [['Thunderbolt', 'Enhanced Thunderbolt', 'Superior Thunderbolt'][i],
    `Drink it for +${g.pct}% damage for ${THUNDER.hours} hours. Doesn't stack: a new one replaces the old. Drink it from the combat panel or My Items. Max ${THUNDER.cap}.`]])),
  ...Object.fromEntries(OWL.grades.map((g, i) => [g.id, [['Petri’s Philter', 'Enhanced Petri’s Philter', 'Superior Petri’s Philter'][i],
    `Drunk on purchase: +${g.xp} XP. The merchant has ${STOCK.owl} a day (any grade).`]])),
  blackblood: ['Black Blood', `Drink it for +${BLACKBLOOD.crit}% crit chance for ${BLACKBLOOD.hours} hours; +${BLACKBLOOD.vsCrit}% more against Vampires and Necrophages. Can be combined with Thunderbolt. Drink it from the combat panel or My Items. Max ${BLACKBLOOD.cap}.`],
  puzzle: ['Mysterious Puzzle Box', `Opening it poses a riddle: either a card's art and you name it, or the flavour text of a card you've collected and you name the card. Get even one word of the name right and the box opens with a random prize. You have ${PUZZLE.secs} seconds to answer; you can look through your cards meanwhile. You can't buy another until the previous riddle is over. The merchant has ${STOCK.puzzle} a day.`],
  mutagen: ['Mutagenerator', "A marvel of the laboratory… or a disaster. Who knows what comes out; nothing comes out twice. Sold out once everything has come out."],
  dancing: ['Dancing Star', `Bomb: hits the monster for a random ${DANCING.minH}–${DANCING.maxH} hours of your damage. After throwing one you can't throw another for ${DANCING.cooldown} hours. Throw it from the combat panel or My Items. Max ${DANCING.cap}.`],
};
SHOP.forEach(i => bi(i, { name: SHOP_EN[i.id][0], desc: SHOP_EN[i.id][1] }));
/* tüccar kartları: Gwent kart resmi + çerçeve nadirliği (kademe arttıkça çerçeve parlar). own: Eşyalarım'da sayılan durum alanı */
const SHOP_ART = { keg: [1484, 'Rare'], bigkeg: [1484, 'Epic'], swallow: [1059, 'Common', 'swallow'], honey: [1499, 'Common', 'honey'],
  thunder: [1060, 'Common', 'thunder'], thunder2: [1060, 'Epic', 'thunder2'], thunder3: [1060, 'Legendary', 'thunder3'],
  owl: [1066, 'Common'], owl2: [1066, 'Epic'], owl3: [1066, 'Legendary'], blackblood: [1633, 'Epic', 'blackblood'], puzzle: [3934, 'Epic'], mutagen: [3945, 'Legendary'], dancing: [1694, 'Common', 'dancing'] };
SHOP.forEach(i => { const [art, r, own] = SHOP_ART[i.id]; Object.assign(i, { art, r, own: own || null }); });
/* canavar değerleri: bölgenin en yüksek değerleri × canavarın bölge içi gücü (str) */
/* oyunun üçte birlik dilimlerine göre can çarpanı: kademe 1–3 ×1.2, 4–6 ×1.5, 7–8 ×2 */
const HP_MULT = [1.2, 1.2, 1.2, 1.5, 1.5, 1.5, 2, 2];
function monStats(m, elite = false) {
  const r = Math.min(REG.hp.length - 1, regionTier(m.region || 0));
  const f = m.str || 0.75, b = m.boss, e = elite ? ELITE : { hp: 1, gold: 1, xp: 1 };
  return {
    hp: Math.round(REG.hp[r] * (HP_MULT[r] ?? 1) * f * (b ? BOSS.hp : 1) * e.hp),
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
const MAX_ITEMS = 20;                                               // bir alışkanlıkta en fazla alt görev
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
  /* alt görevler (adet ve yaptım/yapmadım türünde): ör. "Vitamin al" → D vitamini, Omega 3, B12.
   * Adette her alt görev 1 sayılır ve günlük hedef alt görev sayısı olur; yaptım/yapmadımda hepsi işaretlenince gün tamamlanır. */
  if (q.type === 'count' || q.type === 'check') {
    const items = [...new Set((Array.isArray(cfg.items) ? cfg.items : []).map(x => String(x || '').trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_ITEMS);
    if (items.length) { q.items = items; if (q.type === 'count') q.count.target = items.length; }
  }
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
  const sch = SCHOOLS[school] ? school : 'wolf', kit = START_KIT[sch];
  const sw = [kit.silver, kit.steel].filter(id => id && swordById(id));
  return {
    charId: uid(), charStart: nowDate.toISOString(),
    name: name || 'Witcher', school: sch, faction: FACTIONS.includes(faction) ? faction : null, avatar: null,
    hp: sch === 'bear' ? 140 : 100, xp: 0, level: 1, gold: kit.gold, scraps: kit.scraps, swallow: kit.swallow, honey: kit.honey, thunder: kit.thunder || 0, thunder2: 0, thunder3: 0, blackblood: 0, dancing: kit.dancing || 0, combat: null, queue: [],
    collection: {}, factionsDone: [], links: [], swords: { owned: sw, silver: swordById(kit.silver) ? kit.silver : null, steel: swordById(kit.steel) ? kit.steel : null, lv: Object.fromEntries(sw.map(id => [id, 1])) }, diagrams: [],
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
  // v12: idle savaş. Eski Swallow (ceza koruması) Mahakam Ale oldu; Swallow artık can iksiri.
  if (s.v < 12) {
    s.honey = Math.min(HONEY_MAX, s.swallow ?? 1); s.swallow = 3;
    s.effects = []; s.combat = null; s.queue = [];
    s.settings ||= {}; if (s.settings.autoPotion === undefined) s.settings.autoPotion = true;
    s.v = 12;
  }
  s.effects ||= []; s.queue ||= [];
  s.thunder ??= 0; s.thunder2 ??= 0; s.thunder3 ??= 0; s.blackblood ??= 0; s.dancing ??= 0; delete s.huntPaused;   // kontrat iptali kalktı: av hiç durmaz
  if (s.swords) {                          // eski +1..+5 güçlendirmeler kalktı: elindeki kılıçlar karakterin seviyesine gelir
    s.swords.lv ||= {};
    (s.swords.owned || []).forEach(id => { if (!s.swords.lv[id]) s.swords.lv[id] = Math.max(1, s.level || 1); });
    delete s.swords.up;
  }
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
  /* kuşanılan kılıçların benzersiz özellikleri */
  const eqSwords = () => [swordById(state.swords?.silver), swordById(state.swords?.steel)].filter(Boolean);
  const has = id => eqSwords().some(w => w.unique === id);
  const holderOf = id => eqSwords().find(w => w.unique === id) || null;
  const otherOf = id => { const w = holderOf(id); return w ? swordById(state.swords[w.type === 'silver' ? 'steel' : 'silver']) : null; };
  const uName = id => UNIQUE_BY_ID[id]?.name || id;
  const hourAt = t => new Date(t.getTime() - 1).getHours();             // saat başı vuruş, biten saate sayılır
  const isNight = t => { const h = hourAt(t); return h >= 22 || h < 6; };
  const markEquip = id => { (state.swords.since ||= {})[id] = clockNow().toISOString(); };
  const aeroOn = () => has('aerondight');
  const aeroFull = () => aeroOn() && (state.aero?.charge || 0) >= AERO.max;
  const repairNeed = () => Math.max(1, (sc() === 'griffin' ? 1 : REPAIR_NEED) - (has('atoner') ? 1 : 0));
  const isSleep = () => Q().type === 'sleep';
  const maxHp = () => Math.round(hpAt(state.level || 1) * (sc() === 'bear' ? 1.4 : 1) * (has('hpshield') ? 1.25 : 1));
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
  const activeFx = t => (state.effects || []).filter(e => new Date(e.until) > t);
  const debuffPct = (t = clockNow()) => Math.min(EFFECT_CAP, activeFx(t).filter(e => !EFFECTS[e.kind]?.buff).reduce((s, e) => s + e.pct, 0));
  const buffPct = (t = clockNow()) => activeFx(t).filter(e => EFFECTS[e.kind]?.buff && !EFFECTS[e.kind].crit).reduce((s, e) => s + e.pct, 0);   // farklı güçlendirmeler toplanır (aynı tür üst üste binmez)
  function addEffect(kind, src, hours, pct) {
    const d = { ...EFFECTS[kind], ...(hours ? { hours: +hours.toFixed(1) } : {}), ...(pct ? { pct } : {}) }, t = clockNow();
    if (d.buff || d.once) state.effects = state.effects.filter(e => e.kind !== kind);   // güçlendirme üst üste binmez, süresi yenilenir
    const e = { id: uid(), kind, pct: d.pct, until: addMin(t, d.hours * 60).toISOString(), src };
    state.effects.push(e);
    const nm = { tired: L('Yorgun', 'Tired'), exhausted: L('Bitkin', 'Exhausted'), focus: L('Odak', 'Focus'), thunder: 'Thunderbolt', early: uName('early'), discipline: uName('discipline') }[kind];
    if (d.crit || d.hurt) { /* iksir kendi günlüğünü yazar */ }
    else if (d.buff) log(L(`${nm}: ${d.hours} saat boyunca hasarın +%${d.pct}${src ? ` (${src})` : ''}.`, `${nm}: +${d.pct}% damage for ${d.hours} hours${src ? ` (${src})` : ''}.`), 'good');
    else log(L(`${nm}: ${d.hours} saat boyunca hasarın −%${d.pct}${src ? ` (${src})` : ''}.`, `${nm}: −${d.pct}% damage for ${d.hours} hours${src ? ` (${src})` : ''}.`), 'bad');
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
      if (c.repair.got >= repairNeed()) {
        c.len = c.repair.preLen + c.repair.got;
        state.counters ||= {}; state.counters.repairs = (state.counters.repairs || 0) + 1;
        log(L(`Kefaret tamamlandı! Kırık halka onarıldı, zincir ${c.len} halkaya döndü.`, `Atonement complete! The broken link is repaired; your chain is back to ${c.len} links.`), 'epic');
        toast(L('Zincir onarıldı!', 'Chain repaired!'), 'good');
        c.repair = null;
      } else log(L(`Kefaret ${c.repair.got}/${repairNeed()}. Bir gün daha başarırsan ${c.repair.preLen} halka geri gelecek.`, `Atonement ${c.repair.got}/${repairNeed()}. One more successful day brings back ${c.repair.preLen} links.`), 'good');
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
    log(L(`Zincir kırıldı (${why})! ${preLen} → ${c.len} halka${t > 0 ? `, ${TIERS[t].name} → ${TIERS[t - 1].name}` : ''}. Kefaret: sonraki ${repairNeed()} günü başarırsan ${preLen} halka geri gelir.`,
      `Chain broken (${why})! ${preLen} → ${c.len} links${t > 0 ? `, ${TIERS[t].name} → ${TIERS[t - 1].name}` : ''}. Atonement: succeed the next ${repairNeed()} days and ${preLen} links come back.`), 'bad');
    toast(L('Zincir kırıldı! Kefaret yolu açık.', 'Chain broken! The path of atonement is open.'), 'bad');
  }
  function chainLate(k) {
    const c = C();
    if (has('rustproof')) { log(L(`${uName('rustproof')}: geç kaldın ama zincir paslanmadı.`, `${uName('rustproof')}: you were late, but the chain didn't rust.`), ''); return; }
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
  /* kesilen canavarın ilanı panoda "öldü" olarak kalır; panodaki bütün ilanlar kesilince pano yenilenir (hafta başını beklemeden).
   * Bölgede kesilmemiş canavar kalmadıysa pano olduğu gibi kalır. */
  function refillBoard(r) {
    const board = state.boards?.[r]; if (!board || postGame() || !board.ids.length) return;
    const killed = killedSet();
    if (!board.ids.every(id => killed.has(id))) return;
    const pool = MONSTERS.filter(m => (m.region || 0) === r && !m.boss && !killed.has(m.id) && m.id !== state.contract?.id);
    if (!pool.length) return;
    const ids = [];
    while (ids.length < BOARD_SIZE && pool.length) ids.push(pool.splice(Math.floor(random() * pool.length), 1)[0].id);
    board.ids = ids;
    log(L(`${REGIONS[r].name} panosundaki bütün ilanlar tamamlandı; panoya yeni ilanlar asıldı.`, `Every notice on the ${REGIONS[r].name} board is done; new notices were posted.`), 'good');
  }
  function boardEntries(r = homeRegion()) {
    if (!REGIONS[r] || REGIONS[r].tier > band()) return [];
    ensureBoard(r); refillBoard(r);
    const board = state.boards[r], killed = killedSet();
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
  /* bağın değeri: nadirlik + ek ortak türler, okul uyumu ×1,5 */
  function linkValue(l) {
    if (!l || l.cards.length < LINK_SIZE) return null;
    const cards = l.cards.map(a => CARD_BY_ART[a]).filter(Boolean);
    const rar = cards.reduce((t, c) => t + (LINK_RAR[c.r] || 0), 0);
    const shared = cards.length ? cardCats(cards[0]).filter(x => x !== l.cat && cards.every(c => cardCats(c).includes(x))) : [];
    const fav = (SCHOOL_CATS[sc()] || []).includes(l.cat);
    const base = rar + shared.length * LINK_EXTRA;
    return { rar: +rar.toFixed(1), shared, extra: shared.length * LINK_EXTRA, fav, total: +(base * (fav ? LINK_SCHOOL : 1)).toFixed(1) };
  }
  /* sayılan bağlar: en değerli LINK_MAX tanesi */
  const countedLinks = () => completeLinks().map(l => ({ l, v: linkValue(l) })).sort((a, b) => b.v.total - a.v.total).slice(0, LINK_MAX);
  const swordLv = id => (state.swords.lv || {})[id] || 1;
  /* gümüşün saatlik hasarı (kılıcın seviyesi + kendi okulunun seti +%15) */
  function swordDmg(w, L = w && swordLv(w.id)) {
    if (!w || w.type !== 'silver') return 0;
    const own = w.school && w.school === sc();
    return Math.round(swordDmgAt(w, L) * (own ? 1.15 : 1) * 10) / 10;
  }
  /* kılıcın tek sayılık değeri: gümüşte saatlik hasar, çelikte kritik % */
  function swordValue(w, L = w && swordLv(w.id)) {
    if (!w) return 0;
    if (w.type === 'silver') return swordDmg(w, L);
    const own = w.school && w.school === sc();
    return swordCritAt(w, L) + (own ? 3 : 0);
  }
  const baneOf = (w, m) => (w && m && (w.banes || [w.bane]).includes(m.cls) ? (w.banePct ?? BANE) : 0);
  /* zincirlerin hasar katkısı: en güçlüsü tam, ikincisi yarım, üçüncüsü üçte bir ... */
  function chainDamage() {
    const list = state.habits.map(h => ({ h, dmg: TIERS[tierOf(h.chain.len)].dmg * (h.status === 'mastery' ? MASTERY_DMG : 1) })).sort((a, b) => b.dmg - a.dmg);
    list.forEach((x, i) => { x.w = CHAIN_WEIGHTS[i] ?? 0.2; x.eff = +(x.dmg * x.w).toFixed(1); });
    return { total: +list.reduce((s, x) => s + x.eff, 0).toFixed(1), list };
  }
  /* yüzde bonusları: zincir + kart bağları + bane, düz toplanır. Kılıç tabanı ayrı. */
  function damageBonus(m = state.contract ? monById(state.contract.id) : null) {
    const parts = []; let raw = 0;
    const sv = swordById(state.swords.silver), stl = swordById(state.swords.steel);
    for (const w of [sv, stl]) { const bb = baneOf(w, m); if (bb) { raw += bb; parts.push(L(`${w.name}: ${CLASSES[m.cls]?.tr || m.cls} avcısı +%${bb}`, `${w.name}: ${CLASSES[m.cls]?.tr || m.cls} bane +${bb}%`)); } }
    const cl = countedLinks(), lv = +(cl.reduce((t, x) => t + x.v.total, 0) * (has('linkmaster') ? 1.3 : 1)).toFixed(1);
    if (lv) { raw += lv; parts.push(L(`${cl.length} kart bağı +%${lv}`, `${cl.length} card links +${lv}%`)); }
    const ch = chainDamage(), sw = swordDmg(sv), chT = +(ch.total * (has('resonance') ? 1.25 : 1)).toFixed(1);
    if (chT) { raw += chT; parts.unshift(L(`zincirler +%${chT}`, `chains +${chT}%`)); }
    for (const [p, nm] of traitBonus(m)) { raw += p; parts.push(`${nm} +${L('%' + p, p + '%')}`); }
    return { pct: +raw.toFixed(1), raw: +raw.toFixed(1), parts, crit: critChance(m, swordValue(stl)), chain: chT, links: lv, sword: sw, swordName: sv ? `${sv.name} (${L('Sv', 'Lv')} ${swordLv(sv.id)})` : null };
  }
  /* benzersiz özelliklerden gelen hasar yüzdeleri: [yüzde, ad] */
  function traitBonus(m, t = clockNow()) {
    const out = [], c = state.contract, ratio = c ? c.hp / c.max : 1, h = hourAt(t), wd = t.getDay();
    const add = (id, p) => { if (p > 0) out.push([p, uName(id)]); };
    if (!eqSwords().some(w => w.unique)) return out;
    if (has('night') && isNight(t)) add('night', 30);
    if (has('dawn') && h >= 6 && h < 12) add('dawn', 25);
    if (has('noon') && h >= 12 && h < 18) add('noon', 25);
    if (has('dusk') && h >= 18 && h < 22) add('dusk', 35);
    if (has('weekend') && (wd === 0 || wd === 6)) add('weekend', 25);
    if (has('monday') && wd === 1) add('monday', 50);
    if (has('execute') && c && ratio < 0.25) add('execute', 50);
    if (has('firstblood') && c && ratio > 0.75) add('firstblood', 30);
    if (has('giant') && m?.boss) add('giant', 30);
    if (has('elite') && c?.elite) add('elite', 40);
    if (has('fullpower') && state.hp > maxHp() * 0.9) add('fullpower', 20);
    if (has('bloodprice')) add('bloodprice', 35);
    if (has('patient') && c?.since) add('patient', Math.min(40, 5 * Math.floor((t - new Date(c.since)) / 864e5)));
    if (has('quick') && c?.since && t - new Date(c.since) < 12 * 36e5) add('quick', 50);
    if (has('streak')) add('streak', Math.min(25, 5 * (state.killStreak || 0)));
    if (has('loyal')) { const w = holderOf('loyal'), since = state.swords.since?.[w.id] || (markEquip(w.id), state.swords.since[w.id]); add('loyal', Math.min(30, Math.floor((t - new Date(since)) / 864e5))); }
    if (has('kin')) { const o = otherOf('kin'); if (o && !o.set && o.tier >= 4) add('kin', 15); }
    if (has('lone') && !otherOf('lone')) add('lone', 35);
    if (has('bestiary') && m) add('bestiary', Math.min(20, new Set(state.trophies.filter(x => monById(x.id).cls === m.cls).map(x => x.id)).size));
    if (has('lord') && m && regionTier(m.region) < band()) add('lord', 50);
    if (has('stranger') && state.bandSince && t - new Date(state.bandSince) < 7 * 864e5) add('stranger', 30);
    if (has('grudge')) add('grudge', 10 * activeFx(t).filter(e => !EFFECTS[e.kind]?.buff).length);
    if (has('bleed') && state.bleedUntil && t < new Date(state.bleedUntil)) add('bleed', 25);
    if (has('rested') && isRest(dk(t))) add('rested', 40);
    if (aeroOn()) add('aerondight', AERO.per * Math.min(AERO.max, state.aero?.charge || 0));
    return out;
  }
  /* kritik şansı: çelik kılıç + özellikler */
  function critChance(m, base, t = clockNow()) {
    const c = state.contract;
    if (has('lastblow') && c && c.hp / c.max < 0.2) return 100;
    let x = base + (has('sharp') ? 8 : 0) + (has('nightcrit') && isNight(t) ? 15 : 0);
    if (activeFx(t).some(e => e.kind === 'blackblood')) x += BLACKBLOOD.crit + (m && BLACKBLOOD.vs.includes(m.cls) ? BLACKBLOOD.vsCrit : 0);
    if (has('chaincrit') && state.critChain) x *= 2;
    return Math.min(100, Math.round(x));
  }
  /* oyuncunun saatlik hasarı: (seviye gücü + gümüş kılıç) × (1 + bonus [zincir + bağlar + bane]) × odak × ceza × yaralı */
  function playerStats(m = state.contract ? monById(state.contract.id) : null) {
    const b = damageBonus(m), deb = debuffPct(), buf = buffPct() * (has('focusmind') ? 1.5 : 1), wounded = isWounded();
    const mult = (1 + b.pct / 100) * (1 + buf / 100) * (1 - deb / 100) * (wounded ? (has('desperate') ? 1.2 : 1 - WOUNDED.pct / 100) : 1);
    const lvl = powerAt(state.level);
    return { dph: (lvl + b.sword) * mult, level: lvl, mult, crit: b.crit, deb, buf, wounded, bonus: b };
  }
  function hitMonster(base, why) {
    const c = ensureContract();
    if (!c || base <= 0) return 0;
    const b = damageBonus(monById(c.id));
    const isCrit = b.crit > 0 && random() * 100 < b.crit;
    const dmg = Math.max(1, Math.round(base * (isCrit ? critMult() : 1)));
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
    let gm = sc() === 'cat' ? 1.3 : 1, xm = 1;
    if (has('bounty')) gm *= 1.25;
    if (has('greedy')) { gm *= 1.5; xm *= 0.75; }
    if (has('veteran')) { xm *= 1.4; gm *= 0.8; }
    if (has('sage')) xm *= 1.2;
    const gold = addGold(s.gold * gm), xp = Math.round(s.xp * xm), scr = SCRAP_PER_KILL + (has('scav') ? 2 : 0);
    state.scraps += scr;
    state.killStreak = (state.killStreak || 0) + 1;
    log(L(`${why}: ${dmg} hasarlık${isCrit ? ' kritik' : ''} son darbe! ${el ? 'Elit ' : ''}${m.name} öldü. Ödül: ${gold} oren, ${xp} TP, ${scr} kırıntı.`, `${why}: a ${dmg}-damage${isCrit ? ' critical' : ''} finishing blow! ${el ? 'Elite ' : ''}${m.name} is dead. Reward: ${gold} crowns, ${xp} XP, ${scr} scrap.`), 'epic');
    killTraits(m);
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
        state.region = band() + 1; state.bandSince = clockNow().toISOString();
        const bi2 = bandInfo(), names = bi2.regions.map(x => REGIONS[x].name).join(', ');
        log(L(`${m.name} yenildi! Yeni bölgeler açıldı: ${names} (seviye ${bi2.min}–${bi2.max}).`, `${m.name} defeated! New regions unlocked: ${names} (levels ${bi2.min}–${bi2.max}).`), 'epic');
        toast(L(`Yeni bölgeler: ${names}`, `New regions: ${names}`), 'good');
        bi2.regions.forEach(x => ensureBoard(x));
      } else {
        if (!state.legend) {
          state.legend = true;
          log(L(`Son boss ${m.name} yenildi! ${state.name} artık bir efsane. Ya Karakterlerim sekmesinden yeniden doğ ya da bu karakterle devam et: kestiğin canavarlar ve bölge boss'ları artık elit olarak geri dönüyor, 32'den sonraki TP Ün (★) kazandırıyor.`,
            `Final boss ${m.name} defeated! ${state.name} is now a legend. Be reborn from the My Characters tab, or keep playing this character: slain monsters and region bosses now return as elites, and XP past level 32 earns Renown (★).`), 'epic');
          toast(L(`${state.name} bir efsane oldu!`, `${state.name} became a legend!`), 'good');
          for (const i of openRegions()) { delete state.boards[i]; ensureBoard(i); }   // tabelalar son oyuna göre yenilensin
        }
      }
    }
    gainXp(xp);
  }
  /* öldürmede özellik ganimetleri */
  function killTraits(m) {
    const got = (id, what) => log(L(`${uName(id)}: ${what[0]}.`, `${uName(id)}: ${what[1]}.`), 'good');
    if (has('collector') && random() < 0.25) drawCards(1, 'Common', uName('collector'));
    if (has('trophy') && m.boss) drawCards(1, 'Legendary', uName('trophy'));
    if (has('potionhunt') && random() < 0.3 && state.swallow < POTION.cap) { state.swallow++; got('potionhunt', ['bir Swallow buldun', 'you found a Swallow']); }
    if (has('stormharvest') && random() < 0.2 && (state.thunder || 0) < THUNDER.cap) { state.thunder = (state.thunder || 0) + 1; got('stormharvest', ['bir Thunderbolt buldun', 'you found a Thunderbolt']); }
    if (has('starharvest') && random() < 0.2 && (state.dancing || 0) < DANCING.cap) { state.dancing = (state.dancing || 0) + 1; got('starharvest', ['bir Dancing Star buldun', 'you found a Dancing Star']); }
    if (has('harvest')) heal(0.25, 1);
  }
  /* ---------- sürekli av ----------
   * Sen canavara sürekli vurursun; canavar sana SADECE alışkanlıklarında başarısız olduğunda vurur
   * (gecikme: yarım vuruş, kaçırma: tam vuruş). Can kendiliğinden dolmaz; sadece Swallow (iksir) doldurur.
   * Can biterse yenilirsin: canavarın canı tamamen dolar, 6 saat toparlanır ve tam canla dönersin. */
  const cbState = () => (state.combat ||= { t: now().toISOString(), mode: 'fight', until: null, last: {} });
  const potionHeal = () => Math.round(maxHp() * (has('swallowmaster') ? POTION.master : POTION.heal));
  const critMult = () => (has('deadly') ? 2 : CRIT_MULT);
  const honeyMax = () => (has('honeybearer') ? HONEY_MAX * 2 : HONEY_MAX);
  const alchPrice = p => (sc() === 'manticore' ? Math.round(p * ALCH_DISCOUNT) : p);
  const potionPrice = () => alchPrice(SHOP.find(i => i.id === 'swallow').price);
  const regenIdle = () => (sc() === 'bear' ? REGEN.idleBear : REGEN.idle) * (has('quickrecover') ? 2 : 1);
  const regenFight = () => (REGEN.fight[sc()] ?? REGEN.fight.wolf) * (has('lifebond') ? 3 : 1);
  const isWounded = () => cbState().mode !== 'recover' && state.hp < maxHp() * WOUNDED.below;
  const heal = (rate, h) => { state.hp = Math.min(maxHp(), (state.hp || 0) + maxHp() * rate * h); };
  const schoolHurt = () => (sc() === 'cat' ? 1.5 : sc() === 'bear' ? 0.6 : 1) * (has('stone') ? 0.75 : 1) * (has('bloodprice') ? 1.25 : 1) * (aeroFull() ? AERO.strike : 1) * (activeFx(clockNow()).some(e => e.kind === 'drunk') ? DRUNK.hurt : 1);
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
    const hours = 1 / regenIdle();
    state.hp = 0; cb.mode = 'recover'; cb.until = addMin(t, hours * 60).toISOString();
    if (c) c.hp = c.max;
    state.killStreak = 0; if (state.aero) { state.aero.charge = 0; state.aero.h = 0; }
    const lost = has('purse') ? 0 : Math.floor((state.gold || 0) * DEFEAT.gold); state.gold -= lost;
    flavor('defeat', m); fx('bad'); state.stats.defeats = (state.stats.defeats || 0) + 1;
    if (lost) log(L(`Yaraların sarılırken kesenden ${lost} oren eksildi.`, `While your wounds were tended, ${lost} crowns went missing from your purse.`), 'bad');
    toast(L(`${m ? m.name : 'Canavar'} seni yendi! Canı tamamen doldu; ~${Math.round(hours * 10) / 10} saat toparlanacaksın${lost ? `, −${lost} oren` : ''}.`, `${m ? m.name : 'The monster'} defeated you! It's back to full HP; you'll recover for ~${Math.round(hours * 10) / 10} hours${lost ? `, −${lost} crowns` : ''}.`), 'bad');
  }
  /* başarısızlık: canavar vurur. Döndürür: geri alma için bilgi */
  function monsterStrike(missed, why) {
    const c = state.contract, m = c ? monById(c.id) : null;
    const before = { hp: state.hp, contract: c ? { ...c } : null, combat: { ...cbState() } };
    if (cbState().mode === 'recover') return { dealt: 0, before };
    if (!missed && has('steady')) { log(L(`${uName('steady')}: geç kaldın ama canavar vuramadı.`, `${uName('steady')}: you were late, but the monster couldn't strike.`), ''); return { dealt: 0, before }; }
    const d = failHit(missed, c);
    state.hp -= d;
    flavor(missed ? 'strikeMiss' : 'strikeLate', m, d);
    let died = state.hp <= 0;
    const wk = mondayOf(logicalToday());
    if (died && has('lastbreath') && state.lastBreath !== wk) {
      state.hp = 1; state.lastBreath = wk; died = false;
      log(L(`${uName('lastbreath')}: ölümcül darbeden 1 canla kurtuldun!`, `${uName('lastbreath')}: you survived a killing blow with 1 HP!`), 'epic');
    }
    if (died) defeat(m, c);
    else if (has('thorns') && c && state.contract === c) hitMonster(Math.round(playerStats(m).dph * 3), uName('thorns'));
    return { dealt: d, died, before };
  }
  /* sayaçlar (karakterler arası kalır): başarımlar için */
  const count = (k, n = 1) => { state.counters ||= {}; state.counters[k] = (state.counters[k] || 0) + n; };
  const drank = () => { state.stats.potions = (state.stats.potions || 0) + 1; count('potions'); };
  /* Mahakam Ale: elle içilir. Bitkin'i hemen kaldırır ama 24 saat sarhoşsun: canavarın vuruşları ×2. */
  function drinkAle() {
    if ((state.honey || 0) <= 0) return err(L('Mahakam Ale yok.', 'No Mahakam Ale left.'));
    if (!activeFx(clockNow()).some(e => e.kind === 'exhausted')) return err(L('Bitkin değilsin.', "You aren't Exhausted."));
    advanceCombat(now());
    state.honey--; drank();
    state.effects = state.effects.filter(e => e.kind !== 'exhausted');
    addEffect('drunk', 'Mahakam Ale');
    log(L(`Mahakam Ale içtin: Bitkin geçti ama ${DRUNK.hours} saat sarhoşsun, canavarın vuruşları ×${DRUNK.hurt}.`,
      `You drank Mahakam Ale: no longer Exhausted, but you're drunk for ${DRUNK.hours} hours and monster hits deal ×${DRUNK.hurt}.`), '');
    return ok();
  }
  /* Black Blood: 24 saat kritik +%10 (Vampir/Nekrofaj'a +%15 daha). Thunderbolt'tan ayrı etki; kendisi üst üste binmez. */
  function drinkBlackBlood() {
    if ((state.blackblood || 0) <= 0) return err(L('Black Blood yok.', 'No Black Blood left.'));
    advanceCombat(now());
    state.blackblood--; drank();
    addEffect('blackblood', L('iksir', 'potion'));
    log(L(`Black Blood içtin: ${BLACKBLOOD.hours} saat boyunca kritik şansın +%${BLACKBLOOD.crit} (Vampir ve Nekrofaj'a +%${BLACKBLOOD.crit + BLACKBLOOD.vsCrit}).`,
      `You drank Black Blood: +${BLACKBLOOD.crit}% crit chance for ${BLACKBLOOD.hours} hours (+${BLACKBLOOD.crit + BLACKBLOOD.vsCrit}% against Vampires and Necrophages).`), 'good');
    return ok();
  }

  /* --- Mysterious Puzzle Box: bilmece + kasa --- */
  const flavorOf = c => c.fl || (root.GWENT_EXTRA || {})[c.a] || '';
  function makePuzzle() {
    const named = c => puzzleWords(c.n).length > 0;
    const mine = Object.keys(state.collection || {}).map(a => CARD_BY_ART[a]).filter(c => c && named(c) && flavorOf(c).length >= 20);
    const units = CARDS.filter(c => c.t === 'Unit' && named(c));
    const kind = mine.length && random() < 0.5 ? 'flavor' : 'art';
    const pool = kind === 'flavor' ? mine : units, c = pool[Math.floor(random() * pool.length)];
    state.puzzleQ = { kind, a: c.a, until: addMin(now(), PUZZLE.secs / 60).toISOString() };
  }
  /* süre doldu mu (eski kayıtlarda süre yok: sınırsız) */
  const puzzleLate = q => !!q?.until && now() - new Date(q.until) > PUZZLE.grace * 1000;
  function puzzleQuestion() {
    const q = state.puzzleQ; if (!q) return null;
    const c = CARD_BY_ART[q.a];
    return { kind: q.kind, a: q.a, flavor: q.kind === 'flavor' ? flavorOf(c) : null, until: q.until || null, expired: puzzleLate(q) };
  }
  const puzzleW = t => (sc() === 'cat' ? t.wCat ?? t.w : t.w);
  function rollPuzzlePrize() {
    const tot = PUZZLE.tiers.reduce((t, x) => t + puzzleW(x) * x.prizes.length, 0);
    let r = random() * tot;
    for (const [ti, t] of PUZZLE.tiers.entries()) for (const p of t.prizes) { r -= puzzleW(t); if (r < 0) return { ...p, tier: ti }; }
    const last = PUZZLE.tiers.length - 1; return { ...PUZZLE.tiers[last].prizes.at(-1), tier: last };
  }
  function answerPuzzle(text) {
    const q = state.puzzleQ;
    if (!q) return err(L('Açılmayı bekleyen bir kutu yok.', 'No box is waiting to be opened.'));
    const c = CARD_BY_ART[q.a], guess = new Set(puzzleWords(text)), name = c.n, late = puzzleLate(q);
    if (!guess.size && !late) return err(L('Bir şey yaz.', 'Type something.'));
    state.puzzleQ = null;
    const correct = !late && puzzleWords(name).some(w => guess.has(w));
    if (!correct) { log(late ? L(`Bilmecenin süresi doldu: doğru cevap "${name}". Kutu açılmadı.`, `The riddle timed out: the answer was "${name}". The box stayed shut.`)
      : L(`Bilmece bilinemedi: doğru cevap "${name}". Kutu açılmadı.`, `Riddle missed: the answer was "${name}". The box stayed shut.`), 'bad'); return { ok: true, correct: false, late, name }; }
    const prize = rollPuzzlePrize(), box = L('Mysterious Puzzle Box', 'Mysterious Puzzle Box');
    if (prize.id === 'gold') { state.gold += prize.n; state.stats.goldEarned += prize.n; weekTrack('gold', prize.n); }
    if (prize.id === 'scraps') state.scraps += prize.n;
    if (prize.id === 'keg') drawCards(3, 'Rare', box);
    if (prize.id === 'bigkeg') drawCards(5, 'Epic', box);
    count('puzzles');
    log(L(`Bilmece bilindi (${name})! Kutudan çıkan: ${prizeName(prize)}.`, `Riddle solved (${name})! The box held: ${prizeName(prize)}.`), 'epic');
    return { ok: true, correct: true, name, prize };
  }
  /* --- günlük mini oyunlar --- */
  const miniReward = () => Math.round((state.level || 1) * (sc() === 'cat' ? MINI.perCat : MINI.per));
  const dayNum = k => Math.round((fromKey(k) - fromKey('2026-01-01')) / 864e5);
  function miniBuild(kind, k, salt = '') {
    const r = seeded(hashStr(`mini|${k}|${state.charId || state.name}|${kind}${salt}`));
    const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const owned = Object.keys(state.collection || {}).map(a => CARD_BY_ART[a]).filter(Boolean);
    if (kind === 'match') {
      const fl = c => flavorOf(c).length >= 15;
      const mine = owned.filter(fl), src = mine.length >= MINI.sizes.match ? mine : CARDS.filter(c => c.t === 'Unit' && fl(c));
      const cards = shuf(src).slice(0, MINI.sizes.match);
      return { key: cards.map(c => c.a), pub: { templates: cards.map(c => ({ n: c.n, fl: flavorOf(c) })), images: shuf(cards.map(c => c.a)) } };
    }
    if (kind === 'class') {
      const ms = shuf(MONSTERS.filter(m => m.cls && CLASSES[m.cls])).slice(0, MINI.sizes.class);
      return { key: ms.map(m => m.cls), pub: { monsters: ms.map(m => ({ id: m.id, name: m.name, img: monImg(m, 'low') })), options: Object.keys(CLASSES) } };
    }
    if (kind === 'missing') {
      const have = new Set(owned.map(c => c.a)), out = CARDS.filter(c => inPool(c) && !have.has(c.a));
      if (owned.length < MINI.sizes.missing - 1 || !out.length) return null;
      const miss = shuf(out)[0], cards = shuf([...shuf(owned).slice(0, MINI.sizes.missing - 1), miss]);
      return { key: miss.a, pub: { cards: cards.map(c => c.a) } };
    }
    if (kind === 'odd') {
      for (const f of shuf(FACTIONS)) {
        const fc = CARDS.filter(c => c.f === f && cardCats(c).length), cnt = {};
        fc.forEach(c => cardCats(c).forEach(x => { cnt[x] = (cnt[x] || 0) + 1; }));
        for (const x of shuf(Object.keys(cnt).filter(x => cnt[x] >= MINI.sizes.odd - 1))) {
          const nine = shuf(fc.filter(c => cardCats(c).includes(x))).slice(0, MINI.sizes.odd - 1), U = new Set(nine.flatMap(cardCats));
          const odds = fc.filter(c => !nine.includes(c) && cardCats(c).every(y => !U.has(y)));
          if (!odds.length) continue;
          const o = shuf(odds)[0];
          return { key: o.a, pub: { faction: f, cards: shuf([...nine, o]).map(c => c.a) } };
        }
      }
      return null;
    }
    return null;
  }
  function miniCheck(g, answer) {
    const arr = Array.isArray(g.key);
    if (arr && (!Array.isArray(answer) || answer.length !== g.key.length || answer.some(x => x == null || x === ''))) return err(L('Önce hepsini doldur.', 'Fill them all in first.'));
    if (!arr && (answer == null || answer === '')) return err(L('Önce bir seçim yap.', 'Make a choice first.'));
    return { won: arr ? g.key.every((x, i) => String(x) === String(answer[i])) : String(g.key) === String(answer) };
  }
  /* antrenman: istediğin oyunu istediğin kadar oyna; ödül, sayaç ve başarım yok. Kayda yazılmaz. */
  let practice = null;
  function startPractice(kind) {
    if (!MINI.kinds.includes(kind)) return err('?');
    const g = miniBuild(kind, dk(now()), '|p' + Math.floor(random() * 1e9));
    if (!g) return err(L('Bu oyun şu an kurulamıyor (ör. yeterli kart yok).', "This game can't be set up right now (e.g. not enough cards)."));
    practice = { id: uid(), kind, ...g, done: false, won: false, answer: null };
    return ok();
  }
  function practiceGame() {
    if (!practice) return null;
    const p = practice;
    return { id: p.id, kind: p.kind, name: miniName(p.kind), data: p.pub, done: p.done, won: p.won, answer: p.answer, key: p.done ? p.key : null, reward: 0, got: 0, practice: true };
  }
  function playPractice(answer) {
    if (!practice) return err(L('Önce bir oyun seç.', 'Pick a game first.'));
    if (practice.done) return err(L('Bu oyun bitti; yenisini başlat.', 'This game is over; start a new one.'));
    const chk = miniCheck(practice, answer); if (chk.err) return chk;
    Object.assign(practice, { done: true, won: chk.won, answer });
    return { ok: true, won: chk.won, got: 0, key: practice.key };
  }
  /* bugünün oyunu: sıra dayNum'a göre döner; kurulamayan (ör. yeterli kart yok) atlanır */
  let miniForce = null;   // test modu: bugünün oyunu yerine seçilen oyun
  function miniToday(k = dk(now())) {
    if (miniForce && k === dk(now())) { const g = miniBuild(miniForce, k); if (g) return { kind: miniForce, ...g }; }
    const n = MINI.kinds.length, start = ((dayNum(k) % n) + n) % n;
    for (let i = 0; i < n; i++) { const kind = MINI.kinds[(start + i) % n], g = miniBuild(kind, k); if (g) return { kind, ...g }; }
    return null;
  }
  function miniGame() {
    const k = dk(now()), g = miniToday(k); if (!g) return null;
    const m = state.mini?.date === k && state.mini.kind === g.kind ? state.mini : null;
    const next = miniToday(addDays(k, 1));
    return { date: k, kind: g.kind, name: miniName(g.kind), data: g.pub, done: !!m, won: !!m?.won, answer: m?.answer ?? null, key: m ? g.key : null,
      reward: miniReward(), got: m?.got || 0, next: next ? miniName(next.kind) : null };
  }
  function playMini(answer) {
    const k = dk(now()), g = miniToday(k);
    if (!g) return err(L('Bugün oyun yok.', 'No game today.'));
    if (state.mini?.date === k && state.mini.kind === g.kind) return err(L('Bugünün oyununu zaten oynadın. Yarın yenisi açılır.', "You've already played today's game. A new one opens tomorrow."));
    const chk = miniCheck(g, answer); if (chk.err) return chk;
    const won = chk.won;
    const got = won ? addGold(miniReward()) : 0;
    state.mini = { date: k, kind: g.kind, won, answer, got };
    if (won) { count('miniWins'); count('mini_' + g.kind); }
    log(won ? L(`Günlük oyun (${miniName(g.kind)}) kazanıldı: +${got} oren.`, `Daily game (${miniName(g.kind)}) won: +${got} crowns.`)
      : L(`Günlük oyun (${miniName(g.kind)}) kaybedildi. Yarın yeni bir oyun açılır.`, `Daily game (${miniName(g.kind)}) lost. A new game opens tomorrow.`), won ? 'epic' : 'bad');
    return { ok: true, won, got, key: g.key };
  }
  const oddLeft = () => ODDITIES.filter(o => !(state.oddities || []).includes(o.id));
  const prizeName = p => (p.id === 'gold' ? L(`${p.n} oren`, `${p.n} crowns`) : p.id === 'scraps' ? L(`${p.n} kırıntı`, `${p.n} scraps`) : SHOP.find(i => i.id === p.id).name);

  /* elle iksir: savaş panelindeki düğme */
  function drinkPotion() {
    if ((state.swallow || 0) <= 0) return err(L('Swallow yok.', 'No Swallow left.'));
    if (state.hp >= maxHp()) return err(L('Canın zaten dolu.', 'Your HP is already full.'));
    if (cbState().mode === 'recover') return err(L('Toparlanıyorsun; toparlanınca canın zaten dolacak.', "You're recovering; your HP will be full when you're back."));
    advanceCombat(now());
    state.swallow--; drank();
    state.hp = Math.min(maxHp(), state.hp + potionHeal());
    log(L(`Bir Swallow içtin: +${potionHeal()} can (${Math.round(state.hp)}/${maxHp()}).`, `You drank a Swallow: +${potionHeal()} HP (${Math.round(state.hp)}/${maxHp()}).`), 'good');
    return ok();
  }
  /* Thunderbolt (üç kademe): 24 saat hasar +%20 / +%30 / +%40 (Fırtına Çağıran ×1,5). Üst üste binmez: yenisi eskisinin yerine geçer. */
  const thunderPct = id => Math.round(THUNDER_BY[id].pct * (has('stormcaller') ? THUNDER.stormcaller : 1));
  function drinkThunder(id = 'thunder') {
    const g = THUNDER_BY[id];
    if (!g) return err(L('Böyle bir iksir yok.', 'No such potion.'));
    if ((state[id] || 0) <= 0) return err(L('Thunderbolt yok.', 'No Thunderbolt left.'));
    advanceCombat(now());
    state[id]--; drank();
    addEffect('thunder', L('iksir', 'potion'), undefined, thunderPct(id));
    return ok();
  }
  /* Dancing Star: canavara rastgele 3–10 saatlik hasar (Manticore ×1,3, Bombacı ×1,5). Attıktan sonra 48 saat (Simyacı Eli 30) yenisi atılamaz.
   * dancingDmg: bir saatlik bomba hasarı (okul çarpanı dahil). */
  const dancingDmg = () => { const c = state.contract; return c ? Math.round(playerStats(monById(c.id)).dph * (sc() === 'manticore' ? DANCING.manticore : 1) * (has('bomber') ? 1.5 : 1)) : 0; };
  const dancingCooldown = () => (has('alchhand') ? DANCING.alchhand : DANCING.cooldown);
  const dancingReadyAt = () => (state.dancingAt ? addMin(new Date(state.dancingAt), dancingCooldown() * 60) : null);
  const dancingWait = () => { const r = dancingReadyAt(); return r && r > now() ? r - now() : 0; };   // ms
  function throwDancing() {
    if ((state.dancing || 0) <= 0) return err(L('Dancing Star yok.', 'No Dancing Star left.'));
    if (cbState().mode === 'recover') return err(L('Toparlanıyorsun; bomba atamazsın.', "You're recovering; you can't throw bombs."));
    if (dancingWait() > 0) { const h = Math.ceil(dancingWait() / 36e5); return err(L(`Yeni bomba için ${h} saat daha beklemelisin.`, `You must wait ${h} more hours for another bomb.`)); }
    advanceCombat(now());
    if (!ensureContract()) return err(L('Aktif kontrat yok.', 'No active contract.'));
    const hours = DANCING.minH + Math.floor(random() * (DANCING.maxH - DANCING.minH + 1)), d = Math.round(dancingDmg() * hours);
    state.dancing--; state.dancingAt = now().toISOString(); state.stats.bombs = (state.stats.bombs || 0) + 1;
    log(L(`Dancing Star patladı (${hours} saatlik hasar). Yenisi ${dancingCooldown()} saat sonra.`, `The Dancing Star exploded (${hours} hours of damage). Next one in ${dancingCooldown()} hours.`), 'epic');
    hitMonster(d, 'Dancing Star');
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
    // saat başı vuruş: bir sonraki tam saate gelindiyse o saatin hasarı vurulur (yarım kalan saat sonraki açılışta işlenir)
    const nextHour = x => { const d = new Date(x); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; };
    let last = t;
    while (nextHour(last) <= to) {
      const hit = nextHour(last), h = (hit - last) / 3600000;
      last = hit; logClock = hit;
      if (cb.mode === 'recover') {
        heal(regenIdle(), h);
        if (state.hp >= maxHp() || hit >= new Date(cb.until)) { cb.mode = 'fight'; cb.until = null; state.hp = maxHp(); flavor('recover'); sum.major = true; }
        continue;
      }
      const c = ensureContract();
      if (!c) continue;                                                   // kontrat her zaman vardır; bulunamazsa (bütün panolar boş) av bekler
      heal(regenFight(), h);
      if (state.hp > maxHp()) state.hp = maxHp();
      const m = monById(c.id), ps = playerStats(m);
      if (!c.started) { c.started = true; flavor('start', m); }
      // sabit vuruş: (seviye gücü + gümüş kılıç) × bonuslar; tek şans unsuru çelik kılıcın kritiği (×1.5)
      let pd = ps.dph * h;
      if (aeroFull()) {
        state.aero.n = (state.aero.n || 0) + 1;
        if (state.aero.n % AERO.every === 0) { pd = ps.dph * AERO.burst; log(L(`✨ Göl Hanımı'nın Darbesi! Aerondight parladı ve ${m.name} ${AERO.burst} saatlik hasar aldı.`, `✨ Strike of the Lady of the Lake! Aerondight blazed and ${m.name} took ${AERO.burst} hours of damage.`), 'epic'); }
      }
      const crit = ps.crit > 0 && random() < ps.crit / 100;
      state.critChain = crit;
      if (crit) { pd *= critMult(); state.stats.crits++; if (has('bleed')) state.bleedUntil = addMin(hit, 180).toISOString(); }
      if (has('leech')) heal(0.007, 1);
      if (aeroOn()) { state.aero ||= { charge: 0, n: 0, h: 0 }; if (state.aero.charge < AERO.max && ++state.aero.h >= AERO.hours && (state.aero.h = 0, ++state.aero.charge === AERO.max)) log(L('Aerondight tam şarj oldu: Göl Hanımı seni kutsuyor.', 'Aerondight is fully charged: the Lady of the Lake blesses you.'), 'epic'); }
      c.hp -= pd; state.stats.dmg += pd; sum.dmg += pd; weekTrack('dmg', Math.round(pd));
      c.lastHit = { t: hit.toISOString(), d: Math.round(pd), crit };
      if (crit) flavor('crit', m, Math.max(1, Math.round(pd)));
      else if (random() < 0.15) flavor('dodge', m);
      if (c.hp <= 0) { c.hp = 0; killMonster(m, Math.round(pd), crit, L('Av', 'Hunt')); sum.kills++; sum.major = true; }
    }
    t = last;
    logClock = null;
    cb.t = t.toISOString();
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
      eta, wounded: isWounded(), regen: { fight: regenFight(), idle: regenIdle() }, potions: state.swallow, potionCap: POTION.cap, potionHeal: potionHeal(), potionPrice: potionPrice(), honey: state.honey || 0,
      thunderCap: THUNDER.cap, thunders: THUNDER.grades.filter(g => g.lv <= (state.level || 1) || (state[g.id] || 0) > 0).map((g, i) => ({ id: g.id, n: state[g.id] || 0, pct: thunderPct(g.id), price: alchPrice(g.price), locked: g.lv > (state.level || 1), name: SHOP.find(x => x.id === g.id).name })),
      dancing: state.dancing || 0, dancingCap: DANCING.cap, dancingPrice: DANCING.price, dancingDmg: dancingDmg(), dancingMin: dancingDmg() * DANCING.minH, dancingMax: dancingDmg() * DANCING.maxH, dancingWait: dancingWait(), dancingCooldown: dancingCooldown(), aero: aeroOn() ? { charge: Math.min(AERO.max, state.aero?.charge || 0), max: AERO.max, toNext: (state.aero?.charge || 0) >= AERO.max ? null : AERO.hours - (state.aero?.h || 0), full: aeroFull(), next: aeroFull() ? AERO.every - ((state.aero?.n || 0) % AERO.every) : null, pct: AERO.per * Math.min(AERO.max, state.aero?.charge || 0) } : null,
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
      log(L(`Yatış aralığında meditasyona çekildin (${hm(n)}). +${DAY_XP.prep} TP, +${DAY_GOLD.prep} oren. Sabah ödülün ×1.5 ve +1 kart.`, `You meditated within your bedtime window (${hm(n)}). +${DAY_XP.prep} XP, +${DAY_GOLD.prep} crowns. Morning reward ×1.5 and +1 card.`), 'good');
      fx('prep');
      toast(L('Madalyon sustu. İyi uykular, witcher.', 'The medallion is still. Sleep well, witcher.'), 'good');
    } else {
      log(L(`Aralık dışında meditasyon (${hm(n)}). Sabah ödülün yine de ×1.15.`, `Meditation outside the window (${hm(n)}). Morning reward still ×1.15.`), '');
      toast(L('Geç kaldın ama hiç yoktan iyidir. Hemen uyu.', "You're late, but better than nothing. Go to sleep now."), '');
    }
    return ok();
  }
  /* erken tamamlama (Viper): saatli türlerde aralığın ilk 10 dakikası ya da öncesi, adet/yaptım türlerinde öğleden önce */
  const isEarly = (k, n) => (Q().type === 'count' || Q().type === 'check') ? n < at(k, '12:00') : n <= addMin(W(k).checkStart, 10);
  function rewardMult(day, n, k) {
    let mult = 1; const parts = [];
    if (day.med) { const m = day.medOnTime ? 1.5 : 1.15; mult *= m; parts.push(L(`meditasyon ×${m}`, `meditation ×${m}`)); }
    const tier = TIERS[tierOf(C().len)];
    if (tier.mult > 1) { mult *= tier.mult; parts.push(L(`${tier.name} zincir ×${tier.mult}`, `${tier.name} chain ×${tier.mult}`)); }
    if (sc() === 'wolf' && C().len > 0) { const m = +(1 + Math.min(10, C().len) * 0.05).toFixed(2); mult *= m; parts.push(L(`kurt ×${m}`, `wolf ×${m}`)); }
    if (sc() === 'viper' && n && isEarly(k, n)) { mult *= 1.4; parts.push(L('engerek dakikliği ×1.4', 'viper punctuality ×1.4')); }
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
      if (sc() === 'viper' && isEarly(k, n)) addEffect('focus', L('erken tamamlandı', 'done early'));
      successTraits(k, n);
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
      if (sc() !== 'griffin' && !has('tireless')) addEffect('tired', Q().name);
      monsterStrike(false); aeroFail(false);
      gainXp(DAY_XP.late);
    }
    return ok();
  }
  /* alışkanlık başarısında kılıç özellikleri */
  function successTraits(k, n) {
    if (has('early') && isEarly(k, n)) addEffect('early', L('erken tamamlandı', 'done early'));
    if (has('cardluck') && random() < 0.15) drawCards(1, 'Common', uName('cardluck'));
    if (has('goldwind')) { const g = addGold(15); log(L(`${uName('goldwind')}: +${g} oren.`, `${uName('goldwind')}: +${g} crowns.`), 'good'); }
    if (has('discipline') && state.habits.every(h => h.entries[k]?.result === 'success')) {
      const end = at(addDays(dk(clockNow()), 2), '00:00');
      addEffect('discipline', L('günün bütün alışkanlıkları', "all of the day's habits"), Math.max(1, (end - clockNow()) / 36e5));
    }
  }
  /* Aerondight: gecikme şarjın yarısını, kaçırma hepsini götürür */
  function aeroFail(missed) {
    if (!state.aero?.charge) return;
    const before = state.aero.charge;
    state.aero.charge = missed ? 0 : Math.floor(before / 2); state.aero.n = 0; state.aero.h = 0;
    if (aeroOn()) log(L(`Aerondight sönükleşti: şarj ${before} → ${state.aero.charge}.`, `Aerondight dimmed: charge ${before} → ${state.aero.charge}.`), 'bad');
  }
  function applyMissed(k) {
    const day = getDay(k);
    day.q ||= Q().id;
    const half = Q().type === 'count' ? (day.count || 0) >= Q().count.target / 2 : (Q().items?.length && doneItems(day).length >= Q().items.length / 2);
    if (half && !isRest(k)) {
      // adet hedefinin en az yarısı: gecikme gibi sayılır
      day.result = 'late'; fx('bad');
      log(L(`"${Q().name}": ${longDate(k)} hedefin yarısına ulaştın (${day.count}/${Q().count.target}). Paslı halka, kart yok.`, `"${Q().name}": on ${longDate(k)} you reached half the target (${day.count}/${Q().count.target}). Rusty link, no cards.`), 'bad');
      chainLate(k); if (sc() !== 'griffin' && !has('tireless')) addEffect('tired', Q().name); monsterStrike(false); aeroFail(false); gainXp(DAY_XP.late);
      return;
    }
    if (isRest(k)) {
      day.result = 'rest'; addLink(k, 'rest');
      log(L(`${longDate(k)}: dinlenme günü. Zincir donmuş halde bekliyor.`, `${longDate(k)}: rest day. The chain waits, frozen.`), '');
      return;
    }
    day.result = 'fail';
    // sonradan işlenirse geri alınabilsin diye kaçırmanın etkileri kaydedilir
    const undo = { chain: JSON.parse(JSON.stringify(C())), honeyUsed: false, effect: null, strike: null, aero: state.aero ? { ...state.aero } : null };
    const exhaustH = has('resolute') ? 8 : aeroFull() ? AERO.exhausted : undefined;
    log(L(`"${Q().name}": ${longDate(k)} kaçırıldı.`, `"${Q().name}": ${longDate(k)} was missed.`), 'bad');
    chainBreak(k, L('kaçırılan gün', 'missed day'));
    if (sc() !== 'griffin') undo.effect = addEffect('exhausted', Q().name, exhaustH);
    undo.strike = monsterStrike(true).before;
    aeroFail(true);
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
    if (u.honeyUsed) state.honey = (state.honey || 0) + 1;   // eski kayıtlar (otomatik içme dönemi)
    if (u.aero) state.aero = u.aero;
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
    // uyku düzeni tek olur: birden fazlası aynı geceden iki kez ödül/zincir almak demek (yerine geçecekse eskisi sayılmaz)
    if (q.type === 'sleep' && state.habits.some(h => h.type === 'sleep' && h !== old)) return err(L('Zaten bir uyku düzenin var; ikinci bir uyku alışkanlığı eklenemez.', "You already have a sleep schedule; you can't add a second one."));
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
  /* alt görevi işaretle / kaldır. Adette sayılır; hepsi (ya da hedef) tamamlanınca gün başarılı olur. */
  const doneItems = day => (day.done || []).filter(x => (Q().items || []).includes(x));
  function toggleItem(name) {
    const q = Q();
    if (!q.items?.includes(name)) return err(L('Böyle bir alt görev yok.', 'No such sub-task.'));
    const t = now(), k = upcoming(t), day = getDay(k), w = W(k);
    if (day.result) return err(L('Bu günün sonucu zaten belli.', "This day's result is already set."));
    if (t < w.checkOpen) return err(L('Henüz açık değil.', 'Not open yet.'));
    day.done ||= [];
    day.done = day.done.includes(name) ? day.done.filter(x => x !== name) : [...day.done, name];
    day.q = q.id;
    const n = doneItems(day).length;
    if (q.type === 'count') { day.count = n; if (n >= q.count.target) { advanceCombat(now()); return doCheck(k, t); } }
    else if (n >= q.items.length) { advanceCombat(now()); return doCheck(k, t); }
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
    const owlFull = (atCap() && state.level < MAX_LEVEL && state.xp >= xpBank()) ;   // seviye sınırında TP dolduysa boşa gider
    const full = { swallow: state.swallow >= POTION.cap, honey: (state.honey || 0) >= honeyMax(), dancing: (state.dancing || 0) >= DANCING.cap,
      blackblood: (state.blackblood || 0) >= BLACKBLOOD.cap, puzzle: !!state.puzzleQ && !puzzleLate(state.puzzleQ), mutagen: !oddLeft().length,
      ...Object.fromEntries(THUNDER.grades.map(g => [g.id, (state[g.id] || 0) >= THUNDER.cap])), ...Object.fromEntries(OWL.grades.map(g => [g.id, owlFull])) };
    return SHOP.map(i => { const locked = (i.lv || 1) > (state.level || 1), left = stockLeft(i.id);
      return { ...i, price: ALCHEMY.includes(i.id) ? alchPrice(i.price) : i.price, locked, stock: left, stockMax: STOCK[stockKey(i.id)], disabled: locked || !!full[i.id] || left === 0 }; });
  }
  /* günlük stok: bugün satılanlar (gün değişince sıfırlanır); stoğu olmayan ürün için null */
  const soldToday = key => (state.stockDay?.date === dk(now()) ? state.stockDay.n[key] || 0 : 0);
  const stockLeft = id => { const key = stockKey(id); return STOCK[key] == null ? null : Math.max(0, STOCK[key] - soldToday(key)); };
  function buy(id) {
    const it = shopItems().find(i => i.id === id);
    if (!it) return err(L('Böyle bir şey yok.', 'No such item.'));
    if (it.disabled) return err(L('Şu an alınamaz.', "Can't buy that right now."));
    if (state.gold < it.price) return err(L('Yeterli orenin yok.', "You don't have enough crowns."));
    state.gold -= it.price;
    const sk = stockKey(id); if (STOCK[sk] != null) { const k = dk(now()); if (state.stockDay?.date !== k) state.stockDay = { date: k, n: {} }; state.stockDay.n[sk] = soldToday(sk) + 1; }
    if (id === 'keg') drawCards(3, 'Rare', it.name);
    if (id === 'bigkeg') drawCards(5, 'Epic', it.name);
    if (id === 'swallow') { state.swallow++; log(L(`Swallow aldın (${state.swallow}/${POTION.cap}).`, `You bought a Swallow (${state.swallow}/${POTION.cap}).`)); }
    if (id === 'honey') { state.honey = (state.honey || 0) + 1; log(L(`Mahakam Ale aldın (${state.honey}/${honeyMax()}).`, `You bought Mahakam Ale (${state.honey}/${honeyMax()}).`)); }
    if (THUNDER_BY[id]) { state[id] = (state[id] || 0) + 1; log(L(`${it.name} aldın (${state[id]}/${THUNDER.cap}).`, `You bought a ${it.name} (${state[id]}/${THUNDER.cap}).`)); }
    if (id === 'mutagen') { const left = oddLeft(), o = left[Math.floor(random() * left.length)];
      state.oddities = [...(state.oddities || []), o.id]; ev.oddity = o.id;
      log(L(`Mutagenerator homurdandı, köpürdü ve içinden… ${o.name} çıktı. ${o.desc}`, `The Mutagenerator rumbled, bubbled and out came… ${o.name}. ${o.desc}`), 'epic'); }
    if (id === 'blackblood') { state.blackblood = (state.blackblood || 0) + 1; log(L(`Black Blood aldın (${state.blackblood}/${BLACKBLOOD.cap}).`, `You bought Black Blood (${state.blackblood}/${BLACKBLOOD.cap}).`)); }
    if (id === 'puzzle') { if (state.puzzleQ) answerPuzzle('');   // süresi dolmuş eski bilmece kapanır
      makePuzzle(); log(L('Mysterious Puzzle Box aldın. Bilmeceyi çöz, kutu açılsın.', 'You bought a Mysterious Puzzle Box. Solve the riddle to open it.')); }
    if (id === 'dancing') { state.dancing = (state.dancing || 0) + 1; log(L(`Dancing Star aldın (${state.dancing}/${DANCING.cap}).`, `You bought a Dancing Star (${state.dancing}/${DANCING.cap}).`)); }
    if (OWL_BY[id]) { const xp = OWL_BY[id].xp; drank();
      log(L(`Bir ${it.name} içtin: +${xp} TP.`, `You drank a ${it.name}: +${xp} XP.`), 'good'); gainXp(xp); }
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
  /* bugün (bu stokta) satın alınanlar: yerine yenisi gelmez */
  const shopKey = (k = dk(now())) => `${k}|${shopRerolls(k)}`;
  const boughtNow = (k = dk(now())) => (state.shopBought?.key === shopKey(k) ? state.shopBought.ids : []);
  function dailySwords(type, k = dk(now())) {
    const n = shopRerolls(k), bought = boughtNow(k), ownedBefore = id => state.swords.owned.includes(id) && !bought.includes(id);
    const r = seeded(hashStr(`${k}|${state.charId}|${type}${n ? '|' + n : ''}`));
    // her kılıcın kademesi seviyene göre zarla belirlenir (altlarda Sıradan, üstlerde Efsanevi daha olası); okul setleri satılmaz
    const L = state.level, odds = rarityOdds(L), tiers = Object.keys(odds).map(Number);
    const pool = SWORDS.filter(w => w.type === type && !w.set && w.tier <= 4 && !ownedBefore(w.id));
    const out = [];
    for (let i = 0; i < SHOP_DAILY && out.length < pool.length; i++) {
      let x = r() * 100, tier = tiers[tiers.length - 1];
      for (const t of tiers) { if ((x -= odds[t]) <= 0) { tier = t; break; } }
      const left = pool.filter(w => !out.includes(w));
      const same = left.filter(w => w.tier === tier), near = same.length ? same : left.slice().sort((a, b) => Math.abs(a.tier - tier) - Math.abs(b.tier - tier)).filter((w, _, a) => w.tier === a[0].tier);
      out.push(near[Math.floor(r() * near.length)]);
    }
    const aero = SWORDS.find(w => w.tier === 6 && w.type === type);
    if (aero && L >= AERONDIGHT.minLevel && !ownedBefore(aero.id) && r() < AERONDIGHT.chance) out.push(aero);
    return out.filter(w => !bought.includes(w.id)).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }
  /* demircideki fiyat ve güç: kılıç senin şu anki seviyende gelir */
  const shopPrice = (w, L = state.level) => Math.round(swordPrice(w, L) * (!w.set && w.tier >= 4 ? LEGEND_PRICE : 1) / 5) * 5;   // Efsanevi ve Kadim %50 pahalı
  function buySword(id) {
    const w = swordById(id);
    if (!w) return err(L('Böyle bir kılıç yok.', 'No such sword.'));
    if (w.set) return err(L('Okul setleri satılmaz; boss şemasıyla yapılır.', "School sets aren't sold; they're crafted from boss diagrams."));
    if (state.swords.owned.includes(id)) return err(L('Bu kılıç zaten sende.', 'You already own this sword.'));
    if (!dailySwords(w.type).some(x => x.id === id)) return err(L('Demirci bugün bu kılıcı satmıyor.', "The blacksmith isn't selling this sword today."));
    const price = shopPrice(w);
    if (state.gold < price) return err(L('Yeterli orenin yok.', "You don't have enough crowns."));
    state.gold -= price; state.swords.owned.push(id);
    (state.swords.lv ||= {})[id] = state.level;
    const key = shopKey(); state.shopBought = state.shopBought?.key === key ? { key, ids: [...state.shopBought.ids, id] } : { key, ids: [id] };
    if (!state.swords[w.type]) { state.swords[w.type] = id; markEquip(id); }
    log(L(`${w.name} (seviye ${state.level}) satın alındı (${price} oren).${state.swords[w.type] === id ? ' Kuşandın.' : ''}`, `Bought ${w.name} (level ${state.level}) for ${price} crowns.${state.swords[w.type] === id ? ' Equipped.' : ''}`), 'epic');
    return ok();
  }
  /* kılıcın seviyesini yükselt: en fazla kendi seviyene kadar */
  function upgradeCost(id) {
    const w = swordById(id), lv = swordLv(id);
    if (!w || !state.swords.owned.includes(id) || lv >= state.level) return null;
    const to = lv + 1;
    return { to, gold: Math.max(5, Math.round(swordPrice(w, to) * SWORD_UP.goldShare / 5) * 5), scraps: SWORD_UP.scraps(to) };
  }
  function upgradeSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    const c = upgradeCost(id);
    if (!c) return err(L(`Kılıcın seviyesi senin seviyeni (${state.level}) geçemez.`, `A sword can't go above your level (${state.level}).`));
    if (state.gold < c.gold) return err(L(`${c.gold} oren gerekiyor.`, `You need ${c.gold} crowns.`));
    if (state.scraps < c.scraps) return err(L(`${c.scraps} kırıntı gerekiyor.`, `You need ${c.scraps} scraps.`));
    state.gold -= c.gold; state.scraps -= c.scraps;
    state.swords.lv[id] = c.to;
    state.counters ||= {}; state.counters.forged = (state.counters.forged || 0) + 1;
    log(L(`${w.name} ${c.to}. seviyeye yükseltildi (${c.gold} oren, ${c.scraps} kırıntı). ${w.type === 'silver' ? `Hasar +${swordValue(w)}/sa` : `Kritik %${swordValue(w)}`}.`,
      `${w.name} upgraded to level ${c.to} (${c.gold} crowns, ${c.scraps} scraps). ${w.type === 'silver' ? `Damage +${swordValue(w)}/h` : `Crit ${swordValue(w)}%`}.`), 'epic');
    return ok();
  }
  function dismantleValue(id) {
    const w = swordById(id), lv = swordLv(id);
    return { gold: Math.round(swordPrice(w, lv) * DISMANTLE.gold), scraps: Math.floor(lv / 2) };
  }
  function dismantleSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    if (state.swords[w.type] === id) return err(L('Kuşandığın kılıcı eritemezsin.', "You can't dismantle an equipped sword."));
    const v = dismantleValue(id);
    state.swords.owned = state.swords.owned.filter(x => x !== id); delete state.swords.lv[id];
    state.gold += v.gold; state.scraps += v.scraps;
    log(L(`${w.name} eritildi: +${v.gold} oren, +${v.scraps} kırıntı.`, `${w.name} dismantled: +${v.gold} crowns, +${v.scraps} scraps.`));
    return ok();
  }
  /* okul seti şemaları: önce kendi okulunun seti (çelik, sonra gümüş), sonra diğer okullar */
  function dropDiagram() {
    const have = new Set([...state.swords.owned, ...state.diagrams]);
    const sets = SWORDS.filter(w => w.set && !have.has(w.id));
    if (!sets.length) return null;
    // önce kendi okulunun en düşük aşaması (çelik önce), sonra diğer okulların en düşük aşamaları
    const order = (a, b) => (a.v ?? 0) - (b.v ?? 0) || (a.type === 'steel' ? 0 : 1) - (b.type === 'steel' ? 0 : 1);
    const mine = sets.filter(w => w.school === sc()).sort(order);
    const low = sets.slice().sort(order).filter((w, i, a) => (w.v ?? 0) === (a[0].v ?? 0));
    const w = mine[0] || rnd(low);
    state.diagrams.push(w.id);
    log(L(`Boss bir şema düşürdü: ${w.name}. Demircide yaptırabilirsin.`, `The boss dropped a diagram: ${w.name}. You can have it crafted at the blacksmith.`), 'epic');
    toast(L(`Şema: ${w.name}`, `Diagram: ${w.name}`), 'good');
    return w;
  }
  const craftCost = id => ({ gold: swordPrice(swordById(id), state.level), scraps: SET_CRAFT_SCRAPS });
  function craftSword(id) {
    const w = swordById(id);
    if (!w || !state.diagrams.includes(id)) return err(L('Bu kılıcın şeması sende yok.', "You don't have this sword's diagram."));
    const c = craftCost(id);
    if (state.gold < c.gold) return err(L(`${c.gold} oren gerekiyor.`, `You need ${c.gold} crowns.`));
    if (state.scraps < c.scraps) return err(L(`${c.scraps} kırıntı gerekiyor.`, `You need ${c.scraps} scraps.`));
    state.gold -= c.gold; state.scraps -= c.scraps;
    state.diagrams = state.diagrams.filter(x => x !== id); state.swords.owned.push(id); (state.swords.lv ||= {})[id] = state.level;
    if (!state.swords[w.type]) { state.swords[w.type] = id; markEquip(id); }
    log(L(`Demirci ${w.name}'ı ${state.level}. seviyede yaptı (${c.gold} oren, ${c.scraps} kırıntı).`, `The blacksmith crafted ${w.name} (${c.gold} crowns, ${c.scraps} scraps).`), 'epic');
    return ok();
  }
  /* bir canavara karşı en iyi kılıç: güçlendirme + okul + bane dahil */
  function bestSwordFor(type, m) {
    const owned = state.swords.owned.map(swordById).filter(w => w && w.type === type);
    // gümüş: ortalama saatlik hasar (avcı bonusu yüzdesiyle), çelik: kritik + avcı yüzdesi
    const score = w => type === 'silver' ? swordValue(w) + baneOf(w, m) / 100 * (powerAt(state.level) + swordValue(w)) : swordValue(w) * 0.5 + baneOf(w, m);
    return owned.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function equipBest(m = state.contract ? monById(state.contract.id) : null) {
    let changed = false;
    for (const type of ['silver', 'steel']) { const w = bestSwordFor(type, m); if (w && state.swords[type] !== w.id) { state.swords[type] = w.id; markEquip(w.id); changed = true; } }
    if (changed) log(L('Bu kontrat için en iyi kılıçlar kuşanıldı.', 'Equipped the best swords for this contract.'));
    return ok();
  }
  function equipSword(id) {
    const w = swordById(id);
    if (!w || !state.swords.owned.includes(id)) return err(L('Bu kılıç sende değil.', "You don't own this sword."));
    if (state.swords[w.type] !== id) markEquip(id);
    state.swords[w.type] = id; if (state.hp > maxHp()) state.hp = maxHp();
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
  function eligibleForLink(linkId, { includeUsed = false } = {}) {
    const l = state.links.find(x => x.id === linkId); if (!l) return [];
    const used = usedInLinks();
    return CARDS.filter(c => c.f === l.f && state.collection[c.a] && !l.cards.includes(c.a) && (includeUsed || !used.has(c.a)) && cardCats(c).includes(l.cat));
  }
  /* kartın bulunduğu bağ (yoksa null) */
  const linkOfCard = a => state.links.find(l => l.cards.includes(a)) || null;
  function createLink(f, cat) {
    if (!f || !cat) return err(L('Fraksiyon ve tür seç.', 'Pick a faction and a category.'));
    if (state.links.length >= LINK_MAX) return err(L(`En fazla ${LINK_MAX} bağ kurabilirsin. Yer açmak için bir bağı çöz.`, `You can have at most ${LINK_MAX} links. Undo one to make room.`));
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
    if (l.cards.includes(a)) return err(L('Bu kart zaten bu bağda.', 'This card is already in this link.'));
    const from = linkOfCard(a);
    if (from) {                                                         // başka bağdaysa oradan çıkarılıp buraya taşınır
      from.cards = from.cards.filter(x => x !== a);
      log(L(`${c.n}, ${from.f} · ${from.cat} bağından çıkarılıp ${l.f} · ${l.cat} bağına taşındı.`, `${c.n} moved from the ${from.f} · ${from.cat} link to ${l.f} · ${l.cat}.`));
    }
    l.cards.push(a);
    if (l.cards.length === LINK_SIZE) {
      const v = linkValue(l), ex = v.shared.length ? ` + ${v.shared.join(', ')}` : '';
      log(L(`Kart bağı tamamlandı: ${l.f} · ${l.cat}${ex}. Hasar +%${v.total}${v.fav ? ' (okul uyumu ×1,5)' : ''}.`, `Card link complete: ${l.f} · ${l.cat}${ex}. Damage +${v.total}%${v.fav ? ' (school affinity ×1.5)' : ''}.`), 'epic');
      toast(L(`Bağ tamamlandı: ${l.cat} (+%${v.total} hasar)`, `Link complete: ${l.cat} (+${v.total}% damage)`), 'good');
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
    state.gold -= 150; state.school = id; state.avatar = null; state.hp = Math.min(state.hp, maxHp()); count('schoolChanges');
    log(L(`Okul değişti: ${SCHOOLS[id].name}.`, `School changed: ${SCHOOLS[id].name}.`), 'epic');
    return ok();
  }
  /* kart odağı: odaklanılan fraksiyonun bütün kartları toplanınca başka bir fraksiyona geçilebilir (ücretsiz).
   * Toplanan kartlar koleksiyonda kalır; yeni kartlar yeni fraksiyondan + tarafsızdan gelir. */
  function factionProgress(f = state.faction) {
    if (!f) return null;
    const all = CARDS.filter(c => c.f === f);
    return { have: all.filter(c => state.collection[c.a]).length, total: all.length };
  }
  function changeFaction(f) {
    if (!state.faction) return err(L('Zaten bütün fraksiyonlardan kart topluyorsun.', 'You already collect cards from all factions.'));
    if (f === 'all') f = null;
    if (f !== null && (!FACTIONS.includes(f) || f === state.faction)) return err(L('Başka bir fraksiyon seç.', 'Pick a different faction.'));
    const p = factionProgress();
    if (p.have < p.total) return err(L(`Önce ${FACTION_TR[state.faction]} kartlarının hepsini topla (${p.have}/${p.total}).`, `First collect every ${FACTION_TR[state.faction]} card (${p.have}/${p.total}).`));
    const old = state.faction;
    state.factionsDone = [...new Set([...(state.factionsDone || []), old])];
    state.faction = f;
    log(L(`${FACTION_TR[old]} koleksiyonu tamamlandı. Yeni kart odağı: ${f ? FACTION_TR[f] : 'bütün fraksiyonlar'}.`, `${FACTION_TR[old]} collection complete. New card focus: ${f ? FACTION_TR[f] : 'all factions'}.`), 'epic');
    toast(L(`Yeni kart odağı: ${f ? FACTION_TR[f] : 'hepsi'}`, `New card focus: ${f ? FACTION_TR[f] : 'all'}`), 'good');
    return ok();
  }
  function snapshot() {
    return {
      id: state.charId, name: state.name, school: state.school, faction: state.faction, avatar: state.avatar,
      level: state.level, fame: state.fame || 0, region: state.region, legend: state.legend, start: state.charStart, end: now().toISOString(),
      collection: { ...state.collection }, links: state.links.map(l => ({ ...l, cards: [...l.cards] })),
      trophies: state.trophies.map(t => ({ ...t })), swords: [...state.swords.owned], swordLevels: { ...(state.swords.lv || {}) }, diagrams: [...(state.diagrams || [])],
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
    log(L(`${old.name} (seviye ${old.level}${old.legend ? ', efsane' : ''}) Karakterlerim'e katıldı. Yeni karakter: ${state.name}, ${SCHOOLS[state.school].name}, ${faction ? FACTION_TR[faction] : 'tüm fraksiyonlar'}.`,
      `${old.name} (level ${old.level}${old.legend ? ', legend' : ''}) moved to My Characters. New character: ${state.name}, ${SCHOOLS[state.school].name}, ${faction ? FACTION_TR[faction] : 'all factions'}.`), 'epic');
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
    // bölge başına: bir karakterin o bölgede öldürdüğü farklı canavar sayısının en yükseği
    const regionKills = REGIONS.map((r, i) => Math.max(0, ...chars.map(c => { const t = new Set((c.trophies || []).map(x => x.id)); return MONSTERS.filter(m => m.region === i && t.has(m.id)).length; })));
    return {
      success: allDays.filter(d => d.result === 'success').length, rests: Object.keys(state.restDays || {}).length,
      chainBest: Math.max(0, ...state.habits.map(h => h.chain.best)), repairs: state.counters?.repairs || 0, perfectWeek: perfect,
      medOnTime: allDays.filter(d => d.medOnTime).length, questsDone: state.questHistory.filter(q => q.result === 'completed').length,
      kills: allTrophies.length, bosses: allTrophies.filter(t => MONSTERS.find(m => m.id === t.id)?.boss).length, regionCleared, regionKills,
      legend: chars.some(c => c.legend), swords: state.swords.owned.length,
      mini: { wins: state.counters?.miniWins || 0, ...Object.fromEntries(MINI.kinds.map(k => [k, state.counters?.['mini_' + k] || 0])) },
      oddities: (state.oddities || []).length, forged: state.counters?.forged || 0, potions: state.counters?.potions || 0, schoolChanges: state.counters?.schoolChanges || 0,
      aerondight: !!state.counters?.aerondight || state.swords.owned.some(id => swordById(id)?.tier === 6),
      ownSchoolSet: state.swords.owned.some(id => { const w = swordById(id); return w && w.set && w.school === sc(); }),
      legendaryCards: chars.some(c => Object.keys(c.collection || {}).some(a => CARD_BY_ART[a]?.r === 'Legendary')) ? 1 : 0,
      uniqueCards: Math.max(...chars.map(c => Object.keys(c.collection || {}).length)),
      links: completeLinks().length, hall: (state.hall || []).length,
      ...(() => { const vs = completeLinks().map(l => ({ l, v: linkValue(l) }));
        return { linkAllLegend: vs.some(x => x.l.cards.every(a => CARD_BY_ART[a]?.r === 'Legendary')), linkExtraMax: Math.max(0, ...vs.map(x => x.v.shared.length)),
          linkSchool: vs.filter(x => x.v.fav).length, linkFactions: new Set(vs.map(x => x.l.f)).size, linkTotal: countedLinks().reduce((t, x) => t + x.v.total, 0) }; })(),
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
    miniKind(kind) { if (kind && !MINI.kinds.includes(kind)) return err('?'); miniForce = kind || null;
      if (kind && !miniBuild(kind, dk(now()))) { miniForce = null; return err(L('Bu oyun şu an kurulamıyor (ör. yeterli kart yok).', "This game can't be set up right now (e.g. not enough cards).")); } return ok(); },
    miniReset() { state.mini = null; return ok(); },
    miniForced: () => miniForce,
    heal() { state.hp = maxHp(); const cb = cbState(); cb.mode = 'fight'; cb.until = null; log('[Test] ' + L('Can doldu.', 'HP restored.')); return ok(); },
  };

  function projectedMult(k) { return rewardMult(Q().entries[k] || {}, null, k).mult; }
  if (idle) cbState();                                      // savaş saati motorun kurulduğu andan başlar

  return {
    state, ev, now, logicalToday, maxHp, xpNeed,
    W: (k, hid) => on(hid, () => W(k)), upcoming: (n = now(), hid) => on(hid, () => upcoming(n)), phase: (k, n = now(), hid) => on(hid, () => phase(k, n)),
    projectedMult: (k, hid) => on(hid, () => projectedMult(k)), isSleep: hid => on(hid, () => isSleep()),
    prep: hid => on(hid, () => prep()), checkIn: hid => on(hid, () => checkIn()), addCount: (n, hid) => on(hid, () => addCount(n)), toggleItem: (name, hid) => on(hid, () => toggleItem(name)),
    continueMastery: hid => on(hid, () => continueMastery()), correctableDay: hid => on(hid, () => correctableDay()),
    correctMissed: (k, o = {}, hid) => on(hid ?? o.hid, () => correctMissed(k, o)),
    habitById, chainDamage, advanceCombat, combatInfo, drinkPotion, drinkThunder, drinkBlackBlood, drinkAle, throwDancing, honeyMax, puzzleQuestion, answerPuzzle, stockLeft, prizeName, oddLeft, miniGame, playMini, startPractice, practiceGame, playPractice, failHit, playerStats, queueAdd, queueRemove, debuffPct, isRest, restTarget, restBy: k => restBy(k), restUsedInWeek, removeHabit, habitTypeName,
    declareRest, processPending, completeSide, addSide, removeSide, shopItems, buy, craft,
    changeSchool, changeFaction, factionProgress, startQuest, updateQuest, init, drawCards, log,
    damageBonus, completeLinks, linkValue, linkOfCard, countedLinks, swordDmg, buffPct, buySword, equipSword, dailySwords, rerollShop, dismantleSword, dismantleValue, shopPrice,
    craftSword, craftCost, bestSwordFor, equipBest, dropDiagram, shopRerollCost, rerollBoard, boardRerollCost, upgradeSword, upgradeCost, swordLv, swordValue, linkOptions, eligibleForLink, createLink, addToLink, removeFromLink, deleteLink,
    region, band, bandInfo, homeRegion, capLevel, atCap, xpBank, bossAvailable, postGame, isElite, fameNeed, boardEntries, ensureBoard, takeContract, openRegions, inPool, rebirth, snapshot, dev,
    legacy, checkAchievements, achStats, ensureWeekStats,
  };
}

root.KM = {
  L, lang, bi, habitTypeName,
  createEngine, newState, migrate, makeQuest, makeHabit, validateQuest, monStats, HABIT_TYPES, MAX_HABITS, MAX_ITEMS, CHAIN_WEIGHTS,
  time: { pad, dk, fromKey, addDays, at, addMin, hm, mondayOf, toMin, fromMin, longDate, sfx, DAYS, MONTHS },
  data: {
    ART, CARDS, CARD_BY_ART, RAR, RAR_TR, SCRAP, CRAFT, MONSTERS, CLASSES, REGIONS, BAND_COUNT, bandRegions, regionTier, monById, monImg, SCHOOLS, TIERS, tierOf, REPAIR_NEED,
    QUEST_MIN, QUEST_MAX, MASTERY_MULT, MASTERY_DMG, SHOP, DMG, DAY_XP, DAY_GOLD, CARDS_PER, REG, BOSS, BOARD_SIZE, MAX_LEVEL, xpNeed,
    BANE_TIERS, UNIQUE, UNIQUE_BY_ID, AERO, LEGEND_PRICE, POTION, THUNDER, OWL, DANCING, BLACKBLOOD, PUZZLE, STOCK, puzzleWords, MUTAGEN, ODDITIES, ODDITY_BY, MINI, ALCH_DISCOUNT, schoolImg, REST, DEFEAT, REGEN, WOUNDED, EFFECTS, EFFECT_CAP, HONEY_MAX, powerAt, hpAt, BAND_HOURS, TIER_DAYS, REF_SWORD, REF_CHAIN, REF_LINKS, STEP_MIN, CRIT_MULT, swordBase, critBase, swordDmgAt, swordCritAt, swordPrice, rarityOdds, RARITY_ODDS, AERONDIGHT, SWORD_UP, SCRAP_PER_KILL, LINK_SIZE, LINK_BONUS, LINK_MAX, LINK_RAR, LINK_EXTRA, LINK_SCHOOL, SCHOOL_CATS, REGEN, WOUNDED, SWORDS, SWORD_TIERS, swordById, cardCats, dat, FACTIONS, FACTION_TR, SHOP_DAILY, START_KIT, HP_MULT, REROLL, BANE, DISMANTLE, DIAGRAM_FROM_REGION, SET_CRAFT_SCRAPS, LEGACY, ACHIEVEMENTS, RETRO_HOURS, ELITE, FAME,
  },
  uid,
};
})(typeof window !== 'undefined' ? window : globalThis);
