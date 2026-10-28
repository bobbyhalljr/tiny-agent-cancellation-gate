# Your Agent Stopped. Its Tool Didn't.

You click Stop.

The spinner disappears. The input unlocks. You give the agent a different task.

Then the old tool finishes, and its result lands in the new conversation.

Or worse: the old tool sends the message you thought you had stopped.

These are different failures, and they need different fixes. One is about which run owns a result. The other is about whether an external system actually stopped doing work.

A single `cancelled: true` field hides that distinction surprisingly well.

Let's build a tiny TypeScript example that separates them. It stops waiting locally, rejects obsolete results, and deliberately proves that an uncooperative tool can still perform a side effect.

The interesting test is the one where the external write still happens.

**Runnable code:** https://github.com/bobbyhalljr/tiny-agent-cancellation-gate

## 1. There are three acknowledgments hiding behind Stop

Consider a hypothetical agent that starts a document export. The user changes their mind before the export finishes.

Your application can acknowledge the stop request immediately. It can also prevent that export result from entering a later run's context.

Neither acknowledgment proves that the export service cancelled its job.

That third fact belongs to the service doing the work. Maybe it supports cancellation. Maybe cancellation is best effort. Maybe the operation has already completed.

The distinction exists in ordinary async APIs too. [Node documents `AbortController`](https://nodejs.org/api/globals.html#class-abortcontroller) as a way to signal cancellation to selected Promise-based APIs. The [DOM standard](https://dom.spec.whatwg.org/#aborting-ongoing-activities) defines how APIs participate in that signaling. A signal does not turn arbitrary work into a reversible transaction.

Durable execution has its own delivery mechanics. [Temporal's Activity documentation](https://docs.temporal.io/activity-execution#cancellation) explains that Activities must heartbeat to receive cancellation from the service, and that an Activity may accept or ignore cancellation.

The useful question is not simply whether your framework has a cancel method.

It is which acknowledgment you have actually received.

![Three separate lanes show local waiting ending, an obsolete result being rejected, and external work requiring provider confirmation.](https://raw.githubusercontent.com/bobbyhalljr/tiny-agent-cancellation-gate/main/images/diagram.png)

## 2. Give each run an identity

Our example has one `Session` and one current run. Starting another run signals the previous one and replaces the local context.

```ts
export type Run = Readonly<{
  id: number;
  signal: AbortSignal;
}>;

export type Tool = (
  signal: AbortSignal
) => string | Promise<string>;
```

Inside `Session`, beginning a run looks like this:

```ts
begin(): Run {
  this.#controller?.abort("superseded");
  this.#controller = new AbortController();
  this.#current = Object.freeze({
    id: ++this.#sequence,
    signal: this.#controller.signal
  });
  this.#context = [];
  return this.#current;
}
```

The run counter makes the lifecycle readable. Object identity is what this implementation uses to recognize the current run.

Those IDs are process-local. They are not durable job IDs, distributed fencing tokens, or authorization credentials. Restarting the process starts the counter over.

That limit is fine for the lesson: a result belongs to the run that started it, and a new run does not inherit that result just because it arrived later.

## 3. Stop waiting without pretending the tool stopped

An invocation first checks that its run is still active. If it is already stopped or superseded, the tool never gets called.

For an active invocation, the session attaches an abort listener and starts the tool. Both success and rejection handlers stay attached to the tool's promise.

The caller can settle before that promise does.

```ts
const onAbort = () => finish("ignored");

run.signal.addEventListener("abort", onAbort, {
  once: true
});
```

Here, `finish` is the helper in `invoke` that resolves the caller's outcome once and removes the listener. The full implementation is in the code package.

Why return `ignored` instead of `cancelled`?

Because this code controls admission to a local context. It does not control the remote export service. The name describes the fact we can prove.

Node recommends one-shot abort listeners. We also remove the listener when a call finishes normally, so completed invocations do not accumulate listeners on a long-lived run.

Attaching a rejection handler matters too. If we stop waiting and the tool rejects later, that rejection still needs to be observed. Abandoning the result is not permission to abandon promise handling.

It is also not resource cleanup. A hung adapter can retain sockets, handles, closures, or remote work after our caller has returned. Adapters still need their own deadlines and cleanup.

## 4. Check ownership where the result enters context

Sending an abort signal is useful when the adapter cooperates. The context boundary needs its own check.

This is the success path inside `invoke`:

```ts
work.then((value) => {
  if (settled) return;
  if (!this.#active(run)) return finish("ignored");
  if (typeof value !== "string") return finish("failed");

  this.#context.push(value);
  finish("accepted");
}, () => {
  finish(this.#active(run) ? "failed" : "ignored");
});
```

There is no `await` between checking the active run and appending the string to this in-memory context.

That makes the boundary easy to reason about on one JavaScript event loop. A stop processed before the continuation prevents admission. A result already admitted before stop stays admitted.

If your real commit writes to a database or calls another service, you have a different coordination problem. This local check does not provide an atomic check-and-write across systems.

Also notice that the session owns the context write. Returning an unchecked value to a caller and asking every caller to remember another guard would spread the invariant across the application.

The guard belongs at the output sink it protects.

## 5. Write the test that refuses to flatter you

The demo creates a tool that intentionally ignores its signal. A deferred promise lets us choose exactly when the simulated external operation finishes.

```ts
const work = release.promise.then(() => {
  externalWrites++;
  return "old tool result";
});

const waiting = session.invoke(oldRun, () => work);
session.stop();
```

First, the local caller returns. Then we release the tool and let it perform its simulated write.

The actual demo output is:

```text
caller outcome: ignored
external writes after stop: 1
old context entries: 0
new context: ["fresh result"]
```

Zero stale context entries is the property this gate enforces.

One external write is the property it does not enforce.

Both numbers belong in the same test run. Otherwise, it is too easy to prove that the chat stopped updating and accidentally claim that the external operation stopped too.

The package has 16 passing tests, including an already-stopped run, replacement runs, cooperative cancellation, late success, late rejection, listener cleanup, malformed results, and a stop between promise resolution and its continuation.

I ran them on Node 25.6.0 with synthetic tools. No live provider, HTTP request, model call, or timing benchmark is involved.

From the included repository directory:

```sh
npm test
npm run demo
```

No dependency installation or API key is required. Use Node 22.18 or later for native execution of this erasable TypeScript syntax. Native stripping does not perform static type checking.

## 6. Make the product tell the same truth

If a stop request has three acknowledgments, your state model should have room for them.

For an external operation, retain its identifier and distinguish a cancellation request from a confirmed provider state. If a create request finishes after the user presses Stop, its returned operation ID can still be essential for cleanup and reconciliation.

Our `ignored` outcome means the body is excluded from model context. A production adapter may still need to capture operation metadata in a separate operational record. Ignoring an answer and losing the receipt are different choices.

Compensation is another action with another permission boundary. Cancelling an export, deleting an exported file, and undoing an email are not interchangeable operations. Some effects cannot be undone.

The UI can say: “Agent stopped. Export cancellation requested.” It should say the export was cancelled only after the service confirms that state.

Finally, an abort signal cannot preempt synchronous CPU-bound JavaScript that is blocking the event loop. Nor does this in-memory session survive a crash or coordinate multiple workers. Those systems need additional mechanisms and their own tests.

The stop button is where a user withdraws permission for work to continue.

Your application should honor that immediately where it has control, track what it cannot yet stop, and make the difference visible.
