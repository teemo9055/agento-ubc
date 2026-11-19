import { mintOnrampSession } from "@/server/onramp";

export const dynamic = "force-dynamic";

/** POST { network, destinationAddress, appUserId } → an Arc Onramp session for the widget. */
export const POST = (req: Request) => mintOnrampSession(req);
