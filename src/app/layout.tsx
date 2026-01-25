import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource/instrument-serif/400.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeScript } from "@/components/ThemeScript";
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
