import { getChatbotService } from "@/db/service";

async function handle(request: Request): Promise<Response> {
  const service = await getChatbotService();
  const response = await service.auth.handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = handle;
export const POST = handle;
