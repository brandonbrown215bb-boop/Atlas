import { executeCommandOnDraft, type WorldDocument } from '../model/commands';
const scope = globalThis as unknown as {
  onmessage: (event: { data: { world: WorldDocument; commands: Array<{ name: string; input: unknown }> } }) => void;
  postMessage: (message: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try {
    const results = data.commands.map(c => executeCommandOnDraft(data.world, c.name, c.input));
    scope.postMessage({ world: data.world, results });
  } catch(error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
