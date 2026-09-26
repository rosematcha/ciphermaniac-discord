import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { Alarm, listenForNotices } from './notices.ts';

const LONG = 60_000;

describe('Alarm', () => {
  it('ends a wait when rung', async () => {
    const alarm = new Alarm();
    const started = Date.now();
    const waiting = alarm.wait(LONG, new AbortController().signal);
    alarm.ring();
    await waiting;
    assert.ok(Date.now() - started < 1_000);
  });

  it('keeps a ring from between waits, then waits in full again', async () => {
    const alarm = new Alarm();
    alarm.ring();
    alarm.ring();
    await alarm.wait(LONG, new AbortController().signal);
    let ended = false;
    void alarm.wait(50, new AbortController().signal).then(() => (ended = true));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(ended, false);
  });

  it('ends a wait on its own after the time given, or on abort', async () => {
    const alarm = new Alarm();
    await alarm.wait(5, new AbortController().signal);
    const stop = new AbortController();
    const waiting = alarm.wait(LONG, stop.signal);
    stop.abort();
    await waiting;
  });
});

describe('listenForNotices', () => {
  it('calls back for a POST to /notify and turns anything else away', async () => {
    let notices = 0;
    const server = listenForNotices(0, () => (notices += 1));
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    try {
      const notice = await fetch(`http://127.0.0.1:${port}/notify`, { method: 'POST', body: '{"slug":"frankfurt-2027"}' });
      assert.equal(notice.status, 204);
      assert.equal((await fetch(`http://127.0.0.1:${port}/notify`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status, 404);
      assert.equal(notices, 1);
    } finally {
      server.close();
    }
  });

  it('survives a port that is already taken', async () => {
    const first = listenForNotices(0, () => undefined);
    await once(first, 'listening');
    const { port } = first.address() as AddressInfo;
    const second = listenForNotices(port, () => undefined);
    try {
      await once(second, 'error');
    } finally {
      first.close();
    }
  });
});
