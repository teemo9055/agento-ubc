import { redirect } from "next/navigation";

/** Travo became Worko: old links still land in the right place. */
export default function Travo() {
  redirect("/worko");
}
