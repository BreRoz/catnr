import type { Metadata } from "next";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://ari-rescue-assistant.matthew-bahren335256.chatgpt.site"),
  title: "TNR Assistant",
  description: "A careful AI memory for Ari's TNR and cat rescue work.",
  openGraph: {
    title: "TNR Assistant",
    description: "Your rescue, remembered.",
    images: [{ url: "/og.png", width: 1792, height: 928 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TNR Assistant",
    description: "Your rescue, remembered.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/tnr-cat.png",
    shortcut: "/tnr-cat.png",
    apple: "/tnr-cat.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
