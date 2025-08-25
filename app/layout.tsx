import { type Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { ThemeProvider } from "@/components/provider/theme-provider";
import { auth } from "@/auth";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "DevVibe",
  description: "Online Code Playground",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  return (
    <SessionProvider session={session}>
      <html lang="en" suppressHydrationWarning>
        <body className="antialiased" suppressHydrationWarning>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="flex flex-col min-h-screen">
              <Toaster />
              <div className="flex-1">{children}</div>
            </div>
          </ThemeProvider>
        </body>
      </html>
    </SessionProvider>
  );
}
