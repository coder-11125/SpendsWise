import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, clearDb, stopTestDb } from "./helpers/db.js";
import { uniqueEmail } from "./helpers/auth.js";
import authRouter from "../src/routes/auth.js";

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRouter);

const VALID_PASSWORD = "StrongPass1!";

beforeAll(async () => {
  await startTestDb();
});

beforeEach(async () => {
  await clearDb();
});

afterAll(async () => {
  await stopTestDb();
});

describe("register", () => {
  it("creates a user and returns a session", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: VALID_PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.token).toBeTruthy();

    const cookie = res.headers["set-cookie"] as unknown as string[];
    const session = cookie.find((c) => c.startsWith("sw_session="));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Strict");
  });

  it("rejects malformed emails", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: VALID_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("rejects weak passwords with a helpful message", async () => {
    const cases = [
      "short1!", // too short
      "alllowercase1!", // no uppercase
      "ALLUPPERCASE1!", // no lowercase
      "NoNumberHere!", // no digit
      "NoSpecialChar1", // no special
      "A".repeat(73) + "a1!", // over 72 bytes
    ];
    for (const password of cases) {
      const res = await request(app)
        .post("/api/auth/register")
        .send({ email: uniqueEmail(), password });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/password/i);
    }
  });

  it("rejects duplicate emails with 409", async () => {
    const email = uniqueEmail();
    const first = await request(app)
      .post("/api/auth/register")
      .send({ email, password: VALID_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/auth/register")
      .send({ email, password: VALID_PASSWORD });
    expect(second.status).toBe(409);
  });
});

describe("login", () => {
  it("logs in with correct credentials", async () => {
    const email = uniqueEmail();
    await request(app).post("/api/auth/register").send({ email, password: VALID_PASSWORD });

    const res = await request(app).post("/api/auth/login").send({ email, password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    const email = uniqueEmail();
    await request(app).post("/api/auth/register").send({ email, password: VALID_PASSWORD });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "WrongPass1!" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown email without leaking account existence", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: uniqueEmail(), password: VALID_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe("session + profile", () => {
  async function registerAndGetToken(): Promise<{ email: string; token: string }> {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: VALID_PASSWORD });
    return { email, token: res.body.token as string };
  }

  it("returns the profile for an authenticated request", async () => {
    const { email, token } = await registerAndGetToken();
    const res = await request(app).get("/api/auth/me").set("Cookie", [`sw_session=${token}`]);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it("rejects /me without a session", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("updates a valid timezone and rejects an invalid one", async () => {
    const { token } = await registerAndGetToken();

    const ok = await request(app)
      .put("/api/auth/timezone")
      .set("Cookie", [`sw_session=${token}`])
      .send({ timezone: "Asia/Kolkata" });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .put("/api/auth/timezone")
      .set("Cookie", [`sw_session=${token}`])
      .send({ timezone: "Mars/Olympus" });
    expect(bad.status).toBe(400);
  });
});

describe("password change", () => {
  it("invalidates all existing sessions after a password change", async () => {
    const email = uniqueEmail();
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email, password: VALID_PASSWORD });
    const oldToken = reg.body.token as string;
    const oldCookie = [`sw_session=${oldToken}`];

    // Wrong current password is rejected and does not revoke the session.
    const wrong = await request(app)
      .put("/api/auth/password")
      .set("Cookie", oldCookie)
      .send({ currentPassword: "WrongPass1!", newPassword: "NewStrongPass2!" });
    expect(wrong.status).toBe(401);
    const stillValid = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(stillValid.status).toBe(200);

    // Correct change bumps tokenVersion: old token is dead, new token works.
    const change = await request(app)
      .put("/api/auth/password")
      .set("Cookie", oldCookie)
      .send({ currentPassword: VALID_PASSWORD, newPassword: "NewStrongPass2!" });
    expect(change.status).toBe(200);

    const oldTokenRejected = await request(app).get("/api/auth/me").set("Cookie", oldCookie);
    expect(oldTokenRejected.status).toBe(401);

    const newToken = change.body.token as string;
    const newTokenWorks = await request(app)
      .get("/api/auth/me")
      .set("Cookie", [`sw_session=${newToken}`]);
    expect(newTokenWorks.status).toBe(200);
  });
});
