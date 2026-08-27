// HOW A LOAN DOCUMENT IS NAMED ON DISK — ONE COPY, TWO CALLERS.
//
// `scripts/sync-loan-docs.ts` (the mirror) and `scripts/scan-to-file.ts` (the scanner) both write
// into ~/Fetti Loan Files. If they sanitise a name even slightly differently they produce two
// files for one document, and the mirror's push side then re-uploads the copy the scanner made as
// a second document on the loan file. A duplicated regex is exactly how that drift starts, so the
// rule lives here and both import it.
export function safe(s: string, max = 70): string {
  return String(s || "")
    .replace(/[/\\:*?"<>|\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, "") || "untitled";
}

// The folder a loan file's documents live in. The file NUMBER is what makes it unique — the push
// side parses it back out of the folder name to decide which loan file a dropped-in file belongs
// to — so it must always be present and always be last.
export function loanFolderName(borrowerName: string | null, fileNumber: string | null, idFallback: string): string {
  return safe(`${borrowerName || "Borrower"} — ${fileNumber || idFallback.slice(0, 8)}`, 90);
}
