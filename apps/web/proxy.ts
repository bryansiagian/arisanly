import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  // Redirect before streaming starts. The dashboard still verifies the session with the API.
  if (!request.cookies.get("arisanly_access")?.value) {
    return NextResponse.redirect(new URL("/masuk?sesi=1", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/dasbor/:path*" };
