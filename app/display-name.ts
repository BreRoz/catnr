/** A friendly first name for the greeting, guessed from the sign-in email: "jane.doe@x.com" → "Jane". */
export function firstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const word = local.split(/[._+\-\s]+/).find((part) => /[a-z]/i.test(part)) ?? "";
  const letters = word.replace(/[^a-z]/gi, "");
  return letters ? letters[0].toUpperCase() + letters.slice(1).toLowerCase() : "there";
}
