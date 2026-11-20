import { redirect } from "next/navigation";

/** The site root is the staff dashboard: signed-out visitors chain straight
 * to the login screen via /dashboard's own auth redirect. The WordPress
 * embed demo stays reachable at /demo/wordpress-test-page.html. */
export default function Home() {
  redirect("/dashboard");
}
