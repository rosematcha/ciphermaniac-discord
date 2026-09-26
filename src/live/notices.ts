/**
 * Notices from ciphermaniac's live poller that a round has been published, so
 * a new round is posted the moment it is out rather than on the next minute's
 * look. A notice carries nothing but the fact: the rounds are still read from
 * R2, so a stray POST can do no more than bring a look forward.
 */

import { createServer, type Server } from 'node:http';

/** A wait that a notice cuts short. A notice during a look is kept, so the next wait ends at once. */
export class Alarm {
  #rung = false;
  #wake: (() => void) | null = null;

  ring(): void {
    this.#rung = true;
    this.#wake?.();
  }

  /** Resolves after `ms`, on a notice, or on abort, whichever is first. */
  async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (!this.#rung && !signal.aborted) {
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          this.#wake = null;
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
        this.#wake = done;
      });
    }
    this.#rung = false;
  }
}

/**
 * Listens for `POST /notify` on `port`, calling `onNotice` for each. A listener
 * that fails, say on a port already taken, is logged rather than fatal: the
 * minute's look still posts every round.
 */
export function listenForNotices(port: number, onNotice: () => void): Server {
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === 'POST' && request.url === '/notify') {
      onNotice();
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  server.on('error', (error: Error) => {
    console.error(`notices on port ${port}:`, error.message);
  });
  return server.listen(port);
}
