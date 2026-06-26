// Small helpers shared by the serverless endpoints.

// Reads and JSON-parses the request body whether or not the platform has
// already parsed it. Falls back to consuming the raw stream so large gzip
// envelopes are never silently dropped by a default parser limit.
export async function readJsonBody(request) {
  if (request.body !== undefined && request.body !== null && request.body !== "") {
    if (typeof request.body === "string") {
      return request.body ? JSON.parse(request.body) : {};
    }
    if (Buffer.isBuffer(request.body)) {
      const text = request.body.toString("utf8");
      return text ? JSON.parse(text) : {};
    }
    return request.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
