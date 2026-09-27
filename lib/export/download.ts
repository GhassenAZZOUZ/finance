/** Saves a generated file in the browser (no server storage, issue #7). */
export function downloadFile(fileName: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some mobile browsers read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
