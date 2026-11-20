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
export type DungeonTheme = 'tomb' | 'den' | 'fortress' | 'temple';
const ROOM_SENSES = [
  'Water drips steadily somewhere out of sight.', 'The air is cold enough to fog breath.', 'A sweet, rotten smell hangs here.',
  'Scratches cover the lower walls.', 'Old soot blackens the ceiling.', 'The floor slopes gently toward a drain.',
  'Faded murals peel from the plaster.', 'Every footstep echoes twice.', 'Roots have split the far wall.',
  'Dust lies thick and undisturbed.', 'Fresh tracks cross the dust.', 'A faint draught smells of earth.',
  'Bones are swept into one corner.', 'Something skittered away as the door opened.', 'Wax drippings crust the floor.',
  'The stones are warm to the touch.', 'Rusted chains hang from ceiling hooks.', 'Mould glows faintly along the joints.',
  'A dried bloodstain trails to the far door.', 'Chalk marks in a crude hand label the doors.', 'Rubble half-blocks one wall.',
  'The ceiling is carved with staring faces.',
];
const ROOM_FEATURES: Record<string, string[]> = {
  guardroom: ['A rack of rusted spears stands by the door', 'A dice game lies abandoned on the table', 'A signal gong hangs from a bracket'],
  storage: ['Split sacks spill mouldy grain', 'Crates are stencilled with a merchant\'s mark', 'A ledger lies open on a barrel head'],
  crypt: ['Stone coffins line the walls, one lid ajar', 'Niches hold skulls with coins in their teeth', 'A carved effigy lies on the central tomb'],
  cistern: ['Dark water fills a sunken basin', 'A rusted wheel works a sluice gate', 'Steps lead down into black water'],
  prison: ['Cell doors hang open on broken hinges', 'Names are scratched into every wall', 'A key ring hangs just out of reach'],
  alchemy: ['Cracked glassware covers the benches', 'A cauldron still holds a crust of something green', 'Shelves of labelled jars, most empty'],
  treasury: ['Iron-bound chests sit behind a low rail', 'An empty pedestal stands in the centre', 'Coin dust glitters between the flagstones'],
  shrine: ['A defaced idol watches the door', 'Offering bowls hold dried flowers', 'Candles burn low on the altar, recently lit'],
  bedroom: ['Bedrolls are laid around a cold firepit', 'A hammock sags between two hooks', 'Personal trinkets are hidden under a loose stone'],
  tavern: ['A long table is set for a feast nobody ate', 'Tankards hang from pegs above a cold hearth', 'A cask is tapped and still dripping'],
};
const DUNGEON_MONSTERS: Record<DungeonTheme, [string[], string[], string[]]> = {
  tomb: [
    ['a swarm of rats', 'two skeletons that rise when the coffins open', 'a grave-robber who would rather talk than fight', 'giant centipedes'],
    ['ghouls feeding on the old dead', 'a wight and its skeleton guard', 'a shadow that drinks lantern light', 'cultists guarding a dig'],
    ['a mummy lord in its wrappings', 'a wraith bound to the vault', 'a bone golem built from the ossuary', 'a lich\'s spectral steward'],
  ],
  den: [
    ['a nest of giant rats', 'a stirge flock clinging to the ceiling', 'kobolds who trap everything', 'a lone hungry wolf'],
    ['goblins and their worg', 'a gelatinous cube cleaning the halls', 'an ogre gnawing a bone', 'a pair of ghouls fighting over scraps'],
    ['a troll with a fresh kill', 'a young black dragon on a bed of coins', 'a chimera that hunts by smell', 'an owlbear mother with cubs'],
  ],
  fortress: [
    ['a bored sentry and his dog', 'bandit lookouts dicing for watches', 'two deserters hiding from their captain', 'a goblin scout'],
    ['an orc patrol of six', 'a mercenary sergeant and crossbowmen', 'a hobgoblin drill squad', 'a hungry gargoyle perched above the door'],
    ['a fallen knight in black plate', 'an ogre warlord and bodyguards', 'a hobgoblin captain with war-trained wolves', 'an iron golem guarding the arms'],
  ],
  temple: [
    ['an acolyte who mistakes the party for pilgrims', 'zombies of the faithful', 'a cultist novice and two thugs', 'animated candlesticks'],
    ['a cult priest leading a rite', 'a gargoyle that moves when unwatched', 'a possessed statue', 'a choir of shadows'],
    ['a fallen angel chained in prayer', 'a demon half-summoned in a circle', 'the cult\'s high priest and their champion', 'a naga coiled around the relic'],
  ],
};
const TRAPS = [
  'a pressure plate fires darts from the walls (tell: tiny holes at chest height)', 'a pit trap under false flagstones (tell: the dust is thinner in a square)',
  'a scything blade swings across the doorway (tell: a groove cut in the floor)', 'the door handle carries contact poison (tell: a green stain on the brass)',
  'a falling block seals the room for an hour (tell: fresh mortar dust on the sills)', 'a gas vent fills the room with sleeping fumes (tell: a faint smell of almonds)',
  'a rune flashes a lightning bolt at the first to cross it (tell: scorch marks on the far wall)', 'the floor tilts toward a spiked trench (tell: the stones rock underfoot)',
];
const SPECIALS = [
  'a talking skull that trades answers for secrets', 'a fountain whose water shows one true vision', 'a statue that turns its head to follow light',
  'a bell that rings when someone tells a lie', 'a mirror showing the room as it was long ago', 'a ghost that asks to be buried properly',
  'a map of the level scratched on a door, with one room wrong', 'an altar that blesses anyone who leaves a coin, and curses thieves',
];
const EMPTY = [
  'signs of a camp with ashes still warm', 'a dead adventurer with a half-written letter', 'boot tracks end at a pile of rubble',
  'old supplies, mostly spoiled; one potion survives', 'a collapsed corner filled with rubble', 'nothing but echoes and a draught',
  'a message chalked in a rival party\'s code', 'the bones of something large, picked clean',
];
const TREASURE: [string[], string[], string[]] = [
  ['a purse of mixed silver', 'a silver holy symbol', 'a jade ring', 'a cask of fine brandy'],
  ['a chest of old coin', 'a jewelled dagger', 'a scroll of protection', 'a pair of gold candlesticks'],
  ['a crown of the old kings', 'a coffer of gems', 'a magic blade with a name', 'a wand with three charges left'],
];
const KEYS = ['an iron key on a bone ring', 'a bronze key shaped like a hand', 'a black glass key that hums', 'a heavy brass seal-key', 'a key carved from a femur', 'a silver key wrapped in a prayer strip'];

export interface DungeonFactionPair {
  entryFaction: string;
  deepFaction: string;
  tension: string;
  aftermath: string;
}

const DUNGEON_FACTIONS: Record<DungeonTheme, DungeonFactionPair[]> = {
  tomb: [
    {
      entryFaction: 'Desperate Grave-Robbers',
      deepFaction: 'Bound Crypt Wardens',
      tension: 'The robbers want the inner vault cracked open but fear the bell-wardens patrolling the deeper galleries.',
      aftermath: 'If the wardens fall, rival looters from the nearest town move in within a week.',
    },
    {
      entryFaction: 'Ashen Cult Excavators',
      deepFaction: 'Ravenous Barrow Ghouls',
      tension: 'The cultists hold the upper choke with torches while ghouls stalk the dark ossuaries behind the seal.',
      aftermath: 'Breaking the cult frees the ghouls to raid nearby farmsteads unless the outer gate is collapsed.',
    },
  ],
  den: [
    {
      entryFaction: 'Kobold Trap-Sappers',
      deepFaction: 'Broodmother Giant Spiders',
      tension: 'The kobolds barricade the entrance wing and lure intruders toward the deep spider galleries.',
      aftermath: 'Clearing the spiders lets the kobolds expand to raid passing trade wagons.',
    },
    {
      entryFaction: 'Goblin Scavengers',
      deepFaction: 'Territorial Ogre & Worgs',
      tension: 'The goblins pay tribute in stolen livestock to keep the ogre from sweeping the upper chambers.',
      aftermath: 'Slaying the ogre fractures the goblin clan into petty road-bandits.',
    },
  ],
  fortress: [
    {
      entryFaction: 'Mutinous Watch Deserters',
      deepFaction: 'Loyalist Ironbound Remnant',
      tension: 'Deserters control the gatehouse and supplies, trying to starve out the loyalists locked inside the inner wing.',
      aftermath: 'Whichever side survives claims toll rights over the nearest road or mountain pass.',
    },
    {
      entryFaction: 'Orc Outriders',
      deepFaction: 'Bound Construct Garrison',
      tension: 'The outriders camp in the outer barracks and fear tripping the ancient iron guardians deeper inside.',
      aftermath: 'Disabling the constructs hands a fortified stronghold to whoever holds the gate.',
    },
  ],
  temple: [
    {
      entryFaction: 'Wayward Pilgrim Zealots',
      deepFaction: 'Shadow-Bound Choir',
      tension: 'The zealots guard the upper shrine and make offerings to appease whatever whispers from the inner sanctum.',
      aftermath: 'Silencing the inner sanctum draws official temple inspectors from the nearest city.',
    },
    {
      entryFaction: 'Rival Relic Hunters',
      deepFaction: 'Sunken-Order Acolytes',
      tension: 'Relic hunters hold a forward camp near the entrance, probing the acolytes’ wards for a safe way past.',
      aftermath: 'Removing the relic breaks the ward keeping nearby crypts quiet.',
    },
  ],
};

const BIOME_ENCOUNTERS: Record<string, string[]> = {
  forest: ['Wary charcoal burners with news of the road', 'A pack of gaunt timber wolves shadowing travelers', 'Elven or ranger outriders demanding toll or news', 'Boars rooting around a mossy milestone', 'Bandit scouts watching from an oak ridge', 'A stray pack-mule carrying a torn saddlebag'],
  rainforest: ['Venomous canopy vipers dropping near camp', 'Rival treasure-seekers lost in the undergrowth', 'A territorial jungle cat stalking the rear rank', 'Fever-flies rising off stagnant pools', 'Overgrown shrine-monkeys stealing shiny gear', 'Giant constrictor coiled across a fallen trunk'],
  desert: ['Water-sellers guarding a brackish cistern', 'Sun-bleached raiders riding lean camels', 'A sudden dust-squall cutting sight to 30 ft', 'Giant scorpions emerging from shaded rock clefts', 'Pilgrims following cairns toward a hidden oasis', 'Vultures circling a half-buried caravan wreck'],
  tundra: ['Frost-bitten fur trappers hauling sleds', 'Winter wolves testing the camp perimeter', 'A whiteout squall hiding the ridge trail', 'Herd of elk stampeding past a glacial erratic', 'Reavers raiding south along frozen streams', 'An abandoned watch-fire still smoking'],
  snow: ['Ice-glazed crevice across the pass', 'Snow-blind courier clutching a wax-sealed tube', 'Crag yeti tracking scent from upwind', 'Avalanche rumble loosening loose scree', 'Frozen mountaineers clutching a map scrap', 'Frost-rimmed wolves circling at dusk'],
  mountain: ['Rockslide blocking a narrow ledge path', 'Dwarven or mule-train prospectors descending', 'Griffons or wyverns wheeling above the saddle', 'Toll-bandits holding a switchback choke', 'Mountain goats revealing a narrow bypass ledge', 'A sudden freezing fog over the high pass'],
  grassland: ['Merchant wagon with a cracked axle', 'Mounted patrol checking travel papers', 'A herd of wild horses kicking up dust', 'Wandering tinker trading rumours for salt', 'Highwaymen waiting behind a low hedge-crest', 'Refugees hurrying toward the nearest town'],
};

const FACTION_RIVALRIES = [
  'taxes road caravans heavily, pushing smugglers onto back trails',
  'is quietly hiring mercenaries to seize a rival bridge or pass',
  'offers bounty coin for proof of their rival’s frontier raids',
  'blocks supply wagons heading into contested borderlands',
  'posts spies in taverns along the border to track rival expeditions',
];

const SETTLEMENT_RE =/^(City|Town|Village|Hamlet) known for (.+?)\. Trouble: (.+?)\./;

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
    // Dungeon rooms: what you notice, what you can poke at, and what is really there.
    sense: () => pick(ROOM_SENSES),
    feature: (purpose: string) => pick(ROOM_FEATURES[purpose] ?? ROOM_FEATURES.storage!),
    monster: (theme: DungeonTheme, band: Band) => pick(DUNGEON_MONSTERS[theme][band]),
    trap: () => pick(TRAPS),
    special: () => pick(SPECIALS),
    empty: () => pick(EMPTY),
    treasure: (band: Band) => pick(TREASURE[band]),
    key: () => pick(KEYS),
    dungeonFactions: (theme: DungeonTheme): DungeonFactionPair => {
      const list = DUNGEON_FACTIONS[theme];
      return list[Math.floor(random() * list.length)]!;
    },
    regionalEncounters: (biome: string, neighborBiome?: string): string[] => {
      const keyOf = (b: string) => {
        const l = b.toLowerCase();
        if (l.includes('rainforest')) return 'rainforest';
        if (l.includes('forest')) return 'forest';
        if (l.includes('desert')) return 'desert';
        if (l.includes('snow')) return 'snow';
        if (l.includes('tundra')) return 'tundra';
        if (l.includes('mountain')) return 'mountain';
        return 'grassland';
      };
      const primary = BIOME_ENCOUNTERS[keyOf(biome)] ?? BIOME_ENCOUNTERS.grassland!;
      const pool = [...primary];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      const chosen = pool.slice(0, 5);
      const nbKey = neighborBiome ? keyOf(neighborBiome) : (keyOf(biome) === 'grassland' ? 'forest' : 'grassland');
      const spillPool = BIOME_ENCOUNTERS[nbKey] ?? BIOME_ENCOUNTERS.grassland!;
      const spill = spillPool[Math.floor(random() * spillPool.length)]!;
      chosen.push(`[Border spillover — ${nbKey}] ${spill}`);
      return chosen;
    },
    factionRivalry: () => pick(FACTION_RIVALRIES),
  };
}
