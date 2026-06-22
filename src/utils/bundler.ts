import { UrlItem, GroupItem } from "../types";

/**
 * Special Greedy Load-Balancing & Partitioning Algorithm
 * Groups clean scraped URL items into up to `limit` buckets based on volume/length balance.
 * 
 * Steps:
 * 1. Measure character content of each item.
 * 2. Sort items by character count in descending order (longest first).
 * 3. Initialize K baskets, where K = min(N, limit).
 * 4. Sequentially assign each item to the basket with the lowest accumulated characters.
 * 5. Returns formatted group items with proper naming conventions.
 */
export function partitionSources(urls: UrlItem[], limit = 50, namingConvention = "forras_001_[domain].pdf"): GroupItem[] {
  const N = urls.length;
  if (N <= 0) return [];

  // Determine actual number of baskets (cannot exceed unique available source documents, or limit)
  const K = Math.min(N, Math.max(1, limit));

  const baseSize = Math.floor(N / K);
  const remainder = N % K;

  const baskets: { id: number; sources: UrlItem[] }[] = [];
  let currentIdx = 0;

  for (let bIndex = 0; bIndex < K; bIndex++) {
    const id = bIndex + 1;
    // The first `remainder` baskets get `baseSize + 1` items; the rest get `baseSize`
    const size = bIndex < remainder ? baseSize + 1 : baseSize;
    const basketUrls = urls.slice(currentIdx, currentIdx + size);
    currentIdx += size;

    baskets.push({
      id,
      sources: basketUrls,
    });
  }

  // Format non-empty baskets as final GroupItem list
  return baskets
    .filter((b) => b.sources.length > 0)
    .map((b, idx) => {
      const id = idx + 1;
      const primarySource = b.sources[0];
      const domainName = primarySource?.domain || "forras";
      const sanitizedDomain = sanitizeFilename(domainName);
      
      const isMerged = b.sources.length > 1;
      
      let pattern = namingConvention || "forras_001_[domain].pdf";
      pattern = pattern.replace("001", String(id).padStart(3, "0"));
      pattern = pattern.replace("[domain]", sanitizedDomain);
      if (!pattern.toLowerCase().endsWith(".pdf")) {
        pattern += ".pdf";
      }
      if (isMerged && !pattern.toLowerCase().includes("osszefuzott") && !pattern.toLowerCase().includes("merged")) {
        // Safe insertion of _osszefuzott before .pdf
        pattern = pattern.replace(/\.pdf$/i, "_osszefuzott.pdf");
      }
      
      const filename = pattern;

      return {
        id,
        filename,
        sources: b.sources,
      };
    });
}

/**
 * Sanitizes domain strings for standard safe filenames
 */
export function sanitizeFilename(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

