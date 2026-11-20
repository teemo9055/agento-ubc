import { redirect } from "next/navigation";

/** Trado isn't offered any more: its old links land on Inso, which trades on prediction markets. */
export default function Page() {
  redirect("/inso");
}
