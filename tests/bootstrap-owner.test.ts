import { beforeAll, describe, expect, test } from "vitest";
import { provisionStaffMember } from "../src/auth/provision";
import { getChatbotService } from "../src/db/service";
import { useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  await warmChatbotService();
});

describe("trusted first-owner provisioning", () => {
  test("creates an owner username and password account", async () => {
    const { auth, db } = await getChatbotService();
    const owner = await provisionStaffMember(auth, db, {
      username: "bootstrap-owner",
      password: "bootstrap-owner-password-42",
      name: "Bootstrap Owner",
      role: "owner",
    });

    expect(owner).toMatchObject({
      username: "bootstrap-owner",
      role: "owner",
    });
    const stored = await db.get<{ role: string; username: string }>(
      `SELECT role, username FROM staff_members WHERE id = ?`,
      owner.userId,
    );
    expect(stored).toEqual({ role: "owner", username: "bootstrap-owner" });
  });
});
