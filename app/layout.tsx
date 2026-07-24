import type { Metadata, Viewport } from "next";
import { Barlow } from "next/font/google";
import PwaRegistrar from "@/components/PwaRegistrar";
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
  // PWA / iOS home-screen install. `appleWebApp` opts the installed app
  // into standalone (no Safari chrome) on iOS; the apple-touch-icon is
  // what iOS uses for the home-screen tile. The manifest itself is served
  // from app/manifest.ts at /manifest.webmanifest.
  appleWebApp: {
    capable: true,
    title: "Alliance Social",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/brand/app-icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#FCFCFB",
  // Lets the app paint edge-to-edge behind the iPhone home indicator so
  // the bottom tab bar can pad itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
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
        <PwaRegistrar />
      </body>
    </html>
  );
}
