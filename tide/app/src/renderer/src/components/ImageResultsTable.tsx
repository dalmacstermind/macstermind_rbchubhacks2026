// Per-image counts. Images never get subsample points and are never part of MeanCount.
import type { ImageResult } from "../../../shared/api";
import { Chip } from "../ui";

export function ImageResultsTable({
  images,
  speciesName,
}: {
  images: ImageResult[];
  speciesName: (id: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="font-display text-lg font-semibold">Images</div>
      <p className="text-xs text-muted-foreground">Counted per image; not part of MeanCount.</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Image</th>
              <th className="px-3 py-2">Fish</th>
              <th className="px-3 py-2">Invertebrates</th>
              <th className="px-3 py-2">Species</th>
              <th className="px-3 py-2">Unknown</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {images.map((im) => (
              <tr key={im.fileId} className="border-t border-border">
                <td className="max-w-xs truncate px-3 py-2" title={im.relPath}>
                  {im.relPath}
                </td>
                <td className="px-3 py-2">{im.totalFish}</td>
                <td className="px-3 py-2">{im.invertebrates}</td>
                <td className="px-3 py-2 text-xs">
                  {Object.entries(im.perSpecies)
                    .map(([id, n]) => `${speciesName(id)} ${n}`)
                    .join(", ") || "–"}
                </td>
                <td className="px-3 py-2">{im.unknown}</td>
                <td className="px-3 py-2">
                  {im.needsReview ? <Chip tone="review">Review</Chip> : <Chip tone="info">AI</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
