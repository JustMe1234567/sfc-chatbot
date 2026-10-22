import { toNextJsHandler } from "better-auth/next-js";
import { getChatbotService } from "@/db/service";

export const { GET, POST } = toNextJsHandler(
  async (request: Request) => (await getChatbotService()).auth.handler(request),
);
