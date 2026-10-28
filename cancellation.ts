export type Run = Readonly<{ id: number; signal: AbortSignal }>;
export type Tool = (signal: AbortSignal) => string | Promise<string>;
export type Outcome = { status: "accepted" | "ignored" | "failed" };

// Single-process teaching example. This is not a remote cancellation protocol.
export class Session {
  #sequence = 0;
  #current: Run | undefined;
  #controller: AbortController | undefined;
  #context: string[] = [];

  begin(): Run {
    this.#controller?.abort("superseded");
    this.#controller = new AbortController();
    this.#current = Object.freeze({ id: ++this.#sequence, signal: this.#controller.signal });
    this.#context = [];
    return this.#current;
  }

  stop(): void {
    this.#controller?.abort("stop requested");
  }

  context(run: Run): readonly string[] {
    return this.#current === run ? [...this.#context] : [];
  }

  #active(run: Run): boolean {
    return this.#current === run && !run.signal.aborted;
  }

  invoke(run: Run, tool: Tool): Promise<Outcome> {
    if (!this.#active(run)) return Promise.resolve({ status: "ignored" });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: Outcome["status"]) => {
        if (settled) return;
        settled = true;
        run.signal.removeEventListener("abort", onAbort);
        resolve({ status });
      };
      const onAbort = () => finish("ignored");
      run.signal.addEventListener("abort", onAbort, { once: true });
      let work: Promise<string>;
      try {
        work = Promise.resolve(tool(run.signal));
      } catch {
        finish(this.#active(run) ? "failed" : "ignored");
        return;
      }
      // Both handlers remain attached even after we stop waiting. A late
      // rejection is observed; a late success cannot enter this context.
      work.then((value) => {
        if (settled) return;
        if (!this.#active(run)) return finish("ignored");
        if (typeof value !== "string") return finish("failed");
        // No await between the active-run check and this local commit.
        this.#context.push(value);
        finish("accepted");
      }, () => finish(this.#active(run) ? "failed" : "ignored"));
    });
  }
}
