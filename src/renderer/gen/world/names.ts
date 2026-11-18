import { mulberry32 } from '../rng';

const ROOTS = ['Ash', 'Bram', 'Cald', 'Dun', 'Elm', 'Fen', 'Gar', 'Hart', 'Iron', 'Kel', 'Lor', 'Mar', 'Nor', 'Oak', 'Pell', 'Rav', 'Sal', 'Thorn', 'Ul', 'Wyn', 'Yar', 'Brack', 'Cor', 'Grey', 'Hollin', 'Mere', 'Stan', 'Wold'];
const TOWN_ENDS = ['ford', 'wick', 'holm', 'by', 'stead', 'bury', 'haven', 'mere', 'gate', 'ton', 'well', 'moor', 'dale', 'crest', 'hollow', 'march', 'field', 'bridge'];
const PLACE_ENDS = ['', 'stone', 'helm', 'wall', 'crag', 'brook', 'ridge', 'fell', 'water', 'thorn'];
const OLD_A = ['Vael', 'Kor', 'Drath', 'Ys', 'Thul', 'Mor', 'Azh', 'Kesh', 'Our', 'Sel', 'Nar', 'Ith', 'Zan', 'Hael', 'Gol', 'Urth'];
const OLD_B = ['oth', 'rin', 'mar', 'esh', 'undar', 'ar', 'ith', 'eon', 'dros', 'ul', 'ane', 'is'];
const DREAD_A = ['Ash', 'Gloom', 'Wyrm', 'Bone', 'Grim', 'Black', 'Rot', 'Howl', 'Murk', 'Red', 'Blood', 'Shade'];
const DREAD_B = ['maw', 'tooth', 'fang', 'claw', 'gut', 'hide', 'jaw', 'horn'];

const GIVEN = ['Agna', 'Bertil', 'Cobb', 'Dagny', 'Edric', 'Fenna', 'Godwin', 'Hesta', 'Ivo', 'Jory', 'Kettil', 'Linnet', 'Maud', 'Nils', 'Osric', 'Petra', 'Quill', 'Rowena', 'Sigrid', 'Tobin', 'Ulla', 'Wat', 'Ysolde', 'Hamm'];
const SURNAME_ENDS = ['by', 'wright', 'well', 'ley', 'er', 'ton', 'more', 'shaw'];
const INN_ADJ = ['Gilded', 'Drowned', 'Crooked', 'Laughing', 'Sleeping', 'Rusty', 'Silver', 'Black', 'Wandering', 'Hanged', 'Three-Legged', 'Blind', 'Merry', 'Broken', 'Golden', 'Salted'];
const INN_NOUN = ['Stag', 'Lantern', 'Goose', 'Kettle', 'Anchor', 'Boar', 'Crown', 'Fiddler', 'Mermaid', 'Wyvern', 'Barrel', 'Hound', 'Raven', 'Plough', 'Bell', 'Pike'];
export type WardKind = 'market' | 'high' | 'temple' | 'craft' | 'docks' | 'shambles';

export type SiteNameKind = 'stronghold' | 'ruin' | 'lair' | 'sacred' | 'travel' | 'beacon' | 'bridge';

/** Seeded, non-repeating fantasy names so every world reads as its own place. */
export function makeNamer(seed: number, taken: Iterable<string> = []) {
  const random = mulberry32((seed ^ 0x2a4e1d) >>> 0), used = new Set<string>(taken);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const common = () => { const root = pick(ROOTS), end = pick(PLACE_ENDS); return root + (root.toLowerCase() === end ? '' : end); };
  const old = () => pick(OLD_A) + pick(OLD_B);
  const dread = () => pick(DREAD_A) + pick(DREAD_B);
  const unique = (make: () => string) => {
    for (let i = 0; i < 40; i++) {
      const name = make();
      if (!used.has(name)) { used.add(name); return name; }
    }
    const name = `${make()} ${used.size}`;
    used.add(name);
    return name;
  };
  const sites: Record<SiteNameKind, Array<() => string>> = {
    stronghold: [() => `${common()} Keep`, () => `${common()} Watch`, () => `Fort ${common()}`, () => `${old()} Tower`],
    ruin: [() => `Ruins of ${old()}`, () => `Barrow of ${old()}`, () => `${old()} Vaults`, () => `Fallen ${old()}`, () => `Halls of ${old()}`],
    lair: [() => `${dread()} Cavern`, () => `${dread()} Den`, () => `${dread()} Hollow`, () => `${dread()} Pit`],
    sacred: [() => `${common()} Stones`, () => `Shrine of ${old()}`, () => `${common()} Well`, () => `${common()} Abbey`],
    travel: [() => `${common()} Inn`, () => `${common()} Crossing`, () => `${common()} Landing`, () => `${common()} Mill`],
    beacon: [() => `${common()} Light`],
    bridge: [() => `${common()} Bridge`],
  };
  const surname = () => pick(ROOTS) + pick(SURNAME_ENDS);
  const wards: Record<WardKind, Array<() => string>> = {
    market: [() => `${pick(ROOTS)} Market`, () => 'Cornmarket', () => `${pick(ROOTS)}cross`],
    high: [() => `${pick(ROOTS)} Hill`, () => "Lords' Row", () => `${pick(ROOTS)} Heights`],
    temple: [() => `${old()} Close`, () => "Saints' Ward", () => 'Chapter Ward'],
    craft: [() => "Tanners' Row", () => "Smiths' Quarter", () => `${pick(ROOTS)}gate`, () => "Weavers' Ward"],
    docks: [() => `${pick(ROOTS)} Wharf`, () => 'Saltside', () => 'Fishgate'],
    shambles: [() => 'The Shambles', () => `${pick(DREAD_A)} Lanes`, () => 'Rag Ward', () => `${pick(ROOTS)}ditch`],
  };
  return {
    town: () => unique(() => pick(ROOTS) + pick(TOWN_ENDS)),
    person: () => unique(() => `${pick(GIVEN)} ${surname()}`),
    inn: () => unique(() => `The ${pick(INN_ADJ)} ${pick(INN_NOUN)}`),
    temple: () => unique(() => pick([() => `Temple of ${old()}`, () => `${common()} Abbey`, () => `Chapel of St. ${old()}`])()),
    farm: () => unique(() => `${surname()} Farm`),
    graveyard: () => unique(() => pick([() => 'Old Churchyard', () => `${pick(ROOTS)} Barrowfield`, () => 'The Weeping Yard', () => `${old()} Cemetery`, () => 'Gallows Hill'])()),
    ward: (kind: WardKind) => unique(() => pick(wards[kind])()),
    site: (kind: SiteNameKind) => unique(pick(sites[kind])),
    range: () => unique(() => `${old()} ${pick(['Peaks', 'Spine', 'Teeth', 'Crags', 'Mountains'])}`),
    wood: () => unique(() => pick([() => `${common()} Wood`, () => `${common()} Weald`, () => `The ${old()} Wilds`])()),
    sea: () => unique(() => `THE ${pick(['SEA OF', 'DEEPS OF', 'GULF OF'])} ${old().toUpperCase()}`),
    pass: () => unique(() => pick([() => `${common()} Pass`, () => `${old()} Gap`])()),
    river: () => unique(() => pick([() => `River ${old()}`, () => `The ${pick(ROOTS)}${pick(['brook', 'water', 'burn', 'rill'])}`])()),
  };
}
