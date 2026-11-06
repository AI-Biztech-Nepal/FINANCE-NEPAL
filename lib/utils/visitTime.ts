// lib/utils/visitTime.ts
//
// How the Visits page words a visitor's stay: minutes, the page, who, and when. Plain functions so they can be tested alone.

/** "–" when nothing was timed (a page opened before the website sent time), "< 1 min" under half a minute, then whole
 * minutes ("7 min"), then hours ("1 h 5 min"). */
export function formatStay(seconds: number): string {
  if (!(seconds > 0)) return '–';
  if (seconds < 30) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

/** The address as a name: "/" is Home, "/shop.html" is Shop, "/product.php?id=4" is Product #4. */
export function pageLabel(path: string): string {
  const [file, query = ''] = path.split('?');
  const name = file.replace(/^\//, '').replace(/\.(html|php)$/, '').replace(/[-_/]+/g, ' ').trim();
  if (!name || name === 'index') return 'Home';
  const id = /(?:^|&)id=([\w-]+)/.exec(query)?.[1];
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return id ? `${label} #${id}` : label;
}

/** A short name to tell visitors apart: the website gives each browser a random id, so "Visitor 3F9A2C". */
export function visitorLabel(visitor: string): string {
  const id = visitor.replace(/[^0-9a-z]/gi, '').slice(0, 6).toUpperCase();
  return !id || visitor === 'unknown' ? 'Visitor' : `Visitor ${id}`;
}

/** "6 Nov, 3:42 pm" in Nepal time, the same clock the daily totals on the Visits page are cut by. */
export function visitWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return d.toLocaleString();
  }
}
