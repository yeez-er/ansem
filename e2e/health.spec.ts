// Task 2 (spec 000): system.health over the real HTTP stack (dev server).
import { expect, test } from "@playwright/test";

test("tRPC route answers system.health with ok:true and an ISO time", async ({
  request,
}) => {
  const res = await request.get("/api/trpc/system.health");
  expect(res.status()).toBe(200);

  // superjson envelope: result.data.json is the procedure output
  const body = (await res.json()) as {
    result: { data: { json: { ok: boolean; time: string } } };
  };
  const health = body.result.data.json;
  expect(health.ok).toBe(true);
  expect(new Date(health.time).toISOString()).toBe(health.time);
});
