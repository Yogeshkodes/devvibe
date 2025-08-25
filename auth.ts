// Replace your existing auth.js with this optimized version:

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "./lib/db";
import { authConfig } from "./auth.config";
import { getAccountByUserId, getUserById } from "./features/auth/actions";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // Only update session once per day (reduces DB calls)
  },
  secret: process.env.AUTH_SECRET,

  ...authConfig,
  callbacks: {
    /**
     * Handle user creation and account linking after a successful sign-in
     */
    async signIn({ user, account, profile }) {
      if (!user || !account) return false;

      // Check if the user already exists
      const existingUser = await db.user.findUnique({
        where: { email: user.email! },
      });

      // If user does not exist, create a new one
      if (!existingUser) {
        const newUser = await db.user.create({
          data: {
            email: user.email!,
            name: user.name,
            image: user.image,

            accounts: {
              // @ts-ignore
              create: {
                type: account.type,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
                refreshToken: account.refresh_token,
                accessToken: account.access_token,
                expiresAt: account.expires_at,
                tokenType: account.token_type,
                scope: account.scope,
                idToken: account.id_token,
                sessionState: account.session_state,
              },
            },
          },
        });

        if (!newUser) return false;
      } else {
        // Link the account if user exists
        const existingAccount = await db.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
        });

        // If the account does not exist, create it
        if (!existingAccount) {
          await db.account.create({
            data: {
              userId: existingUser.id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              refreshToken: account.refresh_token,
              accessToken: account.access_token,
              expiresAt: account.expires_at,
              tokenType: account.token_type,
              scope: account.scope,
              idToken: account.id_token,
              // @ts-ignore
              sessionState: account.session_state,
            },
          });
        }
      }

      return true;
    },

    // 🚀 FIXED: Only do DB queries on sign-in, not every session check
    async jwt({ token, user, account, trigger }) {
      // Only run expensive DB queries when signing in or when token is missing critical data
      if (trigger === "signIn" || (!token.role && token.sub)) {
        if (!token.sub) return token;

        try {
          console.log("🔍 JWT Callback: Fetching user data for", token.sub);
          const existingUser = await getUserById(token.sub);

          if (!existingUser) {
            console.warn("⚠️ JWT Callback: User not found for", token.sub);
            return token;
          }

          // Cache ALL user data in JWT token to prevent future DB calls
          token.name = existingUser.name;
          token.email = existingUser.email;
          token.role = existingUser.role;
          token.image = existingUser.image;

          console.log("✅ JWT Callback: User data cached in token");
        } catch (error) {
          console.error("❌ JWT Callback: Error fetching user:", error);
        }
      } else {
        // Just return the existing token with cached data - NO DB QUERIES
        console.log("✅ JWT Callback: Using cached token data (no DB query)");
      }

      return token;
    },

    // 🚀 OPTIMIZED: No database queries - just use JWT token data
    async session({ session, token }) {
      console.log("🔍 Session Callback: Populating session from token");

      // Populate session from cached JWT token data - NO DB QUERIES
      if (token.sub && session.user) {
        session.user.id = token.sub;
        session.user.role = token.role;
        session.user.name = token.name;
        //@ts-ignore
        session.user.email = token.email;
        //@ts-ignore
        session.user.image = token.image;
      }

      return session;
    },
  },
});
