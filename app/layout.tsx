import type { Metadata } from "next";
import { Bodoni_Moda, Archivo, IBM_Plex_Mono, Geist, Saira_Extra_Condensed } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const sairaCondensed = Saira_Extra_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const bodoni = Bodoni_Moda({
  variable: "--font-bodoni",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "cVault — on-chain ETF ops console",
  description:
    "Multi-vault ETF admin console for deposits, redemptions, NAV views, and on-chain vault operations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", bodoni.variable, archivo.variable, plexMono.variable, "font-sans", geist.variable, sairaCondensed.variable)}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
