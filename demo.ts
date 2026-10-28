import { Session } from "./cancellation.ts";
import { deferred } from "./deferred.ts";

const session = new Session();
const oldRun = session.begin();
const release = deferred<void>();
let externalWrites = 0;
// Intentionally ignores AbortSignal. This simulates a remote write already
// dispatched, not a real request to an external provider.
const work = release.promise.then(() => {
  externalWrites++;
  return "old tool result";
});
const waiting = session.invoke(oldRun, () => work);
session.stop();
console.log("caller outcome:", (await waiting).status);
release.resolve();
await work;
console.log("external writes after stop:", externalWrites);
console.log("old context entries:", session.context(oldRun).length);
const newRun = session.begin();
await session.invoke(newRun, async () => "fresh result");
console.log("new context:", JSON.stringify(session.context(newRun)));
