import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";
import { createTriageServer } from "./server.mjs";

const server = createTriageServer();
let directory;
let socketPath;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "triage-"));
  socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\neowise-triage-${process.pid}`
    : join(directory, "http.sock");
  server.listen(socketPath);
  await once(server, "listening");
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

function post(body) {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath, path: "/api/triage", method: "POST",
      headers: { "Content-Type": "application/json" },
    }, async (response) => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve({ code: response.statusCode, data: JSON.parse(Buffer.concat(chunks)) });
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("неподходящий ввод возвращает 400", async () => {
  for (const body of ["{", "", "null", "[]", "{}", '{"text":1}', '{"text":""}', '{"text":"   "}']) {
    assert.deepEqual(await post(body), { code: 400, data: { status: "invalid_input" } }, body);
  }
});

test("возвращает тему и непустой черновик для каждого допустимого типа", async () => {
  for (const [text, topic] of [["  доставка  ", "delivery"], ["цена", "pricing"], ["вопрос", "other"]]) {
    const { code, data } = await post(JSON.stringify({ text }));
    assert.equal(code, 200);
    assert.deepEqual(data, { status: "ready", topic, draft: "Спасибо за обращение. Уточним детали заявки." });
  }
});

test("сбой имитатора требует ручного разбора и очищает черновик", async () => {
  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]", "[timeout]"]) {
    const start = performance.now();
    assert.deepEqual(await post(JSON.stringify({ text: marker })), {
      code: 200, data: { status: "manual_review", topic: null, draft: null },
    }, marker);
    if (marker === "[timeout]") {
      // Таймаут 300 мс плюс допуск на планировщик. Имитатор сам заканчивает через 1200 мс.
      assert.ok(performance.now() - start < 900, "ответ пришёл слишком поздно");
    }
  }
  assert.equal((await post('{"text":"доставка"}')).data.status, "ready");
});
