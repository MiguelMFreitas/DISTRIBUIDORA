import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-condensed" });

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora",
  description: "Pedidos, cargas e romaneio",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pedidos", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#d98a0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
