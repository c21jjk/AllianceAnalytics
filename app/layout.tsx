import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Alliance Social — Century 21 Alliance",
  description:
    "Social media analytics & reporting platform for Century 21 Alliance.",
  applicationName: "Alliance Social",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FCFCFB",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={barlow.variable}>
      <body className="font-sans antialiased text-neutral-900 bg-neutral-25 min-h-screen">
        {children}
      </body>
    </html>
  );
}
