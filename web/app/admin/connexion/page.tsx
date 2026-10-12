import type { Metadata } from "next";
import AdminLogin from "@/components/AdminLogin";
import "../admin.css";

export const metadata: Metadata = {
  title: "Connexion administrateur, lab.bingo games",
  robots: { index: false, follow: false },
};
export default function LoginPage() {
  return <AdminLogin />;
}
