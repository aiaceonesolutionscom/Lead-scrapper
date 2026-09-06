import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/shared/auth-gate";
import { ThemeProvider } from "@/components/shared/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lead Extractor + CRM",
  description: "Extract business leads from worldwide sources and manage them in CRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('lead-crm:theme')||'auto';var h=new Date().getHours();var dark=m==='dark'||(m!=='light'&&(h>=19||h<7));if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider>
          <AuthGate>{children}</AuthGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
