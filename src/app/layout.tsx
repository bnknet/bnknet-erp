import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "비앤케이넷 ERP",
  description: "BNKNET 통합 ERP 시스템",
  manifest: "/manifest.webmanifest",
  applicationName: "BNKnet ERP",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "BNKnet ERP",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#6E5230",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSansKR.variable} h-full`}
    >
      <body className="min-h-full flex flex-col font-sans antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
