// The web player's page read as data (criterion 7), as #1045's suite reads it (tests/acceptance/1045/helpers.ts
// `pageTree`, copied here with the node's value added): over #172's DevTools session of the page, each element marked
// `data-deep-id` that the browser's own accessibility tree holds and doesn't ignore, in document order, with the
// browser's computed name, description and value. #172's `Tab` holds its protocol and its session as private fields;
// this file reaches those two fields as the class holds them, sending commands only, as #1045's does.

import type { Tab } from '../172/helpers.ts';
import type { TreeNode } from '../169/helpers.ts';

type Send = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
function sendOf(tab: Tab): Send {
  const t = tab as unknown as { cdp: { send(method: string, params: Record<string, unknown>, session: string): Promise<Record<string, unknown>> }; session: string };
  return (method, params = {}) => t.cdp.send(method, params, t.session);
}

/** A node of the page's tree: #169's `{id, role, name}`, and the browser's computed description and value. */
export interface PageNode extends TreeNode { description: string; value: string }

/**
 * The page's accessibility tree: its `id` the mark, its name the browser's computed name, its description and value the
 * computed description and value (empty when the browser computes none), and as its role its `aria-roledescription`,
 * else its `role` attribute, else the browser's computed role (#1045's reading).
 */
export async function pageTree(tab: Tab): Promise<PageNode[]> {
  const send = sendOf(tab);
  await send('DOM.enable');
  await send('Accessibility.enable');
  const { root } = await send('DOM.getDocument', { depth: -1 }) as { root: { nodeId: number } };
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-deep-id]' }) as { nodeIds: number[] };
  type Ax = { ignored?: boolean; backendDOMNodeId?: number; role?: { value?: unknown }; name?: { value?: unknown }; description?: { value?: unknown }; value?: { value?: unknown } };
  const { nodes } = await send('Accessibility.getFullAXTree') as { nodes: Ax[] };
  const ax = new Map(nodes.filter((n) => n.backendDOMNodeId !== undefined).map((n) => [n.backendDOMNodeId!, n]));
  const out: PageNode[] = [];
  for (const nodeId of nodeIds) {
    const { node } = await send('DOM.describeNode', { nodeId }) as { node: { backendNodeId: number; attributes?: string[] } };
    const list = node.attributes ?? [];
    const attrs = new Map<string, string>();
    for (let i = 0; i + 1 < list.length; i += 2) attrs.set(list[i]!, list[i + 1]!);
    const a = ax.get(node.backendNodeId);
    if (!a || a.ignored) continue;
    const role = attrs.get('aria-roledescription') ?? attrs.get('role') ?? String(a.role?.value ?? '');
    out.push({ id: attrs.get('data-deep-id') ?? '', role, name: String(a.name?.value ?? ''), description: String(a.description?.value ?? ''), value: String(a.value?.value ?? '') });
  }
  return out;
}
