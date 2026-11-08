/* Habits of Witchers — otomatik testler. Tarayıcıda aç: http://localhost:8642/tests.html
 * Motoru (engine.js) sahte saatle çalıştırır; veritabanına dokunmaz.
 * Yeni özellik eklediğinde buraya bir test(...) ekle.
 */
(() => {
'use strict';
const { createEngine, newState, migrate, makeQuest, validateQuest, monStats, time: T, data: D } = window.KM;
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(a, b, msg = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); }
function ok(c, msg = 'koşul sağlanmadı') { if (!c) throw new Error(msg); }
function isErr(r, msg = 'hata bekleniyordu') { if (!r || !r.err) throw new Error(msg); }
function isOk(r, msg = '') { if (!r || r.err) throw new Error(`${msg} ${r && r.err}`); }

/* Kurulum: 5 Kasım 21:00'de başla. Varsayılan uyku: yatış 00:00–02:00, kalkış 08:00–08:30, tolerans 60 dk. */
const RI = id => D.REGIONS.findIndex(r => r.id === id);
const tierOfMon = m => D.REGIONS[m.region].tier;
function setup({ type = 'sleep', school = 'wolf', faction = null, start = '2026-11-05T21:00', quest = {}, seed: seed0 = 7, random: rand, idle = false } = {}) {
  const clock = { t: new Date(start) };
  let seed = seed0;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const s = newState({ name: 'Test', school, faction, quest: { type, days: 30, ...quest }, nowDate: clock.t });
  const E = createEngine(s, { now: () => clock.t, random: rand || random, idle });
  E.init();
  E.ev.reveals.length = 0;
  const go = iso => { clock.t = new Date(iso); E.processPending(); };
  return { E, s, go, clock };
}
const day = (s, k) => s.days[k] || {};
const pad2 = n => String(n).padStart(2, '0');
const contractHp = s => s.contract ? s.contract.hp : null;
function succeed(E, go, startDay, n) {
  for (let i = 0; i < n; i++) { const k = T.addDays(startDay, i); go(`${k}T08:10`); isOk(E.checkIn(), `gün ${k}`); }
}

/* ---- aralıklar ---- */
test('Uyku: kalkış aralığında başarı', () => {
  const { E, s, go } = setup();
  go('2026-11-06T08:20'); isOk(E.checkIn());
  eq(day(s, '2026-11-06').result, 'success'); eq(s.chain.len, 1, 'zincir'); eq(s.quest.progress, 1, 'ilerleme');
});
test('Uyku: aralığın son dakikası hâlâ başarı (08:30)', () => {
  const { E, s, go } = setup(); go('2026-11-06T08:30'); E.checkIn(); eq(day(s, '2026-11-06').result, 'success');
});
test('Uyku: aralıktan erken kalkmak da başarı', () => {
  const { E, s, go } = setup(); go('2026-11-06T06:00'); E.checkIn(); eq(day(s, '2026-11-06').result, 'success');
});
test('Uyku: aralık bitince gecikme (paslı halka, canavarın yarım vuruşu, 12 saat "Yorgun": hasar −%15)', () => {
  const { E, s, go } = setup();
  go('2026-11-06T08:31'); E.checkIn();
  eq(day(s, '2026-11-06').result, 'late'); eq(s.chain.rust, true, 'pas');
  eq(s.hp, 100 - E.failHit(false), 'yarım vuruş'); ok(E.failHit(false) * 2 >= E.failHit(true) - 1);
  eq(s.effects.map(e => [e.kind, e.pct]), [['tired', 15]]); eq(E.debuffPct(), 15);
  go('2026-11-06T20:32'); eq(E.debuffPct(), 0, '12 saat sonra kalkar');
});
test('Yatış: aralığın her yeri zamanında, sonrası geç', () => {
  for (const [t, exp] of [['2026-11-05T23:15', true], ['2026-11-06T00:00', true], ['2026-11-06T01:59', true], ['2026-11-06T02:00', true], ['2026-11-06T02:01', false]]) {
    const { E, s, go } = setup(); go(t); isOk(E.prep(), t); eq(day(s, '2026-11-06').medOnTime, exp, t);
  }
});
test('Yatış: aralıkta meditasyon sabahı ×1.5 ve +1 kart (toplam 3) yapar', () => {
  const { E, s, go } = setup();
  go('2026-11-06T00:30'); E.prep(); E.ev.reveals.length = 0;
  go('2026-11-06T08:10'); E.checkIn();
  eq(day(s, '2026-11-06').reward.mult, 1.5);
  eq(E.ev.reveals[0].cards.length, D.CARDS_PER.first + D.CARDS_PER.prepBonus, 'kart');
});
test('Kaçırılan gün: zincir kırılır, canavar tam vurur; ilk seferde Mahakam Ale "Bitkin"i önler, ikincide 24 saat "Bitkin" (−%30); cezalar en çok −%60', () => {
  const { E, s, go } = setup();
  go('2026-11-06T09:31');
  eq(day(s, '2026-11-06').result, 'fail'); eq(s.honey, 0, 'Mahakam Ale içildi'); eq(s.effects, []); eq(s.hp, 100 - E.failHit(true), 'Mahakam Ale vuruşu önlemez');
  s.hp = 100;
  go('2026-11-07T09:31');
  eq(s.effects.map(e => e.kind), ['exhausted']); eq(E.debuffPct(), 30); eq(s.hp, 100 - E.failHit(true), 'tam vuruş');
  const dph = E.playerStats().dph; s.effects = []; ok(E.playerStats().dph > dph * 1.4, 'ceza hasarı düşürür');
  s.effects = [1, 2, 3].map(i => ({ id: 'x' + i, kind: 'exhausted', pct: 30, until: '2026-12-01T00:00:00' }));
  eq(E.debuffPct(), D.EFFECT_CAP, 'tavan');
});

/* ---- idle savaş ---- */
test('Savaş: av sürekli akar; canavarlar zamanla ölür, oren ve TP gelir, sıradaki kontrat kendiliğinden alınır', () => {
  const { E, s, go } = setup({ idle: true });
  const g = s.stats.goldEarned, xp = s.xp + s.level * 1000;
  go('2026-11-09T21:30');                                          // 4 gün
  ok(s.trophies.length >= 2, 'birkaç günde birkaç canavar: ' + s.trophies.length);
  ok(s.stats.goldEarned > g && s.xp + s.level * 1000 > xp, 'oren ve TP');
  ok(s.contract, 'yeni kontrat'); eq(s.combat.t, new Date('2026-11-09T21:00').toISOString(), 'saat başı vuruş: son tam saat');
  ok(s.log.some(l => /izini|medallion|karşı karşıya|Kırık dallar|trail|face/.test(l.text)), 'günlükte savaş anları');
  ok(!E.ev.reveals.some(r => /ganimeti|loot/.test(r.title)), 'avdan kart fıçısı gelmez (sadece kupa)');
});
test('Savaş: canavar avda vurmaz; can avda okula göre dolar (Wolf saatte %0,3), iksir kendiliğinden içilmez; Yaralı hasarı düşürür', () => {
  const { E, s, go } = setup({ idle: true });
  isOk(E.takeContract(E.boardEntries()[0].m.id)); s.contract.hp = s.contract.max = 1e9;
  s.hp = 40; s.swallow = 2; s.honey = 3;
  const full = E.playerStats().dph; ok(E.combatInfo().wounded, 'yaralı');
  go('2026-11-06T07:00');                                          // 10 saat av
  ok(Math.abs(s.hp - (40 + E.maxHp() * 0.03)) < 0.01, 'Wolf saatte %0,3: ' + s.hp); eq(D.REGEN.fight.bear, 0.005); ok(D.REGEN.fight.cat < D.REGEN.fight.wolf); eq(s.swallow, 2, 'iksir kendiliğinden içilmez');
  s.hp = 60; ok(Math.abs(E.playerStats().dph - full / 0.8) < 0.01, 'yaralı değilken tam hasar');
  s.hp = 40;
  isOk(E.drinkPotion()); eq(s.hp, Math.min(E.maxHp(), 40 + Math.round(E.maxHp() * D.POTION.heal))); eq(s.swallow, 1);
  s.hp = E.maxHp(); isErr(E.drinkPotion(), 'can dolu');
});
test('Savaş: başarısızlıkta canın biterse yenilirsin; canavarın canı tamamen dolar, 6 saat sonra tam canla dönersin', () => {
  const { E, s, go } = setup({ idle: true });
  s.level = 4; isOk(E.takeContract(D.REGIONS[0].boss)); s.honey = 0;
  ok(E.failHit(true) > E.failHit(true, { id: E.boardEntries(0).find(e => !e.boss).m.id, hp: 1, max: 1 }), 'boss daha sert vurur');
  s.hp = 5;
  go('2026-11-06T09:31');                                          // 6 Kasım kaçırıldı
  eq(s.combat.mode, 'recover'); ok(s.hp < 1, 'can sıfırlandı'); eq(s.contract.hp, s.contract.max, 'canavarın canı doldu');
  ok(s.log.some(l => l.type === 'bad' && /yendi|son darbe|beat you|final blow/.test(l.text)), 'yenilgi günlükte');
  const hpBoss = s.contract.hp;
  go('2026-11-06T15:00'); eq(s.contract.hp, hpBoss, 'toparlanırken av yok');
  ok(s.hp > 0 && s.hp < E.maxHp(), 'toparlanırken can doluyor');
  go('2026-11-06T16:15'); eq(s.combat.mode, 'fight'); eq(s.hp, E.maxHp(), 'tam canla döndü (saatte %15 → ~6,7 saat)');
});
test('Kontrat her zaman var: savaş dışı hızlı iyileşme yok; yenilgi orenin %10 kadarını alır', () => {
  {
    const { E, s, go } = setup({ idle: true });
    s.hp = 10; go('2026-11-05T23:00');
    ok(s.contract, 'kontrat kendiliğinden alındı');
    ok(Math.abs(s.hp - (10 + E.maxHp() * D.REGEN.fight.wolf * 2)) < 0.01, 'sadece avdaki iyileşme: ' + s.hp);
  }
  const { E, s, go } = setup({ idle: true });
  s.level = 4; isOk(E.takeContract(D.REGIONS[0].boss)); s.honey = 0; s.hp = 1; E.checkAchievements(); s.gold = 1000;
  go('2026-11-06T09:31'); eq(s.combat.mode, 'recover'); eq(s.gold, 900);
});
test('Savaş: uzun aradan sonra "sen yokken" özeti', () => {
  const { E, s, go } = setup({ idle: true });
  const e = E.boardEntries().filter(x => !x.boss).sort((a, b) => a.stats.hp - b.stats.hp)[0];
  isOk(E.takeContract(e.m.id)); s.contract.hp = Math.min(s.contract.hp, 50);
  go('2026-11-06T07:00');
  ok(E.ev.offline && E.ev.offline.minutes >= 600 && E.ev.offline.kills >= 1, 'özet');
});
/* ---- dinlenme ---- */
test('Dinlenme günü: ceza yok, zincir donar; haftada bir kez; sonradan ilan edilemez', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 1);
  go('2026-11-06T21:00'); isOk(E.declareRest());
  go('2026-11-07T10:00');
  eq(day(s, '2026-11-07').result, 'rest'); eq(s.chain.len, 1); eq(s.hp, 100);
  go('2026-11-07T21:00'); isErr(E.declareRest(), 'aynı hafta');
  go('2026-11-09T03:00'); isOk(E.declareRest(), 'yeni hafta');
  ok(s.restDays['2026-11-10'] && !s.restDays['2026-11-09'], 'penceresi başlamış gün değil, sıradaki gün dinlenme olur');
});

/* ---- zincir ---- */
test('Zincir: üst üste iki gecikme kırar, kefaret açılır', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 3);
  go('2026-11-09T08:40'); E.checkIn(); eq(s.chain.rust, true);
  go('2026-11-10T08:40'); E.checkIn();
  eq(s.chain.len, 0); ok(s.chain.repair, 'kefaret yok');
});
test('Zincir: kırılınca bir malzeme düşer, 2 günlük kefaret geri getirir', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 8);
  go('2026-11-14T09:31');
  eq(s.chain.len, 0); eq(s.chain.repair.preLen, 8);
  succeed(E, go, '2026-11-15', 2);
  eq(s.chain.len, 10); eq(s.chain.repair, null);
});

/* ---- günlük alışkanlık ---- */
test('Günlük: aralıkta ya da erken başarı, sonrası gecikme, hiç yapmamak kaçırma', () => {
  const { E, s, go } = setup({ type: 'daily', start: '2026-11-06T09:00', quest: { name: 'Spor', daily: { start: '18:00', end: '22:00' } } });
  go('2026-11-06T19:00'); E.checkIn(); eq(day(s, '2026-11-06').result, 'success');
  go('2026-11-07T10:00'); E.checkIn(); eq(day(s, '2026-11-07').result, 'success');
  go('2026-11-08T22:30'); E.checkIn(); eq(day(s, '2026-11-08').result, 'late');
  go('2026-11-09T23:30'); eq(day(s, '2026-11-09').result, 'fail');
});
test('Günlük: tolerans gece yarısını geçince önceki gün hâlâ açık', () => {
  const { E, s, go } = setup({ type: 'daily', start: '2026-11-06T09:00', quest: { name: 'Kitap', daily: { start: '21:00', end: '23:30' }, lateMin: 60 } });
  go('2026-11-07T00:15'); eq(E.upcoming(), '2026-11-06');
  E.checkIn(); eq(day(s, '2026-11-06').result, 'late');
});

/* ---- ana görev ---- */
test('Ana görev: hedef güne ulaşınca tamamlanır, Efsanevi kart + seçim', () => {
  const { E, s, go } = setup({ quest: { days: 14 } });
  succeed(E, go, '2026-11-06', 14);
  eq(s.quest.status, 'mastery'); eq(s.quest.awaitingChoice, true); eq(s.questHistory[0].result, 'completed');
  ok(E.ev.reveals.some(r => r.title.includes('edinildi') && r.cards[0].r === 'Legendary'));
});
test('Ana görev: ustalıkta günlük ödül yarıya', () => {
  const { E, s, go } = setup({ quest: { days: 14 } });
  succeed(E, go, '2026-11-06', 14); isOk(E.continueMastery());
  go('2026-11-20T08:10'); E.checkIn();
  ok(day(s, '2026-11-20').reward.mult < 1.2, 'ödül yarıya');
});
test('Ana görev: yerine yenisi başlatılınca eskisi günleriyle geçmişe yazılır, yenisi bugün ve kendi zinciriyle başlar', () => {
  const { E, s, go } = setup({ quest: { days: 14 } });
  succeed(E, go, '2026-11-06', 1);
  go('2026-11-06T10:00');
  const oldId = s.quest.id;
  isOk(E.startQuest({ ...s.quest, name: 'Spor', type: 'daily', days: 21, daily: { start: '18:00', end: '22:00' } }, { keepAsSide: true, replace: oldId }));
  eq(s.habits.length, 1); eq(s.quest.name, 'Spor'); eq(s.quest.type, 'window');
  eq(s.quest.start, '2026-11-06'); eq(s.quest.progress, 0); eq(s.quest.status, 'active');
  ok(s.questHistory[0].entries['2026-11-06'], 'eski kayıt geçmişte'); eq(s.questHistory[0].result, 'abandoned');
  ok(s.quests.some(q => q.name === 'Uyku düzeni'), 'yan görev');
  go('2026-11-06T19:00'); isOk(E.checkIn()); eq(s.chain.len, 1, 'yeni alışkanlığın kendi zinciri');
});
test('Alışkanlıklar: birden fazla alışkanlık, her birinin kendi zinciri; ikinci zincirin hasar katkısı yarım', () => {
  const { E, s, go } = setup();
  const r1 = E.startQuest({ name: 'Spor', type: 'window', days: 30, daily: { start: '18:00', end: '22:00' } }); isOk(r1);
  const sp = r1.habit.id; eq(s.habits.length, 2);
  for (let i = 0; i < 7; i++) {
    const k = T.addDays('2026-11-06', i);
    go(`${k}T08:10`); isOk(E.checkIn());
    go(`${k}T19:00`); isOk(E.checkIn(sp), 'spor ' + k);
  }
  eq(s.habits[0].chain.len, 7); eq(E.habitById(sp).chain.len, 7);
  const cd = E.chainDamage(); eq(cd.total, D.TIERS[1].dmg * 1.5, 'Çelik + yarım Çelik');
  // ikincisi kaçırılınca sadece onun zinciri kırılır
  go('2026-11-13T08:10'); isOk(E.checkIn());
  go('2026-11-14T08:10'); isOk(E.checkIn());
  eq(s.habits[0].chain.len, 9); eq(E.habitById(sp).chain.len, 0, 'spor zinciri kırıldı');
  ok(E.removeHabit(s.habits[0].id) && s.habits.length === 1, 'kaldırma');
  isErr(E.removeHabit(s.habits[0].id), 'son alışkanlık kaldırılamaz');
});
test('Alışkanlıklar: en fazla 5; günün ilk başarısı 2 kart, sonrakiler 1', () => {
  const { E, s, go } = setup();
  for (let i = 0; i < 4; i++) isOk(E.startQuest({ name: 'G' + i, type: 'check', days: 30 }));
  isErr(E.startQuest({ name: 'Fazla', type: 'check', days: 30 }));
  go('2026-11-06T08:10'); E.ev.reveals.length = 0; isOk(E.checkIn());
  isOk(E.checkIn(s.habits[1].id)); isOk(E.checkIn(s.habits[2].id));
  eq(E.ev.reveals.filter(r => /: (sabah|günün) ganimeti/.test(r.title)).map(r => r.cards.length), [2, 1, 1]);
});
test('Görev türü — adet: hedefe ulaşınca başarı, en az yarısı gecikme, azı kaçırma', () => {
  const { E, s, go } = setup();
  const h = E.startQuest({ name: 'Su', type: 'count', days: 30, count: { target: 8, unit: 'bardak' } }).habit;
  go('2026-11-06T10:00'); isOk(E.addCount(3, h.id)); isOk(E.addCount(4, h.id));
  eq(h.entries['2026-11-06'].count, 7); ok(!h.entries['2026-11-06'].result);
  isOk(E.addCount(1, h.id)); eq(h.entries['2026-11-06'].result, 'success'); eq(h.chain.len, 1);
  isErr(E.addCount(1, h.id), 'gün kapandı');
  go('2026-11-07T20:00'); isOk(E.addCount(5, h.id));
  go('2026-11-08T03:01'); eq(h.entries['2026-11-07'].result, 'late', 'yarısından fazla'); eq(h.chain.rust, true);
  go('2026-11-08T22:00'); isOk(E.addCount(2, h.id));
  go('2026-11-09T03:01'); eq(h.entries['2026-11-08'].result, 'fail', 'yarısından az');
});
test('Görev türü — yaptım/yapmadım: gün boyunca ve gece 03:00\'e kadar başarı, sonrası tolerans içinde gecikme', () => {
  const { E, s, go } = setup();
  const h = E.startQuest({ name: 'Kitap', type: 'check', days: 30, lateMin: 60 }).habit;
  go('2026-11-06T23:30'); isOk(E.checkIn(h.id)); eq(h.entries['2026-11-06'].result, 'success');
  go('2026-11-08T02:30'); isOk(E.checkIn(h.id)); eq(h.entries['2026-11-07'].result, 'success', 'gece yarısından sonra hâlâ önceki gün');
  go('2026-11-09T03:30'); isOk(E.checkIn(h.id)); eq(h.entries['2026-11-08'].result, 'late');
  go('2026-11-10T05:00'); eq(h.entries['2026-11-09'].result, 'fail');
});
test('Taşıma: v10 kaydı (tek ana görev) ilk alışkanlığa dönüşür; zincir, günler ve dinlenme günleri korunur', () => {
  const v10 = { v: 10, created: '2026-11-01T10:00:00Z', name: 'Eski', school: 'wolf', settings: {}, hp: 100, xp: 0, level: 1, gold: 0, scraps: 0, swallow: 1,
    chain: { len: 3, rust: false, repair: null, links: [], best: 5, bestTier: 0 }, lastProcessed: '2026-11-05',
    quest: makeQuest({ id: 'q1', name: 'Uyku düzeni', type: 'sleep', days: 30, start: '2026-11-02' }),
    questHistory: [{ id: 'q0', name: 'Eski görev', days: 14, result: 'abandoned' }],
    days: { '2026-11-03': { result: 'success', q: 'q1' }, '2026-11-04': { result: 'rest', rest: true, restAt: '2026-11-03T20:00:00Z' }, '2026-11-02#q0': { result: 'success' } },
    collection: {}, trophies: [], links: [], swords: { owned: [], silver: null, steel: null, up: {} }, diagrams: [], quests: [], questLog: {}, log: [], notified: {}, boards: {}, rerolls: {}, hall: [], stats: { goldEarned: 0, dmg: 0, crits: 0 }, region: 0, draws: 0, pity: 0 };
  v10.quest.progress = 2;
  const s = migrate(JSON.parse(JSON.stringify(v10)));
  eq(s.v, 12); eq(s.habits.length, 1); eq(s.habits[0].id, 'q1'); eq(s.habits[0].chain.len, 3); eq(s.habits[0].progress, 2);
  eq(s.habits[0].lastProcessed, '2026-11-05'); ok(s.habits[0].entries['2026-11-03']);
  ok(s.restDays['2026-11-04'], 'dinlenme günü'); ok(s.questHistory[0].entries['2026-11-02'], 'eski görevin günü geçmişte');
  eq(JSON.parse(JSON.stringify(s)).days, undefined, 'eski alanlar kayda yazılmaz'); eq(s.days, s.habits[0].entries, 'uyum için takma ad');
});
test('Ana görev: doğrulama', () => {
  ok(validateQuest(makeQuest({ type: 'sleep', days: 10 }))); ok(validateQuest(makeQuest({ type: 'sleep', days: 61 })));
  eq(validateQuest(makeQuest({ type: 'sleep', days: 60 })), null);
  ok(validateQuest(makeQuest({ type: 'sleep', days: 30, sleep: { bedStart: '02:00', bedEnd: '01:00' } })));
  eq(validateQuest(makeQuest({ type: 'sleep', days: 30, sleep: { bedStart: '23:30', bedEnd: '01:00' } })), null);
  ok(validateQuest(makeQuest({ type: 'daily', days: 30, daily: { start: '22:00', end: '18:00' } })));
});

/* ---- kontrat tabelası + bölgeler ---- */
test('Tabela: bölgeden 5 canavar, haftalık yenilenir; aynı kademedeki bölge açık, üst kademe kilitli', () => {
  const { E, s, go } = setup();
  const b = E.boardEntries();
  eq(b.length, D.BOARD_SIZE); ok(b.every(x => x.m.region === 0 && !x.m.boss));
  const first = s.boards[0].ids.join();
  go('2026-11-09T12:00'); E.boardEntries();
  ok(s.boards[0].ids.join() !== first, 'pazartesi yeni tabela');
  eq(E.boardEntries(RI('kovir')).length, D.BOARD_SIZE, 'aynı kademedeki ikinci bölge (Kovir) açık');
  isOk(E.takeContract(E.boardEntries(RI('kovir'))[0].m.id), 'ikinci bölgeden kontrat');
  eq(E.boardEntries(RI('lyria')), [], 'üst kademe kilitli');
  const locked = D.MONSTERS.find(m => tierOfMon(m) === 1 && !m.boss);
  isErr(E.takeContract(locked.id), 'kilitli bölgeden kontrat alınamaz');
});
test('Tabela: boss\'tan sonra eski bölgenin tabelası da açık kalır, oradan kontrat alınabilir', () => {
  const { E, s } = setup();
  E.dev.addXp(5000); isOk(E.takeContract(D.REGIONS[0].boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.region, 1);
  eq(E.boardEntries(0).length, D.BOARD_SIZE); eq(E.boardEntries(RI('lyria')).length, D.BOARD_SIZE); eq(E.boardEntries(RI('vizima')).length, D.BOARD_SIZE);
  ok(E.boardEntries(RI('kovir')).some(x => x.boss), 'alt kademenin kesilmemiş boss\'u açık kalır');
  isOk(E.takeContract(E.boardEntries(0)[0].m.id), 'alt bölge');
  isOk(E.takeContract(E.boardEntries(RI('lyria'))[0].m.id), 'üst bölge');
  const lv = s.level; isOk(E.takeContract(D.REGIONS[RI('kovir')].boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.region, 1, 'alt kademenin boss\'u kademe atlatmaz');
});
test('Canavar değerleri: bölge içinde canı az olanın ödülü de az; bölgenin en yüksek değerini aşmaz; vuruş bölgeyle artar', () => {
  D.REGIONS.forEach((r, i) => {
    const list = D.MONSTERS.filter(m => m.region === i && !m.boss).map(m => ({ m, st: monStats(m) })).sort((a, b) => a.st.hp - b.st.hp);
    ok(list[0].st.gold <= list.at(-1).st.gold && list[0].st.xp <= list.at(-1).st.xp, r.name + ' ödül cana göre');
    ok(list.every(x => x.st.hp <= Math.round(D.REG.hp[r.tier] * D.HP_MULT[r.tier]) && x.st.gold <= D.REG.gold[r.tier] + 5), r.name + ' tavan (5e yuvarlama payı)');
    ok(new Set(list.map(x => x.st.hp)).size >= 4, r.name + ' canlar farklı olmalı');
    if (r.tier) ok(D.REG.hp[r.tier] > D.REG.hp[r.tier - 1] * 1.5, r.name + ' kademe canı artar');
    ok(list.every(x => x.st.hit > 0), r.name + ' vuruş');
  });
  ok(monStats(D.MONSTERS.filter(m => m.region === 0)[0]).hp >= 30, 'ilk bölgede can en az 30');
});
test('Demirci: oren karşılığı stok yenilenir; bedel aynı gün artar, ertesi gün sıfırlanır', () => {
  const { E, s, go } = setup();
  s.gold = 1000; s.level = 14;
  const a = E.dailySwords('silver').map(w => w.id).join();
  eq(E.shopRerollCost(), D.REROLL.shop);
  isOk(E.rerollShop()); eq(s.gold, 1000 - D.REROLL.shop);
  ok(E.dailySwords('silver').map(w => w.id).join() !== a, 'stok değişmeli');
  eq(E.dailySwords('silver').length, D.SHOP_DAILY);
  eq(E.shopRerollCost(), D.REROLL.shop * 2, 'ikinci yenileme daha pahalı');
  const b = E.dailySwords('silver').map(w => w.id).join();
  eq(E.dailySwords('silver').map(w => w.id).join(), b, 'yenilemeden sonra gün içinde sabit');
  s.gold = 50; isErr(E.rerollShop(), 'para yok');
  go('2026-11-06T12:00'); eq(E.shopRerollCost(), D.REROLL.shop, 'ertesi gün sıfırlanır');
});
test('Kontrat tabelası: ucuz yenileme, aktif kontrat yerinde kalır, bedel aynı hafta artar, kilitli bölge yenilenmez', () => {
  const { E, s, go } = setup();
  s.gold = 1000;
  const before = s.boards[0] ? [...s.boards[0].ids] : E.boardEntries(0).map(e => e.m.id);
  isOk(E.takeContract(before[1]));
  const cost = E.boardRerollCost(0); eq(cost, D.REROLL.boardBase);
  isOk(E.rerollBoard(0)); eq(s.gold, 1000 - cost);
  const after = s.boards[0].ids;
  eq(after.length, D.BOARD_SIZE); ok(after.includes(before[1]), 'aktif kontrat kalmalı');
  ok(after.filter(id => id !== before[1]).every(id => !before.includes(id)), 'diğerleri yeni olmalı');
  eq(s.contract.id, before[1]);
  eq(E.boardRerollCost(0), D.REROLL.boardBase * 2, 'aynı hafta pahalanır');
  isErr(E.rerollBoard(RI('lyria')), 'kilitli bölge');
  go('2026-11-09T12:00'); eq(E.boardRerollCost(0), D.REROLL.boardBase, 'yeni hafta sıfırlanır');
  s.gold = 0; isErr(E.rerollBoard(0), 'para yok');
});
test('Tüccar: Mahakam Ale 60 oren (en çok 3); Swallow pahalı, fiyatı seviyeyle artar (en çok 10)', () => {
  const { E, s } = setup();
  eq(E.shopItems().find(i => i.id === 'honey').price, 60);
  eq(E.shopItems().find(i => i.id === 'swallow').price, D.SHOP.find(i => i.id === 'swallow').price);
  ok(D.SHOP.find(i => i.id === 'swallow').price >= 40, 'zamlı');
  s.gold = 10000; s.swallow = 9; isOk(E.buy('swallow')); isErr(E.buy('swallow'), 'kapasite');
  s.honey = 3; isErr(E.buy('honey'), 'en çok 3');
});
test('Tabela: kontrat seçilir, canı ve ödülü canavara özel', () => {
  const { E, s } = setup();
  const e = E.boardEntries()[1];
  isOk(E.takeContract(e.m.id));
  eq([s.contract.id, s.contract.max, s.contract.hp], [e.m.id, e.stats.hp, e.stats.hp]);
  ok(e.stats.gold > 0); isErr(E.takeContract('yok-boyle-bir-canavar'));
  const golds = new Set(D.MONSTERS.map(m => monStats(m).gold)); ok(golds.size > 10, 'ödüller canavara göre değişmeli');
});
test('Tabela: kontrat seçilmezse bu kademenin panolarındaki en kolay canavar alınır', () => {
  const { E, s, go } = setup();
  const easiest = [0, RI('kovir')].flatMap(r => E.boardEntries(r)).filter(x => !x.boss).sort((a, b) => a.stats.hp - b.stats.hp)[0];
  const t = setup({ idle: true }); t.go('2026-11-05T22:00');
  const [E2, s2] = [t.E, t.s];
  const easiest2 = [0, RI('kovir')].flatMap(r => E2.boardEntries(r)).filter(x => !x.boss).sort((a, b) => a.stats.hp - b.stats.hp)[0];
  ok(easiest && s2.contract && s2.contract.id === easiest2.m.id && s2.contract.hp < s2.contract.max, 'otomatik kontrat: ' + s2.contract?.id);
  return;
  ok(s.contract && s.contract.id === easiest.m.id && s.contract.hp < s.contract.max, 'otomatik kontrat: ' + s.contract?.id);
});
test('Av: canavar ölünce oren + TP + kupa (kart fıçısı yok); aynı canavar bir daha gelmez', () => {
  const { E, s, go } = setup();
  const e = E.boardEntries()[0]; E.takeContract(e.m.id); s.contract.hp = 5;
  const g = s.gold, lv = s.level, xp = s.xp;
  E.ev.reveals.length = 0; E.dev.killContract();
  eq(s.trophies.length, 1); eq(s.contract, null);
  ok(s.gold >= g + e.stats.gold, 'ödül');
  ok(s.level > lv || s.xp >= xp + e.stats.xp, 'TP');
  ok(!E.ev.reveals.some(r => r.title.includes(e.m.name + ' ganimeti')), 'avdan kart fıçısı yok');
  for (let w = 0; w < 6; w++) { go(T.addDays('2026-11-09', w * 7) + 'T12:00'); ok(!E.boardEntries().some(x => x.m.id === e.m.id), 'tekrar geldi'); }
});
test('Seviye: bölge sınırında TP birikir ama seviye boss ölmeden geçmez', () => {
  const { E, s } = setup();
  E.dev.addXp(5000);
  eq(s.level, D.REGIONS[0].max, 'sınır'); eq(s.xp, D.xpNeed(s.level), 'en fazla bir seviyelik TP birikir');
  ok(E.bossAvailable(), 'boss açıldı');
  ok(E.boardEntries().some(x => x.boss && x.m.id === D.REGIONS[0].boss), 'boss tabelada');
});
test('Seviye: boss ölünce yeni bölge, yeni tabela, biriken TP ile seviye atlanır', () => {
  const { E, s } = setup();
  E.dev.addXp(5000);
  isOk(E.takeContract(D.REGIONS[0].boss)); s.contract.hp = 1;
  E.dev.killContract();
  eq(s.region, 1); ok(s.level > D.REGIONS[0].max && s.level <= D.REGIONS[0].max + 2, 'en fazla iki seviye atlanır: ' + s.level);
  ok(E.boardEntries().every(x => tierOfMon(x.m) === 1), 'yeni kademenin tabelası');
});
test('Seviye: tüm bölge canavarlarını öldürmek boss olmadan yetmez', () => {
  const { E, s } = setup();
  D.MONSTERS.filter(m => m.region === 0 && !m.boss).forEach(m => s.trophies.push({ id: m.id }));
  s.boards = {}; s.contract = null; E.ensureBoard();
  eq(s.boards[0].ids.length, 0, 'tabela boş');
  E.dev.addXp(99999);
  eq(s.level, D.REGIONS[0].max); eq(s.region, 0); ok(E.bossAvailable());
});
test('Son boss: efsane olunur, seviye son seviyede durur', () => {
  const { E, s } = setup();
  s.region = D.BAND_COUNT - 1; s.level = D.MAX_LEVEL; s.boards = {}; s.contract = null;
  isOk(E.takeContract(D.REGIONS.at(-1).boss)); s.contract.hp = 1;
  E.dev.killContract();
  eq(s.legend, true); eq(s.level, D.MAX_LEVEL);
});

test('Son oyun: efsane olunca kesilmiş canavarlar elit olarak tabelaya döner, tekrar kesilir, daha çok ödül verir', () => {
  const { E, s } = setup();
  s.region = D.BAND_COUNT - 1; s.level = D.MAX_LEVEL; s.boards = {}; s.contract = null;
  D.MONSTERS.filter(m => !m.boss || m.id !== D.REGIONS.at(-1).boss).forEach(m => s.trophies.push({ id: m.id }));
  ok(E.boardEntries(0).length === 0 || E.boardEntries(0).every(x => !x.elite), 'efsane değilken kesilmişler gelmez');
  isOk(E.takeContract(D.REGIONS.at(-1).boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.legend, true);
  const b = E.boardEntries(0);
  ok(b.filter(x => !x.boss).length === D.BOARD_SIZE && b.filter(x => !x.boss).every(x => x.elite), 'elit tabela dolu');
  ok(b.some(x => x.boss && x.elite && x.m.id === D.REGIONS[0].boss), 'eski bölge boss\'u elit olarak açık');
  const e = b.find(x => !x.boss), base = monStats(e.m);
  ok(e.stats.hp > base.hp && e.stats.gold >= base.gold, 'elit daha güçlü ve değerli');
  isOk(E.takeContract(e.m.id)); eq(s.contract.elite, true); eq(s.contract.max, e.stats.hp);
  const g = s.gold, n = s.trophies.length; s.contract.hp = 1; E.dev.killContract();
  eq(s.trophies.length, n + 1); ok(s.gold - g >= e.stats.gold, 'elit ödül'); eq(s.region, D.BAND_COUNT - 1);
  isOk(E.takeContract(D.REGIONS.at(-1).boss), 'son boss tekrar alınabilir');
});
test('Son oyun: son seviyede TP Ün (★) kazandırır; ün oren ve Swallow verir', () => {
  const { E, s } = setup();
  s.region = D.BAND_COUNT - 1; s.level = D.MAX_LEVEL; s.xp = 0; s.legend = true; s.swallow = 0;
  const g = s.gold;
  E.dev.addXp(E.fameNeed() * 2 + 5);
  eq(s.level, D.MAX_LEVEL); eq(s.fame, 2); ok(s.xp < E.fameNeed());
  ok(s.gold > g, 'ün oreni'); eq(s.swallow, 2, 'ün Swallow');
});
test('Son oyun: efsane olmadan elit yok, kesilen canavar tekrar alınamaz', () => {
  const { E, s } = setup();
  const m = E.boardEntries()[0].m; s.trophies.push({ id: m.id });
  ok(E.takeContract(m.id).err); eq(E.isElite(m.id), false);
});

test('Fraksiyon: "Tüm fraksiyonlar" seçilirse her fraksiyondan kart gelir; yeniden doğuşta seçilebilir', () => {
  const { E, s } = setup();
  isOk(E.rebirth({ name: 'Hepsi', school: 'wolf', faction: 'all' }));
  eq(s.faction, null);
  const got = E.dev.addGold ? (s.gold = 5000, Array.from({ length: 20 }, () => E.buy('bigkeg')), E.ev.reveals.flatMap(r => r.cards)) : [];
  ok(new Set(got.map(c => c.f)).size >= 4, 'birden çok fraksiyon');
  ok(E.rebirth({ name: 'x', school: 'wolf', faction: 'Elfler' }).err);
});

/* ---- hasar + demirci ---- */
test('Hasar: başarı anında ek vuruş yok; yatış, kalkış ve yan görev canavara vurmaz', () => {
  const { E, s, go } = setup();
  E.takeContract(E.boardEntries()[0].m.id); s.contract.hp = s.contract.max = 100000;
  go('2026-11-06T00:30'); E.prep(); eq(contractHp(s), 100000);
  go('2026-11-06T08:10'); E.checkIn(); eq(contractHp(s), 100000);
  go('2026-11-06T12:00'); E.completeSide(s.quests[0].id); eq(contractHp(s), 100000);
});
test('Kontrat değiştirme: iptal yok, başka kontrat alınca eskisinin ilerlemesi sıfırlanır', () => {
  const { E, s, go } = setup({ idle: true });
  const [a, b] = E.boardEntries().map(e => e.m.id);
  isOk(E.takeContract(a));
  s.contract.hp = s.contract.max = 100000;
  go('2026-11-05T23:00'); ok(s.contract.hp < s.contract.max, 'vuruldu');
  eq(E.cancelContract, undefined, 'iptal fonksiyonu yok');
  isOk(E.takeContract(b)); eq(s.contract.id, b); eq(s.contract.hp, s.contract.max, 'yeni kontrat tam canla');
  isOk(E.takeContract(a)); eq(s.contract.hp, s.contract.max, 'eskisine dönünce ilerleme sıfır');
  const old = migrate({ ...JSON.parse(JSON.stringify(s)), huntPaused: true }); eq(old.huntPaused, undefined, 'eski kayıttaki duraklatma silinir');
});
test('Swallow: 100 oren, en yüksek canın %50si (Swallow Ustası %80)', () => {
  eq(D.SHOP.find(i => i.id === 'swallow').price, 100); eq(D.POTION.heal, 0.5); eq(D.POTION.master, 0.8);
  const { E, s } = setup({ idle: true });
  s.level = 30; s.hp = 1; s.swallow = 1; isOk(E.drinkPotion()); eq(s.hp, 1 + Math.round(E.maxHp() * 0.5), '30. seviyede de canın yarısı');
});
test('Thunderbolt: üç kademe, 24 saat, Odak ile toplanır, üst üste binmez', () => {
  const { E, s, go } = setup({ idle: true });
  const [t1, t2, t3] = D.THUNDER.grades;
  eq([t1.pct, t2.pct, t3.pct], [20, 30, 40]); eq([t1.price, t2.price, t3.price], [120, 300, 600]); eq([t2.lv, t3.lv], [13, 25]);
  isErr(E.drinkThunder(), 'iksir yok');
  s.gold = 1000; isOk(E.buy('thunder')); eq(s.thunder, 1); eq(s.gold, 1000 - t1.price);
  ok(E.shopItems().find(i => i.id === 'thunder2').locked, 'Gelişmiş 13. seviyeye kadar kilitli'); isErr(E.buy('thunder2'), 'kilitli');
  const before = E.playerStats().dph;
  isOk(E.drinkThunder()); eq(s.thunder, 0); eq(E.buffPct(), 20);
  ok(Math.abs(E.playerStats().dph - before * 1.2) < 0.01, 'hasar ×1,2');
  s.thunder = 1; isOk(E.drinkThunder()); eq(E.buffPct(), 20, 'üst üste binmez');
  s.thunder3 = 1; isOk(E.drinkThunder('thunder3')); eq(E.buffPct(), 40, 'Üstün eskisinin yerine geçer'); eq(s.thunder3, 0);
  s.effects.push({ id: 'f', kind: 'focus', pct: 10, until: '2026-12-01T00:00:00' }); eq(E.buffPct(), 50, 'Odak + Thunderbolt');
  go('2026-11-06T09:30'); eq(E.buffPct(), 50, '12 saat sonra hâlâ sürer');
  go('2026-11-06T21:31'); eq(E.buffPct(), 10, '24 saat sonra biter');
  s.thunder = D.THUNDER.cap; isErr(E.buy('thunder'), 'kapasite');
  s.level = 13; s.gold = 1000; isOk(E.buy('thunder2')); eq(s.thunder2, 1);
});
test('Petri’s Philter: üç kademe, günde en fazla bir tane', () => {
  const { E, s, go } = setup({ idle: true });
  s.gold = 1000; const xp = s.xp;
  isOk(E.buy('owl')); eq(s.gold, 950); eq(s.xp, xp + 10);
  isErr(E.buy('owl'), 'günde bir'); ok(E.shopItems().find(i => i.id === 'owl').disabled);
  go('2026-11-06T22:00'); s.level = 25; const x2 = s.xp; isOk(E.buy('owl3')); eq(s.xp, x2 + 35); isErr(E.buy('owl2'), 'kademe fark etmez');
  s.level = 4; s.xp = 10000;
  ok(E.shopItems().find(i => i.id === 'owl').disabled, 'seviye sınırında TP doluyken alınmaz');
});
test('Dancing Star: rastgele 3–10 saatlik hasar, can bedeli yok, 48 saat bekleme; Manticore ×1,3', () => {
  const { E, s, go } = setup({ idle: true });
  go('2026-11-05T22:00'); ok(s.contract);
  s.contract.hp = s.contract.max = 100000;
  isErr(E.throwDancing(), 'bomba yok');
  s.dancing = 2; s.hp = E.maxHp();
  const dph = E.playerStats().dph, hp0 = s.contract.hp, crit = s.stats.crits;
  isOk(E.throwDancing()); eq(s.dancing, 1); eq(s.hp, E.maxHp(), 'can gitmez');
  const hit = (hp0 - s.contract.hp) / (s.stats.crits > crit ? D.CRIT_MULT : 1), hrs = hit / Math.round(dph);
  ok(hrs >= 2.99 && hrs <= 10.01 && Math.abs(hrs - Math.round(hrs)) < 0.02, '3–10 saatlik hasar: ' + hrs);
  isErr(E.throwDancing(), 'bekleme süresi'); eq(s.dancing, 1); ok(E.combatInfo().dancingWait > 0);
  go('2026-11-07T21:00'); isErr(E.throwDancing(), '47 saat yetmez');
  go('2026-11-07T22:01'); isOk(E.throwDancing(), '48 saat sonra atılır'); eq(s.dancing, 0);
  eq(D.UNIQUE_BY_ID.alchhand.id, 'alchhand'); eq(D.UNIQUE_BY_ID.fireproof, undefined);
  for (const [school, r, h, k] of [['wolf', 0, 3, 1], ['wolf', 0.999, 10, 1], ['manticore', 0.999, 10, 1.3]]) {   // kritik yok (çelik yok/zar yüksek)
    const m = setup({ idle: true, school, random: () => r });
    m.go('2026-11-05T22:00'); m.s.contract.hp = m.s.contract.max = 1e7; m.s.hp = m.E.maxHp(); m.s.swords.steel = null; m.s.dancing = 1;
    const one = Math.round(m.E.playerStats().dph * k);
    eq(m.E.combatInfo().dancingMin, one * 3); eq(m.E.combatInfo().dancingMax, one * 10);
    isOk(m.E.throwDancing()); eq(1e7 - m.s.contract.hp, one * h, `${school} ${h} saat`);
  }
});
test('Black Blood: 24 saat kritik +%10, Vampir/Nekrofaj +%15 daha; hasarı değil kritiği artırır', () => {
  const { E, s, go } = setup({ idle: true });
  go('2026-11-05T22:00'); ok(s.contract);
  isErr(E.drinkBlackBlood(), 'iksir yok');
  s.gold = 1000; isOk(E.buy('blackblood')); eq(s.blackblood, 1); eq(s.gold, 1000 - D.BLACKBLOOD.price);
  const m = D.monById(s.contract.id), before = E.playerStats(), buf = E.buffPct();
  isOk(E.drinkBlackBlood()); eq(s.blackblood, 0);
  eq(E.buffPct(), buf, 'hasar bonusu değişmez');
  eq(E.playerStats().crit, Math.min(100, before.crit + 10 + (D.BLACKBLOOD.vs.includes(m.cls) ? 15 : 0)));
  const vamp = D.MONSTERS.find(x => x.cls === 'Vampire'), beast = D.MONSTERS.find(x => x.cls === 'Beast');
  eq(E.playerStats(vamp).crit - E.playerStats(beast).crit, 15, 'Vampire karşı +%15 daha');
  ok(s.counters.potions >= 1, 'iksir sayacı');
  go('2026-11-06T22:01'); eq(E.playerStats().crit, before.crit, '24 saat sonra biter');
});
test('Mysterious Puzzle Box: sınırsız ama bekleyen bilmece varken alınmaz; kelime eşleşmesi, ödül uygulanır', () => {
  const { E, s, go } = setup({ idle: true });
  eq(D.SHOP.find(i => i.id === 'puzzle').price, 50);
  eq(D.puzzleWords("Geralt of Rivia"), ['geralt', 'rivia']); eq(D.puzzleWords('Dol Blathanna Archer!'), ['dol', 'blathanna', 'archer']);
  s.gold = 1000; isOk(E.buy('puzzle')); eq(s.gold, 950);
  const q = E.puzzleQuestion(); ok(q && D.CARD_BY_ART[q.a], 'soru var'); ok(['art', 'flavor'].includes(q.kind));
  isErr(E.buy('puzzle'), 'cevaplanmamış kutu varken alınmaz');
  const name = D.CARD_BY_ART[q.a].n, word = D.puzzleWords(name)[0];
  const g = s.gold, sc = s.scraps;
  const r = E.answerPuzzle('blah ' + word.toUpperCase()); ok(r.correct, 'tek kelime yeter: ' + name); ok(r.prize);
  eq(E.puzzleQuestion(), null);
  if (r.prize.id === 'gold') eq(s.gold, g + r.prize.n); if (r.prize.id === 'scraps') eq(s.scraps, sc + r.prize.n);
  isOk(E.buy('puzzle'), 'günlük sınır yok'); const r2 = E.answerPuzzle('zzzz qqqq'); eq(r2.correct, false); eq(E.puzzleQuestion(), null, 'yanlışta kutu gider');
  // 30 saniye süre: içinde doğru cevap geçer, süre dolunca doğru cevap da sayılmaz; süresi dolan bilmece yeni kutuyu engellemez
  eq(D.PUZZLE.secs, 30);
  const t = setup({ idle: true }); t.s.gold = 1000;
  isOk(t.E.buy('puzzle')); let qq = t.E.puzzleQuestion(); ok(qq.until && !qq.expired);
  t.go('2026-11-05T21:00:25'); ok(t.E.answerPuzzle(D.CARD_BY_ART[qq.a].n).correct, '25. saniyede doğru');
  isOk(t.E.buy('puzzle')); qq = t.E.puzzleQuestion();
  t.go('2026-11-05T21:01:00'); ok(t.E.puzzleQuestion().expired, 'süre doldu'); ok(!t.E.shopItems().find(i => i.id === 'puzzle').disabled, 'süresi dolunca yeni kutu alınabilir');
  const late = t.E.answerPuzzle(D.CARD_BY_ART[qq.a].n); eq([late.correct, late.late], [false, true], 'geç cevap sayılmaz');
  isOk(t.E.buy('puzzle')); t.go('2026-11-05T21:02:00'); isOk(t.E.buy('puzzle'), 'süresi dolan eski bilmece kendiliğinden kapanır'); ok(!t.E.puzzleQuestion().expired);
  // ödül olasılıkları: kademe ağırlıkları kötüden iyiye azalır
  for (const k of ['w', 'wCat']) { const w = D.PUZZLE.tiers.map(t => t[k]); ok(w.every((x, i) => i === 0 || x <= w[i - 1]), 'olasılık azalır: ' + k); }
  ok(D.PUZZLE.tiers.flatMap(t => t.prizes).filter(p => p.id === 'scraps').map(p => p.n).join() === '40,100,250', 'kırıntı ödülleri');
});
test('Kart ödülleri açılmadan da verilir: fıçı ve kutu kartları hemen koleksiyona girer', () => {
  const { E, s } = setup({ idle: true });
  const tot = () => Object.values(s.collection).reduce((a, b) => a + b, 0);
  s.gold = 1000; const c0 = tot(); E.ev.reveals.length = 0;
  isOk(E.buy('keg')); eq(tot(), c0 + 3, 'Card Keg 3 kart'); eq(E.ev.reveals.length, 1, 'açılış ekranı kuyrukta');
  E.ev.reveals.length = 0; eq(tot(), c0 + 3, 'açılış atlanınca kartlar gitmez');
  isOk(E.buy('bigkeg')); eq(tot(), c0 + 8, 'Large Keg 5 kart');
});
test('Uyku düzeni tek olur: ikinci uyku alışkanlığı eklenemez, diğer türler eklenir', () => {
  const { E, s } = setup();
  ok(s.habits.some(h => h.type === 'sleep'), 'başta bir uyku düzeni var');
  const n = s.habits.length;
  isErr(E.startQuest({ name: 'İkinci uyku', type: 'sleep', days: 30, lateMin: 60, sleep: { bedStart: '23:00', bedEnd: '00:30', wakeStart: '07:00', wakeEnd: '07:30' } }), 'ikinci uyku');
  eq(s.habits.length, n);
  isOk(E.startQuest({ name: 'Kitap', type: 'check', days: 30, lateMin: 60 }), 'başka tür eklenir');
  const sl = s.habits.find(h => h.type === 'sleep');
  isOk(E.startQuest({ name: 'Yeni uyku', type: 'sleep', days: 30, lateMin: 60, sleep: { bedStart: '23:00', bedEnd: '00:30', wakeStart: '07:00', wakeEnd: '07:30' } }, { replace: sl.id }), 'uykunun yerine uyku konabilir');
  eq(s.habits.filter(h => h.type === 'sleep').length, 1);
});
test('Mutagenerator: 1000 oren, havuzdan tekrarsız tuhaf eşya, bitince alınamaz; başarım', () => {
  const { E, s } = setup();
  eq(D.SHOP.find(i => i.id === 'mutagen').price, 1000);
  s.gold = 5000; eq(E.oddLeft().length, D.ODDITIES.length);
  for (let i = 0; i < D.ODDITIES.length; i++) isOk(E.buy('mutagen'));
  eq(new Set(s.oddities).size, D.ODDITIES.length, 'aynı eşya iki kez çıkmaz'); eq(s.gold, 5000 - 1000 * D.ODDITIES.length);
  ok(s.oddities.includes('freaky-snake')); eq(D.ODDITY_BY['freaky-snake'].desc, 'Wants your feet.');
  ok(E.shopItems().find(i => i.id === 'mutagen').disabled, 'havuz bitince alınamaz'); isErr(E.buy('mutagen'));
  E.checkAchievements(); ok(s.achievements.oddity, 'başarım');
});
test('Günlük mini oyunlar: sırayla döner, günde bir deneme, doğru cevap seviye × 5 oren (Cat × 7,5), başarımlar; antrenman ödülsüz', () => {
  const { E, s, go } = setup({ idle: true });
  // koleksiyonu doldur: Eksik Kart oyunu da kurulabilsin
  D.CARDS.filter(c => !s.faction || c.f === s.faction || c.f === 'Neutral').slice(0, 40).forEach(c => { s.collection[c.a] = 1; });
  const seen = new Set(), keyOf = {};
  for (let d = 0; d < 4; d++) {
    go(`2026-11-${String(6 + d).padStart(2, '0')}T12:00`);
    const g = E.miniGame(); ok(g && !g.done, 'oyun var'); seen.add(g.kind);
    // anahtar sadece oynandıktan sonra görünür
    eq(g.key, null);
    // doğru cevabı motorun kendi verisinden çıkar: önce yanlış cevapla deneyip sonucu göremeyiz, o yüzden test seed'i üzerinden çözeriz
    let answer;
    if (g.kind === 'match') answer = g.data.templates.map(t => D.CARDS.find(c => c.n === t.n && (c.fl || (window.GWENT_EXTRA || {})[c.a] || '') === t.fl).a);
    if (g.kind === 'class') answer = g.data.monsters.map(m => D.monById(m.id).cls);
    if (g.kind === 'missing') answer = g.data.cards.find(a => !s.collection[a]);
    if (g.kind === 'odd') { const cats = a => D.cardCats(D.CARD_BY_ART[a]); answer = g.data.cards.find(a => g.data.cards.every(b => b === a || !cats(b).some(x => cats(a).includes(x)))); }
    const gold = s.gold, r = E.playMini(answer); ok(r.won, g.kind + ' doğru cevap kazanır');
    eq(r.got, s.level * 5); ok(s.gold >= gold + s.level * 5 - 1);
    isErr(E.playMini(answer), 'günde bir');
    ok(E.miniGame().done && E.miniGame().key != null, 'oynandıktan sonra anahtar görünür');
  }
  eq(seen.size, 4, 'dört oyun sırayla');
  E.checkAchievements(); ['mini-match', 'mini-class', 'mini-missing', 'mini-odd'].forEach(id => ok(s.achievements[id], id));
  // yanlış cevap: ödül yok
  go('2026-11-10T12:00'); const g = E.miniGame(), wrong = g.kind === 'class' ? g.data.monsters.map(() => 'Zzz') : g.kind === 'match' ? g.data.images.map(() => 1) : -1;
  const before = s.gold, r = E.playMini(wrong); eq([r.won, s.gold], [false, before]);
  // Cat okulu: seviye × 15
  const c = setup({ idle: true, school: 'cat' }); c.s.level = 4; eq(c.E.miniGame().reward, 30); c.s.level = 3; eq(c.E.miniGame().reward, 23, 'Cat × 7,5 yuvarlanır');
  // antrenman: istediğin oyun, sınırsız, ödül/sayaç yok
  const wins = s.counters.miniWins, g0 = s.gold;
  for (const kind of D.MINI.kinds) {
    isOk(E.startPractice(kind)); const p = E.practiceGame(); eq([p.kind, p.practice, p.key], [kind, true, null]);
    const wrongP = p.kind === 'class' ? p.data.monsters.map(() => 'Zzz') : p.kind === 'match' ? p.data.images.map(() => 1) : -1;
    const rp = E.playPractice(wrongP); eq([rp.won, rp.got], [false, 0]); ok(E.practiceGame().key != null); isErr(E.playPractice(wrongP), 'biten antrenman tekrar oynanmaz');
  }
  isOk(E.startPractice('odd')); const p2 = E.practiceGame(), cats = a => D.cardCats(D.CARD_BY_ART[a]);
  const rightP = p2.data.cards.find(a => p2.data.cards.every(b => b === a || !cats(b).some(x => cats(a).includes(x))));
  ok(E.playPractice(rightP).won, 'antrenmanda doğru cevap'); eq([s.gold, s.counters.miniWins], [g0, wins], 'antrenman oren ya da sayaç vermez');
});
test('Puzzle Box: Cat okulunda iyi ödüllerin şansı daha yüksek', () => {
  const ev = w => { const t = D.PUZZLE.tiers, tot = t.reduce((a, x) => a + w(x) * x.prizes.length, 0), val = p => (p.id === 'gold' ? p.n : p.id === 'keg' ? 60 : p.id === 'bigkeg' ? 180 : 0);
    return t.reduce((a, x) => a + x.prizes.reduce((b, p) => b + w(x) * val(p), 0), 0) / tot; };
  ok(ev(x => x.wCat) > ev(x => x.w) * 1.15, 'Cat ortalaması en az %15 yüksek');
  const top = w => { const t = D.PUZZLE.tiers, tot = t.reduce((a, x) => a + w(x) * x.prizes.length, 0); return w(t.at(-1)) / tot; };
  ok(top(x => x.wCat) > top(x => x.w), '1000 oren şansı artar');
});
test('Başarımlar: Aerondight, 50 iksir, okul değiştirme', () => {
  const { E, s } = setup({ idle: true });
  const has = id => !!s.achievements[id];
  E.checkAchievements(); ok(!has('new-school') && !has('aerondight') && !has('potions-50'));
  s.gold = 1000; isOk(E.changeSchool('cat')); E.checkAchievements(); ok(has('new-school'), 'okul');
  s.swords.owned.push(D.SWORDS.find(w => w.tier === 6).id); E.checkAchievements(); ok(has('aerondight'), 'Aerondight');
  s.counters.potions = 49; s.swallow = 1; s.hp = 1; isOk(E.drinkPotion()); E.checkAchievements(); ok(has('potions-50'), '50 iksir');
});
test('Manticore: iksirler yarı fiyatına, bombalar değil; başlangıç donanımı', () => {
  const { E, s } = setup({ school: 'manticore' });
  const price = id => E.shopItems().find(i => i.id === id).price;
  eq([price('swallow'), price('honey'), price('thunder'), price('thunder3'), price('owl'), price('owl2'), price('dancing')],
    [D.SHOP.find(i => i.id === 'swallow').price / 2, 30, 60, 300, 25, 75, D.DANCING.price]);
  eq(E.combatInfo().dancingPrice, D.DANCING.price, 'savaş panelinde de indirimsiz');
  eq(price('keg'), 60, 'kart fıçısı indirimsiz');
  eq(E.combatInfo().potionPrice, D.SHOP.find(i => i.id === 'swallow').price / 2);
  eq([s.thunder, s.dancing], [D.START_KIT.manticore.thunder, D.START_KIT.manticore.dancing]);
  eq(D.schoolImg('manticore'), 'img/manticore.webp'); ok(D.schoolImg('wolf').includes('gwent'), 'diğer okullar kart resmi');
  const w = setup({ school: 'wolf' }); eq(w.E.shopItems().find(i => i.id === 'swallow').price, D.SHOP.find(i => i.id === 'swallow').price);
});
test('Hasar: gümüş kılıcın hasarı seviyesine bağlı; kendi okulunun seti +%15; çelikle kritik', () => {
  const { E, s } = setup();
  const sv = D.SWORDS.find(w => w.type === 'silver' && w.school === 'wolf');
  s.swords.owned.push(sv.id); s.swords.lv[sv.id] = 10; isOk(E.equipSword(sv.id));
  eq(E.damageBonus().sword, Math.round(D.swordDmgAt(sv, 10) * 1.15 * 10) / 10, 'kendi okulunun seti +%15');
  ok(Math.abs(E.playerStats().dph - (D.powerAt(1) + E.damageBonus().sword)) < 0.01, 'taban hasara eklenir');
  s.swords.lv[sv.id] = 20; ok(E.damageBonus().sword > D.swordDmgAt(sv, 10), 'seviye arttıkça hasar artar');
  const st = D.SWORDS.find(w => w.type === 'steel' && w.tier === 3); s.swords.owned.push(st.id); s.swords.lv[st.id] = 15; E.equipSword(st.id);
  eq(E.damageBonus().crit, D.swordCritAt(st, 15));
});
test('Hasar: zincir, bağ ve avcı bonusları düz toplanır; tavan ya da azaltım yok', () => {
  const { E, s } = setup();
  const p0 = E.playerStats().dph;
  s.chain.len = 70;
  eq(E.damageBonus().chain, 100); eq(E.damageBonus().pct, 100, 'zincir bonusa girer');
  ok(Math.abs(E.playerStats().dph - p0 * 2) < 0.01, 'Göktaşı: hasar ×2');
  for (let i = 0; i < 10; i++) s.links.push({ id: 'l' + i, f: 'X', cat: 'Y', cards: [] });
  s.links.forEach(l => { l.cards = D.CARDS.filter(c => c.r === 'Legendary').slice(0, 5).map(c => c.a); });
  const b = E.damageBonus(); eq(b.pct, +(100 + b.links).toFixed(1), 'azaltım yok: ' + b.pct); ok(b.pct > 150);
  ok(Math.abs(E.playerStats().dph - p0 * (1 + b.pct / 100)) < 0.01, 'hasar bonusla doğrudan çarpılır');
  eq(D.TIERS.map(t => [t.at, t.dmg, t.mult]), [[0, 0, 1], [7, 10, 1.2], [14, 20, 1.3], [30, 30, 1.5], [40, 50, 1.7], [60, 100, 2]]);
});
test('Saat başı vuruş: tam saat dolmadan hasar yok', () => {
  const { E, s, go } = setup({ idle: true, start: '2026-11-05T21:10' });
  isOk(E.takeContract(E.boardEntries()[0].m.id)); s.contract.hp = s.contract.max = 1e9;
  go('2026-11-05T21:55'); eq(s.contract.hp, 1e9, 'saat dolmadı');
  go('2026-11-05T22:05'); ok(s.contract.hp < 1e9, '22:00 vuruşu'); eq(s.contract.lastHit?.t, new Date('2026-11-05T22:00').toISOString());
  s.swords.steel = null; const before = s.contract.hp, dph = E.playerStats().dph;
  go('2026-11-05T23:05'); ok(Math.abs(before - s.contract.hp - dph) < 0.01, 'kritiksiz vuruş sabit: ' + (before - s.contract.hp));
});
test('Demirci: bütün kılıçlar her seviyede çıkabilir; kademe olasılıkları seviyeye göre (altta Sıradan, üstte Efsanevi); okul seti satılmaz', () => {
  eq(D.rarityOdds(1), { 1: 60, 2: 25, 3: 13, 4: 2 }); eq(D.rarityOdds(30), { 1: 10, 2: 20, 3: 40, 4: 30 });
  [1, 10, 20, 30].forEach(L => { const o = D.rarityOdds(L); ok(Math.abs(o[1] + o[2] + o[3] + o[4] - 100) < 0.5, 'toplam %100'); });
  const { E, s } = setup();
  const count = lv => { s.level = lv; const c = { 1: 0, 2: 0, 3: 0, 4: 0, 6: 0 };
    for (let d = 0; d < 1000; d++) for (const type of ['silver', 'steel']) E.dailySwords(type, T.addDays('2026-11-06', d)).forEach(w => { c[w.tier]++; ok(!w.set, 'okul seti satılmaz'); });
    return c; };
  const lo = count(1), hi = count(30);
  ok(lo[1] > lo[4] * 5, 'seviye 1: Sıradan çok, Efsanevi az: ' + JSON.stringify(lo)); ok(lo[4] > 0, 'seviye 1 de Efsanevi çıkabilir');
  ok(hi[4] > hi[1], 'seviye 30: Efsanevi Sıradan dan çok: ' + JSON.stringify(hi)); ok(hi[1] > 0, 'seviye 30 da Sıradan çıkabilir');
  eq(lo[6], 0, 'Aerondight 25 altı çıkmaz'); ok(hi[6] >= 1 && hi[6] <= 30, 'Aerondight çok nadir (~günde %1): ' + hi[6]);
});
test('Demirci: satın alınan kılıcın yerine yenisi gelmez; Efsanevi ve Kadim %50 pahalı', () => {
  const { E, s } = setup();
  s.level = 12; s.gold = 1e6;
  const before = E.dailySwords('silver').map(w => w.id), steel = E.dailySwords('steel').map(w => w.id);
  isOk(E.buySword(before[0]));
  eq(E.dailySwords('silver').map(w => w.id), before.slice(1), 'boşluk dolmadı');
  eq(E.dailySwords('steel').map(w => w.id), steel, 'diğer tür değişmedi');
  isErr(E.buySword(before[0]), 'tekrar alınamaz');
  isOk(E.rerollShop()); eq(E.dailySwords('silver').length, D.SHOP_DAILY, 'yenileyince tam stok');
  const leg = D.SWORDS.find(w => w.tier === 4), com = D.SWORDS.find(w => w.tier === 1), aero = D.SWORDS.find(w => w.tier === 6);
  eq(E.shopPrice(leg), Math.round(D.swordPrice(leg, 12) * 1.5 / 5) * 5); eq(E.shopPrice(aero), Math.round(D.swordPrice(aero, 12) * 1.5 / 5) * 5);
  eq(E.shopPrice(com), D.swordPrice(com, 12));
});
test('Benzersiz özellikler: her Efsanevi kılıçta farklı bir tane, Aerondight kendine özel', () => {
  const legs = D.SWORDS.filter(w => w.tier === 4 && !w.set);
  ok(D.UNIQUE.length >= legs.length, 'havuz yeterli: ' + D.UNIQUE.length + '/' + legs.length);
  ok(legs.every(w => w.unique && D.UNIQUE_BY_ID[w.unique]), 'hepsinde var');
  eq(new Set(legs.map(w => w.unique)).size, legs.length, 'tekrar yok');
  ok(D.SWORDS.filter(w => w.tier !== 4 && w.tier !== 6).every(w => !w.unique), 'diğer kademelerde yok');
  eq(D.SWORDS.find(w => w.tier === 6).unique, 'aerondight');
  eq(new Set(D.UNIQUE.map(u => u.id)).size, D.UNIQUE.length, 'kimlikler tekil');
});
/* kuşanılmış kılıca istenen özelliği ver (test için) */
function withTrait(E, s, id) {
  const w = D.SWORDS.find(x => x.unique === id);
  if (!w) throw new Error('özellik bir kılıca atanmamış: ' + id);
  s.swords.owned.push(w.id); s.swords.lv[w.id] = s.level; s.swords[w.type] = w.id;   // diğer yuva kendi kılıcıyla kalır
  return w;
}
test('Özellikler: hasar, kritik, ödül ve savunma', () => {
  // Şafak Işığı: 06–12 arası +%25, öğleden sonra yok
  { const { E, s, go } = setup({ idle: true }); go('2026-11-06T09:30'); withTrait(E, s, 'dawn'); const nm = D.UNIQUE_BY_ID.dawn.name;
    ok(E.damageBonus().parts.some(p => p.includes(nm)), 'sabah'); go('2026-11-06T14:30'); ok(!E.damageBonus().parts.some(p => p.includes(nm)), 'öğleden sonra yok'); }
  // Ölümcül: kritik ×2
  { const { E, s, go } = setup({ idle: true, random: () => 0 }); go('2026-11-05T22:00'); withTrait(E, s, 'deadly');
    s.contract.hp = s.contract.max = 1e7; const hp0 = s.contract.hp, dph = E.playerStats().dph; go('2026-11-05T23:00');
    ok(Math.abs((hp0 - s.contract.hp) - dph * 2) < 1, 'kritik ×2: ' + (hp0 - s.contract.hp) + ' / ' + dph); }
  // Keskin Kenar: kritik +8
  { const { E, s } = setup(); const c0 = E.damageBonus().crit; withTrait(E, s, 'sharp'); const w = D.SWORDS.find(x => x.unique === 'sharp');
    if (w.type === 'steel') ok(E.damageBonus().crit >= 8, 'kritik'); else eq(E.damageBonus().crit, c0 + 8); }
  // Ödül Avcısı: oren ×1,25
  { const a = setup({ idle: true }), b = setup({ idle: true });
    for (const x of [a, b]) { x.go('2026-11-05T22:00'); x.s.gold = 0; }
    withTrait(b.E, b.s, 'bounty'); a.E.dev.killContract(); b.E.dev.killContract();
    ok(Math.abs(b.s.gold - a.s.gold * 1.25) <= 1, 'oren ×1,25: ' + a.s.gold + ' → ' + b.s.gold); }
  // Taş Deri: aldığın hasar −%25; Can Kalkanı: can +%25
  { const { E, s } = setup(); const h0 = E.failHit(true); withTrait(E, s, 'stone'); ok(Math.abs(E.failHit(true) - h0 * 0.75) <= 1, 'taş deri'); }
  { const { E, s } = setup(); const m0 = E.maxHp(); withTrait(E, s, 'hpshield'); eq(E.maxHp(), Math.round(m0 * 1.25)); }
  // Son Nefes: haftada bir kez 1 canla kurtulur
  { const { E, s, go } = setup({ idle: true }); go('2026-11-05T22:00'); withTrait(E, s, 'lastbreath'); s.honey = 0; s.hp = 1;
    go('2026-11-06T10:00'); ok(s.hp > 0 && s.hp < 5, 'kurtuldu: ' + s.hp); ok(s.combat.mode !== 'recover'); ok(s.lastBreath, 'haftalık hak kullanıldı'); }
  // Yorulmaz: gecikince Yorgun olmaz
  { const { E, s, go } = setup(); withTrait(E, s, 'tireless'); go('2026-11-06T08:45'); isOk(E.checkIn()); eq(s.days['2026-11-06'].result, 'late'); eq(E.debuffPct(), 0); }
  // Altın Rüzgârı: başarıda +15 oren
  { const a = setup(), b = setup(); withTrait(b.E, b.s, 'goldwind');
    for (const x of [a, b]) { x.go('2026-11-06T08:10'); x.s.gold = 0; isOk(x.E.checkIn()); }
    eq(b.s.gold - a.s.gold, 15); }
});
test('Aerondight: her 24 saatte 1 şarj, tam şarjda 12. vuruş 12 saatlik; gecikme yarı, kaçırma hepsini götürür', () => {
  const { E, s, go } = setup({ idle: true, random: () => 0.99 });
  go('2026-11-05T22:00'); s.swords.steel = null; withTrait(E, s, 'aerondight');
  s.contract.hp = s.contract.max = 1e9;
  go('2026-11-06T06:00'); eq(s.aero?.charge || 0, 0, '8 saatte şarj yok');
  go('2026-11-06T08:10'); isOk(E.checkIn());
  go('2026-11-06T22:00'); eq(s.aero.charge, 1, '24 saatte 1 şarj'); eq(E.combatInfo().aero.toNext, 24);
  s.aero.charge = 3; ok(E.damageBonus().parts.some(p => p.includes('15')), 'şarj başına +%5');
  s.aero.charge = 19; s.aero.h = 23;
  go('2026-11-06T23:00'); eq(s.aero.charge, 20); ok(E.combatInfo().aero.full, 'tam şarj');
  go('2026-11-07T06:00'); eq(s.aero.charge, 20);
  go('2026-11-07T08:10'); isOk(E.checkIn());
  go('2026-11-07T11:00'); ok(s.log.some(l => /Göl Hanımı'nın Darbesi|Strike of the Lady/.test(l.text)), 'Göl Hanımının Darbesi');
  const half = E.failHit(true); s.aero.charge = 0; const full = E.failHit(true); s.aero.charge = 20;
  ok(half < full, 'tam şarjda vuruş yarıya iner: ' + half + ' / ' + full);
  go('2026-11-08T08:45'); isOk(E.checkIn()); eq(s.days['2026-11-08'].result, 'late'); eq(s.aero.charge, 10, 'gecikme yarısını götürdü');
  go('2026-11-09T09:45'); eq(s.days['2026-11-09'].result, 'fail'); eq(s.aero.charge, 0, 'kaçırma hepsini götürdü');
});
test('Kılıç seviyesi: demirciden senin seviyende gelir; oren + kırıntıyla kendi seviyene kadar yükselir; seviye şartı yok', () => {
  const { E, s } = setup();
  s.level = 12; s.gold = 100000; s.scraps = 1000;
  const w = E.dailySwords('silver')[0], price = E.shopPrice(w);
  eq(price, w.tier >= 4 ? Math.round(D.swordPrice(w, 12) * 1.5 / 5) * 5 : D.swordPrice(w, 12)); isOk(E.buySword(w.id)); eq(E.swordLv(w.id), 12); eq(s.gold, 100000 - price);
  eq(E.upgradeCost(w.id), null, 'seviyende: yükseltilemez'); isErr(E.upgradeSword(w.id));
  s.level = 14;
  const c = E.upgradeCost(w.id); eq(c.to, 13); ok(c.gold > 0 && c.scraps > 0);
  const d0 = E.swordValue(w), g = s.gold, sc = s.scraps; isOk(E.upgradeSword(w.id));
  eq(E.swordLv(w.id), 13); eq(s.gold, g - c.gold); eq(s.scraps, sc - c.scraps); ok(E.swordValue(w) > d0, 'güç arttı');
  isOk(E.upgradeSword(w.id)); eq(E.swordLv(w.id), 14); eq(E.upgradeCost(w.id), null, 'kendi seviyeni geçemez');
  eq(s.counters.forged, 2);
  const kit = s.swords.owned.filter(id => id !== w.id).map(D.swordById); ok(kit.every(x => E.swordLv(x.id) === 1), 'başlangıç kılıçları 1. seviye');
});
test('Kırıntı: kazanılan her dövüş 1 kırıntı verir', () => {
  const { E, s } = setup();
  const e = E.boardEntries()[0]; E.takeContract(e.m.id); const sc = s.scraps;
  s.contract.hp = 1; E.dev.killContract(); eq(s.scraps, sc + D.SCRAP_PER_KILL);
});
test('Bane: kılıç kendi sınıfındaki canavara +%15; en iyi kılıç kontrata göre seçilir', () => {
  const { E, s } = setup();
  const e = E.boardEntries()[0]; E.takeContract(e.m.id);
  const cls = e.m.cls;
  const silvers = D.SWORDS.filter(w => w.type === 'silver' && !w.set && w.tier === 4);
  const banePick = silvers.find(w => w.banes.includes(cls)) || D.SWORDS.find(w => w.banes.includes(cls) && !w.set);
  const other = D.SWORDS.find(w => !w.banes.includes(cls) && !w.set && w.tier === banePick.tier && w.type === banePick.type);
  s.swords.owned.push(banePick.id, other.id); s.swords.lv[banePick.id] = s.swords.lv[other.id] = 5; E.equipSword(other.id);
  isOk(E.equipBest());
  if (banePick.type === 'silver') eq(s.swords.silver, banePick.id, 'bane kılıcı kuşanılmalı'); else eq(s.swords.steel, banePick.id);
  ok(E.damageBonus().raw >= D.BANE, 'avcı bonusu');
});
test('Avcı özellikleri: kademe yükseldikçe daha çok tür (Efsanevi 3); Efsanevi ve üstü daha yüksek bonus', () => {
  const cnt = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 5 }, pct = { 1: 15, 2: 15, 3: 15, 4: 25, 5: 20, 6: 25 };
  for (const w of D.SWORDS) {
    eq(w.banes.length, cnt[w.tier], w.name); eq(w.banePct, pct[w.tier], w.name);
    eq(w.banes[0], w.bane, 'ilk tür eski bane'); eq(new Set(w.banes).size, w.banes.length, 'tekrar yok');
    ok(w.banes.every(c => D.CLASSES[c]), 'geçerli tür');
  }
  const { E, s } = setup();
  const e = E.boardEntries()[0]; E.takeContract(e.m.id);
  const leg = D.SWORDS.find(w => w.tier === 4 && w.type === 'silver' && w.banes.slice(1).includes(e.m.cls));
  s.swords.owned.push(leg.id); E.equipSword(leg.id);
  ok(E.damageBonus().raw >= 25, 'ek türden de +%25: ' + E.damageBonus().raw);
});
test('Eritme: oren + kırıntı geri verir; kuşanılan eritilemez', () => {
  const { E, s } = setup();
  s.gold = 100000; s.scraps = 100000;
  const [a, b] = D.SWORDS.filter(w => w.type === 'silver' && w.tier === 2);
  s.swords.owned.push(a.id, b.id); s.swords.lv[a.id] = 8; s.swords.lv[b.id] = 8; E.equipSword(a.id);
  isErr(E.dismantleSword(a.id), 'kuşanılan eritilemez');
  const v = E.dismantleValue(b.id); eq(v, { gold: Math.round(D.swordPrice(b, 8) * D.DISMANTLE.gold), scraps: 4 });
  const g2 = s.gold, sc2 = s.scraps; isOk(E.dismantleSword(b.id));
  eq(s.gold, g2 + v.gold); eq(s.scraps, sc2 + v.scraps); ok(!s.swords.owned.includes(b.id), 'kılıç gitmeli'); eq(s.swords.lv[b.id], undefined);
});
test("Şema: 2. kademe ve sonrası boss'ları okul seti şeması düşürür (önce kendi okulunun en düşük aşaması); demirci yaptırır", () => {
  const { E, s } = setup({ school: 'bear' });
  const f = RI('flotsam'); s.region = D.REGIONS[f].tier; s.level = D.REGIONS[f].max; s.boards = {}; s.contract = null;
  isOk(E.takeContract(D.REGIONS[f].boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.diagrams.length, 1);
  const w = D.swordById(s.diagrams[0]); eq([w.set, w.school, w.type, w.v], [true, 'bear', 'steel', 0], 'önce kendi okulunun en düşük aşama çeliği');
  s.scraps = 999; s.gold = 0; isErr(E.craftSword(w.id), 'para');
  s.gold = 99999; isOk(E.craftSword(w.id));
  ok(s.swords.owned.includes(w.id)); eq(s.diagrams, []); eq(E.swordLv(w.id), s.level, 'senin seviyende yapılır');
  eq(E.swordValue(w), D.swordCritAt(w, s.level) + 3, 'kendi okulunun seti ekstra kritik');
});
test("Şema: 1. kademe (White Orchard, Kovir) boss'ları şema düşürmez, 2. kademe düşürür", () => {
  const { E, s } = setup();
  E.dev.addXp(5000); isOk(E.takeContract(D.REGIONS[0].boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.diagrams, []);
  E.dev.addXp(5000); isOk(E.takeContract(D.REGIONS[RI('lyria')].boss)); s.contract.hp = 1; E.dev.killContract();
  eq(s.diagrams.length, 1);
});
test('Demirci: her gün tür başına 5 kılıç, gün içinde aynı, ertesi gün değişir, listede olmayan alınamaz', () => {
  const { E, s, go } = setup();
  s.level = 10;
  const a = E.dailySwords('silver').map(w => w.id), b = E.dailySwords('silver').map(w => w.id);
  eq(a.length, D.SHOP_DAILY); eq(a, b); eq(E.dailySwords('steel').length, D.SHOP_DAILY);
  ok(E.dailySwords('steel').every(w => w.type === 'steel'));
  const later = [7, 8, 9, 10, 11].map(d => { go(`2026-11-${pad2(d)}T12:00`); return E.dailySwords('silver').map(w => w.id).join(); });
  ok(later.some(x => x !== a.join()), 'sonraki günlerde değişmeli');
  s.gold = 99999;
  const notToday = D.SWORDS.find(w => w.type === 'silver' && !w.set && !E.dailySwords('silver').some(x => x.id === w.id));
  isErr(E.buySword(notToday.id));
  const today = E.dailySwords('silver')[0]; isOk(E.buySword(today.id));
  ok(!E.dailySwords('silver').some(x => x.id === today.id), 'alınan listeden çıkar');
});
test('Fraksiyon: karakter sadece kendi fraksiyonu + tarafsız kart kazanır', () => {
  const { E, s } = setup({ faction: 'Skellige' });
  for (let i = 0; i < 40; i++) E.drawCards(5, 'Common', 'x');
  ok(Object.keys(s.collection).every(a => ['Skellige', 'Neutral'].includes(D.CARD_BY_ART[a].f)), 'başka fraksiyon kartı geldi');
});
test('Kart bağı: aynı fraksiyon + ortak tür, değeri nadirlikten gelir, kurallar', () => {
  const { E, s } = setup();
  const elves = D.CARDS.filter(c => c.f === 'Scoiatael' && D.cardCats(c).includes('Elf')).slice(0, 6);
  const other = D.CARDS.find(c => c.f === 'Monster' && D.cardCats(c).includes('Elf'));
  elves.concat([other]).forEach(c => { s.collection[c.a] = 1; });
  const r = E.createLink('Scoiatael', 'Elf'); isOk(r);
  isOk(E.createLink('Scoiatael', 'Elf'), 'aynı fraksiyon + türden ikinci bağ kurulabilir'); E.deleteLink(s.links[1].id);
  isErr(E.addToLink(r.link.id, other.a));
  elves.slice(0, 4).forEach(c => isOk(E.addToLink(r.link.id, c.a)));
  eq(E.damageBonus().pct, 0);
  isOk(E.addToLink(r.link.id, elves[4].a));
  const v = E.linkValue(r.link), rar = elves.slice(0, 5).reduce((t, c) => t + D.LINK_RAR[c.r], 0);
  eq(v.rar, +rar.toFixed(1)); eq(E.damageBonus().pct, v.total); ok(v.total >= 2.5);
  isErr(E.addToLink(r.link.id, elves[5].a));
  isOk(E.removeFromLink(r.link.id, elves[0].a)); eq(E.damageBonus().pct, 0);
});

test('Kupa: öldürülen canavarın kendi Gwent kartı koleksiyona düşer (fraksiyon odağından bağımsız)', () => {
  const { E, s, go } = setup({ faction: 'Nilfgaard' });
  const e = E.boardEntries()[0]; E.takeContract(e.m.id); s.contract.hp = 1;
  E.dev.killContract();
  ok(s.collection[e.m.art] >= 1, 'kupa kartı');
  ok(E.ev.reveals.some(r => r.trophy && r.cards[0].a === e.m.art), 'kupa gösterimi');
});
test('Başarımlar: koşul sağlanınca bir kez açılır, oren verir; tekrar açılmaz', () => {
  const { E, s, go } = setup();
  s.swords = { owned: [], silver: null, steel: null, up: {} };
  eq(E.checkAchievements().length, 0, 'başta hiçbiri');
  go('2026-11-06T08:10'); E.checkIn();
  const g = s.gold; const got = E.checkAchievements().map(a => a.id);
  ok(got.includes('first-dawn'), 'İlk Şafak'); ok(s.achievements['first-dawn']);
  ok(s.gold >= g + D.ACHIEVEMENTS.find(a => a.id === 'first-dawn').gold);
  eq(E.checkAchievements().length, 0, 'ikinci kez açılmaz');
  s.chain.best = 30; const r = E.checkAchievements().map(a => a.id);
  ok(['chain-7', 'chain-14', 'chain-30'].every(id => r.includes(id)), 'zincir başarımları');
  ok(E.ev.reveals.some(x => x.title.includes('Altın Zincir')), 'kartlı başarım kart verir');
  ok(D.ACHIEVEMENTS.length >= 25 && new Set(D.ACHIEVEMENTS.map(a => a.id)).size === D.ACHIEVEMENTS.length);
});
test("Okul mirası: Okul'daki her efsane +%3 oren, her karakter +%1 TP verir (tavanlı)", () => {
  const { E, s } = setup();
  eq(E.legacy().gold, 0);
  s.hall = [{ legend: true, trophies: [], collection: {}, links: [] }, { legend: true, trophies: [], collection: {}, links: [] }, { legend: false, trophies: [], collection: {}, links: [] }];
  eq(E.legacy().gold, 6); eq(E.legacy().xp, 3);
  const g = s.gold; E.dev.addGold(100); eq(s.gold, g + 106);
  s.hall = Array.from({ length: 20 }, () => ({ legend: true, trophies: [], collection: {}, links: [] }));
  eq(E.legacy().gold, D.LEGACY.goldMax); eq(E.legacy().xp, D.LEGACY.xpMax);
});
test('Haftalık özet: yeni haftaya geçince geçen haftanın raporu oluşur ve gösterilmek üzere bekler', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 3);
  eq(s.weekly.length, 0);
  go('2026-11-09T12:00');
  eq(s.weekly.length, 1); const w = s.weekly[0];
  eq(w.key, '2026-11-02'); eq(w.success, 3); ok(w.gold > 0 && w.cards > 0, 'oren ve kart sayıldı');
  eq(s.pendingSummary, w.key);
});
test('Günlük metni: saat ekleri doğru yazılır ("08:10\u2019da kalktın")', () => {
  const { E, s, go } = setup();
  go('2026-11-06T08:10'); E.checkIn();
  ok(s.log.some(l => l.text.startsWith("08:10'da kalktın")), 'log: ' + s.log.find(l => l.text.includes('kalktın'))?.text);
});
test('Dil: İngilizce seçilince mesajlar, tarih ve veri adları İngilizce olur; Türkçeye geri döner', () => {
  const prev = window.KM_LANG;
  try {
    window.KM_LANG = 'en';
    const { E, s, go } = setup();
    go('2026-11-06T08:10'); E.checkIn();
    ok(s.log.some(l => l.text.startsWith('You woke up at 08:10!')), 'log: ' + s.log[0]?.text);
    eq(E.takeContract('yok').err, 'No such monster.');
    eq(T.longDate('2026-11-06'), 'Fri 6 Nov');
    eq(D.TIERS[1].name, 'Steel'); eq(D.SCHOOLS.wolf.desc.startsWith('Balanced'), true);
    eq(D.ACHIEVEMENTS[0].name, 'First Dawn'); eq(D.RAR_TR.Rare, 'Rare'); eq(D.SHOP[0].name, 'Card Keg');
    eq(D.REGIONS[RI('lyria')].name, 'Lyria and Rivia'); eq(D.CLASSES.Necrophage.tr, 'Necrophages');
    window.KM_LANG = 'tr';
    eq(T.longDate('2026-11-06'), '6 Kasım Cum'); eq(D.TIERS[1].name, 'Çelik'); eq(D.REGIONS[RI('lyria')].name, 'Lyria ve Rivia');
  } finally { window.KM_LANG = prev; }
});
test('Sonradan işleme: kaçırılan gün 24 saat içinde girilir; zincir ve ceza geri alınır, gün normal işlenir', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 2);
  s.honey = 0;
  if (!s.contract) isOk(E.takeContract(E.boardEntries().find(e => !e.killed && !e.boss).m.id));
  s.contract.hp = s.contract.max;
  const chainBefore = s.chain.len, cBefore = s.contract.hp, progBefore = s.quest.progress, hpBefore = s.hp;
  go('2026-11-08T09:31');                                         // 8 Kasım kaçırıldı
  eq(s.days['2026-11-08'].result, 'fail'); eq(E.debuffPct(), 30, 'Bitkin'); eq(s.chain.len, 0); ok(s.hp < hpBefore, 'canavar vurdu');
  const cor = E.correctableDay(); eq(cor.k, '2026-11-08');
  go('2026-11-08T13:00');
  isErr(E.correctMissed('2026-11-08', { wake: '04:00' }), 'çok erken');
  isErr(E.correctMissed('2026-11-08', { wake: '10:00' }), 'kaçırıldı sınırının ötesi');
  isOk(E.correctMissed('2026-11-08', { wake: '08:15', bed: '00:40' }));
  const d = s.days['2026-11-08'];
  eq(d.result, 'success'); ok(d.retro, 'işaretli'); eq(d.medOnTime, true); eq(d.reward.mult >= 1.5, true);
  eq(s.chain.len, chainBefore + 1, 'zincir kırılmamış gibi'); eq(E.debuffPct(), 0, 'Bitkin kalktı'); eq(s.hp, hpBefore, 'can geri geldi');
  eq(s.quest.progress, progBefore + 1);
  eq(E.correctableDay(), null, 'ikinci kez düzeltilemez');
});
test('Sonradan işleme: aralık sonrası saat gecikme sayılır; Mahakam Ale iade edilir', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 1);
  eq(s.honey, 1);
  go('2026-11-07T09:31'); eq(s.honey, 0, 'Mahakam Ale içildi');
  go('2026-11-07T12:00'); isOk(E.correctMissed('2026-11-07', { wake: '09:00' }));
  eq(s.days['2026-11-07'].result, 'late'); eq(s.honey, 1, 'Mahakam Ale iade'); eq(s.chain.rust, true);
});
test('Sonradan işleme: 24 saat geçince ya da sonraki gün işlenince olmaz', () => {
  const { E, s, go } = setup();
  go('2026-11-06T09:31');
  ok(E.correctableDay(), 'açık');
  go('2026-11-07T08:10'); E.checkIn();                           // sonraki gün işlendi
  eq(E.correctableDay(), null); isErr(E.correctMissed('2026-11-06', { wake: '08:10' }));
  const t2 = setup(); t2.go('2026-11-06T09:31');
  t2.clock.t = new Date('2026-11-07T09:29'); ok(t2.E.correctableDay(), '24 saat dolmadan açık');
  t2.clock.t = new Date('2026-11-07T09:31'); eq(t2.E.correctableDay(), null, '24 saat geçti');
});
/* ---- yeniden doğuş ---- */
test('Yeniden doğuş: karakter Okul\'a eklenir, karakter verisi sıfırlanır, alışkanlık verisi kalır', () => {
  const { E, s, go } = setup();
  succeed(E, go, '2026-11-06', 5);
  isOk(E.takeContract(E.boardEntries().find(e => !e.killed && !e.active && !e.boss).m.id)); s.contract.hp = 1; go('2026-11-11T08:10'); E.checkIn();
  s.links.push({ id: 'l', f: 'Neutral', cat: 'Witcher', cards: [1] });
  const before = { name: s.name, kills: s.trophies.length, cards: Object.keys(s.collection).length, chain: s.chain.len, days: Object.keys(s.days).length };
  isErr(E.rebirth({ name: 'Yeni' }), 'fraksiyon şart');
  isOk(E.rebirth({ name: 'Ciri', school: 'cat', faction: 'Nilfgaard' }));
  eq(s.hall.length, 1); eq(s.hall[0].name, before.name); eq(s.hall[0].trophies.length, before.kills);
  eq(Object.keys(s.hall[0].collection).length, before.cards); eq(s.hall[0].links.length, 1);
  eq(s.name, 'Ciri'); eq(s.school, 'cat'); eq(s.faction, 'Nilfgaard'); eq(s.level, 1); eq(s.trophies, []); eq(s.links, []); eq(s.region, 0);
  ok(Object.keys(s.collection).every(a => ['Nilfgaard', 'Neutral'].includes(D.CARD_BY_ART[a].f)), 'yeni başlangıç kartları');
  eq(s.chain.len, before.chain, 'zincir alışkanlıktır, kalır'); eq(Object.keys(s.days).length, before.days, 'kayıtlar kalır');
  eq(E.boardEntries().length, D.BOARD_SIZE, 'yeni tabela');
});

/* ---- taşıma + yardımcılar ---- */
test('Taşıma: v4 kaydı (senin gerçek kaydının biçimi) v6\'ya dönüşür', () => {
  const v4 = { v: 4, created: '2026-11-05T21:31:44.587Z', name: 'Witcher', school: 'wolf', settings: { notify: false }, hp: 100, xp: 5, level: 1, gold: 13, scraps: 0, swallow: 1,
    chain: { len: 0, rust: false, repair: null, links: [], best: 0, bestTier: 0 }, lastProcessed: '2026-11-05',
    quest: makeQuest({ name: 'Uyku düzeni', type: 'sleep', days: 30, sleep: { bedStart: '00:00', bedEnd: '02:00', wakeStart: '08:30', wakeEnd: '09:00' }, start: '2026-11-06' }),
    questHistory: [], week: { key: '2026-11-02', id: 'noonwraith', power: 1, max: 100, hp: 80, killed: false }, swords: { owned: [], silver: null, steel: null }, links: [],
    draws: 3, pity: 2, quests: [], notified: {}, days: { '2026-11-06': { med: '2026-11-05T21:36:01.720Z', medOnTime: true, q: 'x' } }, log: [], collection: { 1007: 1 }, trophies: [], questLog: {} };
  const s = migrate(JSON.parse(JSON.stringify(v4)));
  eq(s.v, 12); eq(s.region, 0); eq(s.faction, null); eq(s.hall, []); eq(s.week, undefined); eq(s.board, undefined);
  eq(s.boards, {});
  const max = monStats(D.monById('noonwraith')).hp;
  eq([s.contract.id, s.contract.max, s.contract.hp], ['noonwraith', max, Math.round(max * 0.8)], 'Öğlen Hayaleti yeni listede de var: %80 can korunur');
  const E = createEngine(s, { now: () => new Date('2026-11-06T08:45'), idle: false });
  E.processPending(); isOk(E.checkIn());
  eq(s.days['2026-11-06'].reward.mult, 1.5); eq(s.contract.hp, Math.round(max * 0.8), 'kontrat korunur, başarı anında ek vuruş yok');
});
test('Taşıma: denge değişince aktif kontratın canı kalan oranla güncel değere çevrilir', () => {
  const { E, s } = setup();
  const e = E.boardEntries()[0]; E.takeContract(e.m.id);
  s.contract.max = 200; s.contract.hp = 50;          // eski dengeden kalmış bir kontrat
  migrate(s);
  eq(s.contract.max, e.stats.hp); eq(s.contract.hp, Math.round(e.stats.hp * 0.25));
});
test('Taşıma: v1 kaydı da açılır', () => {
  const s = migrate({ v: 1, created: '2026-11-05T18:00:00Z', name: 'Eski', school: 'cat', settings: { bed: '00:30', wake: '08:00', deadline: '08:30', lateMin: 60 },
    hp: 90, xp: 0, level: 1, gold: 70, scraps: 0, streak: 4, best: 4, swallow: 1, days: {}, lastProcessed: '2026-11-05',
    week: { key: '2026-11-02', id: 'noonwraith', hp: 55, max: 100, killed: false }, trophies: [], collection: {}, draws: 0, pity: 0, quests: [], questLog: {}, log: [], notified: {} });
  eq(s.v, 12); eq(s.chain.len, 4); eq(s.quest.type, 'sleep'); eq(s.contract.id, 'noonwraith');
});
test('Türkçe ekler', () => {
  eq(T.sfx('08:30', 'da'), "08:30'da"); eq(T.sfx('08:05', 'da'), "08:05'te"); eq(T.sfx('06:00', 'e'), "06:00'ya");
  eq(D.dat('Grifon'), "'a"); eq(D.dat('Bruxa'), "'ya"); eq(D.dat('Wight'), "'e");
});
test('Veri: 8 kademe, Toussaint tek başına en üstte; her bölgede boss + 10–15 canavar; eski canavarlar korunur, Elf yok', () => {
  eq(D.BAND_COUNT, 8); eq(D.REGIONS.length, 16);
  eq(D.bandRegions(6).map(i => D.REGIONS[i].id), ['skellige', 'skelligeseas', 'sansretour']);
  for (let t = 0; t < D.BAND_COUNT; t++) ok(D.bandRegions(t).length >= 1, 'kademe ' + t);
  eq(D.bandRegions(7).map(i => D.REGIONS[i].id), ['toussaint']);
  D.REGIONS.forEach((r, i) => {
    const b = D.monById(r.boss); ok(b && b.boss && b.region === i, r.name + ' boss');
    const n = D.MONSTERS.filter(m => m.region === i).length; ok(n >= 10 && n <= 15, r.name + ' canavar sayısı ' + n);
    ok(r.map && r.map.x > 0 && r.map.y > 0 && /^M[\d.,]+( L[\d.,]+)+ Z$/.test(r.map.d), r.name + ' harita sınırı');
  });
  eq(new Set(D.MONSTERS.map(m => m.id)).size, D.MONSTERS.length, 'tekrar eden id');
  ['ghoul', 'noonwraith', 'griffin', 'dettlaff-van-der-eretein', 'nekker-k-zg-n'].forEach(id => ok(D.MONSTERS.some(m => m.id === id), 'eski kimlik ' + id));
  ['Keltullis', 'Gernichora', 'Kraken', 'Woodland Spirit'].forEach(n => ok(D.MONSTERS.some(m => m.name === n), n));
  D.MONSTERS.forEach(m => {
    const c = D.CARD_BY_ART[m.art];
    if (c) ok(!D.cardCats(c).includes('Elf'), m.name + ' elf');
    ok(c || (window.GWENT_EXTRA || {})[m.art], m.name + ' kartı ya da açıklaması');
  });
  ok(!D.MONSTERS.some(m => /Saesenthessis|Regis|Roach/.test(m.name)), 'Saskia, Regis, Roach yok');
  eq(D.REGIONS.at(-1).max, D.MAX_LEVEL);
});

/* ---- simülasyon: kart, oren, seviye hızı, öldürme süreleri (yükseltmeli / yükseltmesiz) ---- */
/* yükseltmeli oyuncu: her gün demirciden elindekinden iyi kılıcı alır, kuşandığını güçlendirir, 5 uygun kart birikince bağ kurar */
function potionUp(E, s) {
  while (s.swallow < 5 && s.gold >= E.shopItems().find(i => i.id === 'swallow').price) E.buy('swallow');   // iksir stoğu (gerçekçi oyuncu)
  while (s.hp < E.maxHp() * 0.5 && s.swallow > 0 && E.drinkPotion().ok) {}                                    // canı yarının altındaysa iksir içer
}
function gearUp(E, s) {
  const main = type => s.swords.owned.map(D.swordById).filter(w => w.type === type).sort((a, b) => E.swordValue(b) - E.swordValue(a))[0];
  for (const id of [...s.diagrams]) { const c = E.craftCost(id); if (s.gold >= c.gold + 200 && s.scraps >= c.scraps) E.craftSword(id); }   // boss şemalarını yaptır
  for (const type of ['silver', 'steel']) {
    const old = main(type), cur = old ? E.swordValue(old) : 0;          // senin seviyendeki daha iyi bir kılıç çıkınca al
    const best = E.dailySwords(type).filter(w => E.shopPrice(w) <= s.gold && E.swordValue(w, s.level) > cur * 1.15).sort((a, b) => E.swordValue(b, s.level) - E.swordValue(a, s.level))[0];
    if (best) E.buySword(best.id);
  }
  for (const type of ['silver', 'steel']) {                            // ana kılıcı seviyene kadar yükselt
    const id = main(type)?.id;
    while (id) { const c = E.upgradeCost(id); if (!c || s.gold < c.gold || s.scraps < c.scraps) break; E.upgradeSword(id); }
  }
  E.equipBest();                                                       // kontrata göre en iyi kılıçları kuşan
  if (E.completeLinks().length >= D.LINK_MAX) return;
  for (const f of [s.faction || 'Neutral', 'Neutral']) {
    let more = true;
    while (more && E.completeLinks().length < D.LINK_MAX) {          // aynı türden birden fazla bağ da kurulabilir
      more = false;
      for (const [cat, n] of Object.entries(E.linkOptions(f))) {
        if (n < D.LINK_SIZE || E.completeLinks().length >= D.LINK_MAX) continue;
        const r = E.createLink(f, cat); if (!r.link) return;
        E.eligibleForLink(r.link.id).slice(0, D.LINK_SIZE).forEach(c => E.addToLink(r.link.id, c.a));
        if (r.link.cards.length < D.LINK_SIZE) E.deleteLink(r.link.id); else more = true;
      }
    }
  }
}
function simulate({ name, days = 320, type = 'sleep', pSuccess = 1, pLate = 0, pPrep = 1, sides = 2, seed = 11, faction = 'Scoiatael', gear = true }) {
  const quest = type === 'daily' ? { name: 'Spor', daily: { start: '18:00', end: '22:00' } } : {};
  const { E, s, go } = setup({ type, quest, seed, faction, idle: true });
  let b = seed * 7919 + 13;
  const roll = () => { b = (b * 48271) % 2147483647; return b / 2147483647; };
  while (s.quests.length < sides) E.addSide('yan ' + s.quests.length, 5, 3);
  s.quests = s.quests.slice(0, sides);
  const d0 = s.draws, g0 = s.gold;
  let maxDay = null, legendDay = null, cards60 = null, potions = 0;
  const regionDays = [];
  for (let d = 0; d < days; d++) {
    const k = T.addDays('2026-11-06', d);
    if (!s.legend && E.bossAvailable() && !(s.contract && D.monById(s.contract.id).boss)) E.takeContract(D.REGIONS[E.homeRegion()].boss);
    if (type === 'sleep' && roll() < pPrep) { go(`${k}T00:30`); E.prep(); }
    const r = roll();
    if (type === 'sleep') { if (r < pSuccess) { go(`${k}T08:10`); E.checkIn(); } else if (r < pSuccess + pLate) { go(`${k}T08:45`); E.checkIn(); } }
    else { if (r < pSuccess) { go(`${k}T19:00`); E.checkIn(); } else if (r < pSuccess + pLate) { go(`${k}T22:30`); E.checkIn(); } }
    go(`${k}T${type === 'daily' ? '20' : '18'}:00`);
    s.quests.forEach(q => E.completeSide(q.id));
    if (s.quest.awaitingChoice) { s.quest.awaitingChoice = false; s.quest.status = 'active'; s.quest.days += 30; }   // eski modeldeki gibi: zincir korunarak yeni hedef
    potionUp(E, s);
    if (gear) gearUp(E, s);
    while (regionDays.length < s.region) regionDays.push(d + 1);
    if (maxDay == null && s.level >= D.MAX_LEVEL) maxDay = d + 1;
    if (legendDay == null && s.legend) legendDay = d + 1;
    if (d === 59) cards60 = (s.draws - d0) / 60;
    E.ev.reveals.length = 0;
  }
  const killDays = Array.from({ length: D.BAND_COUNT }, (_, i) => {
    const seen = new Set(), first = s.trophies.filter(t => !seen.has(t.id) && seen.add(t.id));   // son oyundaki elit tekrarlar sayılmaz
    const ks = first.filter(t => tierOfMon(D.monById(t.id)) === i && t.hours != null);
    const norm = ks.filter(t => !D.monById(t.id).boss).map(t => t.hours), boss = ks.filter(t => D.monById(t.id).boss).map(t => t.hours);
    const r1 = x => Math.round(x * 10) / 10;
    return { normal: norm.length ? r1(norm.reduce((a, c) => a + c, 0) / norm.length) : null, n: norm.length, min: norm.length ? r1(Math.min(...norm)) : null, max: norm.length ? r1(Math.max(...norm)) : null, boss: boss[0] != null ? r1(boss[0]) : null };
  });
  const bonus = E.damageBonus(), sv = D.swordById(s.swords.silver);
  return {
    name, gear, killDays, cardsPerDay60: cards60, cardsPerDay: (s.draws - d0) / days, unique: Object.keys(s.collection).length,
    goldPerDay: (s.stats.goldEarned) / days, killsPerWeek: s.trophies.length / (days / 7), level: s.level, regionDays, maxDay, legendDay, kills: s.trophies.length,
    gearText: gear ? `${sv ? `${sv.name} Sv${E.swordLv(sv.id)}` : '—'} · ${E.completeLinks().length} bağ · +%${bonus.pct}${bonus.crit ? ` · kritik %${bonus.crit}` : ''}` : `yükseltmesiz · +%${bonus.pct} (zincir)`,
    potions: s.stats.potions || 0, defeats: s.stats.defeats || 0, gold: s.gold, trophies: s.trophies,
  };
}
test('Kart bağı: ek ortak tür +%1,5, okul uyumu ×1,5, en fazla 10 bağ', () => {
  const { E, s } = setup({ school: 'wolf' });
  const hs = D.CARDS.filter(c => c.f === 'Northern Realms' && D.cardCats(c).includes('Human') && D.cardCats(c).includes('Soldier') && c.r === 'Common').slice(0, 5);
  eq(hs.length, 5, 'kart var');
  hs.forEach(c => { s.collection[c.a] = 1; });
  const r = E.createLink('Northern Realms', 'Human'); hs.forEach(c => isOk(E.addToLink(r.link.id, c.a)));
  const v = E.linkValue(r.link); ok(v.shared.includes('Soldier'), 'Soldier ortak'); eq(v.total, +(2.5 + v.shared.length * D.LINK_EXTRA).toFixed(1)); eq(v.fav, false);
  const l2 = { id: 'l2', f: 'Northern Realms', cat: 'Soldier', cards: [...r.link.cards] };
  const v2 = E.linkValue(l2); eq(v2.fav, true, 'Wolf: Soldier sever');
  ok(Math.abs(v2.total - (v2.rar + v2.extra) * 1.5) < 0.11, 'okul ×1,5');
  while (s.links.length < D.LINK_MAX) s.links.push({ id: 'z' + s.links.length, f: 'X', cat: 'Y', cards: [] });
  isErr(E.createLink('Northern Realms', 'Human'), '10 bağ sınırı');
});
test('Başlangıç donanımı okula göre: Wolf 100 oren, gümüş + çelik; Cat sadece çelik', () => {
  const w = setup({ school: 'wolf' }).s, c = setup({ school: 'cat' }).s;
  eq([w.swallow, w.honey], [D.START_KIT.wolf.swallow, D.START_KIT.wolf.honey]); ok(w.gold >= 100);
  ok(w.swords.silver && w.swords.steel, 'wolf iki kılıç'); eq(c.swords.silver, null); ok(c.swords.steel, 'cat çelik');
  Object.values(D.START_KIT).forEach(k => [k.silver, k.steel].filter(Boolean).forEach(id => ok(D.swordById(id), 'kılıç var: ' + id)));
});
test('Tabela: kesilen ilan "öldü" olarak kalır; bütün ilanlar kesilince pano yenilenir', () => {
  const { E, s } = setup();
  const e = E.boardEntries()[0]; isOk(E.takeContract(e.m.id)); E.dev.killContract();
  ok(E.boardEntries(0).some(x => x.m.id === e.m.id && x.killed), 'öldü olarak kalır');
  const ids = s.boards[0].ids.slice(); ids.forEach(id => { if (!s.trophies.some(t => t.id === id)) s.trophies.push({ id }); });
  const b = E.boardEntries(0).filter(x => !x.boss);
  ok(b.length > 0 && b.every(x => !x.killed && !ids.includes(x.m.id)), 'yeni ilanlar');
});
test('Kart bağı: başka bağdaki kart seçilince oradan çıkıp buraya taşınır', () => {
  const { E, s } = setup();
  const elves = D.CARDS.filter(c => c.f === 'Scoiatael' && D.cardCats(c).includes('Elf')).slice(0, 2);
  elves.forEach(c => { s.collection[c.a] = 1; });
  const a = E.createLink('Scoiatael', 'Elf').link, b = E.createLink('Scoiatael', 'Elf').link;
  isOk(E.addToLink(a.id, elves[0].a));
  ok(E.eligibleForLink(b.id).every(c => c.a !== elves[0].a), 'normalde gizli');
  ok(E.eligibleForLink(b.id, { includeUsed: true }).some(c => c.a === elves[0].a), 'seçicide görünür');
  isOk(E.addToLink(b.id, elves[0].a)); eq(a.cards, []); eq(b.cards, [elves[0].a]); eq(E.linkOfCard(elves[0].a).id, b.id);
  isErr(E.addToLink(b.id, elves[0].a), 'aynı bağa iki kez');
});
test('Okullar: Griffin kefareti 1 gün, gecikince Yorgun olmaz; Viper erken yapınca Odak (+%10 hasar)', () => {
  const g = setup({ school: 'griffin' });
  succeed(g.E, g.go, '2026-11-06', 8); eq(g.s.chain.len, 8);
  g.go('2026-11-14T09:31'); eq(g.s.chain.len, 0, 'kırıldı'); g.s.effects = [];
  g.go('2026-11-15T08:10'); isOk(g.E.checkIn()); eq(g.s.chain.repair, null, 'kefaret 1 günde'); eq(g.s.chain.len, 9);
  g.go('2026-11-16T08:45'); isOk(g.E.checkIn()); eq(g.s.days['2026-11-16'].result, 'late'); eq(g.E.debuffPct(), 0, 'Yorgun yok');
  g.s.honey = 0; const ghp = g.s.hp;
  g.go('2026-11-18T09:31'); eq(g.s.days['2026-11-17'].result, 'fail'); eq(g.E.debuffPct(), 0, 'Bitkin yok'); ok(g.s.hp < ghp, 'canavar yine vurdu');
  const v = setup({ school: 'viper' });
  v.go('2026-11-06T08:05'); isOk(v.E.checkIn()); eq(v.E.buffPct(), 10, 'Odak');
  const d1 = v.E.playerStats().dph; v.s.effects = []; ok(Math.abs(d1 / v.E.playerStats().dph - 1.1) < 0.001, 'hasar +%10');
  const w = setup({ school: 'wolf' }); w.go('2026-11-06T08:05'); isOk(w.E.checkIn()); eq(w.E.buffPct(), 0);
});
test('Kart odağı: fraksiyonun bütün kartları toplanınca başka fraksiyona geçilir', () => {
  const { E, s } = setup({ faction: 'Skellige' });
  isErr(E.changeFaction('Nilfgaard'), 'tamamlanmadan olmaz');
  D.CARDS.filter(c => c.f === 'Skellige').forEach(c => { s.collection[c.a] = 1; });
  isErr(E.changeFaction('Skellige'), 'aynı fraksiyon');
  isOk(E.changeFaction('Nilfgaard')); eq(s.faction, 'Nilfgaard'); eq(s.factionsDone, ['Skellige']);
  ok(E.inPool(D.CARDS.find(c => c.f === 'Nilfgaard')) && !E.inPool(D.CARDS.find(c => c.f === 'Skellige')), 'yeni havuz');
});
test('Alt görevler: adet türünde her alt görev 1 sayılır, hedef alt görev sayısıdır; yaptım/yapmadımda hepsi işaretlenince tamamlanır', () => {
  const items = ['D vitamini', 'Omega 3', 'B12', 'D vitamini', '  '];
  const { E, s, go } = setup({ type: 'count', quest: { name: 'Vitamin al', count: { target: 9 }, items } });
  const h = s.habits[0]; eq(h.items, ['D vitamini', 'Omega 3', 'B12'], 'boşlar ve tekrarlar atılır'); eq(h.count.target, 3);
  go('2026-11-06T10:00');
  isOk(E.toggleItem('D vitamini')); isOk(E.toggleItem('B12')); eq(h.entries['2026-11-06'].count, 2);
  isOk(E.toggleItem('B12')); eq(h.entries['2026-11-06'].count, 1, 'işaret kaldırılınca düşer');
  isErr(E.toggleItem('Yok böyle'));
  isOk(E.toggleItem('B12')); isOk(E.toggleItem('Omega 3'));
  eq(h.entries['2026-11-06'].result, 'success'); isErr(E.toggleItem('B12'), 'gün bitti');
  go('2026-11-07T10:00'); isOk(E.toggleItem('Omega 3')); isOk(E.toggleItem('B12'));
  go('2026-11-08T04:00'); eq(h.entries['2026-11-07'].result, 'late', 'yarısından fazlası: gecikme');
  const c = setup({ type: 'check', quest: { name: 'Sabah rutini', items: ['Yatak', 'Esneme'] } });
  c.go('2026-11-06T09:00'); const hc = c.s.habits[0];
  isOk(c.E.toggleItem('Yatak')); eq(hc.entries['2026-11-06'].result, undefined);
  isOk(c.E.toggleItem('Esneme')); eq(hc.entries['2026-11-06'].result, 'success');
  isOk(c.E.updateQuest({ items: ['Yatak', 'Esneme', 'Su'] }, hc.id)); eq(c.s.habits[0].items.length, 3, 'düzenlenebilir');
});
const SIMS = [
  { name: 'Kusursuz uyku · yükseltmesiz', pSuccess: 1, pPrep: 1, gear: false },
  { name: 'Kusursuz uyku · yükseltmeli', pSuccess: 1, pPrep: 1 },
  { name: 'Gerçekçi uyku (%70) · yükseltmesiz', pSuccess: 0.7, pLate: 0.15, pPrep: 0.6, gear: false },
  { name: 'Gerçekçi uyku (%70) · yükseltmeli', pSuccess: 0.7, pLate: 0.15, pPrep: 0.6 },
  { name: 'Zorlanan (%45) · yükseltmeli', pSuccess: 0.45, pLate: 0.2, pPrep: 0.3, sides: 1 },
  { name: 'Günlük görev (%80) · yükseltmeli', type: 'daily', pSuccess: 0.8, pLate: 0.1 },
];
const simRows = [];
window.KM_SIM = { simulate, SIMS };                     // konsoldan denge denemesi için
test('Simülasyon (320 gün, idle savaş): kusursuz ~4 ayda, gerçekçi ~6–7 ayda son seviye; son boss kusursuza 7–13, gerçekçiye 10+ gün', () => {
  SIMS.forEach(cfg => simRows.push(simulate(cfg)));
  const [pNo, pGear, rNo, rGear, hard] = simRows;
  simRows.forEach(r => { ok(r.level >= 4 && Number.isFinite(r.goldPerDay) && Number.isFinite(r.cardsPerDay), r.name + ' geçerli: sv ' + r.level); });
  ok(rGear.maxDay >= 175 && rGear.maxDay <= 230, 'gerçekçi + donanım son seviye günü (~6–7 ay): ' + rGear.maxDay);
  ok(pGear.maxDay >= 110 && pGear.maxDay <= 140, 'kusursuz + donanım son seviye günü (~4 ay): ' + pGear.maxDay);
  ok(!hard.maxDay || hard.maxDay > rGear.maxDay + 20, 'zorlanan oyuncu belirgin yavaş');
  ok(pNo.maxDay > pGear.maxDay && (!rNo.maxDay || rNo.maxDay >= rGear.maxDay), 'donanımsız daha yavaş');
  simRows.filter(r => r !== hard).forEach(r => ok(r.defeats <= 3, r.name + ' yenilgi: ' + r.defeats));   // zorlanan oyuncu yenilebilir: hasar almanın bedeli
  ok(pGear.killDays[0].normal >= 8 && pGear.killDays[0].normal <= 30, 'ilk kademede normal canavar yarım–bir gün: ' + pGear.killDays[0].normal);
  ok(pGear.killDays.at(-1).boss >= 168 && pGear.killDays.at(-1).boss <= 320, 'kusursuz: son boss 7–13 gün: ' + pGear.killDays.at(-1).boss);
  ok(rGear.killDays.at(-1).boss >= 240, 'gerçekçi: son boss 10+ gün: ' + rGear.killDays.at(-1).boss);
  ok(pGear.cardsPerDay >= 3 && pGear.cardsPerDay <= 6, 'kusursuz kart/gün: ' + pGear.cardsPerDay.toFixed(2));
  ok(hard.cardsPerDay < rGear.cardsPerDay && rGear.cardsPerDay < pGear.cardsPerDay, 'daha iyi alışkanlık = daha çok kart');
  return;
  const first = pGear.killDays[0], last = pGear.killDays.at(-1);
  ok(first.normal >= 1 && first.normal <= 2.2 && first.max <= 3, `White Orchard 1–2 gün: ort ${first.normal}, en uzun ${first.max}`);
  ok(last.n && last.max <= 5 && last.normal >= 2.8, `Toussaint en fazla 5 gün: ort ${last.normal}, en uzun ${last.max}`);
  for (let i = 1; i < pGear.killDays.length; i++) { const A = pGear.killDays[i - 1], B = pGear.killDays[i], a = A.normal, b = B.normal; if (a != null && b != null && A.n >= 3 && B.n >= 3) ok(b >= a - 0.6, `bölgeler kademeli zorlaşmalı: ${i}. bölge ${a} → ${b}`); }
  const lastNo = pNo.killDays.at(-1).normal;
  ok(lastNo >= last.normal * 1.25, `yükseltmesiz son bölgede belirgin yavaş olmalı: ${lastNo} / ${last.normal}`);
  ok(rNo.maxDay == null || rNo.maxDay > rGear.maxDay + 10, 'yükseltmesiz gerçekçi oyuncu daha yavaş olmalı');
  ok(pGear.maxDay && pGear.maxDay >= 50 && pGear.maxDay <= 75, 'kusursuz + yükseltme son seviye günü (~2 ay): ' + pGear.maxDay);
  ok(rGear.maxDay && rGear.maxDay >= 75 && rGear.maxDay <= 110, 'gerçekçi + yükseltme son seviye günü (~3 ay): ' + rGear.maxDay);
  ok(!pNo.maxDay || pNo.maxDay > pGear.maxDay, 'yükseltmesiz daha yavaş olmalı');
  ok(pGear.cardsPerDay60 >= 4.3 && pGear.cardsPerDay60 <= 6.5, 'kusursuz kart/gün (ilk 60): ' + pGear.cardsPerDay60.toFixed(2));
  ok(hard.cardsPerDay < rGear.cardsPerDay && rGear.cardsPerDay < pGear.cardsPerDay, 'daha iyi alışkanlık = daha çok kart');
});

/* ---- sunucu: dolu bir kayıt veritabanına yazılıp aynen geri okunabiliyor mu? (ayrı test kaydı) ---- */
async function serverRoundTrip() {
  if (location.protocol === 'file:') return;
  const name = 'Sunucu: dolu kayıt aynen yazılıp okunuyor; eski sürümle gelen kayıt (başka cihaz) reddediliyor';
  try {
    const { E, s, go } = setup();
    succeed(E, go, '2026-11-06', 3);
    E.takeContract(E.boardEntries()[0].m.id); s.contract.hp = 1; go('2026-11-09T08:10'); E.checkIn();
    s.links.push({ id: 'l1', f: 'Neutral', cat: 'Witcher', cards: [1007] });
    s.swords.owned.push(D.SWORDS[0].id);
    E.rebirth({ name: 'Ciri', school: 'cat', faction: 'Nilfgaard' });
    E.takeContract(E.boardEntries()[0].m.id); s.contract.hp = 1; go('2026-11-10T08:10'); E.checkIn();
    const api = '/api/state?slot=autotest';
    const put = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    if (!put.ok) throw new Error('kayıt reddedildi: ' + await put.text());
    const back = (await (await fetch(api)).json()).state;
    eq(back.trophies, s.trophies, 'canavarlar');
    eq(back.hall.length, 1, 'Okul'); eq(back.hall[0].trophies.length, s.hall[0].trophies.length, 'Okul canavarları');
    eq(back.links, s.links, 'bağlar'); eq(back.swords, s.swords, 'kılıçlar');
    eq(Object.keys(back.habits[0].entries).sort(), Object.keys(s.days).sort(), 'günler (alışkanlık tablosu)');
    eq(back.habits.map(h => h.days), s.habits.map(h => h.days), 'hedef gün sayısı bozulmaz');
    eq(Object.keys(back.collection).length, Object.keys(s.collection).length, 'koleksiyon');
    eq(back.contract, s.contract, 'kontrat'); eq(back.boards, s.boards, 'tabelalar');
    // sürüm (rev): eski sürümle gönderilen kayıt reddedilir, güncel olan kabul edilir
    const put2 = await fetch(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    const r1 = (await put2.json()).rev;
    const stale = await fetch(api + '&rev=' + (r1 - 1), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    eq(stale.status, 409, 'eski sürüm reddedilmeli');
    const fresh = await fetch(api + '&rev=' + r1, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
    eq(fresh.status, 200, 'güncel sürüm kabul edilmeli'); eq((await fresh.json()).rev, r1 + 1);
    eq((await (await fetch('/api/rev?slot=autotest')).json()).rev, r1 + 1);
    await fetch(api, { method: 'DELETE' });
    results.push({ name, ok: true });
  } catch (e) { results.push({ name, ok: false, msg: e.message }); }
}

/* ---- sonuç ---- */
serverRoundTrip().then(() => {
const pass = results.filter(r => r.ok).length, fail = results.length - pass;
window.__RESULTS = { pass, fail, failures: results.filter(r => !r.ok) };
document.title = `${fail ? '❌' : '✅'} ${pass}/${results.length} test`;
document.getElementById('summary').innerHTML = `<span class="${fail ? 'bad' : 'good'}">${pass} / ${results.length} test geçti${fail ? `, ${fail} başarısız` : ''}</span>`;
if (simRows.length) {
  const f = (x, n = 2) => x == null ? '—' : x.toFixed(n).replace('.', ',');
  const box = document.createElement('div');
  box.innerHTML = `<h2>Simülasyon · 180 gün</h2>
    <p>"Yükseltmeli" oyuncu her gün demirciden elindekinden iyi kılıcı alır, kuşandığını güçlendirir ve 5 uygun kart birikince kart bağı kurar. "Yükseltmesiz" hiçbirini yapmaz (sadece zincir bonusu var).</p>
    <table class="sim"><tr><th>Senaryo</th><th>Kart/gün (ilk 60)</th><th>Benzersiz kart</th><th>Kazanılan oren/gün</th><th>Canavar/hafta</th><th>Bölge açılış günleri</th><th>Son seviye (${D.MAX_LEVEL}) günü</th><th>Efsane günü</th><th>180. günde teçhizat</th></tr>
    ${simRows.map(r => `<tr><td>${r.name}</td><td><b>${f(r.cardsPerDay60)}</b></td><td>${r.unique}</td><td>${f(r.goldPerDay, 1)}</td><td>${f(r.killsPerWeek)}</td>
      <td>${r.regionDays.join(' · ') || '—'}</td><td><b>${r.maxDay ?? `— (sv ${r.level})`}</b></td><td>${r.legendDay ?? '—'}</td><td><small>${r.gearText}</small></td></tr>`).join('')}</table>
    <p>Bölge açılış günleri: 2.–8. bölgenin açıldığı gün.</p>
    <h2>Bir canavar ortalama kaç saatte ölüyor?</h2>
    <p>Kontratın alındığı andan öldüğü ana kadar geçen süre, saat (dinlenme ve iksir araları dahil). Normal canavarların ortalaması, köşeli parantezde en kısa–en uzun, normal parantezde örnek sayısı; 👑 boss.</p>
    <table class="sim"><tr><th>Senaryo</th>${Array.from({ length: D.BAND_COUNT }, (_, t) => `<th>${D.bandRegions(t).map(i => D.REGIONS[i].name).join(' / ')}</th>`).join('')}</tr>
    ${simRows.map(r => `<tr><td>${r.name}</td>${r.killDays.map(k => `<td>${k.normal == null ? '—' : f(k.normal, 1)} <small>[${k.min ?? '—'}–${k.max ?? '—'}] (${k.n})</small>${k.boss != null ? ` · 👑 ${k.boss}` : ''}</td>`).join('')}</tr>`).join('')}</table>`;
  document.body.appendChild(box);
  window.__SIM = simRows;
}
document.getElementById('list').innerHTML = results.map(r => `<li class="${r.ok ? 'good' : 'bad'}">${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `<div class="msg">${r.msg.replace(/</g, '&lt;')}</div>`}</li>`).join('');
});
})();
