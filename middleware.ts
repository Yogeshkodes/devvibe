// middleware.ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import {
  apiAuthPrefix,
  authRoutes,
  DEFAULT_LOGIN_REDIRECT,
  publicRoutes,
} from "./routes";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const start = performance.now();
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // 🚀 NEW: Cache commonly used values
  const pathname = nextUrl.pathname;

  // 🚀 NEW: Early returns for better performance
  const isApiAuthRoute = pathname.startsWith(apiAuthPrefix);
  if (isApiAuthRoute) {
    return null; // Let NextAuth handle its own routes
  }

  // 🚀 NEW: Use Set for O(1) lookup instead of Array.includes() which is O(n)
  const publicRouteSet = new Set(publicRoutes);
  const authRouteSet = new Set(authRoutes);

  const isPublicRoute = publicRouteSet.has(pathname);
  const isAuthRoute = authRouteSet.has(pathname);

  // 🚀 NEW: Handle auth routes
  if (isAuthRoute) {
    if (isLoggedIn) {
      console.log(`🔄 Redirecting logged-in user from auth route: ${pathname}`);
      return Response.redirect(new URL(DEFAULT_LOGIN_REDIRECT, nextUrl));
    }
    return null; // Allow access to auth routes for non-logged-in users
  }

  // 🚀 NEW: Handle protected routes
  if (!isLoggedIn && !isPublicRoute) {
    console.log(`🔒 Redirecting unauthenticated user to sign-in: ${pathname}`);
    // 🚀 NEW: Preserve the intended destination
    const signInUrl = new URL("/auth/sign-in", nextUrl);
    if (pathname !== "/") {
      signInUrl.searchParams.set("callbackUrl", pathname);
    }
    return Response.redirect(signInUrl);
  }

  // 🚀 NEW: Performance logging for slow middleware
  const duration = performance.now() - start;
  if (duration > 100) {
    // Log if middleware takes more than 100ms
    console.warn(
      `⚠️ Slow middleware: ${pathname} took ${duration.toFixed(2)}ms`
    );
  }

  return null;
});

export const config = {
  matcher: [
    // 🚀 NEW: More specific matcher for better performance
    // Skip Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
    // Include root
    "/",
    // Include API routes (but NextAuth routes will be handled above)
    "/(api|trpc)(.*)",
  ],
};
