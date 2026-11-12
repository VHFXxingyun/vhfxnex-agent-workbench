import type { Metadata } from "next";
import Providers from "@/app/providers";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "VHFXNEX",
  title: "VHFXNEX | 让想法真正发生",
  description: "从目标到行动的 AI 执行工作台：比较路线、调用工具、交付成果。",
  openGraph: {
    title: "VHFXNEX | 让想法真正发生",
    description: "提出目标，比较执行路线，调用工具并交付成果。",
    siteName: "VHFXNEX",
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "VHFXNEX | 让想法真正发生",
    description: "从目标到行动的 AI 执行工作台：比较路线、调用工具、交付成果。",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
