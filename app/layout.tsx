import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#19483e",
};

export const metadata: Metadata = {
  applicationName: "TNR Assistant",
  appleWebApp: { capable: true, title: "TNR Assistant", statusBarStyle: "default" },
  title: "TNR Assistant",
  description: "A careful AI memory for Ari's TNR and cat rescue work.",
  openGraph: {
    title: "TNR Assistant",
    description: "The full story of your rescue work.",
    images: [{ url: "/og.png", width: 1792, height: 928 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TNR Assistant",
    description: "The full story of your rescue work.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/tnr-cat.png",
    shortcut: "/tnr-cat.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* The whole site sits behind Cloudflare Access, so the manifest request must carry the sign-in cookie. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
