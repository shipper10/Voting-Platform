import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "منصة انتخابات الدفعة", description: "تصويت آمن وسهل لانتخابات الدفعة" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans">
        <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
