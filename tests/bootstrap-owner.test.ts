import { beforeAll, describe, expect, test } from "vitest";
import { provisionStaffMember } from "../src/auth/provision";
import { getChatbotService } from "../src/db/service";
import { useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  await warmChatbotService();
});

describe("trusted first-owner provisioning", () => {
  test("creates an owner invitation without accepting a password", async () => {
    const { auth, db } = await getChatbotService();
    const owner = await provisionStaffMember(auth, db, {
      email: "bootstrap-owner@example.edu",
      name: "Bootstrap Owner",
      role: "owner",
    });

    expect(owner).toMatchObject({
      email: "bootstrap-owner@example.edu",
      role: "owner",
      invitationStatus: "sent",
    });
    const stored = await db.get<{ role: string; invitationStatus: string }>(
      `SELECT role, "invitationStatus" FROM staff_members WHERE id = ?`,
      owner.userId,
    );
    expect(stored).toEqual({ role: "owner", invitationStatus: "sent" });
  });
});
