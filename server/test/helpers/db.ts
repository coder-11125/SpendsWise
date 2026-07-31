import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// A single in-memory MongoDB instance per test file. Started in beforeAll and
// stopped in afterAll so the detached mongod process is always cleaned up,
// even when a test fails (vitest still runs afterAll).
let memoryServer: MongoMemoryServer | null = null;

export async function startTestDb(): Promise<string> {
  if (mongoose.connection.readyState !== 0) {
    return memoryServer?.getUri() ?? "mongodb://127.0.0.1:27017/spendswise-test";
  }
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());
  return memoryServer.getUri();
}

export async function clearDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));

  // Space ledgers live in their own `space_<id>` databases (mongoose.useDb).
  // Drop them so recurring/space tests start clean without cross-test leakage.
  const spaceConns = mongoose.connections.filter(
    (c) => c !== mongoose.connection && c.name.startsWith("space_")
  );
  await Promise.all(spaceConns.map((c) => c.dropDatabase()));
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
