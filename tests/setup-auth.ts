import { vi } from "vitest";

vi.mock("../src/auth/supabase-provider", async () => import("./fake-auth-provider"));
