import type { Point } from '../../model/schema';

export type SiteKind = 'stronghold' | 'ruin' | 'lair' | 'sacred' | 'travel';
export type StockingRole = 'Empty' | 'Monster' | 'Special' | 'Trap';
/** 0 heartland, 1 borderland, 2 frontier. */
export type Band = 0 | 1 | 2;
export const BAND_NAMES = ['Heartland (Low Risk)', 'Borderland (Patrolled Passes)', 'Frontier Wilds (High Risk)'] as const;

export const SITE_SUMMARY: Record<SiteKind, string> = {
  stronghold: 'Fortified watchpost guarding nearby approaches.',
  ruin: 'Ancient stonework and forgotten vaults beneath the turf.',
  lair: 'Dark cavern mouth used as a beast or monster lair.',
  sacred: 'Quiet sanctuary or standing stones revered by locals.',
  travel: 'Waystation, crossing, or working camp for travelers.',
};

// Occupants escalate by band: heartland, borderland, frontier.
const OCCUPANTS: Record<SiteKind, [string[], string[], string[]]> = {
  stronghold: [
    ['a bored garrison of six', 'a retired knight and her squires', 'a tax-collector and his nervous guards'],
    ['a short-handed company owed three months pay', 'mercenaries who answer to the highest bidder', 'a garrison secretly sold out to raiders'],
    ['deserters turned bandit lords', 'a warlord who has crowned himself baron', 'an orc warband holding it as a trophy'],
  ],
  ruin: [
    ['grave-robbers and a few giant rats', 'a hermit scholar copying inscriptions', 'children daring each other into the crypt'],
    ['restless dead bound to the old crypts', 'a cult digging for a sealed reliquary', 'a goblin tribe that worships the statues'],
    ['a lich-cursed vault that wakes at dusk', 'constructs still guarding a fallen court', 'a buried temple with its god still listening'],
  ],
  lair: [
    ['a family of territorial boars', 'a cave bear woken early', 'giant spiders in the upper galleries'],
    ['an ogre who trades with goblins', 'a pack of wolves led by a worg', 'an owlbear mated pair with young'],
    ['a young dragon gathering a hoard', 'a troll brood under a hag\'s protection', 'a manticore that hunts the trade roads'],
  ],
  sacred: [
    ['a kindly hedge-priest', 'pilgrims camped for the solstice', 'a shrine-keeper hiding a deserter'],
    ['druids who distrust outsiders', 'a spirit testing the worthy', 'zealots barring the old rites'],
    ['a defiled altar feeding something below', 'a fey court that keeps visitors a year and a day', 'a saint\'s relic guarded by a sleeping angel'],
  ],
  travel: [
    ['a gossiping innkeeper and drovers', 'a ferryman who knows every rumour', 'a millers\' guild meeting'],
    ['smugglers using the cellar', 'a toll-keeper skimming coin for bandits', 'a bounty hunter waiting for someone'],
    ['the last outpost before the wilds, half-burned', 'refugees fleeing whatever is out there', 'a caravan stranded with a cursed cargo'],
  ],
};
const COMPLICATIONS = [
  'a rival party arrives the same day', 'the way in floods at high water', 'someone in town profits from it staying dangerous',
  'the occupants are not the real threat', 'a captive inside wants rescue, but lies', 'it is only reachable by night',
  'a storm traps everyone there for a day', 'an old map of it is a forgery', 'a local lord forbids anyone to go',
  'the guide hired to lead the way is a spy',
];
const REWARDS: [string[], string[], string[]] = [
  ['a purse of old coin', 'a deed to nearby land', 'a local lord\'s gratitude', 'a fine horse and tack'],
  ['a cached arms shipment', 'a masterwork blade', 'a map to something farther out', 'a noble\'s stolen signet'],
  ['a relic of the old kingdom', 'a dragon-hoard share', 'a key to a sealed vault elsewhere', 'a spellbook in a dead tongue'],
];
const TRAITS = ['horse fairs', 'dark ale', 'river pearls', 'a famous shrine', 'stubborn pride', 'fine wool', 'smugglers', 'its clocktower', 'feuding families', 'salt fish', 'master smiths', 'its winter market'];
const TROUBLES = [
  'livestock vanish at the new moon', 'the reeve has gone missing', 'a plague of bad dreams', 'bandits tax the road',
  'the well water tastes of iron', 'a stranger buys every map in town', 'the harvest rots overnight', 'two guilds near open feud',
  'a witch-hunter has arrived', 'the bells ring by themselves at night',
];
const RUMOUR_LEADS: Record<SiteKind, string[]> = {
  stronghold: ['Soldiers drink hard before posting to', 'A courier never came back from', 'Recruiters pay double for men bound for'],
  ruin: ['Shepherds give a wide berth to', 'A tinker sold a gold coin dug up at', 'A scholar is paying for guides to'],
  lair: ['Hunters swear something big dens at', 'Livestock trails all lead toward', 'A bounty is posted for whatever lives at'],
  sacred: ['Pilgrims say prayers are answered at', 'Strange lights were seen over', 'A healer swears by the waters of'],
  travel: ['Caravan masters swear by the beds at', 'Wanted posters went up at', 'Smuggled goods change hands at'],
};

export function bearing(from: Point, to: Point): string {
  const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return names[(Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) + 8) % 8]!;
}

/** "14 miles (half a day on foot)"; walking pace is about 24 miles a day. */
export function distance(from: Point, to: Point): string {
  const miles = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 1609.344));
  const days = Math.round(miles / 24);
  return `${miles} miles (${days < 1 ? 'half a day' : days === 1 ? 'a day' : `${days} days`} on foot)`;
}

/** Seeded hook tables; an entry repeats only once its list is used up. */
export function makeHooks(random: () => number) {
  const used = new Set<string>();
  const pick = (list: readonly string[]) => {
    const fresh = list.filter(x => !used.has(x)), from = fresh.length ? fresh : list;
    const choice = from[Math.floor(random() * from.length)]!;
    used.add(choice);
    return choice;
  };
  return {
    site(kind: SiteKind, band: Band): { gmNotes: string; stockingRole: StockingRole } {
      const stockingRole: StockingRole =
        kind === 'lair' ? 'Monster'
          : kind === 'ruin' ? (random() < 0.5 ? 'Trap' : 'Special')
            : kind === 'sacred' ? 'Special'
              : band === 2 || random() < band * 0.3 ? 'Monster' : 'Empty';
      return { stockingRole, gmNotes: `Occupants: ${pick(OCCUPANTS[kind][band])}. Complication: ${pick(COMPLICATIONS)}. Reward: ${pick(REWARDS[band])}.` };
    },
    settlement(size: 'City' | 'Town' | 'Village' | 'Hamlet', band: Band): string {
      return `${size} known for ${pick(TRAITS)}. Trouble: ${pick(TROUBLES)}. (${BAND_NAMES[band]})`;
    },
    rumour(kind: SiteKind, name: string, from: Point, to: Point): string {
      return `${pick(RUMOUR_LEADS[kind])} ${name}, about ${distance(from, to)} ${bearing(from, to)}.`;
    },
  };
}
