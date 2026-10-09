"use client";
import { useState } from "react";
import { Sheet } from "../dialog";
import RollCallShare from "../records/roll-call-share";

/** The "Share Roll Call" button under Add Photo: opens a sheet that makes the picture for social media. */
export default function ShareRollCall() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        <span className="actionIcon photo" aria-hidden="true">
          ↗
        </span>
        <strong>Share Roll Call</strong>
        <b aria-hidden="true">›</b>
      </button>
      {open && (
        <Sheet title="Share a roll call" eyebrow="FOR SOCIAL MEDIA" onClose={() => setOpen(false)}>
          <RollCallShare bare />
        </Sheet>
      )}
    </>
  );
}
