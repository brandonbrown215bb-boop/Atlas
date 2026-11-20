import { executeCommandOnDraft, type WorldDocument } from '../model/commands';
import type { AssetsIndex } from '../model/schema';
const scope = globalThis as unknown as {
  onmessage: (event: { data: { world: WorldDocument; assets: AssetsIndex; commands: Array<{ name: string; input: unknown }> } }) => void;
  postMessage: (message: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const results = data.commands.map(c => executeCommandOnDraft(data.world, c.name, c.input, data.assets));
    scope.postMessage({ world: data.world, results });
  } catch(error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
