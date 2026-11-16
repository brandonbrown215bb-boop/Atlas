import { mulberry32 } from '../rng';

const ROOTS = ['Ash', 'Bram', 'Cald', 'Dun', 'Elm', 'Fen', 'Gar', 'Hart', 'Iron', 'Kel', 'Lor', 'Mar', 'Nor', 'Oak', 'Pell', 'Rav', 'Sal', 'Thorn', 'Ul', 'Wyn', 'Yar', 'Brack', 'Cor', 'Grey', 'Hollin', 'Mere', 'Stan', 'Wold'];
const TOWN_ENDS = ['ford', 'wick', 'holm', 'by', 'stead', 'bury', 'haven', 'mere', 'gate', 'ton', 'well', 'moor', 'dale', 'crest', 'hollow', 'march', 'field', 'bridge'];
const PLACE_ENDS = ['', 'stone', 'helm', 'wall', 'crag', 'brook', 'ridge', 'fell', 'water', 'thorn'];
const OLD_A = ['Vael', 'Kor', 'Drath', 'Ys', 'Thul', 'Mor', 'Azh', 'Kesh', 'Our', 'Sel', 'Nar', 'Ith', 'Zan', 'Hael', 'Gol', 'Urth'];
const OLD_B = ['oth', 'rin', 'mar', 'esh', 'undar', 'ar', 'ith', 'eon', 'dros', 'ul', 'ane', 'is'];
const DREAD_A = ['Ash', 'Gloom', 'Wyrm', 'Bone', 'Grim', 'Black', 'Rot', 'Howl', 'Murk', 'Red', 'Blood', 'Shade'];
const DREAD_B = ['maw', 'tooth', 'fang', 'claw', 'gut', 'hide', 'jaw', 'horn'];

export type SiteNameKind = 'stronghold' | 'ruin' | 'lair' | 'sacred' | 'travel' | 'beacon' | 'bridge';

/** Seeded, non-repeating fantasy names so every world reads as its own place. */
export function makeNamer(seed: number) {
  const random = mulberry32((seed ^ 0x2a4e1d) >>> 0), used = new Set<string>();
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const common = () => pick(ROOTS) + pick(PLACE_ENDS);
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
  return {
    town: () => unique(() => pick(ROOTS) + pick(TOWN_ENDS)),
    site: (kind: SiteNameKind) => unique(pick(sites[kind])),
    range: () => unique(() => `${old()} ${pick(['Peaks', 'Spine', 'Teeth', 'Crags', 'Mountains'])}`),
    wood: () => unique(() => pick([() => `${common()} Wood`, () => `${common()} Weald`, () => `The ${old()} Wilds`])()),
    sea: () => unique(() => `THE ${pick(['SEA OF', 'DEEPS OF', 'GULF OF'])} ${old().toUpperCase()}`),
    pass: () => unique(() => pick([() => `${common()} Pass`, () => `${old()} Gap`])()),
  };
}
