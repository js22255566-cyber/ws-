// Bound provider traffic across many open accounts; previews take priority.
export default class TranslationQueue {
  private active = new Set<string>();

  private waiting: {
    accountId: string;
    outgoing: boolean;
    run: () => Promise<unknown>;
    resolve: (value: any) => void;
    reject: (error: unknown) => void;
  }[] = [];

  enqueue<T>(
    accountId: string,
    outgoing: boolean,
    run: () => Promise<T>,
  ): Promise<T> {
    if (this.waiting.length >= 240)
      return Promise.reject(new Error('翻译队列繁忙，请稍后重试'));
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ accountId, outgoing, run, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    if (this.active.size >= 3) return;
    const priority = this.waiting.findIndex(
      job => job.outgoing && !this.active.has(job.accountId),
    );
    const index =
      priority >= 0
        ? priority
        : this.waiting.findIndex(job => !this.active.has(job.accountId));
    if (index < 0) return;
    const [job] = this.waiting.splice(index, 1);
    this.active.add(job.accountId);
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active.delete(job.accountId);
        this.drain();
      });
    this.drain();
  }
}
