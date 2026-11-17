import { signal } from '@angular/core';
import { LlmError, toLlmError } from '../errors';
import type { Phase, Priority } from '../types';
import type { LlmBackend } from './backend';

export interface JobContext {
  readonly backend: LlmBackend;
  /** Call on the first token: the job moves from 'prefill' to 'streaming'. */
  streaming(): void;
}

export interface JobSpec<T> {
  readonly priority: Priority;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: Phase) => void;
  /**
   * Runs the job. It may run more than once: when the model is swapped while
   * it runs, it is interrupted and put back at the head of the queue.
   */
  readonly run: (context: JobContext) => Promise<T>;
}

const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

interface Job {
  readonly spec: JobSpec<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: LlmError) => void;
  /** Set while it runs: the reason it must not resolve normally. */
  cancelled: LlmError | null;
  /** Set while it runs: run it again when it returns. */
  requeue: boolean;
}

/**
 * One queue per engine. WebLLM already runs one generation at a time, but only
 * a queue of our own knows which request is running (interrupting stops that
 * one, whoever asked), can let a request jump ahead, and can drop a request
 * that has not started yet.
 */
export class Scheduler {
  /** Requests waiting, plus the one running. */
  readonly pending = signal(0);

  private readonly queue: Job[] = [];
  private running: Job | null = null;
  /** Nothing starts until the engine says a model is ready. */
  private paused = true;

  constructor(private readonly backend: LlmBackend) {}

  enqueue<T>(spec: JobSpec<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (spec.signal?.aborted) {
        reject(new LlmError('aborted', 'The request was stopped before it started.'));
        return;
      }

      // The listener goes when the job ends, however it ends: a signal that
      // outlives its requests (a conversation's, say) must not collect them.
      const listening = new AbortController();
      const job: Job = {
        spec: spec as JobSpec<unknown>,
        resolve: (value) => {
          listening.abort();
          resolve(value as T);
        },
        reject: (error) => {
          listening.abort();
          reject(error);
        },
        cancelled: null,
        requeue: false,
      };
      spec.signal?.addEventListener(
        'abort',
        () => this.cancel(job, new LlmError('aborted', 'The request was stopped.')),
        { once: true, signal: listening.signal },
      );

      this.insert(job);
      spec.onPhase?.('queued');
      this.updatePending();
      this.pump();
    });
  }

  /** Stops the running job and keeps it for later: the model is about to change. */
  pause(): void {
    this.paused = true;

    const running = this.running;
    if (running && !running.cancelled) {
      running.requeue = true;
      this.backend.interrupt();
    }
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  /** Every waiting job fails, and so does the running one when it returns. */
  failAll(error: LlmError): void {
    for (const job of this.queue.splice(0)) {
      this.settle(job, error);
    }

    if (this.running) {
      this.running.requeue = false;
      this.running.cancelled = error;
    }
    this.updatePending();
  }

  private cancel(job: Job, error: LlmError): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.settle(job, error);
      this.updatePending();
      return;
    }

    if (this.running === job && !job.cancelled) {
      job.requeue = false;
      job.cancelled = error;
      this.backend.interrupt();
    }
  }

  private insert(job: Job): void {
    const rank = RANK[job.spec.priority];
    const index = this.queue.findIndex((queued) => RANK[queued.spec.priority] > rank);

    if (index < 0) {
      this.queue.push(job);
    } else {
      this.queue.splice(index, 0, job);
    }
  }

  private pump(): void {
    if (this.paused || this.running) {
      return;
    }

    const job = this.queue.shift();
    if (job) {
      void this.start(job);
    }
  }

  private async start(job: Job): Promise<void> {
    this.running = job;
    job.spec.onPhase?.('prefill');

    // The clock starts at the first token. WebLLM cannot interrupt a prefill, and
    // the first request after loading also compiles shaders and grammars: a timeout
    // there would only throw that work away.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let streaming = false;
    let result: unknown;
    let failure: unknown = null;

    try {
      result = await job.spec.run({
        backend: this.backend,
        streaming: () => {
          if (!streaming) {
            streaming = true;
            job.spec.onPhase?.('streaming');
            timer = setTimeout(
              () => this.cancel(job, new LlmError('timeout', 'The model took too long to answer.')),
              job.spec.timeoutMs,
            );
          }
        },
      });
    } catch (cause) {
      failure = cause;
    } finally {
      clearTimeout(timer);
      this.running = null;
    }

    if (job.requeue) {
      job.requeue = false;
      this.queue.unshift(job);
      job.spec.onPhase?.('queued');
    } else if (job.cancelled) {
      this.settle(job, job.cancelled);
    } else if (failure !== null) {
      this.settle(job, toLlmError(failure));
    } else {
      job.spec.onPhase?.('idle');
      job.resolve(result);
    }

    this.updatePending();
    this.pump();
  }

  private settle(job: Job, error: LlmError): void {
    job.spec.onPhase?.('idle');
    job.reject(error);
  }

  private updatePending(): void {
    this.pending.set(this.queue.length + (this.running ? 1 : 0));
  }
}
