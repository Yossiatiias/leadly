import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ססיה — ניהול לידים",
  description: "מערכת ניהול לידים פנימית של ססיה",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
