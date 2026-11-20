import { useStore } from 'zustand';
import { CLOCK_TIME, formatMeasureDistance, formatTravelDuration, measureRoute, sampleRouteTerrain, type TravelSeason } from '../geom/measure';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

export function MeasureBar({ panelId, worldId, mapId }: { panelId: string; worldId: string; mapId: string }) {
  const world = useStore(worldStore, (s) => s.world);
  const stored = useStore(viewStore, (s) => s.measurements[panelId]);
  const speed = useStore(viewStore, (s) => s.measureSpeedMph);
  const departure = useStore(viewStore, (s) => s.measureDeparture);
  const schedule = useStore(viewStore, (s) => s.measureSchedule);
  const markers = useStore(viewStore, (s) => s.measureMarkers);
  const terrainWeighted = useStore(viewStore, (s) => s.measureTerrainWeighted);
  const season = useStore(viewStore, (s) => s.measureSeason);
  const showHorizonRing = useStore(viewStore, (s) => s.showHorizonRing);
  const route = stored?.worldId === worldId && stored.mapId === mapId ? stored : null;
  const activeMap = world?.maps[mapId];
  const points = route ? [...route.points, ...(!route.finished && route.hover ? [route.hover] : [])] : [];
  const speedMph = Number(speed);
  const validSpeed = speed.trim() !== '' && Number.isFinite(speedMph) && speedMph > 0;
  let result;
  let error = '';
  try {
    result = measureRoute(points, validSpeed ? speedMph : undefined, CLOCK_TIME.test(departure) ? departure : undefined, schedule ?? undefined);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const terrainSample = terrainWeighted && points.length >= 2 ? sampleRouteTerrain(points, activeMap, season) : null;
  const preview = route?.hover && !route.finished;
  return (
    <div className="measure-bar" data-testid="measure-bar" data-point-count={route?.points.length ?? 0}>
      <div className="measure-controls">
        <label>Speed (mph) <input data-testid="measure-speed" aria-label="Travel speed in miles per hour" type="number" min="0.01" step="any" value={speed} onChange={(e) => viewStore.getState().setMeasureSpeedMph(e.target.value)} /></label>
        <label>Depart <input data-testid="measure-departure" aria-label="Departure time" type="time" value={departure} onChange={(e) => viewStore.getState().setMeasureDeparture(e.target.value)} /></label>
        <label><input aria-label="Daily travel schedule" type="checkbox" checked={!!schedule} onChange={e => viewStore.getState().setMeasureSchedule(e.target.checked ? {startTime:'08:00',hoursPerDay:8} : null)} />Daily schedule</label>
        {schedule && <>
          <label>Resume <input aria-label="Daily travel start" type="time" value={schedule.startTime} onChange={e => viewStore.getState().setMeasureSchedule({...schedule,startTime:e.target.value})} /></label>
          <label>Hours/day <input aria-label="Travel hours per day" type="number" min={.25} max={24} step={.25} value={schedule.hoursPerDay} onChange={e => viewStore.getState().setMeasureSchedule({...schedule,hoursPerDay:Number(e.target.value)})} /></label>
        </>}
        <button type="button" data-testid="measure-watch-preset" title="Pointcrawl watch pace (3 mph, 6h/day)" onClick={() => { viewStore.getState().setMeasureSpeedMph('3'); viewStore.getState().setMeasureSchedule({ startTime: schedule?.startTime || '08:00', hoursPerDay: 6 }); }}>6h Walk</button>
        <button type="button" data-testid="measure-ride-preset" title="Cavalry / Pointcrawl ride (5 mph, 8h/day)" onClick={() => { viewStore.getState().setMeasureSpeedMph('5'); viewStore.getState().setMeasureSchedule({ startTime: schedule?.startTime || '08:00', hoursPerDay: 8 }); }}>Ride</button>
        <button type="button" data-testid="measure-boat-preset" title="River / coastal barge (4 mph, 12h/day)" onClick={() => { viewStore.getState().setMeasureSpeedMph('4'); viewStore.getState().setMeasureSchedule({ startTime: schedule?.startTime || '06:00', hoursPerDay: 12 }); }}>Boat</button>
        <label><input aria-label="Show travel markers" type="checkbox" checked={markers} onChange={e => viewStore.getState().setMeasureMarkers(e.target.checked)} />Watch/camp marks</label>
        <label><input aria-label="Terrain-weighted travel" type="checkbox" checked={terrainWeighted} onChange={e => viewStore.getState().setMeasureTerrainWeighted(e.target.checked)} />Terrain-weighted</label>
        {terrainWeighted && (
          <label>Season{' '}
            <select data-testid="measure-season" aria-label="Travel season" value={season} onChange={e => viewStore.getState().setMeasureSeason(e.target.value as TravelSeason)}>
              <option value="summer">Summer</option>
              <option value="spring">Spring (floods)</option>
              <option value="autumn">Autumn (fog)</option>
              <option value="winter">Winter (snow)</option>
            </select>
          </label>
        )}
        <label><input aria-label="Horizon and 1-day jitter ring" type="checkbox" checked={showHorizonRing} onChange={e => viewStore.getState().setShowHorizonRing(e.target.checked)} />Horizon / ±20% ring</label>
        <button type="button" data-testid="measure-finish" disabled={!route || route.points.length < 2 || route.finished} onClick={() => route && viewStore.getState().setMeasurement(panelId, { ...route, hover: null, finished: true })}>Finish</button>
        <button type="button" data-testid="measure-clear" disabled={!route} onClick={() => viewStore.getState().setMeasurement(panelId, null)}>Clear</button>
      </div>
      <div className="measure-results">
        <strong data-testid="measure-distance" data-metres={result?.metres ?? 0}>{result ? formatMeasureDistance(result) : '—'}</strong>
        {preview && <span>(preview)</span>}
        {result?.durationSeconds !== null && result?.durationSeconds !== undefined && points.length >= 2 && <span data-testid="measure-duration">Travel: {formatTravelDuration(result.durationSeconds)}</span>}
        {terrainSample && result?.durationSeconds !== null && result?.durationSeconds !== undefined && points.length >= 2 && (
          <span data-testid="measure-terrain-weighted" title={`Speed factor ${terrainSample.factor.toFixed(2)}x (${terrainSample.season})`}>
            Terrain ({terrainSample.terrainLabel}{terrainSample.season !== 'summer' ? `, ${terrainSample.season}` : ''}): {formatTravelDuration(result.durationSeconds * terrainSample.weightedSecondsMultiplier)} · Lost check: {terrainSample.lostChance}
            {terrainSample.unbridgedCrossings > 0 ? ` · ${terrainSample.unbridgedCrossings} unbridged river ${terrainSample.unbridgedCrossings === 1 ? 'crossing' : 'crossings'}` : ''}
            {[
              terrainSample.domainBreakdown.road > 0.05 ? `Road ${Math.round(terrainSample.domainBreakdown.road * 100)}%` : '',
              terrainSample.domainBreakdown.woods > 0.05 ? `Woods ${Math.round(terrainSample.domainBreakdown.woods * 100)}%` : '',
              terrainSample.domainBreakdown.rough > 0.05 ? `Rough ${Math.round(terrainSample.domainBreakdown.rough * 100)}%` : '',
              terrainSample.domainBreakdown.water > 0.05 ? `Water ${Math.round(terrainSample.domainBreakdown.water * 100)}%` : '',
            ].filter(Boolean).length > 0
              ? ` [${[
                  terrainSample.domainBreakdown.road > 0.05 ? `Road ${Math.round(terrainSample.domainBreakdown.road * 100)}%` : '',
                  terrainSample.domainBreakdown.woods > 0.05 ? `Woods ${Math.round(terrainSample.domainBreakdown.woods * 100)}%` : '',
                  terrainSample.domainBreakdown.rough > 0.05 ? `Rough ${Math.round(terrainSample.domainBreakdown.rough * 100)}%` : '',
                  terrainSample.domainBreakdown.water > 0.05 ? `Water ${Math.round(terrainSample.domainBreakdown.water * 100)}%` : '',
                ].filter(Boolean).join(', ')}]`
              : ''}
          </span>
        )}
        {result?.arrival && points.length >= 2 && <span data-testid="measure-arrival">Arrive: {result.arrival.time}{result.arrival.dayOffset > 0 ? ` (+${result.arrival.dayOffset} ${result.arrival.dayOffset === 1 ? 'day' : 'days'})` : ''}</span>}
        {schedule && result?.elapsedSeconds != null && points.length >= 2 && <span data-testid="measure-elapsed">Elapsed: {formatTravelDuration(result.elapsedSeconds)} · {result.restStops} rest {result.restStops === 1 ? 'stop' : 'stops'}</span>}
        {speed.trim() && !validSpeed && <span>Enter a positive speed for travel time.</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      <small>Click route points · Enter or double-click to finish · Backspace removes the last point · Esc clears{route?.finished ? ' · Click to start a new route' : ''}</small>
    </div>
  );
}
