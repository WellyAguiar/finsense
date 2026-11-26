import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinSense — Visão Inteligente da Sua Vida Financeira",
  description:
    "Plataforma pessoal de gestão financeira com Open Finance Brasil (Meu Pluggy) e Inteligência Artificial Gemini.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-slate-950 font-sans text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
