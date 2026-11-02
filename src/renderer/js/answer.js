import { h } from './dom.js';

export function renderAnswer(text) {
  const root = h('div', { class: 'formatted-answer' });
  for (const part of String(text).split(/(```[\s\S]*?```)/g)) {
    if (part.startsWith('```')) {
      const code = part.slice(3, -3).replace(/^[\w+-]*\n/, '');
      root.append(h('pre', {}, h('code', {}, code)));
      continue;
    }
    for (const line of part.split('\n')) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      const row = h(heading ? 'h4' : 'p', { class: /^\s*[-*]\s/.test(line) ? 'answer-list-item' : '' });
      const value = heading ? heading[2] : line.replace(/^\s*[-*]\s/, '');
      for (const token of value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) row.append(token.startsWith('**') ? h('strong', {}, token.slice(2, -2)) : token.startsWith('`') ? h('code', {}, token.slice(1, -1)) : document.createTextNode(token));
      root.append(row);
    }
  }
  return root;
}
