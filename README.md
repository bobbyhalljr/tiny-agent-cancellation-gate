# Tiny Agent Cancellation Gate

A dependency-free TypeScript teaching example by Bobby Hall Jr. Ask a tool to stop, stop waiting locally, and reject results from an obsolete run. These actions do not prove that an external operation stopped.

## Run

Use Node 22.18 or later. No install, model, framework, or API key required.

```sh
npm test
npm run demo
```

Native TypeScript stripping executes this code without static type checking. Runtime validation here admits only string results.

## Contract

- One current run per `Session` instance.
- `begin()` signals cancellation to the previous run and resets the local context.
- `stop()` signals cancellation and settles waiting invocations as `ignored`.
- Active successful tool results enter local context in a synchronous check/commit step.
- Late successes and rejections remain observed but cannot enter that context.
- Stopping does not remove results already accepted before the stop.
- `ignored` describes local admission, not remote cancellation.

## Limits

In-memory, single-process example with synthetic tools. No HTTP requests or durable queue. A tool that ignores the signal can keep running and perform a side effect. JavaScript abort cannot preempt synchronous CPU-bound work that blocks the event loop. Pending tool promises and resources still need adapter-specific timeouts, cleanup, and supervision.

Production systems need authenticated operation IDs, durable run state, provider cancellation acknowledgments, reconciliation, and separately authorized compensation where appropriate. Run IDs here are process-local counters, not distributed fencing tokens or security credentials. The local context is the only output sink this gate controls.

## Primary sources

- [Node AbortController and AbortSignal](https://nodejs.org/api/globals.html#class-abortcontroller)
- [DOM AbortController specification](https://dom.spec.whatwg.org/#interface-abortcontroller)
- [Temporal Activity cancellation](https://docs.temporal.io/activity-execution#cancellation)

MIT licensed. See LICENSE.
