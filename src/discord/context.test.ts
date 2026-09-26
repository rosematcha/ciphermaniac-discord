import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { follow } from '../tracker/fixtures.test-helpers.ts';
import { canManage, type Context, listFollows } from './context.ts';

describe('listFollows', () => {
  it('lists every follow when they fit', () => {
    assert.equal(listFollows([follow('Tord Reklev', 'NO'), follow('Emma Hagen')], ', '), 'Tord Reklev (NO), Emma Hagen');
  });

  it('cuts a long list short with a count of the rest', () => {
    const many = Array.from({ length: 100 }, (_, i) => follow(`Player Number ${i}`, 'US'));
    const list = listFollows(many, '\n');
    assert.ok(list.length < 1600);
    const shown = list.split('\n').length - 1;
    assert.match(list, new RegExp(`\\nand ${100 - shown} more$`));
  });
});

describe('followLabel via listFollows', () => {
  it('shows a preferred name in place of the published one, never beside it', () => {
    const list = listFollows([{ ...follow('Jordan Vale', 'US'), preferredName: 'Jay Vale' }, follow('Dusk Dusk')], ', ');
    assert.equal(list, 'Jay Vale (US), Dusk Dusk');
    assert.doesNotMatch(list, /Jordan/);
  });
});

describe('canManage', () => {
  const context = { ownerId: 'owner' } as Context;
  const asker = (id: string, manages: boolean) => ({ user: { id }, memberPermissions: { has: () => manages } });

  it('lets Manage Server members and the owner through, and nobody else', () => {
    assert.equal(canManage(asker('someone', true), context), true);
    assert.equal(canManage(asker('owner', false), context), true);
    assert.equal(canManage(asker('someone', false), context), false);
    assert.equal(canManage({ user: { id: 'someone' }, memberPermissions: null }, context), false);
  });

  it('gives nobody owner rights when no owner is configured', () => {
    assert.equal(canManage(asker('', false), { ownerId: '' } as Context), false);
  });
});
