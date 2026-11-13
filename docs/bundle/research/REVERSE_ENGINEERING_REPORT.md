# Master Reverse-Engineering Report: The Three Map Archetypes

**Analyzed Map Tools:**
1. **Canvas of Kings Demo** (`e:\SteamLibrary\steamapps\common\Canvas of Kings Demo`)
   - **Archetype:** 2.5D Hand-Drawn Tactical / Regional Map Editor
   - **Engine:** Godot 4.3 (Custom MultiMesh + Texture2DArray Batching, Bézier Spline Extruder)
2. **Dungeon Alchemist** (`c:\Users\brand\Documents\TTRPG\00_INBOX\00_Downloads_Unsorted\Dungeon_Alchemist...`)
   - **Archetype:** 3D Procedural Indoor Encounter / Dungeon Builder
   - **Engine:** Unity Mono (Wave Function Collapse, Straight Skeleton Roofs, 2D Polygon Booleans)
3. **Fantasy Map Simulator** (`E:\SteamLibrary\steamapps\common\FantasyMapSimulator`)
   - **Archetype:** Macro-Scale Procedural World & Geopolitical Simulation
   - **Engine:** Unity IL2CPP v29 (`GameAssembly.dll` 53.4 MB, `global-metadata.dat` 13,681 types)

---

## 1. Toolchain Diagnostic: The Software Needed for Fantasy Map Simulator

To get a full C# dump of Fantasy Map Simulator's IL2CPP codebase:

| Tool | Purpose | How to Get It |
| :--- | :--- | :--- |
| **`Il2CppDumper`** | Takes `GameAssembly.dll` and `global-metadata.dat`, restoring clean C# `DummyDll/` assemblies that open directly in `ILSpy` / `dnSpy`, plus `dump.cs` with all method offsets and field layouts. | Download `Il2CppDumper-v6.x.x.zip` from GitHub Releases (Perfare/Il2CppDumper). |

*Note: For this report, we extracted the IL2CPP v29 metadata headers, type definitions, fields, methods, and string tables directly using our custom Python parser.*

---

## 2. Fantasy Map Simulator: Architectural Breakdown

Unlike Canvas of Kings (hand-placed assets) and Dungeon Alchemist (room-scale grids), Fantasy Map Simulator operates at the **macro world scale**. It generates continents, climates, nations, and runs autonomous wars and diplomacy.

```
Fantasy Map Simulator Architecture
├── Planetary & Terrain Engine
│   ├── Voronoi / Delaunay Cell Graph (csDelaunay.Voronoi)
│   ├── Multi-Octave Noise Heightmap (FastNoiseLite: Simplex + Domain Warp)
│   ├── Elevation Analyzer (ElevationBasedTerrainAnalyzer: Ocean, Coast, Plains, Hills, Mountains)
│   └── Hydrology Engine (CreateControlPointsForRiver: Downhill flow accumulation)
├── Geopolitical Hierarchy (Azgaar Model)
│   ├── Burgs / Settlements (BurgsAndStateGenerator - spawned on freshwater & harbors)
│   ├── Province / State Expansion (Dijkstra flood-fill factoring in terrain slope & getRiverCost)
│   ├── Border Tracing (BorderCalculationHelper on Voronoi cell edges)
│   └── SDF Border Rendering (SDFTextureGenerator for razor-sharp borders at all zoom levels)
└── Autonomous Simulation & Living World
    ├── Cultural & Religious Diffusion (MapCultureManager, MapReligionManager)
    ├── Diplomacy & Alliances (AllianceManager: coalitions, treaties, unbroken pacts)
    ├── Military & Warfare (ArmyManager: land marching, transport ship embarkation, battle FX)
    └── Dynasties & Rebellions (CapitalFallCivilWarEvent, RebellionReasonGenerator)
```

### Module 1: The Voronoi Cell Graph (`csDelaunay.Voronoi`)
- **Why Not a Pixel Grid?** Standard square grids create unnatural, blocky 90-degree nation borders and river flows.
- **The Solution:** Partitions the 2D plane into thousands of irregular convex polygon cells using a **Voronoi diagram** (dual of Delaunay triangulation).
- Every cell holds:
  - `center: Vector2` (site position)
  - `neighbors: List<Cell>`
  - `elevation: float`
  - `moisture: float`
  - `biome: BiomeData`
  - `provinceId: int`, `stateId: int`, `cultureId: int`

### Module 2: FastNoiseLite & Elevation Analysis (`ElevationBasedTerrainAnalyzer`)
- Uses `FastNoiseLite` with **Domain Warping** (`SingleDomainWarpSimplexGradient`) to distort raw noise coordinates before sampling. This creates natural, craggy coastlines and jagged mountain chains rather than smooth round blobs.
- Cells are classified into discrete bands:
  - $< 0.2$: Deep Ocean
  - $0.2 - 0.28$: Shallow Water / Coast
  - $0.28 - 0.55$: Lowland / Plains
  - $0.55 - 0.75$: Highlands / Hills
  - $> 0.75$: Mountain Ridge

### Module 3: River Flow & Control Points (`CreateControlPointsForRiver`)
- Rainfall is deposited in highland/mountain cells.
- Water flows from each cell to its **lowest elevation neighbor**:
  $$\text{next\_cell} = \arg\min_{n \in \text{neighbors}}(\text{elevation}_n)$$
- Flow accumulates at each junction. When flow exceeds a threshold, a river is created.
- `CreateControlPointsForRiver` smooths the raw Voronoi cell center steps into natural Bézier curves that discharge into the ocean.

### Module 4: The Settlement & State Expansion Engine (`BurgsAndStateGenerator`)
This follows the battle-tested **Azgaar Fantasy Worldgen model**:
1. **Burg Placement:** Scores every cell for human habitability:
   $$\text{Score} = \text{Freshwater Bonus} + \text{Harbor Bonus} - |\text{Ideal Elevation} - \text{Elevation}|$$
   Top-scoring cells spawn **Burgs** (towns/cities).
2. **State Seeding:** The most powerful burgs are designated State Capitals.
3. **Territory Expansion:** States and Provinces expand outwards simultaneously across the Voronoi graph using cost-weighted Dijkstra/A* pathfinding:
   $$\text{Traversal Cost} = \text{Base Cost} + \Delta\text{Elevation} + \text{River Crossing Cost} (\texttt{getRiverCost})$$
   Rivers and mountain ridges act as natural borders because their crossing cost is high.

### Module 5: SDF Sharp Borders & Inaccessibility Poles
- **Signed Distance Fields (`SDFTextureGenerator`):** Traditional line rendering blurs or aliases when zooming from planet view down to province view. Fantasy Map Simulator computes an SDF texture of state borders, rendering them crisp at any zoom level in a single shader pass.
- **Label Placement:** Uses `polePos` and `poleCellIndex` (Pole of Inaccessibility)—finding the point inside each nation's irregular polygon furthest from all borders—so kingdom name labels are never cut off or placed outside the territory.

### Module 6: Autonomous Military & Diplomatic Simulation
- **Armies (`ArmyManager`):** Pathfinds along Voronoi cells. If an army enters a water cell, it swaps its sprite to a transport ship (`c_ArmyTransportShipSpriteIconResourcePath`) and applies water movement speed.
- **Dynamic Wars & Rebellions:** Alliances track membership timestamps (`timeStampJoinNewMember`) and broken pacts. If a nation's capital is captured, `CapitalFallCivilWarEvent` triggers, splintering the empire into rebel factions.

---

## 3. Comparative Architecture Matrix (The Three Tools)

| System | Canvas of Kings (Godot 4.3) | Dungeon Alchemist (Unity Mono) | Fantasy Map Simulator (Unity IL2CPP) |
| :--- | :--- | :--- | :--- |
| **Scale & Scope** | Local tactical encounter to small town (100m – 2km) | Indoor room & battlemap (10m – 100m) | Macro continent & world (500km – 10,000km) |
| **Spatial Graph** | Continuous 2D/3D Euclidean coordinates | Orthogonal square grid (5ft / 1.5m tiles) | Irregular 2D Voronoi / Delaunay polygon graph |
| **Geometry Core** | Bézier splines + Godot `Geometry2D` | `Polybool.Net` (2D polygon booleans) | `csDelaunay.Voronoi` + Graph adjacency |
| **Map Generation** | Manual stamping + freeform spline roads | Automated WFC + Concave corner scoring | FastNoiseLite + Downhill rivers + Dijkstra state expansion |
| **Roofs / Structures** | Spline-aligned sprites with shader angle mitering | 3D Straight Skeleton wavefront extrusion | 2D procedural town icons / Burg data points |
| **Rendering Secret** | `MultiMeshInstance3D` with dead-index pool recycling | Traditional 3D meshes + dynamic light shadows | Signed Distance Field (SDF) textures for vector-sharp borders |
| **Simulation** | Static map creation (animated smoke/water effects) | Static encounter export (VTT / video) | Real-time geopolitical simulation (wars, trade, borders, armies) |

---

## 4. Master Blueprint: The Ultimate Map Tool Architecture

By combining the best mechanics from all three tools, here is the complete stack to build your own engine:

```mermaid
flowchart TD
    subgraph Level 1: Macro World Generator (Fantasy Map Simulator Style)
        W1["Voronoi Cell Graph (csDelaunay / d3-delaunay)"] --> W2["Domain-Warped FastNoiseLite Heightmap"]
        W2 --> W3["Hydrology (Steepest downhill river paths)"]
        W3 --> W4["Burgs & Dijkstra State Flood-Fill"]
        W4 --> W5["SDF Border & Coastline Shaders"]
    end
    
    subgraph Level 2: Tactical & Regional Map Layer (Canvas of Kings Style)
        R1["Bézier Spline Roads, Rivers & Palisade Walls"] --> R2["Parallel-Swept Field & Crop Generators"]
        R2 --> R3["MultiMesh Billboard Batching + Index Recycling Pool"]
        R3 --> R4["Dynamic Procedural Snow & Weather Shaders"]
    end
    
    subgraph Level 3: Dungeon & Room Layer (Dungeon Alchemist Style)
        D1["2D Polygon Boolean Room Union (Polybool / Clipper)"] --> D2["Wave Function Collapse (WFC) Floor Tiling"]
        D2 --> D3["Concave Corner Biased Prop Snapping"]
        D3 --> D4["Straight Skeleton Procedural Pitched Roofs"]
        D4 --> D5["Universal VTT (.dd2vtt) & Video Exporters"]
    end

    Level 1 --> Level 2
    Level 2 --> Level 3
```

### The 4 High-Impact Components to Build First:

1. **The Voronoi Graph (For World Maps):**
   - Partition your world into 2,000–10,000 Voronoi points. 
   - Assign elevation, moisture, and biome to each cell. 
   - Trace rivers by stepping from high cells to lowest neighbor cells.
2. **The Bézier Spline Extruder (For Roads & Walls):**
   - Anchor points + control handles. 
   - Parameterize arc length so walls and fence posts stamp at uniform distances with perpendicular normal offsets.
3. **The MultiMesh Index Recycling Pool (For Rendering):**
   - Allocate GPU hardware instances upfront.
   - When props are deleted, scale to 0 and push index to a recycling array. Never rebuild the buffer.
4. **Universal VTT Exporter (For Usability):**
   - Output `.dd2vtt` JSON with line-of-sight wall segments, door portals, and lights so your maps work immediately in Foundry VTT and Roll20.
