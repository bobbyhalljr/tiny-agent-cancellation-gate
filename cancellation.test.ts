import test from "node:test";
import assert from "node:assert/strict";
import { Session } from "./cancellation.ts";
import { deferred } from "./deferred.ts";
import { getEventListeners } from "node:events";

test("active success enters context", async () => {
  const s = new Session(), r = s.begin();
  assert.deepEqual(await s.invoke(r, async () => "fresh"), { status: "accepted" });
  assert.deepEqual(s.context(r), ["fresh"]);
});
test("stop settles the caller while the tool is still pending", async () => {
  const s = new Session(), r = s.begin(), d = deferred<string>();
  const result = s.invoke(r, () => d.promise);
  s.stop();
  assert.deepEqual(await result, { status: "ignored" });
  assert.deepEqual(s.context(r), []);
  d.resolve("late");
  await d.promise;
  assert.deepEqual(s.context(r), []);
});
test("stop before dispatch never calls tool", async () => {
  const s = new Session(), r = s.begin(); let calls = 0;
  s.stop();
  assert.equal((await s.invoke(r, () => { calls++; return "bad"; })).status, "ignored");
  assert.equal(calls, 0);
});
test("replacement run excludes late result from old run", async () => {
  const s = new Session(), old = s.begin(), d = deferred<string>();
  const pending = s.invoke(old, () => d.promise);
  const fresh = s.begin();
  await s.invoke(fresh, () => "new");
  d.resolve("old"); await d.promise;
  assert.equal((await pending).status, "ignored");
  assert.deepEqual(s.context(fresh), ["new"]);
});
test("old run handle cannot dispatch into replacement", async () => {
  const s = new Session(), old = s.begin(); s.begin(); let calls = 0;
  assert.equal((await s.invoke(old, () => { calls++; return "bad"; })).status, "ignored");
  assert.equal(calls, 0);
});
test("cooperative tool receives abort signal", async () => {
  const s = new Session(), r = s.begin(); let observed = false;
  const p = s.invoke(r, signal => new Promise<string>((_, reject) => {
    signal.addEventListener("abort", () => { observed = true; reject(new Error("aborted")); }, { once: true });
  }));
  s.stop();
  assert.equal((await p).status, "ignored"); assert.equal(observed, true);
});
test("late rejection is handled after caller has stopped waiting", async () => {
  const s = new Session(), r = s.begin(), d = deferred<string>();
  const p = s.invoke(r, () => d.promise); s.stop(); await p;
  d.reject(new Error("late failure"));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(s.context(r), []);
});
test("synchronous throw produces failed outcome", async () => {
  const s = new Session(), r = s.begin();
  assert.equal((await s.invoke(r, () => { throw new Error("failure"); })).status, "failed");
});
test("active rejection produces failed outcome", async () => {
  const s = new Session(), r = s.begin();
  assert.equal((await s.invoke(r, async () => { throw new Error("failure"); })).status, "failed");
});
test("stop is safe before begin and when repeated", async () => {
  const s = new Session(); s.stop(); const r = s.begin(); s.stop(); s.stop();
  assert.equal((await s.invoke(r, () => "bad")).status, "ignored");
});
test("stop does not undo already accepted local results", async () => {
  const s = new Session(), r = s.begin(); await s.invoke(r, () => "accepted before stop");
  s.stop(); assert.deepEqual(s.context(r), ["accepted before stop"]);
});
test("tool can still perform a side effect after stop", async () => {
  const s = new Session(), r = s.begin(), d = deferred<void>(); let writes = 0;
  const work = d.promise.then(() => { writes++; return "receipt"; });
  const p = s.invoke(r, () => work); s.stop(); await p;
  d.resolve(); await work;
  assert.equal(writes, 1); assert.deepEqual(s.context(r), []);
});
test("stop between resolution and its continuation prevents commit", async () => {
  const s = new Session(), r = s.begin(), d = deferred<string>();
  const p = s.invoke(r, () => d.promise); d.resolve("late"); s.stop();
  assert.equal((await p).status, "ignored"); assert.deepEqual(s.context(r), []);
});
test("returned context is a copy", async () => {
  const s = new Session(), r = s.begin(); await s.invoke(r, () => "original");
  const copy = [...s.context(r)]; copy.push("injected");
  assert.deepEqual(s.context(r), ["original"]);
});
test("completed calls remove their abort listeners", async () => {
  const s = new Session(), r = s.begin();
  await s.invoke(r, () => "done");
  assert.equal(getEventListeners(r.signal, "abort").length, 0);
});
test("unexpected runtime result fails without entering context", async () => {
  const s = new Session(), r = s.begin();
  const invalidAdapter = () => ({ unexpected: true }) as unknown as string;
  assert.equal((await s.invoke(r, invalidAdapter)).status, "failed");
  assert.deepEqual(s.context(r), []);
});
