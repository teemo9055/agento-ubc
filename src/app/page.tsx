import { redirect } from "next/navigation";

// Stand-in until the landing page lands: the app home lives at /home.
export default function Landing() {
  redirect("/home");
}
