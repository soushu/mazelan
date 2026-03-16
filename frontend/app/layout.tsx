import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mazelan",
  description: "AI-powered travel planning assistant",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        <script data-noptimize="1" data-cfasync="false" data-wpfc-render="false" dangerouslySetInnerHTML={{ __html: `(function(){var s=document.createElement("script");s.async=1;s.src="https://emrld.ltd/NTA4NTAz.js?t=508503";document.head.appendChild(s);})();` }} />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
