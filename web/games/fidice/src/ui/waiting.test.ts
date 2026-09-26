// The waiting rooms' bot controls (docs/design/fidice-shell-adoption.md §7 D7) over the page fake:
// the computers listed under the humans, the host's controls on its list alone, the watch box, and
// the delegated intents.
import { describe, expect, test } from 'vitest';

import { fakeEl, fakeTarget } from '../../../../shared/edge/page.fake.ts';
import { choiceLabel } from '../bots/registry.ts';
import { fidicePage } from './page.fake.ts';
import {
  bindWaiting,
  botPlaceholder,
  botRowHtml,
  botRows,
  paintWaiting,
  roomListKey,
  type RoomView,
  type WaitingIntent,
} from './waiting.ts';

import MARKUP from '../../index.html?raw';

const room = (over: Partial<RoomView> = {}): RoomView => ({
  code: 'ABCDE',
  hostStatus: { text: 'Waiting for players — 4 chairs at the table', pulse: true },
  guestStatus: { text: '', pulse: false },
  startGameVisible: true,
  seats: [
    { name: 'Bob', connected: true },
    { name: null, connected: false },
  ],
  mySeat: 0,
  role: 'host',
  myName: 'Ann',
  oppName: 'Bob',
  bots: 2,
  botNames: ['Rex', null],
  botChoice: 'profiler',
  watch: false,
  host: true,
  ...over,
});

describe('the computers` rows', () => {
  test('one row per computer: its index, the room`s name for it or none, the one strategy`s label', () => {
    expect(botRows(room())).toEqual([
      { index: 0, name: 'Rex', strategy: choiceLabel('profiler') },
      { index: 1, name: null, strategy: choiceLabel('profiler') },
    ]);
    expect(botRows(room({ bots: 0 }))).toEqual([]);
    expect(botPlaceholder(1)).toBe('Computer 2');
  });

  test('the host`s row carries the rename input and the two buttons; a guest`s reads the name (or the placeholder) and the strategy', () => {
    const row = { index: 1, name: null, strategy: 'Medium' };
    const host = botRowHtml(row, 3, true);
    expect(host).toContain('<li data-seat="3" data-bot="1" data-connected="true">');
    expect(host).toContain('data-bot-name data-bot="1"');
    expect(host).toContain('placeholder="Computer 2"');
    expect(host).toContain('data-bot-config data-bot="1"');
    expect(host).toContain('data-bot-remove data-bot="1"');
    const guest = botRowHtml({ ...row, name: 'Rex <b>' }, 3, false);
    expect(guest).toBe(
      '<li data-seat="3" data-bot="1" data-connected="true">Rex &lt;b&gt; · computer · Medium</li>',
    );
    expect(botRowHtml(row, 3, false)).toContain('Computer 2 · computer · Medium');
  });
});

describe('paintWaiting', () => {
  test('the shared statuses, then both lists keyed on humans and computers together; the controls on the host`s list alone; the watch box', () => {
    const p = fidicePage(MARKUP);
    const v = room();
    paintWaiting(p.doc, v);
    expect(p.get('roomCode').text()).toBe('ABCDE');
    expect(p.get('hostWaitStatus').text()).toBe(v.hostStatus.text);
    expect(p.get('hostWaitStatus').hasClass('pulse')).toBe(true);
    expect(p.get('startGameBtn').hidden()).toBe(false);
    const list = p.get('seatList');
    expect(list.attr('data-key')).toBe(roomListKey(v));
    expect(list.text()).toContain('Ann · host · you');
    expect(list.text()).toContain('>Bob<');
    expect(list.text()).toContain('Seat 3 · empty');
    expect(list.text()).toContain('data-seat="3" data-bot="0"');
    expect(list.text()).toContain('value="Rex"');
    expect(list.text()).toContain('data-bot-remove data-bot="1"');
    const guestList = p.get('guestSeatList');
    expect(guestList.attr('data-key')).toBe(roomListKey(v));
    expect(guestList.text()).toContain('Rex · computer');
    expect(guestList.text()).not.toContain('data-bot-remove');
    expect(p.get('watchCb').checked()).toBe(false);
    paintWaiting(p.doc, room({ watch: true }));
    expect(p.get('watchCb').checked()).toBe(true);
  });

  test('a guest`s room (the host`s name from oppName) lists the computers without controls; a room not yet open lists nothing', () => {
    const p = fidicePage(MARKUP);
    paintWaiting(p.doc, room({ role: 'guest', mySeat: 1, host: false, botNames: [] }));
    const list = p.get('seatList');
    expect(list.text()).toContain('Bob · host');
    expect(list.text()).toContain('Computer 1 · computer');
    expect(list.text()).not.toContain('data-bot-name');
    paintWaiting(p.doc, room({ seats: [], bots: 0 }));
    expect(p.get('seatList').text()).toBe('');
  });
});

describe('bindWaiting', () => {
  test('add, the watch box, and the delegated remove, strategy and rename on the host`s list', () => {
    const p = fidicePage(MARKUP);
    const intents: WaitingIntent[] = [];
    bindWaiting(p.doc, (i) => intents.push(i));
    p.get('btnAddBot').fire('click');
    (p.get('watchCb').el as HTMLInputElement).checked = true;
    p.get('watchCb').fire('change');
    const remove = fakeEl('r', { attrs: { 'data-bot': '1' } });
    const config = fakeEl('c', { attrs: { 'data-bot': '0' } });
    const input = fakeEl('i', { attrs: { 'data-bot': '1' } });
    const list = p.get('seatList');
    list.fire('click', { target: fakeTarget({ closest: { '[data-bot-remove]': remove } }) });
    list.fire('click', { target: fakeTarget({ closest: { '[data-bot-config]': config } }) });
    // A click on the row itself, no control under it: nothing.
    list.fire('click', { target: fakeTarget({}) });
    list.fire('change', {
      target: fakeTarget({ closest: { '[data-bot-name]': input }, value: 'Rex' }),
    });
    list.fire('change', { target: fakeTarget({ value: 'x' }) });
    expect(intents).toEqual([
      { type: 'bots/add' },
      { type: 'watch/toggle', on: true },
      { type: 'bots/remove', index: 1 },
      { type: 'config/open', target: { kind: 'bot', index: 0 } },
      { type: 'bots/rename', index: 1, name: 'Rex' },
    ]);
  });
});
