"""monsters.js üretici: bölgeler, kademeler, harita konumları ve canavarlar.

Kart bilgisi (isim, görsel no, güç) gwent.one ham verisinden okunur; çıktıda Gwent metni bulunmaz
(canavar açıklaması çalışırken indirilen cards.js'ten gelir).

  py -3 tools/build_monsters.py gwent.json

gwent.json: https://api.gwent.one/?key=data&response=json&html=info&language=en
Mevcut canavarların kimlikleri ve güç değerleri korunur (kayıtlardaki kupalar bozulmasın).
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'monsters.js')

raw = json.load(open(sys.argv[1], encoding='utf-8'))['response']
raw = raw.values() if isinstance(raw, dict) else raw
CARDS = {}
for c in raw:
    a = c['attributes']
    if a['type'] != 'Unit':
        continue
    cats = [x.strip() for x in (c.get('category') or '').split(',') if x.strip()]
    CARDS.setdefault(c['name'], {'art': c['id']['art'], 'power': a['power'], 'prov': a['provision'], 'cats': cats})

# mevcut canavarlar (kimlik, sınıf, güç korunur)
old_src = open(OUT, encoding='utf-8').read()
i = old_src.index('window.KM_MONSTERS')
body = old_src[old_src.index('[', i):]
OLD = {m['id']: m for m in json.loads(body[:body.index('\n];') + 3].rstrip(';'))}

CLS_TR = {'Beast': 'Hayvanlar', 'Relict': 'Kadimler', 'Insectoid': 'Böcekimsiler', 'Ogroid': 'Ogroidler', 'Vampire': 'Vampirler',
          'Necrophage': 'Leşçiller', 'Specter': 'Hayaletler', 'Plant': 'Bitkiler', 'Dragon': 'Ejderhalar', 'Human': 'Lanetliler',
          'Construct': 'Yapılar'}
CAT_PRIORITY = [('Vampire', 'Vampire'), ('Specter', 'Specter'), ('Dragon', 'Dragon'), ('Construct', 'Construct'), ('Relict', 'Relict'),
                ('Insectoid', 'Insectoid'), ('Ogroid', 'Ogroid'), ('Necrophage', 'Necrophage'), ('Plant', 'Plant'), ('Treant', 'Plant'),
                ('Cursed', 'Human'), ('Human', 'Human'), ('Beast', 'Beast')]
ADJ_EN = {'Lyria': 'Lyria', 'Bataklık': 'Swamp', 'Pontar': 'Pontar', 'Kızgın': 'Raging', 'Dağ': 'Mountain', 'Mahakam': 'Mahakam',
          'Mağara': 'Cave', 'Buzul': 'Glacial', 'Ada': 'Island', 'Kaer Morhen': 'Kaer Morhen', 'Gölkıyısı': 'Lakeside',
          'Novigrad': 'Novigrad', 'Kanalizasyon': 'Sewer', 'Kovir': 'Kovir', 'Kestrel': 'Kestrel', 'Sansretour': 'Sansretour'}

# Kademeler: her kademe 4 seviye (1–4, 5–8, ... 29–32). Aynı kademedeki bölgeler birlikte açılır.
# map: kendi çizdiğimiz Kıta haritasında konum (0–1000 × 0–700).
R = []
def region(id, tier, name, game, desc, name_en, desc_en, boss, mons, x, y):
    R.append(dict(id=id, tier=tier, name=name, game=game, desc=desc, name_en=name_en, desc_en=desc_en, boss=boss, mons=mons, map=dict(x=x, y=y)))

region('whiteorchard', 0, 'White Orchard', 'The Witcher 3', 'Savaşın kıyısında küçük bir köy. Leşçiller, boğulmuşlar ve gökyüzünde bir grifon.',
       'White Orchard', 'A small village on the edge of war. Necrophages, drowners and a griffin in the sky.', 'Griffin',
       [('Ghoul',), ('Drowner',), ('Nekker',), ('Noonwraith',), ('Rotfiend',), ('Orchard Mantrap',), ('Wild Hunt Hound',), ('Wyvern',), ('Foglet',),
        ('Cockatrice',), ('Endrega Larva',)], 455, 455)
region('kovir', 0, 'Kovir ve Poviss', 'Sapkowski', 'Kuzeyin zengin krallığı: madenler, fiyortlar ve karlı dağlar. Ayılar, kurt sürüleri ve Salamandra\'nın kaçak mutantları.',
       'Kovir and Poviss', "The rich kingdom of the north: mines, fjords and snowy peaks. Bears, wolf packs and Salamandra's runaway mutants.", 'Dire Bear',
       [('Wolf Pack',), ('Elder Bear',), ('Savage Bear',), ('Raging Bear',), ('Giant Boar',), ('Hunting Pack',), ('Mutated Hounds',),
        ('Dire Mutated Hound',), ('Salamandra Abomination',), ('Nekker', 'Kovir', 'nekker-kaer-morhen')], 0, 0)
region('lyria', 1, 'Lyria ve Rivia', 'Thronebreaker', "Meve'nin işgal altındaki krallığı. Bataklıklarda lanetliler, ormanlarda melezler.",
       'Lyria and Rivia', "Meve's occupied kingdom. Cursed ones in the swamps, hybrids in the woods.", 'Mammuna',
       [('Gan Ceann',), ('Phooca',), ('Hybrid',), ('Chimera',), ('Wererat',), ('Lesser Witch',), ('Witch Apprentice',), ('Rat Catcheress',),
        ('Cursed Damsel',), ('Sir Scratch-a-Lot',), ('The Apiarian Phantom',), ('Ghoul', 'Lyria')], 690, 395)
region('vizima', 1, 'Vizima ve Temeria', 'The Witcher', 'Temeria\'nın başkenti ve göl kıyısı. Lanetli prensesler, kurt adamlar ve suyun dibindeki eski tanrı.',
       'Vizima and Temeria', "Temeria's capital and its lakeshore. Cursed princesses, werewolves and an old god beneath the water.", 'Adda: Striga',
       [('Vincent Meis',), ('The Beast',), ('Botchling',), ('Lubberkin',), ('Koshchey',), ('Viy',), ('Ruehin',), ('Dagon: Promised',), ('Vereena',),
        ('Drowner', 'Gölkıyısı')], 500, 330)
region('velen', 2, 'Velen', 'The Witcher 3', "Bataklıklar, aç köylüler ve Crookback Bataklığı'ndaki üç cadı.",
       'Velen', 'Swamps, starving peasants and the three witches of Crookback Bog.', 'Brewess',
       [('Werewolf',), ('Alpha Werewolf',), ('Nightwraith',), ('Penitent',), ('Fiend',), ('Ancient Foglet',), ('Whispess',), ('Weavess',), ('Abaya',),
        ('Drowner', 'Bataklık'), ('Foglet', 'Bataklık'), ('Barghest',), ('Yaga',), ('She Who Knows',)], 395, 300)
region('brokilon', 2, 'Brokilon', 'Sapkowski', 'Driyadların ormanı. Ağaç adamlar, orman ruhu ve izinsiz girenleri bekleyen yırtıcılar.',
       'Brokilon', 'The forest of the dryads. Treants, the woodland spirit and predators waiting for trespassers.', 'Woodland Spirit',
       [('Forest Protector',), ('Oakcritters',), ('The Great Oak',), ('Treant Boar',), ('Weeping Willow',), ('Treant Mantis: Strike',), ('Gernichora',),
        ('Panther',), ('Saber-Tooth Tiger',), ('Chameleon',), ('Antherion',), ('Lake Guardian: Dusk Aspect',), ('Muirlega',), ("Saov Ainmhi'dh: Unity",)], 340, 450)
region('flotsam', 3, 'Flotsam', 'The Witcher 2', 'Pontar kıyısında bir kaçakçı kasabası. Endregalar, harpiler ve nehirde bir dev.',
       'Flotsam', "A smugglers' town on the Pontar. Endregas, harpies and a giant in the river.", 'Kayran',
       [('Nekker Warrior',), ('Endrega Warrior',), ('Endrega Queen',), ('Armored Arachas',), ('Celaeno Harpy',), ('Bridge Troll',), ('Slyzard',),
        ('Forktail',), ('Drowner', 'Pontar'), ('Rotfiend', 'Pontar'), ('Nekker', 'Kızgın'), ('Arachas Queen',)], 545, 235)
region('novigrad', 3, 'Novigrad ve Oxenfurt', 'Hearts of Stone', 'Özgür şehir ve üniversite kasabası. Lanetli bir malikâne, kanalizasyonda bir kurbağa prens ve aynalı adamın gölgesi.',
       'Novigrad and Oxenfurt', "The free city and the university town. A cursed manor, a toad prince in the sewers and the shadow of the man of glass.", 'Caretaker',
       [('Iris: Shade',), ('Vlodimir von Everec',), ('Olgierd: Immortal',), ('Toad Prince',), ('Hubert Rejk',), ('Incubus',), ('Succubus',), ('Chort',),
        ('Bloody Mistress',), ('Wererat', 'Novigrad'), ('Rotfiend', 'Kanalizasyon')], 330, 225)
region('vergen', 4, 'Vergen ve Aedirn', 'The Witcher 2', 'Cüce kalesi Vergen ve altındaki tüneller. Kikimorlar her yerde.',
       'Vergen and Aedirn', 'The dwarven fortress of Vergen and the tunnels beneath. Kikimores everywhere.', 'Kikimore Queen',
       [('Kikimore Worker',), ('Kikimore Hatchling',), ('Kikimore Stalker',), ('She-Troll of Vergen',), ('Barbegazi',), ('Glustyworp',), ('Ozzrel',),
        ('Mourntart',), ('Desert Banshee',), ('Idr',), ('Plague Maiden',)], 660, 265)
region('kaedwen', 4, 'Kaedwen ve Ban Ard', 'Thronebreaker', 'Büyücü okulunun gölgesinde uyanmış golemler, cinler ve savaş alanlarından dönmeyen hayaletler.',
       'Kaedwen and Ban Ard', "Golems and djinn awakened in the shadow of the mage school, and ghosts that never left the battlefields.", 'Draug',
       [('Colossal Ifrit',), ('Enraged Ifrit',), ('Frenzied D\'ao',), ('Primordial D\'ao',), ('Living Armor',), ('Imperial Golem',), ('Frightener: Awakened',),
        ('Kaedweni Revenant',), ('Cursed Knight',), ('Damned Sorceress',)], 560, 165)
region('mahakam', 5, 'Mahakam', 'Thronebreaker', 'Cücelerin dağları. Mağaralarda troller, ogrelar ve yerin altından gelen devler.',
       'Mahakam', 'The dwarven mountains. Trolls and ogres in the caves, and giants from below.', 'Old Speartip',
       [('Cave Troll',), ('Cyclops',), ('Enraged Cyclops',), ('Ogre Warrior',), ('Lord Riptide',), ('Tugo the Elder',), ('Golyat',), ('Yghern',),
        ('Arachas Behemoth',), ('Bridge Troll', 'Dağ'), ('Nekker Warrior', 'Mahakam'), ('Armored Arachas', 'Mağara'), ('King Chrum',), ('Old Speartip: Asleep',)], 600, 470)
region('kestrel', 5, 'Kestrel Dağları', 'Sapkowski', 'Ejderha avının efsanesi bu sarp tepelerde doğdu. Ejderhalar, anka kuşu ve gökyüzünün yırtıcıları.',
       'Kestrel Mountains', 'The legend of the dragon hunt was born on these steep peaks. Dragons, a phoenix and the predators of the sky.', 'Keltullis',
       [('Villentretenmerth',), ('Myrgtabrakke',), ('Ocvist',), ('Phoenix',), ('Archgriffin',), ('Aguara',), ('Aguara: True Form',), ("Saer Qu'an",),
        ('Tourney Shaelmaar',), ('Vypper',), ('Forktail', 'Kestrel'), ('Wyvern', 'Kestrel')], 760, 180)
region('skellige', 6, 'Skellige', 'The Witcher 3', "Soğuk adalar, sirenler, buz trolleri ve Undvik'in buz devi.",
       'Skellige', 'Cold isles, sirens, ice trolls and the ice giant of Undvik.', 'Ice Giant',
       [('Siren',), ('Ice Troll',), ('Jotunn',), ('Vran Warrior',), ('Morvudd',), ('Miruna',), ('Maerolorn',), ('Imperial Manticore',), ('Werecat',),
        ('Selfeater',), ('Wild Hunt Hound', 'Buzul'), ('Cyclops', 'Ada')], 120, 175)
region('skelligeseas', 6, 'Skellige Denizleri', 'The Witcher 3', 'Adaların arasındaki fırtınalı sular. Deniz yılanları, kurt adam korsanlar ve derinlerin kralı.',
       'Skellige Seas', 'The stormy waters between the isles. Sea serpents, werewolf pirates and the king of the deep.', 'Kraken',
       [('Sea Serpent',), ('Dracoturtle',), ('Melusine',), ('Fucusya',), ('Anglerfish',), ('Little Havfrue',), ('Messenger of the Sea',), ('Morkvarg',),
        ('Ulfhedinn',), ('Hym',), ('Champion of Svalblod',), ('Dagon: Risen',)], 95, 315)
region('sansretour', 6, 'Sansretour Vadisi', 'Blood and Wine', "Toussaint'in kıyısındaki masal vadisi. Van Moorlehem soyunun vampirleri, dev kurbağalar ve geceleri uyanan yaratıklar.",
       'Sansretour Valley', "The fairy-tale valley on the edge of Toussaint. Vampires of the van Moorlehem line, giant toads and things that wake at night.", 'Vincent van Moorlehem',
       [('Thirsty Dame',), ('Van Moorlehem Hunter',), ('Philippe van Moorlehem',), ('Queen of the Night',), ('Giant Toad',), ('Archespore',),
        ('Garkain',), ('Nekurat',), ('Fleder', 'Sansretour')], 405, 585)
region('toussaint', 7, 'Toussaint', 'The Witcher 3', 'Şarap bağları, peri masalı kaleleri ve geceleri avlanan vampirler.',
       'Toussaint', 'Vineyards, fairy-tale castles and vampires that hunt by night.', 'Dettlaff van der Eretein',
       [('Bruxa',), ('Alp',), ('Fleder',), ('Protofleder',), ('Plumard',), ('Katakan',), ('Gael',), ('Orianna',), ('Unseen Elder',)], 545, 635)

slug = lambda s: re.sub(r'[^a-z0-9]+', '-', s.lower().replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's').replace('ö', 'o').replace('ç', 'c')).strip('-')
TR2ASCII = lambda s: s  # id'ler eski üreticiyle aynı kalsın diye aşağıda eski id varsa o kullanılır


def old_id(name, adj):
    # eski üretici: slug(n) + '-' + slug(adj) (Türkçe harfler silinerek)
    s1 = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return s1 + ('-' + re.sub(r'[^a-z0-9]+', '-', adj.lower()).strip('-') if adj else '')


def cls_of(cats):
    for cat, cls in CAT_PRIORITY:
        if cat in cats:
            return cls
    return 'Beast'


mons, used = [], set()
for ri, reg in enumerate(R):
    keep = {(e[0], e[1]): e[2] for e in reg['mons'] if len(e) > 2}     # sıfatı değişse de eski kimlik korunur (kupalar)
    entries = [(e[0], e[1] if len(e) > 1 else None, False) for e in reg['mons']] + [(reg['boss'], None, True)]
    for n, _, _ in entries:
        assert n in CARDS, f'kart yok: {n}'
    # bölge içi güç ölçeği: eski bölgelerde eski canavarların aralığı korunur
    olds = [keep.get((n, a)) or old_id(n, a) for n, a, b in entries if not b and (keep.get((n, a)) or old_id(n, a)) in OLD]
    rawp = {n: CARDS[n]['power'] + CARDS[n]['prov'] * 0.6 for n, _, b in entries if not b}
    base = [rawp[n] for n, a, b in entries if not b and (not olds or (keep.get((n, a)) or old_id(n, a)) in OLD)]
    lo, hi = min(base), max(base)
    for n, adj, boss in entries:
        c = CARDS[n]
        oid = keep.get((n, adj)) or old_id(n, adj)
        if oid in OLD:
            o = OLD[oid]
            m = {'id': oid, 'name': (adj + ' ' + n) if (n, adj) in keep else o['name'], 'art': o['art'], 'cls': o['cls'], 'region': ri, 'str': o['str']}
        else:
            mid = oid
            assert mid not in OLD
            st = 1.0 if boss else round(min(1.0, max(0.55, 0.55 + 0.45 * ((rawp[n] - lo) / (hi - lo) if hi > lo else 0.5))), 3)
            m = {'id': mid, 'name': (adj + ' ' if adj else '') + n, 'art': c['art'], 'cls': cls_of(c['cats']), 'region': ri, 'str': st}
        if adj and ADJ_EN.get(adj, adj) != adj:
            m['name_en'] = ADJ_EN[adj] + ' ' + n
        if boss:
            m['boss'] = True
            m['str'] = 1.0          # boss her zaman bölgenin en güçlüsü
        assert m['id'] not in used, m['id']
        used.add(m['id'])
        mons.append(m)
    reg['boss'] = old_id(reg['boss'], None)
    del reg['mons']


# ---------- harita: bölge sınırları ----------
# Koordinatlar, bir Kıta haritasındaki ülke yerleşimine bakılarak elle çizildi (referans: 1413×2000 piksel);
# görsel kopyalanmadı, sadece hangi bölgenin nerede olduğu. Çıktı: 1000 genişlikte SVG yolları.
def T(p): return (round((p[0] - 60) * 0.746, 1), round((p[1] - 40) * 0.746, 1))
def path(pts): return 'M' + ' L'.join(f'{x},{y}' for x, y in map(T, pts)) + ' Z'
def centroid(pts):
    q = [T(p) for p in pts]
    a = cx = cy = 0
    for i in range(len(q)):
        x0, y0 = q[i]; x1, y1 = q[(i + 1) % len(q)]
        c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    a /= 2
    return round(cx / (6 * a), 1), round(cy / (6 * a), 1)
POLY = {
    'kovir': [(140, 140), (250, 60), (560, 50), (560, 210), (470, 290), (410, 300), (300, 280), (250, 330), (200, 300), (150, 250), (130, 180)],
    'kestrel': [(560, 50), (930, 45), (930, 200), (870, 210), (760, 225), (600, 235), (560, 210)],
    'kaedwen': [(930, 45), (1360, 60), (1370, 400), (1100, 420), (960, 410), (930, 200)],
    'novigrad': [(560, 210), (600, 235), (760, 225), (870, 210), (930, 200), (960, 410), (880, 440), (760, 480), (620, 510), (550, 510), (520, 400), (570, 320)],
    'velen': [(550, 510), (620, 510), (700, 520), (720, 600), (680, 650), (600, 640), (540, 600), (560, 560)],
    'flotsam': [(620, 510), (760, 480), (880, 440), (930, 450), (930, 540), (820, 560), (720, 560), (700, 520)],
    'vizima': [(720, 560), (820, 560), (930, 540), (940, 650), (860, 700), (760, 700), (700, 660), (680, 650), (720, 600)],
    'whiteorchard': [(700, 660), (760, 700), (860, 700), (900, 760), (820, 800), (720, 800), (660, 760)],
    'brokilon': [(540, 600), (600, 640), (680, 650), (700, 660), (660, 760), (720, 800), (640, 830), (590, 800), (560, 720), (530, 660)],
    'mahakam': [(930, 450), (1010, 430), (1040, 520), (1030, 650), (940, 650), (930, 540)],
    'vergen': [(960, 410), (1100, 420), (1370, 400), (1340, 640), (1180, 660), (1030, 650), (1040, 520), (1010, 430)],
    'lyria': [(940, 650), (1030, 650), (1180, 660), (1340, 640), (1330, 740), (1180, 760), (1040, 745), (930, 720), (900, 760), (860, 700)],
    'skelligeseas': [(80, 680), (480, 680), (480, 990), (80, 990)],
    'skellige': [(220, 720), (390, 715), (395, 880), (220, 890)],
    'sansretour': [(880, 1000), (1040, 960), (1060, 1080), (980, 1140), (880, 1100)],
    'toussaint': [(1040, 960), (1260, 940), (1300, 1040), (1200, 1110), (1060, 1080)],
}
LAND = [(140, 140), (250, 60), (560, 50), (950, 40), (1360, 60), (1370, 400), (1340, 700), (1335, 1000), (1330, 1200), (640, 1200), (620, 960), (590, 880),
        (560, 840), (530, 760), (500, 690), (530, 620), (555, 560), (545, 505), (515, 400), (560, 330), (600, 270), (560, 225), (470, 290), (410, 300),
        (300, 280), (250, 330), (200, 300), (150, 250), (130, 180)]
ISLES = [[(250, 770), (275, 745), (300, 760), (285, 790)], [(290, 790), (330, 780), (345, 810), (320, 860), (290, 850)],
         [(240, 820), (265, 815), (270, 850), (245, 855)], [(330, 740), (365, 735), (370, 760), (340, 765)]]
RIVERS = [[(1360, 395), (1100, 425), (960, 440), (880, 445), (760, 485), (620, 512), (550, 512)],
          [(1330, 742), (1180, 762), (1040, 748), (930, 722), (860, 760), (760, 820), (640, 845), (600, 860)]]
for reg in R:
    pts = POLY[reg['id']]
    cx, cy = centroid(pts)
    reg['map'] = {'x': cx, 'y': cy, 'd': path(pts)}
KM_MAP = {'w': 1000, 'h': round((1210 - 40) * 0.746), 'land': path(LAND), 'isles': [path(i) for i in ISLES],
          'rivers': ['M' + ' L'.join(f'{x},{y}' for x, y in map(T, r)) for r in RIVERS],
          # tıklanmayan coğrafi isimler (yön bulmak için)
          'labels': [dict(zip(('x', 'y'), T(p)), tr=tr, en=en, sea=sea) for p, tr, en, sea in [
              ((300, 470), 'Kuzey Denizi', 'North Sea', True), ((330, 1080), 'Büyük Deniz', 'Great Sea', True),
              ((740, 930), 'Cintra', 'Cintra', False), ((1000, 1170), 'Nilfgaard ↓', 'Nilfgaard ↓', False),
              ((1100, 860), 'Sodden · Dol Angra', 'Sodden · Dol Angra', False)]]}

missing_old = set(OLD) - used
assert not missing_old, f'eski canavarlar kayboldu: {missing_old}'
per = [sum(1 for m in mons if m['region'] == i) for i in range(len(R))]
print('bölgeler:', len(R), '| bölge başına:', per, '| toplam', len(mons), '| yeni', len(mons) - len(OLD))
with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('// Üretildi: tools/build_monsters.py. Canavarlar Gwent kartlarıdır (isim + görsel no); açıklama metni çalışırken cards.js\'ten gelir.\n')
    f.write('// tier: seviye kademesi (0 → seviye 1–4 … 7 → 29–32); aynı kademedeki bölgeler birlikte açılır. str: bölge içi güç (0.55–1). map: harita konumu.\n')
    f.write('window.KM_CLASSES = ' + json.dumps({k: {'tr': v} for k, v in CLS_TR.items()}, ensure_ascii=False) + ';\n')
    f.write('window.KM_REGIONS = [\n' + ',\n'.join(json.dumps(r, ensure_ascii=False) for r in R) + '\n];\n')
    f.write('window.KM_MONSTERS = [\n' + ',\n'.join(json.dumps(m, ensure_ascii=False) for m in mons) + '\n];\n')
    f.write('window.KM_MAP = ' + json.dumps(KM_MAP) + ';\n')
