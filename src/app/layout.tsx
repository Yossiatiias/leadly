import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leadly — ניהול לידים",
  description: "מערכת ניהול לידים חכמה מבוססת AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('leadly-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
