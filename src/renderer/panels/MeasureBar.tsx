import { useStore } from 'zustand';
import { CLOCK_TIME, formatMeasureDistance, formatTravelDuration, measureRoute } from '../geom/measure';
import { viewStore } from '../model/viewStore';

export function MeasureBar({ panelId, worldId, mapId }: { panelId: string; worldId: string; mapId: string }) {
  const stored = useStore(viewStore, (s) => s.measurements[panelId]);
  const speed = useStore(viewStore, (s) => s.measureSpeedMph);
  const departure = useStore(viewStore, (s) => s.measureDeparture);
  const schedule = useStore(viewStore, (s) => s.measureSchedule);
  const markers = useStore(viewStore, (s) => s.measureMarkers);
  const route = stored?.worldId === worldId && stored.mapId === mapId ? stored : null;
  const points = route ? [...route.points, ...(!route.finished && route.hover ? [route.hover] : [])] : [];
  const speedMph = Number(speed);
  const validSpeed = speed.trim() !== '' && Number.isFinite(speedMph) && speedMph > 0;
  let result;
  let error = '';
  try {
    result = measureRoute(points, validSpeed ? speedMph : undefined, CLOCK_TIME.test(departure) ? departure : undefined, schedule ?? undefined);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
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
        <label><input aria-label="Show travel markers" type="checkbox" checked={markers} onChange={e => viewStore.getState().setMeasureMarkers(e.target.checked)} />Watch/camp marks</label>
        <button type="button" data-testid="measure-finish" disabled={!route || route.points.length < 2 || route.finished} onClick={() => route && viewStore.getState().setMeasurement(panelId, { ...route, hover: null, finished: true })}>Finish</button>
        <button type="button" data-testid="measure-clear" disabled={!route} onClick={() => viewStore.getState().setMeasurement(panelId, null)}>Clear</button>
      </div>
      <div className="measure-results">
        <strong data-testid="measure-distance" data-metres={result?.metres ?? 0}>{result ? formatMeasureDistance(result) : '—'}</strong>
        {preview && <span>(preview)</span>}
        {result?.durationSeconds !== null && result?.durationSeconds !== undefined && points.length >= 2 && <span data-testid="measure-duration">Travel: {formatTravelDuration(result.durationSeconds)}</span>}
        {result?.arrival && points.length >= 2 && <span data-testid="measure-arrival">Arrive: {result.arrival.time}{result.arrival.dayOffset > 0 ? ` (+${result.arrival.dayOffset} ${result.arrival.dayOffset === 1 ? 'day' : 'days'})` : ''}</span>}
        {schedule && result?.elapsedSeconds != null && points.length >= 2 && <span data-testid="measure-elapsed">Elapsed: {formatTravelDuration(result.elapsedSeconds)} · {result.restStops} rest {result.restStops === 1 ? 'stop' : 'stops'}</span>}
        {speed.trim() && !validSpeed && <span>Enter a positive speed for travel time.</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      <small>Click route points · Enter or double-click to finish · Backspace removes the last point · Esc clears{route?.finished ? ' · Click to start a new route' : ''}</small>
    </div>
  );
}
