import { getChatbotService } from "@/db/service";

async function handle(request: Request): Promise<Response> {
  const response = await (await getChatbotService()).auth.handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = handle;
export const POST = handle;
