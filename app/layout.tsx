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
  title: "Rescue Assistant",
  description: "A careful AI memory for Ari's cat rescue.",
  openGraph: {
    title: "Rescue Assistant",
    description: "Your rescue, remembered.",
    images: [{ url: "/og.png", width: 1792, height: 928 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rescue Assistant",
    description: "Your rescue, remembered.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
