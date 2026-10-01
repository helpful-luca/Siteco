import type { Link, Nodes, Parent, Root, RootContent, Text } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { SENTINEL_PATTERN, stripSentinels } from './insert-sentinels';

/** Rendered as `<span data-citation="N">`, which the chat maps to a chip. */
export const CITATION_ATTRIBUTE = 'data-citation';
/** A word and the chips behind it, kept on one line so a chip never wraps alone. */
export const GROUP_ATTRIBUTE = 'data-citation-group';

type CitationNode = {
  type: 'citation';
  data: { hName: 'span'; hProperties: Record<string, string> };
  children: [];
};

function citation(n: string): RootContent {
  const node: CitationNode = {
    type: 'citation',
    data: { hName: 'span', hProperties: { [CITATION_ATTRIBUTE]: n } },
    children: [],
  };
  return node as unknown as RootContent;
}

function group(word: string, chips: RootContent[]): RootContent {
  return {
    type: 'citationGroup',
    data: { hName: 'span', hProperties: { [GROUP_ATTRIBUTE]: '' } },
    children: [{ type: 'text', value: word }, ...chips],
  } as unknown as RootContent;
}

/**
 * Text with sentinels as text and citation nodes. The last word before a run of chips is grouped
 * with them, so the line breaks before the word instead of between word and chip.
 */
function split(value: string): RootContent[] {
  const nodes: RootContent[] = [];
  const runs = /((?:⟦c:\d+⟧)+)/g;
  let last = 0;
  for (const match of value.matchAll(runs)) {
    const index = match.index ?? 0;
    const before = value.slice(last, index);
    const word = /\S+$/.exec(before)?.[0] ?? '';
    const lead = before.slice(0, before.length - word.length);
    if (lead) nodes.push({ type: 'text', value: lead } satisfies Text);
    const chips = [...match[1].matchAll(SENTINEL_PATTERN)].map((m) => citation(m[1]));
    nodes.push(word ? group(word, chips) : chips.length === 1 ? chips[0] : group('', chips));
    last = index + match[0].length;
  }
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) } satisfies Text);
  return nodes;
}

/**
 * Turns ⟦c:N⟧ sentinels into citation nodes. In code they are removed; inside
 * link text the chip moves behind the link, so no button ends up inside an anchor.
 */
export function remarkCitations() {
  return (tree: Root) => {
    visit(tree, (node: Nodes, index: number | undefined, parent: Parent | undefined) => {
      if (node.type === 'code' || node.type === 'inlineCode') {
        node.value = stripSentinels(node.value);
        return SKIP;
      }
      if (node.type === 'link' && parent && index !== undefined) {
        const numbers: string[] = [];
        visit(node as Link, 'text', (text: Text) => {
          for (const match of text.value.matchAll(SENTINEL_PATTERN)) numbers.push(match[1]);
          text.value = stripSentinels(text.value);
        });
        parent.children.splice(index + 1, 0, ...numbers.map(citation));
        return [SKIP, index + 1 + numbers.length];
      }
      if (node.type === 'text' && parent && index !== undefined) {
        if (!node.value.includes('⟦c:')) return undefined;
        const parts = split(node.value);
        parent.children.splice(index, 1, ...parts);
        return [SKIP, index + parts.length];
      }
      return undefined;
    });
  };
}
