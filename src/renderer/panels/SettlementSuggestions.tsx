import { useState } from 'react';
import type { Entity } from '../model/schema';
import { worldStore } from '../model/store';

function Suggestion({ mapId, entity }: { mapId: string; entity: Extract<Entity, { type: 'prop' }> }) {
  const [name, setName] = useState(entity.name?.replace(' suggestion', '') ?? 'Settlement');
  const [error, setError] = useState('');
  const resolve = (action: 'accept' | 'dismiss') => {
    try { worldStore.getState().execute('settlement.resolveSuggestion', { mapId, entityId: entity.id, action, ...(action === 'accept' ? { name } : {}) }); }
    catch (e) { setError(String(e)); }
  };
  return <div data-testid="settlement-suggestion" style={{ padding: '4px 0', borderTop: '1px solid var(--border)' }}>
    <input aria-label="Settlement name" value={name} onChange={e => setName(e.target.value)} />
    <button onClick={() => resolve('accept')}>Accept settlement</button>
    <button onClick={() => resolve('dismiss')}>Dismiss settlement</button>
    {error && <div role="alert">{error}</div>}
  </div>;
}

export function SettlementSuggestions({ mapId, entities }: { mapId: string; entities: Entity[] }) {
  const suggestions = entities.filter((e): e is Extract<Entity, { type: 'prop' }> => e.type === 'prop' && !!e.suggestedSettlement);
  return <details open><summary>Settlement suggestions ({suggestions.length})</summary>
    <p>Suggestions are GM-only. Accept creates a named place that survives rerolls; dismiss removes the suggestion.</p>
    {suggestions.map(entity => <Suggestion key={`${mapId}:${entity.id}`} mapId={mapId} entity={entity} />)}
  </details>;
}
