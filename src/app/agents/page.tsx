import { redirect } from "next/navigation";

/** The agent directory was folded into the Inso and Worko homes; old links land on the jobs page. */
export default function Page() {
  redirect("/home");
}
