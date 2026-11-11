import { NextResponse } from "next/server";

/**
 * Unexpected store errors used to bubble to Next's default HTML 500, so an
 * API client (the widget iframe) could receive non-JSON failures its
 * `.json()` parse could not read (ticket 34). Wrap a route handler with
 * this to map a thrown error to a JSON 500 instead; expected 4xx responses
 * still return through their normal paths and never reach the catch.
 */
export function jsonServerError(error: unknown): NextResponse {
  console.error("route handler failed:", error);
  // The same { error: { code, message } } envelope the route helpers emit,
  // so clients read unexpected failures exactly like expected ones.
  return NextResponse.json(
    { error: { code: "internal_error", message: "Unexpected server error." } },
    { status: 500 },
  );
}

/**
 * Route-handler wrapper: preserves the handler's signature (the context is
 * optional for param-less routes, which tests call with the request alone),
 * so `export const POST = withJsonErrors(postHandler)` keeps the generated
 * route types happy while every thrown error lands in the JSON 500 above.
 */
export function withJsonErrors<C>(
  handler: (request: Request, context: C) => Promise<Response>,
): (request: Request, context?: C) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context as C);
    } catch (error) {
      return jsonServerError(error);
    }
  };
}
