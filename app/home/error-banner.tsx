import type { Banner } from "./types";

/** A failure message with a way to try again; nothing Ari typed is lost when it shows. */
export default function ErrorBanner({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  return (
    <div className="recError" role="alert">
      <p>{banner.message}</p>
      <div className="recButtons">
        {banner.retry && (
          <button type="button" className="recSmall" onClick={banner.retry}>
            Try again
          </button>
        )}
        <button type="button" className="recSmall" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
