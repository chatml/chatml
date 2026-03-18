import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource/instrument-serif/400.css";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { ThemeScript } from "@/components/shared/ThemeScript";
import { ToastProvider } from "@/components/ui/toast";
import { GlobalErrorHandler } from "@/components/shared/GlobalErrorHandler";
import { PierreWorkerPoolProvider } from "@/components/shared/PierreWorkerPoolProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatML",
  description: "AI Agent Orchestration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={GeistSans.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PierreWorkerPoolProvider>
            <ToastProvider>
              <GlobalErrorHandler />
              {children}
            </ToastProvider>
          </PierreWorkerPoolProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
