import TranslationQueue from '../src/features/accountTools/TranslationQueue';

describe('translation traffic queue', () => {
  it('limits total concurrency to three accounts and one request per account', async () => {
    const queue = new TranslationQueue();
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const run = (name: string) => () =>
      new Promise<void>(resolve => {
        started.push(name);
        releases.push(resolve);
      });
    const jobs = [
      queue.enqueue('a', false, run('a1')),
      queue.enqueue('a', false, run('a2')),
      queue.enqueue('b', false, run('b')),
      queue.enqueue('c', false, run('c')),
      queue.enqueue('d', false, run('d')),
    ];
    expect(started).toEqual(['a1', 'b', 'c']);
    releases[0]();
    await jobs[0];
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    expect(started).toEqual(['a1', 'b', 'c', 'a2']);
    releases[1]();
    releases[2]();
    releases[3]();
    await new Promise<void>(resolve => {
      setImmediate(resolve);
    });
    releases[4]();
    await Promise.all(jobs);
  });
  it('gives a send preview priority over queued incoming translations and recovers after errors', async () => {
    const queue = new TranslationQueue();
    const started: string[] = [];
    let release!: () => void;
    const first = queue.enqueue(
      'a',
      false,
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    const incoming = queue.enqueue('a', false, async () => {
      started.push('incoming');
      return 'in';
    });
    const outgoing = queue.enqueue('a', true, async () => {
      started.push('outgoing');
      throw new Error('synthetic');
    });
    const rejection = outgoing.catch(error => error.message);
    release();
    await first;
    expect(await rejection).toBe('synthetic');
    expect(await incoming).toBe('in');
    expect(started).toEqual(['outgoing', 'incoming']);
  });
});
