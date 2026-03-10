export { auth as middleware } from "@/auth"

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/vault/:path*", "/admin/:path*"],
}
