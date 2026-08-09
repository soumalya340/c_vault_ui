import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Saira_Extra_Condensed } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

const sairaCondensed = Saira_Extra_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "cVault — Own the basket, not the bag",
  description:
    "Deposit once. Own the fund. Exit on your terms. Decentralized token funds on Solana.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full dark antialiased",
        inter.variable,
        plexMono.variable,
        sairaCondensed.variable,
        "font-sans",
      )}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
