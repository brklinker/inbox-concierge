/** "Jane Doe <jane@x.com>" -> "Jane Doe"; bare addresses pass through. */
export function senderName(sender: string | null): string {
  if (!sender) return "(unknown sender)";
  const match = sender.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : sender.trim();
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
