import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import {
  DEFAULT_LOGIN_REDIRECT,
  apiAuthPrefix,
  publicRoutes,
  authRoutes,
} from "@/routes";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isApiAuthRoute = nextUrl.pathname.startsWith(apiAuthPrefix);
  const isPublicRoute = publicRoutes.includes(nextUrl.pathname);
  const isAuthRoute = authRoutes.includes(nextUrl.pathname);

  // Always allow API auth routes (including OAuth callbacks)
  if (isApiAuthRoute) {
    return null; // or return NextResponse.next()
  }

  // If user is on auth route and already logged in, redirect to default
  if (isAuthRoute) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL(DEFAULT_LOGIN_REDIRECT, nextUrl));
    }
    return null;
  }

  // Only redirect to sign-in if user is not logged in AND not on a public route
  if (!isLoggedIn && !isPublicRoute) {
    // Store the attempted URL as callbackUrl
    const callbackUrl = nextUrl.pathname + nextUrl.search;
    const signInUrl = new URL("/auth/sign-in", nextUrl);
    signInUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(signInUrl);
  }

  return null;
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
