// Resolves a PDF outline (bookmarks) to page indexes and y positions.
export async function resolveOutline(pdf) {
  let outline;
  try { outline = await pdf.getOutline(); } catch { return null; }
  if (!outline || !outline.length) return null;
  const resolve = async (items) => {
    const out = [];
    for (const it of items) {
      const e = { title: it.title || '', page: null, top: null, items: [] };
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) {
          const ref = dest[0];
          e.page = typeof ref === 'object' ? await pdf.getPageIndex(ref) : ref;
          if (dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') {
            const page = await pdf.getPage(e.page + 1);
            const vp = page.getViewport({ scale: 1 });
            e.top = vp.convertToViewportPoint(0, dest[3])[1];
          }
        }
      } catch { /* unresolvable entry */ }
      if (it.items?.length) e.items = await resolve(it.items);
      out.push(e);
    }
    return out;
  };
  return resolve(outline);
}
