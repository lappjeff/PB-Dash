import { redirect } from "next/navigation";
import { pageContext } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { viewer } = await pageContext();
  redirect(viewer.role === "ADMIN" ? "/dashboard" : "/my-dashboard");
}
