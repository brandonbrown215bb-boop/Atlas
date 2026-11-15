export const ASSET_TAG_VERSION = 2;
export const UNTAGGED_FILTER = '__untagged__';

export const ASSET_THEMES = [
  'arcane',
  'camp',
  'dungeon',
  'east-asia',
  'fantasy',
  'farm',
  'graveyard',
  'holiday',
  'industrial',
  'medieval',
  'modern',
  'nature',
  'nautical',
  'ruins',
  'sci-fi',
  'tavern',
  'temple',
  'urban',
  'worldmap',
] as const;

export const ASSET_BIOMES = [
  'astral',
  'desert',
  'fall',
  'fey',
  'forest',
  'grassland',
  'jungle',
  'mountain',
  'ocean',
  'red-desert',
  'summer',
  'swamp',
  'underground',
  'urban',
  'volcanic',
  'winter',
] as const;

export const ASSET_PURPOSES = [
  // Structural / placement roles (aligned with THEME_ROLES where applicable)
  'prop',
  'floorTexture',
  'terrainTexture',
  'wallTexture',
  'pathTexture',
  'door',
  'window',
  'roof',
  'light',
  'material',
  'prefab',
  // Worldmap / cartography
  'mountain',
  'hill',
  'forest',
  'settlement',
  'river',
  // Nature & geology
  'tree',
  'bush',
  'plant',
  'flower',
  'grass',
  'fungus',
  'stump',
  'rock',
  'cliff',
  'water',
  'lava',
  'ice',
  'snow',
  'fire',
  // Pathways & architecture
  'bridge',
  'dock',
  'stairs',
  'road',
  'fence',
  'wall',
  'pillar',
  'arch',
  'beam',
  'chimney',
  'statue',
  'building',
  'ruin',
  // Furniture & interior
  'table',
  'chair',
  'bed',
  'altar',
  'desk',
  'shelf',
  'cabinet',
  'counter',
  'rug',
  'hearth',
  'throne',
  // Containers & clutter
  'barrel',
  'crate',
  'chest',
  'bag',
  'bottle',
  'pot',
  'weapon',
  'armor',
  'food',
  'drink',
  'book',
  'treasure',
  'banner',
  'sign',
  'instrument',
  'tool',
  'machine',
  'trap',
  'clothing',
  // Graveyard / horror / creatures / transport / fx
  'grave',
  'coffin',
  'bone',
  'corpse',
  'blood',
  'web',
  'boat',
  'cart',
  'vehicle',
  'tent',
  'animal',
  'creature',
  'rune',
  'debris',
  'shadow',
] as const;

export interface AssetTagClassification {
  themes: string[];
  biomes: string[];
  purposes: string[];
  tags: string[];
}

export interface AssetTagOverride {
  themes?: string[];
  biomes?: string[];
  purposes?: string[];
}

type Rule = [tag: string, pattern: RegExp];

const PACK_NOISE = new Set([
  'ch', 'chr', 'tc', 'tcm', 'tmc', 'mad', 'print', 'assets', 'asset',
  'pack', 'megapack', 'new', 'alt', 'combo', 'light', 'v0', 'v1', 'v2',
]);

// Split CamelCase and letter-to-digit boundaries before lowercasing so Candycane1 -> candycane 1.
export function tokenizeAssetText(text: string): string[] {
  const spaced = text
    .replace(/([a-z\p{Ll}])([A-Z\p{Lu}])/gu, '$1 $2')
    .replace(/([A-Z\p{Lu}]+)([A-Z\p{Lu}][a-z\p{Ll}])/gu, '$1 $2')
    .replace(/([a-z\p{Ll}])([0-9])/gu, '$1 $2');
  return spaced.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const PURPOSE_RULES: Rule[] = [
  // Worldmap / cartography
  ['mountain', /\b(mountain|mountains|mountainpass|peak|volcano)\b/],
  ['hill', /\b(hill|hills|mound|ridge|dune|dunes)\b/],
  ['forest', /\b(forest|woodland|woods|grove|jungle)\b/],
  ['settlement', /\b(settlement|village|town|city|hamlet|keep|fortress|stronghold|citadel)\b/],
  ['river', /\b(river|rivers|stream|creek|brook|waterfall|waterfalls|delta)\b/],

  // Nature & geology
  ['tree', /\b(tree|trees|rtree|stree|ttree|oak|pine|birch|willow|cypress|palm|redwood|sapling|fallen\s*tree|dead\s*tree|bonsai)\b/],
  ['bush', /\b(bush|bushes|shrub|shrubs|hedge|hedges|bramble|brier|briar|thicket)\b/],
  ['flower', /\b(flower|flowers|blossom|blossoms|rose|daisy|daisies|lily|lotus|petal|bouquet)\b/],
  ['fungus', /\b(mushroom|mushrooms|fungi|fungus|toadstool|spore|mycelium)\b/],
  ['stump', /\b(stump|stumps|log|logs|driftwood|firewood)\b/],
  ['grass', /\b(grass|grasses|grassline|tallgrass|lawn|reed|reeds|cattail|wheat|hay|straw|clover|moss)\b/],
  ['plant', /\b(plant|plants|fern|ferns|vine|vines|ivy|kelp|seaweed|algea|algae|coral|cactus|agave|succulent|foliage|leaf|leaves|herb|herbs|crop|corn|weed|weeds)\b/],
  ['cliff', /\b(cliff|cliffs|crag|ledge|ravine|chasm|canyon|escarpment)\b/],
  ['rock', /\b(rock|rocks|boulder|boulders|stone|stones|pebble|pebbles|rubble|crystal|crystals|ore|stalagmite|stalactite|mineral|minerals|meteor|asteroid)\b/],
  ['water', /\b(water|pond|pool|puddle|lake|ocean|sea|fountain|well|spring|geyser|basin|bath|bathtub|aquarium)\b/],
  ['lava', /\b(lava|magma|molten)\b/],
  ['ice', /\b(ice|icy|icicle|glacier|frozen|frost)\b/],
  ['snow', /\b(snow|snowy|snowdrift)\b/],
  ['fire', /\b(fire|flame|flames|ember|embers|campfire|bonfire|hearth|furnace|smoke)\b/],

  // Pathways & elevation
  ['bridge', /\b(bridge|bridges|footbridge|drawbridge|overpass|viaduct)\b/],
  ['dock', /\b(dock|docks|pier|jetty|wharf|gangplank|mooring)\b/],
  ['stairs', /\b(stair|stairs|staircase|stairway|step|steps|ladder|ramp|escalator)\b/],
  ['road', /\b(road|roads|street|path|trail|cobble|cobblestone|paving|pavement|sidewalk|crossroad|curvedroad|track|tracks|rail|railroad)\b/],
  ['fence', /\b(fence|fences|gate|gates|railing|railings|barricade|barricades|barrier|barriers|palisade|balustrade|walling)\b/],

  // Architecture & structure
  ['roof', /\b(roof|roofs|rooftop|rooftops|thatch|shingle|shingles|gable|dormer|awning|canopy)\b/],
  ['door', /\b(door|doors|doorway|portal|portals|hatch|hatches|trapdoor|gate|gates|archway)\b/],
  ['window', /\b(window|windows|casement|shutter|shutters|skylight|arrowslit|slit)\b/],
  ['wall', /\b(rampart|ramparts|battlement|battlements|parapet|partition|divider|walling)\b/],
  ['pillar', /\b(pillar|pillars|column|columns|post|posts|plinth|obelisk|pedestal|bollard)\b/],
  ['arch', /\b(arch|arches|archway|arcade|arbor)\b/],
  ['beam', /\b(beam|beams|girder|girders|rafter|rafters|plank|planks|timber)\b/],
  ['chimney', /\b(chimney|chimneys|flue|smokestack)\b/],
  ['statue', /\b(statue|statues|sculpture|bust|effigy|idol|monument|gargoyle)\b/],
  ['building', /\b(building|buildings|house|houses|hut|cottage|cabin|shack|tower|bastion|castle|fort|gazebo|pavilion|pavillion|shed|barn|mill|warehouse|silo|tent)\b/],
  ['ruin', /\b(ruin|ruins|ruined|wreck|wreckage|collapsed)\b/],

  // Furniture & interior
  ['table', /\b(table|tables|dining|banquet|workbench|roundtable|nightstand|endtable)\b/],
  ['chair', /\b(chair|chairs|stool|stools|bench|benches|seat|seats|sofa|couch|armchair|pew|recliner|lounger)\b/],
  ['throne', /\b(throne|thrones)\b/],
  ['bed', /\b(bed|beds|bedding|bunk|cot|hammock|mattress|pillow|blanket|sleeping\s*bag)\b/],
  ['altar', /\b(altar|altars|shrine|shrines|lectern|pulpit|baptismal|font|podium)\b/],
  ['desk', /\b(desk|desks|writing|secretary|easel)\b/],
  ['shelf', /\b(shelf|shelves|shelving|bookcase|bookshelf|rack|racks|display)\b/],
  ['cabinet', /\b(cabinet|cabinets|wardrobe|dresser|armoire|closet|cupboard|sideboard|locker|drawer)\b/],
  ['counter', /\b(counter|counters|bar|bartop|booth|stall|stand|kiosk|register)\b/],
  ['rug', /\b(rug|rugs|carpet|carpets|mat|mats|runner|runners|tapestry|curtain|curtains|drape)\b/],
  ['hearth', /\b(hearth|fireplace|stove|oven|forge|anvil|bellows|kiln|cauldron|grill)\b/],

  // Containers
  ['barrel', /\b(barrel|barrels|barell|keg|kegs|cask|casks|vat|tun)\b/],
  ['crate', /\b(crate|crates|box|boxes|pallet|pallets|shipping\s*container)\b/],
  ['chest', /\b(chest|chests|coffer|strongbox|trunk|footlocker|safe)\b/],
  ['bag', /\b(bag|bags|sack|sacks|pouch|pouches|backpack|rucksack|knapsack|satchel|bundle|bale|suitcase|luggage)\b/],
  ['bottle', /\b(bottle|bottles|vial|vials|flask|flasks|potion|potions|jar|jars|decanter|alchemy|alembic)\b/],
  ['pot', /\b(pot|pots|pottery|vase|vases|urn|urns|amphora|jug|pitcher|bucket|buckets|basket|baskets|bowl|bowls|canopic|basin|trough)\b/],

  // Props & clutter
  ['light', /\b(torch|torches|lantern|lanterns|brazier|braziers|candle|candles|candelabra|lamp|lamppost|sconce|chandelier|beacon|spotlight|lightbeam|lights)\b/],
  ['weapon', /\b(weapon|weapons|sword|swords|axe|axes|bow|bows|arrow|arrows|spear|lance|halberd|dagger|knife|mace|hammer|staff|gun|rifle|pistol|cannon|ballista|catapult|trebuchet|scythe|sickle|quiver|ammo)\b/],
  ['armor', /\b(armor|armour|armors|shield|shields|buckler|helmet|helm|gauntlet|greave|breastplate|pauldron|chainmail)\b/],
  ['food', /\b(food|bread|meat|cheese|fruit|apple|appel|banana|berry|carrot|cabbage|pumpkin|vegetable|vegetables|pie|cake|fish|egg|eggs|grain|flour|stew|soup|feast|kitchenware|utensil|plate|pan|cutting\s*board)\b/],
  ['drink', /\b(drink|drinks|ale|beer|wine|mead|mug|tankard|goblet|cup|chalice|tea|coffee|glass|tumbler|keg|tap)\b/],
  ['book', /\b(book|books|tome|scroll|scrolls|letter|letters|paper|papers|parchment|note|map|maps|chart|ledger|folio|ink|quill|abacus)\b/],
  ['treasure', /\b(treasure|gold|coin|coins|gem|gems|jewel|jewelry|jewellery|crown|chalice|relic|artifact|trophy|hoard|pearl|diamond|ruby|emerald)\b/],
  ['banner', /\b(banner|banners|flag|flags|pennant|standard|crest|emblem|insignia)\b/],
  ['sign', /\b(sign|signs|signpost|notice|board|bulletin|bounty|marker|markers|placard|billboard)\b/],
  ['instrument', /\b(music|instrument|instruments|drum|drums|lute|harp|piano|flute|horn|bell|organ|violin|guitar)\b/],
  ['tool', /\b(tool|tools|hammer|shovel|pickaxe|saw|wrench|pliers|rope|chain|chains|anchor|pulley|ladder|broom|mop|wheelbarrow|anvil|bellows|loom|scales)\b/],
  ['machine', /\b(machine|machines|machinery|gear|gears|cog|pipe|pipes|valve|engine|boiler|turbine|panel|console|computer|monitor|electronics|appliance|appliances|generator|pump|funnel|conveyor)\b/],
  ['trap', /\b(trap|traps|spike|spikes|snare|cage|cages|gallows|pillory|stocks|rack|guillotine|iron\s*maiden|manacle|shackle|bear\s*trap|pit|mine)\b/],
  ['clothing', /\b(clothing|clothes|cloth|fabric|tailoring|cloak|robe|hat|apron|shirt|pants|coat|boot|boots|shoe|shoes|glove|gloves|tarp)\b/],

  // Graveyard / horror
  ['grave', /\b(grave|graves|graveyard|tomb|tombstone|headstone|gravemarker|gravemarkers|monolith|crypt|mausoleum|sarcophagus|sarcophagi|cenotaph)\b/],
  ['coffin', /\b(coffin|coffins|casket|caskets)\b/],
  ['bone', /\b(bone|bones|skull|skulls|skeleton|skeletons|ribcage|horn|horns|antler|fang|fossil)\b/],
  ['corpse', /\b(corpse|corpses|body|bodies|dead\s*body|carcass|cadaver|remains|mummy)\b/],
  ['blood', /\b(blood|bloody|gore|ichor|splatter)\b/],
  ['web', /\b(web|webs|cobweb|spiderweb)\b/],

  // Transport & shelter
  ['boat', /\b(boat|boats|ship|ships|canoe|raft|rowboat|galleon|sailboat|airship|barge|skiff|sail|sails|oar|oars|helm|mast|capstan|bowsprit|figurehead)\b/],
  ['cart', /\b(cart|carts|wagon|wagons|carriage|carriages|chariot|wheel|wheels|caravan|sled|sleigh)\b/],
  ['vehicle', /\b(vehicle|vehicles|car|cars|truck|bus|van|plane|airplane|jet|helicopter|motorbike|motorcycle|bike|bicycle|train|locomotive|tram)\b/],
  ['tent', /\b(tent|tents|yurt|marquee|pavilion|pavillion|awning)\b/],

  // Living / creatures / FX
  ['animal', /\b(animal|animals|horse|bull|cow|pig|sheep|goat|dog|cat|wolf|bear|deer|stag|bird|raven|crow|owl|chicken|fish|butterfly|butterflies|spider|rat|bat|snake|frog|crab)\b/],
  ['creature', /\b(creature|creatures|monster|dragon|aboleth|beholder|golem|demon|undead|skeleton|zombie|ghost|spider|serpent|nevron)\b/],
  ['rune', /\b(rune|runes|glyph|glyphs|sigil|circle|pentagram|ritual|arcane|magic|summoning|teleport|portal)\b/],
  ['debris', /\b(debris|scrap|trash|garbage|junk|rubble|broken|shattered|damaged|wrecked)\b/],
  ['shadow', /\b(shadow|shadows)\b/],
];

const BIOME_RULES: Rule[] = [
  ['red-desert', /\b(red\s*desert|red\s*waste|red\s*wastes|badlands)\b/],
  ['desert', /\b(desert|deserts|arid|dune|dunes|oasis|cactus|agave|pyramid|egyptian|canopic|sandstone|sand)\b/],
  ['winter', /\b(winter|snow|snowy|frost|frozen|ice|icy|glacier|tundra|blizzard|holiday|candycane|wreath)\b/],
  ['fall', /\b(fall|autumn|autumna|autumnb)\b/],
  ['summer', /\b(summer)\b/],
  ['fey', /\b(fey|feywild|faewild|faewilds|fairy|enchanted|pixie)\b/],
  ['jungle', /\b(jungle|tropics|tropical|amazon|rainforest|palm|bamboo|banana)\b/],
  ['swamp', /\b(swamp|swamps|marsh|bog|mire|bayou|mangrove|cattail|lilypad)\b/],
  ['volcanic', /\b(lava|magma|volcano|volcanic|hellscape|hellscapes|hell|obsidian|brimstone|infernal|cinder)\b/],
  ['underground', /\b(cave|cavern|caverns|undercavern|underdark|subterranean|stalagmite|stalactite|mine|mines|chasm|dungeon|dungeons|sewer|sewers)\b/],
  ['ocean', /\b(ocean|oceans|sea|underwater|coral|corals|kelp|seaweed|algea|algae|anemone|barnacles|reef|aquatic|beach|coast|coastal)\b/],
  ['astral', /\b(astral|cosmic|nebula|star\s*fragment|outer\s*space|spaceship|spacecraft|alien)\b/],
  ['forest', /\b(forest|woods|woodland|wilderwoods|wild\s*woods|into\s*the\s*woods|glade|grove|pine|oak|birch|fern|moss|stump|tree|trees|rtree|stree|ttree|shrub|bush)\b/],
  ['grassland', /\b(grassland|meadow|prairie|plain|plains|pasture|steppe|savanna|field|lawn)\b/],
  ['mountain', /\b(mountain|mountains|mountainpass|alpine|highland|cliff|crag)\b/],
  ['urban', /\b(midtown|city|town|street|alley|plaza|sewer|urban|sidewalk|asphalt|manhole)\b/],
];

const THEME_RULES: Rule[] = [
  ['modern', /\b(modern|airport|appliances|electronics|emergency|sports|car|truck|van|plane|airplane|helicopter|motorbike|motorcycle|computer|monitor|television|ketchup|parking|traffic|neon|microwave|fridge|refrigerator|escalator|subway|camera|ticketbooth)\b/],
  ['sci-fi', /\b(alien|scifi|sci\s*fi|cyber|futuristic|spaceship|spacecraft|laser|robot|android|hologram|airlock|reactor|cloning\s*pod)\b/],
  ['east-asia', /\b(east\s*asia|asian|japanese|japan|chinese|china|pagoda|torii|katana|samurai|kimono|bonsai|tatami|shoji|bamboo|sakura|cherry\s*blossom|teppanyaki|terracotta|jade|air\s*nation|air\s*nomad|airbending|mogu)\b/],
  ['nautical', /\b(shipwright|galleon|nautical|pirate|ship|ships|airship|skyship|shipwood|boat|boats|sail|sails|anchor|anchors|bowsprit|capstan|figurehead|dock|docks|pier|canoe|raft|harbor|harbour|coral|anemone|kelp|seaweed|seaweeds|algea|algae|barnacles|starfish|oceans|seamoss|waterrock|watertiles|unwaterwood|underwater|bubbles|shell|clam|pearl|pearls|barge|fishing)\b/],
  ['graveyard', /\b(death|graveyard|cemetery|tomb|tombs|tombstone|headstone|headstones|gravemarker|gravemarkers|gravestone|gravestones|coffin|casket|sarcophagus|sarcophagi|crypt|mausoleum|vampire|undead|skeleton|corpse|deadbody|bones|skull|gothic|crematorium|urn|urns|stele)\b/],
  ['dungeon', /\b(dungeon|dungeons|delve|lair|lairs|condemned|torture|gallows|cage|prison|cell|chain|chains|shackle|manacle|trap|traps|portcullis|sewer|sewers|undercavern|underdark|mindflayer|illithid|aboleth|beholder|stalactite|stalagmite|spike|spikes|spider\s*web|spider|cobweb|blood|arrowslit|cave|cavern|acid|lava|lavalow|lavafall|torch|torches|brazier|braziers|gargoyle|demon|armory|barracks|pit|crater|grate)\b/],
  ['tavern', /\b(tavern|taverns|inn|pub|ale|beer|wine|bar|bartop|tankard|mug|keg|barrel|hearth|kitchen|dining|banquet|shop|shops|bakery|merchant|commerce|merchants|bread|croissant|burger|honey|cup|plate|dice)\b/],
  ['temple', /\b(temple|temples|altar|shrine|cathedral|church|chapel|monastery|abbey|relic|pew|pulpit|idol|sacred|ritual|cult|cultist|cultists|canopic|anubis|pyramid|incense|angel|censer|erdtree)\b/],
  ['arcane', /\b(arcane|wizard|mage|archmage|alchemy|alchemist|apothecary|potion|potions|rune|runes|glyph|glyphs|spell|scroll|scrolls|astral|crystal|orb|summoning|teleport|ritual|cauldron|caldron|fey|faewild|faewilds|fairy|pixie|element|elements|magic|magical|orrery|nebula|void|eldritch|mindflayer|illithid|aboleth|beholder|amulet|circlet|gem|gems|jewellery|jewelry|enchanted|lunar|puzzle|golem|wyvern|wyvernling|griffon|pegasus)\b/],
  ['ruins', /\b(ruin|ruins|ruined|castleruined|houseruined|broken|damaged|fallen|overgrown|cracked|collapsed|ancient|relic|wreck|fossil|decaying)\b/],
  ['camp', /\b(camp|camping|tent|tents|campfire|bonfire|caravan|bedroll|backpack|adventure\s*pack|bedouin)\b/],
  ['farm', /\b(farm|farmland|barn|crop|crops|corn|wheat|hay|straw|plow|coop|apiary|scarecrow|pasture|bull|cow|pig|chicken|sheep|goat|beehive)\b/],
  ['industrial', /\b(mechanism|machine|machines|machinery|factorymachine|toyconveyorbelt|conveyor|gear|gears|cog|pipe|pipes|factory|warehouse|foundry|minecart|train|boiler|steam|girder|automaton|drone|piston|valve|crane|pulley|workbench|workbenches)\b/],
  ['holiday', /\b(holiday|christmas|candycane|wreath|ornament|santa|xmas|gift|present|largepresent|mediumpresent|smallpresent)\b/],
  ['worldmap', /\b(worldmap|world\s*map|modular\s*map|pre\s*made|cartography|compass\s*rose|quest\s*marker|quest\s*markers)\b/],
  ['urban', /\b(town\s*maps|town|city|midtown|commerce|blackbottom|market|plaza|street|alley|building|buildings|town\s*house|bazaar|lamppost|lamp\s*post|sidewalk|fountain|gazebo|pavilion|pavillion|clothesline|laundry|house|houses|arbor|clerks|artists|trianon|piano|gramophone|sign|signboard|easel)\b/],
  ['medieval', /\b(castle|castles|castleruined|bastion|bastions|fort|stronghold|knight|shield|sword|armor|armour|halberd|ballista|catapult|throne|heraldry|banner|flag|blacksmith|medieval|peasant|cottage|timber|crenelation|palisade|parapet|chimney|anvil|bellows|forge|wagon|cart|drawbridge|quiver|crossbow|bow|dagger|spear|axe|armory|barracks|archway|arrow|arrows|helm|bracer|bracers|cloak|tunic|robe|bookshelf|bookshelves|bookcase|bookstand|lectern|lecturn|armoire|wardrobe|dresser|chandelier|goblet|chalice|crown|cobble|cobblestone|cobblestones|flagstone|flagstones|thatch|thatched|tudor|roof|roofs|dwarven|coin|coinbag|coinpurse|coinsack)\b/],
  ['nature', /\b(nature|natural|biomes|biome|gardens|garden|seasons|woods|forest|woodland|wilderwoods|wild\s*woods|into\s*the\s*woods|swamp|swamps|desert|deserts|tropics|jungle|tree|trees|treestump|treetrunk|grassline|sapling|canopy|planter|bush|bushes|shrub|shrubs|plant|plants|flower|flowers|blossom|fern|moss|clover|grass|grassmix|mushroom|mushrooms|fungi|rock|rocks|boulder|cliff|cliffs|waterfall|river|geyser|coral|anemone|animal|animals|bird|fish|butterflies|butterfly|cactus|agave|palm|cypress|oak|pine|willow|driftwood|log|stump|deadleaves|dirtpatch|woodchips|waterrock|seamoss|seaweeds|ice|snow|sand|dirt|mud|pebbles|stones|leaves|branch|root|roots|hedge|fossil|pond|lake|marsh|reed|reeds|egg|eggs|nest|nests|feather)\b/],
];

function addAll(target: Set<string>, text: string, rules: Rule[]) {
  for (const [tag, pattern] of rules) {
    if (pattern.test(text)) target.add(tag);
  }
}

export function classifyAsset(packName: string, relativePath: string): AssetTagClassification {
  const normPath = relativePath.replace(/\\/g, '/');
  const slash = normPath.lastIndexOf('/');
  const folder = slash >= 0 ? normPath.slice(0, slash) : '';
  const fileName = slash >= 0 ? normPath.slice(slash + 1) : normPath;
  const stem = fileName.replace(/\.[^.]+$/, '');

  const packTokens = tokenizeAssetText(packName);
  const folderTokens = tokenizeAssetText(folder);
  const fileTokens = tokenizeAssetText(stem);
  const rawPathTokens = normPath.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  const packText = packTokens.join(' ');
  const folderFileText = [...folderTokens, ...fileTokens].join(' ');
  const fullText = [packText, folderFileText].filter(Boolean).join(' ');

  const purposes = new Set<string>();
  const biomes = new Set<string>();
  const themes = new Set<string>();

  // 1. Structural purposes from Dungeondraft / Nimblehold / Atlas folder conventions
  const lowerPath = normPath.toLowerCase();
  const topDir = lowerPath.split('/')[0] ?? '';

  if (topDir === 'objects') purposes.add('prop');
  else if (topDir === 'paths') purposes.add('pathTexture');
  else if (topDir === 'walls') purposes.add('wallTexture');
  else if (topDir === 'patterns') purposes.add('floorTexture');
  else if (topDir === 'terrain') purposes.add('terrainTexture');
  else if (topDir === 'materials') purposes.add('material');
  else if (topDir === 'roofs') purposes.add('roof');
  else if (topDir === 'lights') purposes.add('light');
  else if (topDir === 'tilesets') purposes.add('floorTexture');
  else if (topDir === 'portals') {
    if (/\bwindow\b/.test(folderFileText)) purposes.add('window');
    else purposes.add('door');
  } else if (topDir === 'terrains') {
    purposes.add('terrainTexture');
    if (lowerPath.includes('pre-made')) purposes.add('prefab');
  } else if (topDir === 'generation') {
    if (lowerPath.startsWith('generation/floors/')) purposes.add('floorTexture');
    else if (lowerPath.startsWith('generation/walls/')) purposes.add('wallTexture');
    else if (lowerPath.startsWith('generation/terrain/paths/')) purposes.add('pathTexture');
    else if (lowerPath.startsWith('generation/terrain/')) purposes.add('terrainTexture');
  }

  // Nested structural folders (e.g. TC Roofs, TC Prefabs, TC Floors, TC Buildings Insides Dressed)
  if (/\bprefabs?\b/.test(fullText) || /\binsides dressed\b/.test(folderText(folderTokens))) {
    purposes.add('prefab');
  }
  if (/\bfloor(s|ing)?\b/.test(folderText(folderTokens)) && /\b(surface|surfaces|pattern|patterns|tile|tiles|flagstone|plank|planks|floor)\b/.test(folderFileText)) {
    purposes.add('floorTexture');
  }
  if (/\bwall(s)?\b/.test(folderText(folderTokens)) && /\b(surface|surfaces|modular|wall|walls)\b/.test(folderFileText)) {
    purposes.add('wallTexture');
    purposes.add('wall');
  }
  if (/\b(wall|walls)\b/.test(folderFileText) && !/\b(shelf|brazier|torch|lamp|lantern|flag|banner|painting|mirror|sign|vine|ivy|pillar|statue|light|clock|window)\b/.test(folderFileText)) {
    purposes.add('wall');
  }

  // 2. Semantic purpose from folder + filename (never from unrelated pack titles like "Team Light")
  addAll(purposes, folderFileText, PURPOSE_RULES);

  // Explicit worldmap/townmap packs represent cartography stamps even when filenames are e.g. village_1b
  if (/\b(worldmap|world map|town maps)\b/.test(packText)) {
    if (/\b(town|city|village|castle|keep|fort|house|tower|settlement)\b/.test(folderFileText)) {
      purposes.add('settlement');
    }
  }
  if (/\b(tc roofs|roofs)\b/.test(folderText(folderTokens)) || /\broof\b/.test(packText)) {
    purposes.add('roof');
  }
  if (/\b(tc tents)\b/.test(folderText(folderTokens))) {
    purposes.add('tent');
  }

  // 3. Biomes
  addAll(biomes, fullText, BIOME_RULES);
  // "Red Desert" or "Red Wastes" should not also pollute regular "desert" unless generic, wait:
  // keeping 'desert' alongside 'red-desert' can be helpful or distinct; let's keep red-desert distinct
  // when explicitly red desert / red waste, unless 'desert' also helps search. Actually keeping both or
  // removing 'desert' when 'red-desert'? Leaving 'desert' when 'red desert' appears is expected for searches.

  // 4. Themes
  addAll(themes, fullText, THEME_RULES);
  // Modern kitchens/bars/fridges shouldn't be tagged as fantasy taverns unless explicitly tavern/pub/inn.
  if (themes.has('modern') && themes.has('tavern') && !/\b(tavern|taverns|inn|pub|ale|mead)\b/.test(fullText)) {
    themes.delete('tavern');
  }
  // Generic traditional interior/structural props without a more specific theme belong to medieval.
  if (!themes.has('modern') && !themes.has('sci-fi') && themes.size === 0) {
    if (/\b(table|chair|bench|bed|desk|shelf|cabinet|door|doors|window|wall|walls|brick|bricks|carpet|rug|curtain|candle|lantern|lamp|chest|crate|barrel|basket|bag|bottle|pot|vase|cupboard|counter|stool|book|scroll|inkwell|quill|tile|tiles|plank|planks|wood|beam|beams|awning|fence|stair|stairs|staircase|stone|pillar|statue|gate|gates)\b/.test(folderFileText)) {
      themes.add('medieval');
    }
  }
  // Default fantasy theme for traditional packs unless explicitly modern/sci-fi
  if (!themes.has('modern') && !themes.has('sci-fi')) {
    if (themes.size > 0 || /^(ch|chr|nimblehold|tc|tmc)\b/.test(packText)) {
      themes.add('fantasy');
    }
  }

  // 5. Combined searchable tags (preserving original path tokens for backwards compatibility)
  const tagSet = new Set<string>(rawPathTokens);
  for (const t of [...folderTokens, ...fileTokens]) {
    if (t.length >= 2) tagSet.add(t);
  }
  for (const t of packTokens) {
    if (t.length >= 2 && !PACK_NOISE.has(t) && !/^\d+$/.test(t)) tagSet.add(t);
  }
  for (const t of themes) { tagSet.add(t); tagSet.add(`theme:${t}`); }
  for (const b of biomes) { tagSet.add(b); tagSet.add(`biome:${b}`); }
  for (const p of purposes) { tagSet.add(p); tagSet.add(`purpose:${p}`); }

  return {
    themes: [...themes].sort(),
    biomes: [...biomes].sort(),
    purposes: [...purposes].sort(),
    tags: [...tagSet],
  };
}

function folderText(tokens: string[]): string {
  return tokens.join(' ');
}

export function applyTagOverrides(
  classified: AssetTagClassification,
  override?: AssetTagOverride,
): AssetTagClassification {
  if (!override) return classified;
  const themes = [...new Set(override.themes ?? classified.themes)].sort();
  const biomes = [...new Set(override.biomes ?? classified.biomes)].sort();
  const purposes = [...new Set(override.purposes ?? classified.purposes)].sort();
  const baseTags = classified.tags.filter(
    t => !t.startsWith('theme:') && !t.startsWith('biome:') && !t.startsWith('purpose:'),
  );
  const tagSet = new Set<string>(baseTags);
  for (const t of themes) { tagSet.add(t); tagSet.add(`theme:${t}`); }
  for (const b of biomes) { tagSet.add(b); tagSet.add(`biome:${b}`); }
  for (const p of purposes) { tagSet.add(p); tagSet.add(`purpose:${p}`); }
  return { themes, biomes, purposes, tags: [...tagSet] };
}
