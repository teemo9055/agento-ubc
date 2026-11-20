import { redirect } from "next/navigation";

/** The recipe book was replaced by the job cards on the Inso and Worko homes; old links land on Worko. */
export default function Page() {
  redirect("/worko");
}
