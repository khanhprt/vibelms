import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../src/providers/pttc1.provider.js', import.meta.url), 'utf8')
  .replace('export const pttc1Provider', 'const pttc1Provider');

function account({ profileId, loggedIn = false } = {}) {
  const menu = { dataset: {}, querySelector: () => profileId ? { href: `https://lms.pttc1.edu.vn/user/profile.php?id=${profileId}` } : null };
  const document = {
    body: { classList: { contains: () => loggedIn } },
    querySelector: selector => selector === '#usermenu, .usermenu, [data-region="usermenu"], .user-menu' ? menu : null,
  };
  const context = createContext({ URL, document, location: { href: 'https://lms.pttc1.edu.vn/my/courses.php' } });
  return runInContext(`${source}\npttc1Provider.getAccount();`, context);
}

test('an initials-only menu recognises the signed-in user from its profile link', () => {
  const result = account({ profileId: '1234' });
  assert.equal(result.authenticated, true);
  assert.equal(result.accountId, '1234');
});

test('logged-in pages are recognised without inventing an account ID for local binding', () => {
  const result = account({ loggedIn: true });
  assert.equal(result.authenticated, true);
  assert.ok(!result.accountId);
});

test('a login page without authenticated account signals remains unauthenticated', () => {
  assert.equal(account().authenticated, false);
});
