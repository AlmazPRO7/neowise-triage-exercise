import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const topics = new Set(["delivery", "pricing", "other"]);
const manualReview = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }
  if (typeof input?.text !== "string" || !input.text.trim()) {
    return json(response, 400, { status: "invalid_input" });
  }

  try {
    const signal = AbortSignal.timeout(300);
    const result = JSON.parse(await classify(input.text.trim(), { signal }));
    if (topics.has(result?.topic) && typeof result.draft === "string" && result.draft.trim()) {
      return json(response, 200, { status: "ready", topic: result.topic, draft: result.draft.trim() });
    }
  } catch {
    // Ошибки имитатора, таймаут и битый JSON требуют ручного разбора.
  }
  return json(response, 200, manualReview);
}

async function handleRequest(request, response) {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
}

export function createTriageServer() {
  return createServer(handleRequest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createTriageServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
