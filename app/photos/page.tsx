import type { Metadata } from "next";
import { eventLabel, EVENT_DATE } from "@/lib/rsvp";
import Uploader from "./Uploader";

// The page a guest lands on from the QR code on the invitation, the poster, and the cards
// on the tables. Server component only so the event's name comes from app_settings and is
// never hard-coded here — the same rule the guest list follows, for the same reason: an
// invented name would be a fabricated fact printed in front of 150 people.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Share your photos",
  description: "Add the pictures you took to our album.",
};

export default async function PhotosPage() {
  const label = await eventLabel();
  return <Uploader eventLabel={label} eventDate={EVENT_DATE} />;
}
