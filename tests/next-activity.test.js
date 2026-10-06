import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
  .replace('export const pttc1Provider', 'const pttc1Provider');
const provider = runInContext(`${source}\npttc1Provider;`, createContext({ URL }));
const currentUrl = 'https://lms.pttc1.edu.vn/mod/resource/view.php?id=52526&forceview=1';

function link(href, overrides = {}) {
  return { id: 'next-activity-link', tagName: 'A', textContent: 'Phần Tiếp Theo',
    getAttribute: name => name === 'href' ? href : null, getClientRects: () => [1], ...overrides };
}

function doc(controls) {
  return { location: { href: currentUrl }, querySelectorAll: () => controls };
}

test('the final PDF has no usable next link when the HTML contains a placeholder', () => {
  for (const href of [null, '', '#', '#region-main', 'javascript:void(0)', currentUrl]) {
    assert.equal(provider.findNextButton(doc([link(href)])), null);
  }
});

test('hidden and disabled next links are not treated as navigation targets', () => {
  for (const overrides of [{ hidden: true }, { getClientRects: () => [] }, { classList: { contains: () => true } }, { disabled: true }]) {
    assert.equal(provider.findNextButton(doc([link('/mod/page/view.php?id=2', overrides)])), null);
  }
});

test('an unusable next placeholder does not hide a real next activity', () => {
  const valid = link('/mod/page/view.php?id=2');
  assert.equal(provider.findNextButton(doc([link('#'), valid])), valid);
});
