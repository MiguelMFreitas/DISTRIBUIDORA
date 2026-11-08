import type { NextConfig } from "next";

// Só para testes locais: se SUPABASE_PROXY_TARGET estiver definido, o navegador fala com
// o Supabase através do próprio site (/sb/...). Em produção não se usa.
const alvo = process.env.SUPABASE_PROXY_TARGET;

const nextConfig: NextConfig = {
  async rewrites() {
    return alvo ? [{ source: "/sb/:path*", destination: `${alvo}/:path*` }] : [];
  },
};

export default nextConfig;
