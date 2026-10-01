const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How Alexa credits a recommendation: the hosts' view on a date, never a current rating. */
export function attribution(showName: string, publishedAt: number): string {
  const date = new Date(publishedAt);
  return `${showName}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
