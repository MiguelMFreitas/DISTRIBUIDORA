import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Inter, Poppins } from "next/font/google";
import { SCRIPT_VISUAL } from "@/lib/visual";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-condensed" });
// fontes dos outros visuais: só baixam se o visual escolhido usar
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", preload: false });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-poppins", preload: false });

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
    <html lang="pt-BR" className={`${barlow.variable} ${barlowCondensed.variable} ${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <head>
        {/* aplica o visual escolhido antes de a tela aparecer (as telas de impressão ficam sempre no clássico) */}
        <script dangerouslySetInnerHTML={{ __html: `if(!location.pathname.startsWith("/imprimir"))${SCRIPT_VISUAL}` }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
