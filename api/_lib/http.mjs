// Small helpers shared by the serverless endpoints.

// Reads and JSON-parses the request body whether or not the platform has
// already parsed it. Falls back to consuming the raw stream so large gzip
// envelopes are never silently dropped by a default parser limit.
import { storageError } from './storage-safety.mjs';
export async function readJsonBody(request, maxBytes = 4 * 1024 * 1024) {
  if (request.body !== undefined && request.body !== null && request.body !== "") {
    if (Buffer.byteLength(typeof request.body === 'string' ? request.body : JSON.stringify(request.body)) > maxBytes)
      throw storageError('REQUEST_TOO_LARGE', 'Payload too large', 413);
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
    if (size > maxBytes) throw storageError('REQUEST_TOO_LARGE', 'Payload too large', 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
