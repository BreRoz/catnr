"use client";
import { useState } from "react";
import { useAction } from "./hooks";
import { Message, when } from "./ui";

export type AccountStatus = {
  counts: Record<string, number>;
  countLabels: Record<string, string>;
  revision: number;
  lastFullExport: string | null;
  waitHours: number;
  confirmPhrase: string;
  willDelete: string[];
  willRemain: string[];
  photosStoredElsewhere: number;
  retention: Array<{ id: string; what: string; keptFor: string; why: string }>;
  request: { requestedAt: string; executeAfter: string; canConfirm: boolean; hoursLeft: number } | null;
};

/** Ask → wait 24 hours (cancel any time) → type the phrase. Nothing is deleted before the last step. */
export default function DeleteAccount({ status, onChanged }: { status: AccountStatus; onChanged: () => void }) {
  const act = useAction();
  const [understood, setUnderstood] = useState(false),
    [phrase, setPhrase] = useState(""),
    [deleted, setDeleted] = useState("");
  if (deleted)
    return (
      <div className="dataCard danger" role="status">
        <p>{deleted}</p>
        <a className="primary dataLink" href="/cdn-cgi/access/logout">
          Sign out
        </a>
      </div>
    );
  const total = Object.entries(status.counts).filter(([k]) => k !== "record_changes" && k !== "corrections" && k !== "merges");
  const request = status.request;
  return (
    <div className="dataCard danger">
      <p>
        <strong>This permanently deletes your whole rescue record.</strong> It cannot be undone, and nobody can recover it for you.
      </p>
      <p>Right now that means:</p>
      <ul>
        {total.map(([k, n]) => (
          <li key={k}>
            {n} {status.countLabels[k] ?? k}
          </li>
        ))}
      </ul>
      <p>What will be deleted:</p>
      <ul>
        {status.willDelete.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p>What will not:</p>
      <ul>
        {status.willRemain.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {status.photosStoredElsewhere > 0 && (
        <p className="recError" role="alert">
          {status.photosStoredElsewhere} older photo{status.photosStoredElsewhere === 1 ? " is" : "s are"} stored in a separate place that
          this deletion cannot reach.
        </p>
      )}
      <p className={status.lastFullExport ? "recHint" : "recError"} role={status.lastFullExport ? undefined : "alert"}>
        {status.lastFullExport
          ? `You last downloaded everything ${when(status.lastFullExport)}. Records changed since then are not in that file.`
          : "You have not downloaded your data yet. Download everything above before you delete."}
      </p>
      <Message error={act.error} notice={act.notice} />
      {!request ? (
        <>
          <label className="importSkip">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this is permanent
            and I have downloaded what I want to keep.
          </label>
          <button
            type="button"
            className="recSecondary"
            disabled={!understood || act.busy}
            onClick={async () => {
              if (await act.run("account", { action: "request" })) onChanged();
            }}
          >
            Ask to delete my account
          </button>
          <p className="recHint">Asking deletes nothing. You wait {status.waitHours} hours, you can cancel, and then you confirm.</p>
        </>
      ) : (
        <>
          <p className="recNotice" role="status">
            Requested {when(request.requestedAt)}.{" "}
            {request.canConfirm
              ? "You can confirm now."
              : `You can confirm in about ${request.hoursLeft} hour${request.hoursLeft === 1 ? "" : "s"}.`}{" "}
            Your records are untouched until you do.
          </p>
          {request.canConfirm && (
            <div className="recField">
              <label htmlFor="deletePhrase">Type {status.confirmPhrase} to confirm</label>
              <input id="deletePhrase" value={phrase} autoComplete="off" onChange={(e) => setPhrase(e.target.value)} />
            </div>
          )}
          <div className="recButtons">
            {request.canConfirm && (
              <button
                type="button"
                className="primary dangerButton"
                disabled={act.busy || phrase !== status.confirmPhrase}
                onClick={async () => {
                  const r = await act.run<{ message: string }>("account", {
                    action: "confirm",
                    confirm: phrase,
                    revision: status.revision,
                  });
                  if (r) setDeleted(r.message);
                  else onChanged();
                }}
              >
                Delete everything permanently
              </button>
            )}
            <button
              type="button"
              className="recSecondary"
              disabled={act.busy}
              onClick={async () => {
                if (await act.run("account", { action: "cancel" })) {
                  setPhrase("");
                  setUnderstood(false);
                  onChanged();
                }
              }}
            >
              Cancel the request
            </button>
          </div>
        </>
      )}
    </div>
  );
}
