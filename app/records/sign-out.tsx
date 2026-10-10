"use client";

/** Ends this browser's session, then returns to the sign-in page. */
export default function SignOut({ className = "recSecondary" }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await fetch("/auth/signout", { method: "POST" });
        } finally {
          location.assign("/signin");
        }
      }}
    >
      Sign out
    </button>
  );
}
