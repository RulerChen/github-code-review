export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function comparePaths(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const aDir = i < pa.length - 1;
    const bDir = i < pb.length - 1;
    if (aDir !== bDir) return aDir ? -1 : 1;
    const c = pa[i]!.localeCompare(pb[i]!);
    if (c !== 0) return c;
  }
  return 0;
}
