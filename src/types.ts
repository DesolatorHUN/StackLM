export type ScrapeStatus = "ideal" | "pending" | "scraping" | "completed" | "failed";

export interface UrlItem {
  id: string;
  url: string;
  title: string;
  domain: string;
  text: string;
  status: ScrapeStatus;
  error?: string;
  scrapedAt?: string;
}

export interface GroupItem {
  id: number;
  filename: string;
  sources: UrlItem[];
}
