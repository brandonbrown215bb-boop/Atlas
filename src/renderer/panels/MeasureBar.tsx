import { useStore } from 'zustand';
import { CLOCK_TIME, formatMeasureDistance, formatTravelDuration, measureRoute } from '../geom/measure';
import { viewStore } from '../model/viewStore';

export function MeasureBar({ panelId, worldId, mapId }: { panelId: string; worldId: string; mapId: string }) {
  const stored = useStore(viewStore, (s) => s.measurements[panelId]);
  const speed = useStore(viewStore, (s) => s.measureSpeedMph);
  const departure = useStore(viewStore, (s) => s.measureDeparture);
  const route = stored?.worldId === worldId && stored.mapId === mapId ? stored : null;
  const points = route ? [...route.points, ...(!route.finished && route.hover ? [route.hover] : [])] : [];
  const speedMph = Number(speed);
  const validSpeed = speed.trim() !== '' && Number.isFinite(speedMph) && speedMph > 0;
  let result;
  let error = '';
  try {
    result = measureRoute(points, validSpeed ? speedMph : undefined, CLOCK_TIME.test(departure) ? departure : undefined);
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const preview = route?.hover && !route.finished;
  return (
    <div className="measure-bar" data-testid="measure-bar" data-point-count={route?.points.length ?? 0}>
      <div className="measure-controls">
        <label>Speed (mph) <input data-testid="measure-speed" aria-label="Travel speed in miles per hour" type="number" min="0.01" step="any" value={speed} onChange={(e) => viewStore.getState().setMeasureSpeedMph(e.target.value)} /></label>
        <label>Depart <input data-testid="measure-departure" aria-label="Departure time" type="time" value={departure} onChange={(e) => viewStore.getState().setMeasureDeparture(e.target.value)} /></label>
        <button type="button" data-testid="measure-finish" disabled={!route || route.points.length < 2 || route.finished} onClick={() => route && viewStore.getState().setMeasurement(panelId, { ...route, hover: null, finished: true })}>Finish</button>
        <button type="button" data-testid="measure-clear" disabled={!route} onClick={() => viewStore.getState().setMeasurement(panelId, null)}>Clear</button>
      </div>
      <div className="measure-results">
        <strong data-testid="measure-distance" data-metres={result?.metres ?? 0}>{result ? formatMeasureDistance(result) : '—'}</strong>
        {preview && <span>(preview)</span>}
        {result?.durationSeconds !== null && result?.durationSeconds !== undefined && points.length >= 2 && <span data-testid="measure-duration">Travel: {formatTravelDuration(result.durationSeconds)}</span>}
        {result?.arrival && points.length >= 2 && <span data-testid="measure-arrival">Arrive: {result.arrival.time}{result.arrival.dayOffset > 0 ? ` (+${result.arrival.dayOffset} ${result.arrival.dayOffset === 1 ? 'day' : 'days'})` : ''}</span>}
        {speed.trim() && !validSpeed && <span>Enter a positive speed for travel time.</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      <small>Click route points · Enter or double-click to finish · Backspace removes the last point · Esc clears{route?.finished ? ' · Click to start a new route' : ''}</small>
    </div>
  );
}
