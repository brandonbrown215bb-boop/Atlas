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

export type Establishment = 'inn' | 'tavern' | 'smithy' | 'stables' | 'guildhall' | 'apothecary' | 'watch' | 'store' | 'healer' | 'shrine'
  | 'bathhouse' | 'moneylender' | 'thieves' | 'wizard' | 'mill' | 'tannery' | 'keep' | 'temple' | 'market' | 'harbor';
const SERVICES: Record<Establishment, [string, string[]]> = {
  inn: ['An inn: beds, stabling and a crowded common room.', ['the cellar connects to an older cellar nobody admits to', 'one guest room is always "taken" and nobody ever leaves it']],
  tavern: ['A tavern: cheap ale, dice and loud opinions.', ['the dice game in back is rigged for one regular', 'the barkeep sells drunk patrons\' secrets by the week']],
  smithy: ['Horseshoes, blades and repairs while you wait.', ['a blade waiting for collection was used in a murder', 'the smith forges keys from wax impressions, no questions asked']],
  stables: ['Horses bought, sold and boarded.', ['a stabled horse belongs to a dead courier', 'the grooms run messages for anyone who pays']],
  guildhall: ['Guild masters set prices, fees and feuds.', ['the guild ledger hides payments to a rival town', 'an election next week is already bought']],
  apothecary: ['Remedies, poisons sold as remedies, and rare herbs.', ['the back room brews something that is not medicine', 'the herb supplier collects ingredients from a haunted place']],
  watch: ['The watch house, cells and the notice board.', ['the captain lets one gang work in exchange for quiet', 'a prisoner in the cells is not who the warrant says']],
  store: ['Rope, rations, lamp oil and gossip.', ['the shopkeeper fences stolen goods in the flour sacks', 'old maps under the counter are the real stock']],
  healer: ['Bone-setting, fevers and quiet births.', ['the healer is hiding a patient with a contagious curse', 'bodies left here sometimes walk out']],
  shrine: ['A small shrine where travellers leave offerings.', ['the offering box funds a smuggling ring', 'the saint\'s relic is a forgery and the real one is buried nearby']],
  bathhouse: ['Hot baths, steam and private rooms.', ['deals between rival houses are struck in the steam room', 'the boilers draw water from an old cistern under the street']],
  moneylender: ['Loans, letters of credit and a strong-room.', ['half the town owes money here, including the watch', 'the strong-room holds a debt-deed for the whole quarter']],
  thieves: ['A back-room where the town\'s thieves meet. GM only.', ['the guild wants a crew for one big job', 'someone inside is informing to the watch']],
  wizard: ['A cramped tower of books, smoke and odd lights.', ['an apprentice is selling the master\'s scrolls', 'the last experiment opened something in the cellar']],
  mill: ['Grinds the district\'s grain for a cut of every sack.', ['the miller has been shorting every farmer for years', 'something under the wheel keeps jamming it at night']],
  tannery: ['Hides, leather goods and a terrible smell.', ['the pits hide more than hides', 'the tanner buys skins from poachers on the lord\'s land']],
  keep: ['The lord\'s keep: garrison, court and dungeon cells.', ['the lord is gravely ill and the steward hides it', 'the dungeon has a sealed lower level the garrison will not enter']],
  temple: ['The great temple: services, alms, records and burials.', ['the archives hold a prophecy someone wants burned', 'the high priest takes tithes to a different god']],
  market: ['Stalls, criers and caravan wagons from dawn to dusk.', ['pickpockets work the stalls for a single fence', 'a merchant sells goods taken from a missing caravan']],
  harbor: ['Piers, warehouses and ships loading for distant ports.', ['two ships carry identical manifests and one is lying', 'the harbourmaster takes a cut of every smuggled crate']],
};
const QUIRKS = [
  'who never forgets a face', 'who speaks only in proverbs', 'who is far too curious about strangers', 'who owes money to the wrong people',
  'who used to adventure and still has the scars', 'who distrusts anyone with a sword', 'who is secretly noble-born', 'who collects strange coins',
  'who is new in town and nervous', 'whose twin runs the rival business', 'who feeds every stray in the street', 'who hums the same tune all day',
];
const JOBS = [
  'pays well to recover a stolen ledger', 'wants a rival frightened, not hurt', 'needs an escort to the next town', 'will pay to find a missing apprentice',
  'wants a package delivered and not opened', 'needs the cellar cleared of something', 'offers a reward for proof against a guild master', 'wants a debt collected',
];
const TROUBLE_CLUES = [
  'a witness who saw too much lives here', 'lodgings of someone missing, door forced', 'a locked cellar with fresh scratches on the door',
  'a strongbox of coin that should not be here', 'a frightened child hiding in the loft', 'a letter half-burned in the hearth',
];
const SETTLEMENT_RE = /^(City|Town|Village|Hamlet) known for (.+?)\. Trouble: (.+?)\./;

/** Reads back what `settlement()` wrote: rank, trait and trouble. */
export function parseSettlement(notes: string | undefined) {
  const m = notes?.match(SETTLEMENT_RE);
  return m ? { rank: m[1]!.toLowerCase() as 'city' | 'town' | 'village' | 'hamlet', trait: m[2]!, trouble: m[3]! } : undefined;
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
    /** A rumour about somewhere on this settlement map, placed relative to its square. */
    localRumour(kind: SiteKind, name: string, square: Point, to: Point): string {
      return `${pick(RUMOUR_LEADS[kind])} ${name}, ${bearing(square, to)} of the square.`;
    },
    establishment(kind: Establishment, owner: string): { notes: string; gmNotes: string } {
      const [service, secrets] = SERVICES[kind];
      return { notes: `${service} Run by ${owner}, ${pick(QUIRKS)}.`, gmNotes: `Secret: ${pick(secrets)}. Job: ${owner} ${pick(JOBS)}.` };
    },
    troubleClue: () => pick(TROUBLE_CLUES),
  };
}
