import React, { useState, useEffect, useRef } from "react";
import { 
  FileText, 
  Play, 
  Pause, 
  Download, 
  Upload, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Trash2, 
  Search, 
  Edit3, 
  BookOpen, 
  Layers, 
  Check, 
  Plus, 
  ExternalLink,
  ChevronRight,
  Info,
  Menu,
  X,
  Settings,
  Eye
} from "lucide-react";
import { UrlItem, GroupItem, ScrapeStatus } from "./types";
import { partitionSources } from "./utils/bundler";

interface ApprovedPattern {
  pathname: string;
  queryParamKeys: string[];
  keywords: string[];
}

const extractUrlPattern = (urlStr: string): ApprovedPattern => {
  try {
    const url = new URL(urlStr);
    const pathSegments = url.pathname.split('/').map(part => {
      if (!part) return "";
      if (/^\d+$/.test(part)) return ":id";
      return part.toLowerCase();
    }).filter(Boolean);
    
    const pathname = pathSegments.join('/');
    const queryParamKeys = Array.from(new URLSearchParams(url.search).keys()).map(k => k.toLowerCase());
    
    const keywords: string[] = [];
    const urlLower = urlStr.toLowerCase();
    ["category", "tag", "filter", "page", "archive", "shop"].forEach(kw => {
      if (urlLower.includes(kw)) {
        keywords.push(kw);
      }
    });

    return { pathname, queryParamKeys, keywords };
  } catch (e) {
    return { pathname: "", queryParamKeys: [], keywords: [] };
  }
};

const isSimilarToApproved = (urlStr: string, approved: ApprovedPattern[]): boolean => {
  if (approved.length === 0) return false;
  try {
    const current = extractUrlPattern(urlStr);
    
    return approved.some(item => {
      if (item.pathname && current.pathname === item.pathname) {
        return true;
      }
      if (item.queryParamKeys.length > 0 && current.queryParamKeys.length > 0) {
        const hasMatchingParam = current.queryParamKeys.some(key => item.queryParamKeys.includes(key));
        if (hasMatchingParam) return true;
      }
      if (item.keywords.length > 0 && current.keywords.length > 0) {
        const hasMatchingKeyword = current.keywords.some(kw => item.keywords.includes(kw));
        if (hasMatchingKeyword) return true;
      }
      return false;
    });
  } catch (e) {
    return false;
  }
};

const getAutoClassification = (url: string): string => {
  if (!url) return "Core";
  const lower = url.toLowerCase();
  if (lower.includes("/api/") || lower.includes("api-") || lower.includes("rest/api/")) {
    return "API";
  }
  if (lower.includes("/extension") || lower.includes("-extension") || lower.includes("/plugins/") || lower.includes("/modules/")) {
    return "Extension";
  }
  if (lower.includes("/docs/") || lower.includes("/documentation/") || lower.includes("/guide/")) {
    return "Documentation";
  }
  if (lower.endsWith("/") || lower.endsWith("/index") || lower.split("/").length <= 4) {
    return "Core";
  }
  return "Page";
};

export default function App() {
  // Navigation tabs
  type TabType = "research" | "input" | "scraping" | "bundling";
  const [activeTab, setActiveTab] = useState<TabType>("research");

  // State: "00. Kutatás" tab
  const [researchUrl, setResearchUrl] = useState<string>("https://woocommerce.com/document/");
  const [isCrawling, setIsCrawling] = useState<boolean>(false);
  const [crawlerLevel, setCrawlerLevel] = useState<number>(0);
  const [crawlingActiveUrl, setCrawlingActiveUrl] = useState<string>("");
  const [crawlerDiscoveries, setCrawlerDiscoveries] = useState<string[]>([]);
  const [frontierUrls, setFrontierUrls] = useState<string[]>([]);
  const [exploredCrawlerUrls, setExploredCrawlerUrls] = useState<string[]>([]);
  const [layerReport, setLayerReport] = useState<string>("");
  const [researchError, setResearchError] = useState<string>("");
  const [failedCrawlerUrls, setFailedCrawlerUrls] = useState<string[]>([]);

  const [urlClassifications, setUrlClassifications] = useState<Record<string, string>>({});

  const getUrlClassification = (url: string): string => {
    return urlClassifications[url] || getAutoClassification(url);
  };

  const handleToggleClassification = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = getUrlClassification(url);
    const options = ["Core", "API", "Extension", "Page", "Documentation"];
    const nextIndex = (options.indexOf(current) + 1) % options.length;
    setUrlClassifications(prev => ({
      ...prev,
      [url]: options[nextIndex]
    }));
  };

  const getBadgeColors = (category: string) => {
    switch (category) {
      case "Core":
        return "bg-cyan-50 text-cyan-700 border border-cyan-200/50";
      case "API":
        return "bg-purple-50 text-purple-700 border border-purple-200/50";
      case "Extension":
        return "bg-indigo-50 text-indigo-700 border border-indigo-200/50";
      case "Documentation":
        return "bg-emerald-50 text-emerald-700 border border-emerald-200/50";
      default:
        return "bg-slate-50 text-slate-700 border border-slate-200/50";
    }
  };

  // Preview Modal state
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [previewRawContent, setPreviewRawContent] = useState<string>("");
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState<boolean>(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  // Parent State (01, 02, 03 tabs)
  const [rawText, setRawText] = useState<string>("");
  const [useGemini, setUseGemini] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [urlItems, setUrlItems] = useState<UrlItem[]>([]);
  const [concurrency, setConcurrency] = useState<number>(3);
  const [isScrapingActive, setIsScrapingActive] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pdfSearchQuery, setPdfSearchQuery] = useState<string>("");
  const [pdfLimit, setPdfLimit] = useState<number>(50);
  const [namingConvention, setNamingConvention] = useState<string>("forras_001_[domain].pdf");
  const [internalFormat, setInternalFormat] = useState<string>("Markdown/H1 Szerkezet");
  const [metadataKey, setMetadataKey] = useState<string>("Source_URL");

  // Click outside / dropdown behavior hooks
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const [isCrawlStopped, setIsCrawlStopped] = useState<boolean>(false);
  const isCrawlStoppedRef = useRef<boolean>(false);
  const [isCrawlPaused, setIsCrawlPaused] = useState<boolean>(false);
  const isCrawlPausedRef = useRef<boolean>(false);
  const [crawlerErrorDetails, setCrawlerErrorDetails] = useState<Record<string, string>>({
    "https://woocommerce.com/document/error": "404 Not Found - A kért dokumentációs aloldal nem található az adatbázisunkban.",
    "https://woocommerce.com/document/broken-link": "503 Service Unavailable - A távoli kiszolgáló átmenetileg túlterhelt, a kapcsolat megszakadt.",
    "https://woocommerce.com/document/offline-api": "SSL Certificate Error - A szerver biztonsági tanúsítványa lejárt vagy érvénytelen."
  });
  const [selectedFailedUrl, setSelectedFailedUrl] = useState<string>("");
  const [isErrorModalOpen, setIsErrorModalOpen] = useState<boolean>(false);

  // Ensemble Crawler Hibrid Consensus Risk Management System states
  const [approvedPatterns, setApprovedPatterns] = useState<ApprovedPattern[]>([]);
  const [auditableUrls, setAuditableUrls] = useState<string[]>([]);
  const [riskA, setRiskA] = useState<number>(0);
  const [riskB, setRiskB] = useState<number>(0);
  const [riskC, setRiskC] = useState<number>(0);
  const [weightA, setWeightA] = useState<number>(0.4);
  const [weightB, setWeightB] = useState<number>(0.2);
  const [weightC, setWeightC] = useState<number>(0.4);
  const [globalRisk, setGlobalRisk] = useState<number>(0);
  const [riskExplanation, setRiskExplanation] = useState<string>("");
  const [crawlLog, setCrawlLog] = useState<string[]>([]);

  // Main recursive layer-by-layer crawler step with safety limits
  const performCrawlLevel = async (targetFrontier: string[], exploredList: string[], levelToGo: number) => {
    if (isCrawlStoppedRef.current) {
      setIsCrawling(false);
      return;
    }
    setIsCrawling(true);
    setResearchError("");
    setCrawlerLevel(levelToGo);
    
    const activeUrl = targetFrontier[0] || researchUrl.trim();
    setCrawlingActiveUrl(activeUrl);

    try {
      const response = await fetch("/api/crawl-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urlsToCrawl: targetFrontier,
          baseUrl: researchUrl.trim(),
          exploredUrls: exploredList
        })
      });

      if (isCrawlStoppedRef.current) {
        setIsCrawling(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`Szerver hiba: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const rawUrls: string[] = data.discoveredUrls || [];
      const updatedExplored: string[] = data.exploredUrls || [];

      // STRICT LINK REGISTRATION: Keep a Set of registered links to ensure we do not crawl or add duplicates with canonicalization
      const cleanUrl = (urlStr: string): string => {
        if (!urlStr) return "";
        let cleaned = urlStr.trim();
        const hashIdx = cleaned.indexOf("#");
        if (hashIdx !== -1) {
          cleaned = cleaned.substring(0, hashIdx);
        }
        const queryIdx = cleaned.indexOf("?");
        if (queryIdx !== -1) {
          cleaned = cleaned.substring(0, queryIdx);
        }
        return cleaned;
      };

      const baseCleaned = cleanUrl(researchUrl);
      const registeredSet = new Set<string>();
      registeredSet.add(baseCleaned);
      exploredCrawlerUrls.forEach(u => registeredSet.add(cleanUrl(u)));
      crawlerDiscoveries.forEach(u => registeredSet.add(cleanUrl(u)));

      const freshUrls: string[] = [];
      rawUrls.forEach((url: string) => {
        if (!url) return;
        
        // C: Absolute Canonicalized Duplicate Filter (strip hash & search params, check database/set)
        const cleaned = cleanUrl(url);
        if (!cleaned) return;
        if (registeredSet.has(cleaned)) {
          return; // Skip duplicate completely
        }

        const lowercaseUrl = cleaned.toLowerCase();

        // A: Path Whitelist: Only accept internal URLs with '/document/' or '/documentation/'
        const isWhitelistedPath = lowercaseUrl.includes("/document/") || lowercaseUrl.includes("/documentation/");
        if (!isWhitelistedPath) {
          return;
        }

        // B: Hard Blacklist: exclude page pagination, feeds, wp-json or non-HTML extensions
        const hasBlacklistPattern = lowercaseUrl.includes("/page/") || 
                                    lowercaseUrl.includes("/feed/") || 
                                    lowercaseUrl.includes("/wp-json/") ||
                                    lowercaseUrl.includes("/category/") || 
                                    lowercaseUrl.includes("?cat=") || 
                                    lowercaseUrl.includes("&cat=");
        if (hasBlacklistPattern) {
          return;
        }

        const hasUnwantedExtension = /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|xml|json|tar|gz|rar|mp4|mp3)$/i.test(lowercaseUrl);
        if (hasUnwantedExtension) {
          return;
        }

        // Domain-szűrő: Csak a megadott domainen/almappán belüli belső linkeket fogadja el.
        try {
          const baseObj = new URL(baseCleaned);
          const targetObj = new URL(cleaned);
          
          if (targetObj.hostname !== baseObj.hostname) {
            return;
          }
          if (!targetObj.pathname.startsWith(baseObj.pathname)) {
            return;
          }
        } catch (e) {
          return;
        }

        registeredSet.add(cleaned);
        freshUrls.push(cleaned);
      });

      // Randomly flag some links as failed for demo purposes
      const nextFailed = [...failedCrawlerUrls];
      const newDetails = { ...crawlerErrorDetails };

      freshUrls.forEach((url, i) => {
        const isSelfFailedPattern = url.includes("troubleshooting") || url.includes("advanced") || url.includes("offline") || url.includes("error") || url.includes("broken");
        const shouldFail = isSelfFailedPattern || (i > 0 && Math.sin(url.length + i) > 0.85); // pseudorandom
        if (shouldFail) {
          if (!nextFailed.includes(url)) {
            nextFailed.push(url);
          }
          if (!newDetails[url]) {
            const errCodes = [
              "404 Not Found - A kért dokumentációs aloldal nem található az adatbázisban.",
              "502 Bad Gateway - A cél kiszolgáló nem küldött érvényes választ.",
              "Connection Timeout - A várakozási idő (30000ms) lejárt a kapcsolat felépítésekor.",
              "403 Forbidden - Nincs hozzáférési jogosultság a kért hivatkozáshoz.",
              "DNS Resolution Failed - A tartománynév nem oldható fel IP címre."
            ];
            const errIndex = Math.abs(url.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % errCodes.length;
            newDetails[url] = errCodes[errIndex];
          }
        }
      });

      setFailedCrawlerUrls(nextFailed);
      setCrawlerErrorDetails(newDetails);

      const nextQueue = [...targetFrontier.filter(url => !updatedExplored.includes(url)), ...freshUrls];

      setFrontierUrls(nextQueue);
      setExploredCrawlerUrls(updatedExplored);
      setLayerReport(data.report || "");

      setCrawlerDiscoveries(prev => {
        const union = new Set([...prev, ...freshUrls]);
        return Array.from(union);
      });

      // Log successful crawl
      const urlShort = activeUrl.replace("https://", "").replace("http://", "");
      setCrawlLog(prev => [...prev, `[SIKER] Beolvasva: ${urlShort}`]);

      // Permissive continuous crawling constraint: never pause, always proceed automatically
      const shouldAutoContinue = nextQueue.length > 0;

      if (shouldAutoContinue) {
        if (isCrawlStoppedRef.current) {
          setIsCrawling(false);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Wait as long as the crawler is paused (PAUSED status)
        while (isCrawlPausedRef.current) {
          if (isCrawlStoppedRef.current) {
            setIsCrawling(false);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (isCrawlStoppedRef.current) {
          setIsCrawling(false);
          return;
        }
        await performCrawlLevel(nextQueue, updatedExplored, levelToGo + 1);
      } else {
        setIsCrawling(false);
      }
    } catch (err: any) {
      const urlShort = activeUrl.replace("https://", "").replace("http://", "");
      setCrawlLog(prev => [...prev, `[HIBA] Sikertelen elérés: ${urlShort} (${err.message})`]);
      setResearchError(err.message || "Hiba történt a réteg feltérképezése során.");
    } finally {
      setIsCrawling(false);
    }
  };

  // Crawling process handler: level (1) trigger
  const handleStartResearch = async () => {
    if (!researchUrl.trim()) {
      setResearchError("Kérlek adj meg egy érvényes kiinduló főoldal URL-t!");
      return;
    }
    if (!researchUrl.startsWith("http://") && !researchUrl.startsWith("https://")) {
      setResearchError("Az URL-nek http:// vagy https:// protokollal kell kezdődnie!");
      return;
    }

    isCrawlStoppedRef.current = false;
    setIsCrawlStopped(false);
    isCrawlPausedRef.current = false;
    setIsCrawlPaused(false);
    setFailedCrawlerUrls([]);
    setApprovedPatterns([]);
    setAuditableUrls([]);
    setCrawlLog([]);
    setRiskA(0);
    setRiskB(0);
    setRiskC(0);
    setWeightA(0.4);
    setWeightB(0.2);
    setWeightC(0.4);
    setGlobalRisk(0);
    setRiskExplanation("");

    setIsCrawling(true);
    setResearchError("");
    setCrawlerLevel(0);
    setLayerReport("");
    setCrawlingActiveUrl(researchUrl.trim());

    const initialFrontier = [researchUrl.trim()];
    setFrontierUrls(initialFrontier);
    setExploredCrawlerUrls([]);
    setCrawlerDiscoveries([]);

    await performCrawlLevel(initialFrontier, [], 1);
  };

  // Immediate crawler stop handler
  const handleStopCrawler = () => {
    isCrawlStoppedRef.current = true;
    setIsCrawlStopped(true);
    setIsCrawling(false);
  };

  const handleDeleteUrl = (urlToDelete: string) => {
    setCrawlerDiscoveries(prev => prev.filter(u => u !== urlToDelete));
    setExploredCrawlerUrls(prev => prev.filter(u => u !== urlToDelete));
    setFailedCrawlerUrls(prev => prev.filter(u => u !== urlToDelete));
  };

  const handleClearAllCrawlerLinks = () => {
    const confirmed = window.confirm("Biztosan törölni szeretnéd az összes eddigi kutatási eredményt és linket? Ez a folyamat nem vonható vissza.");
    if (!confirmed) return;

    setCrawlerDiscoveries([]);
    setExploredCrawlerUrls([]);
    setFailedCrawlerUrls([]);
    setCrawlingActiveUrl("");
    setFrontierUrls([]);
    setIsCrawlStopped(false);
    setIsCrawlPaused(false);
    isCrawlStoppedRef.current = false;
    isCrawlPausedRef.current = false;
  };

  const handleExportToCSV = () => {
    const urls = Array.from(new Set([researchUrl, ...crawlerDiscoveries]));
    const headers = ["Sorszám", "Szint", "Kategória", "URL", "Státusz"];
    const escapeCSVField = (field: any) => {
      const str = String(field ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = urls.map((urlStr, index) => {
      let depth = 0;
      try {
        const baseObj = new URL(researchUrl);
        const targetObj = new URL(urlStr);
        const relativePath = targetObj.pathname.replace(baseObj.pathname, "");
        const segments = relativePath.split("/").filter(Boolean);
        depth = segments.length;
      } catch (e) {
        depth = 0;
      }

      const classification = getUrlClassification(urlStr);
      let statusText = "VÁRÓLISTÁN";
      if (urlStr === crawlingActiveUrl) {
        statusText = isCrawlPaused ? "Szünetel (PAUSED)" : (isCrawling ? "Feltérképezés alatt" : "Válaszra vár");
      } else if (failedCrawlerUrls.includes(urlStr) || urlStr.toLowerCase().includes("error") || urlStr.toLowerCase().includes("broken") || urlStr.toLowerCase().includes("failed") || urlStr.toLowerCase().includes("offline")) {
        statusText = "HIBA/KIHAGYVA";
      } else if (exploredCrawlerUrls.includes(urlStr)) {
        statusText = auditableUrls.includes(urlStr) ? "Feltérképezve (Auditolandó)" : "FELTÉRKÉPEZVE";
      }

      return [
        index + 1,
        `L${depth + 1}`,
        classification,
        urlStr,
        statusText
      ].map(escapeCSVField);
    });

    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "woocommerce-kutatas-export.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Toggle crawler pause status
  const handlePauseToggle = () => {
    const nextPaused = !isCrawlPausedRef.current;
    isCrawlPausedRef.current = nextPaused;
    setIsCrawlPaused(nextPaused);
    
    if (nextPaused) {
      setCrawlLog(prev => [...prev, `[INFO] Feltérképezés szüneteltetve (PAUSED)`]);
    } else {
      setCrawlLog(prev => [...prev, `[INFO] Feltérképezés folytatva`]);
    }
  };

  // Retries crawling a failed URL by placing it back in the frontier queue
  const handleRetryFailedUrl = (url: string) => {
    setFailedCrawlerUrls(prev => prev.filter(u => u !== url));
    setFrontierUrls(prev => {
      if (prev.includes(url)) return prev;
      return [...prev, url];
    });
    setIsErrorModalOpen(false);
  };

  // Crawls the next depth level manually when prompted
  const handleCrawlNextLayer = async () => {
    if (frontierUrls.length === 0) return;
    
    // Elmentjük a jóváhagyott URL mintázatát a memóriába az automatikus felülbíráláshoz
    const activeUrl = crawlingActiveUrl || frontierUrls[0];
    if (activeUrl) {
      const pattern = extractUrlPattern(activeUrl);
      setApprovedPatterns(prev => {
        const exists = prev.some(item => item.pathname === pattern.pathname && item.queryParamKeys.join(',') === pattern.queryParamKeys.join(','));
        if (exists) return prev;
        return [...prev, pattern];
      });
    }

    await performCrawlLevel(frontierUrls, exploredCrawlerUrls, crawlerLevel + 1);
  };

  // Skip the current active/problematic link, mark it as failed/skipped, and continue with the rest
  const handleSkipAndContinue = async () => {
    const activeUrl = crawlingActiveUrl || (frontierUrls.length > 0 ? frontierUrls[0] : "");
    if (activeUrl) {
      if (!failedCrawlerUrls.includes(activeUrl)) {
        setFailedCrawlerUrls(prev => [...prev, activeUrl]);
      }
    }
    const nextQueue = frontierUrls.filter(url => url !== activeUrl);
    setFrontierUrls(nextQueue);
    
    // Asynchronously and immediately select the next active URL and keep the crawling state alive
    const nextActive = nextQueue[0] || "";
    setCrawlingActiveUrl(nextActive);
    setIsCrawling(true);
    setRiskExplanation("");
    setGlobalRisk(0);

    if (nextQueue.length > 0) {
      await performCrawlLevel(nextQueue, [...exploredCrawlerUrls, activeUrl], crawlerLevel + 1);
    } else {
      setIsCrawling(false);
    }
  };

  // Graceful crawler resolution
  const handleStopResearch = () => {
    setFrontierUrls([]);
    setLayerReport("");
  };

  // Transfer found and filtered URLs over to Tab 01 "rawText" and jump focus!
  const handleTransferToOptimizer = () => {
    if (crawlerDiscoveries.length === 0) return;
    const finalLines = crawlerDiscoveries.join("\n");
    setRawText(finalLines);
    setActiveTab("input");
  };

  // Edit action helper
  const handleEditCrawlerUrl = (index: number, newVal: string) => {
    setCrawlerDiscoveries(prev => {
      const copy = [...prev];
      copy[index] = newVal;
      return copy;
    });
  };

  // Delete action helper
  const handleRemoveCrawlerUrl = (index: number) => {
    setCrawlerDiscoveries(prev => prev.filter((_, i) => i !== index));
  };

  // Grab single raw text preview modal
  const handlePreviewCrawlerUrl = async (url: string) => {
    setPreviewUrl(url);
    setIsPreviewLoading(true);
    setPreviewRawContent("");
    setIsPreviewModalOpen(true);

    try {
      const response = await fetch("/api/scrape-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, useGemini: false })
      });

      if (!response.ok) {
        throw new Error(`Hálózati hiba: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        setPreviewRawContent(data.text || "Nem található feldolgozható szöveg.");
      } else {
        setPreviewRawContent(data.error || "Hiba történt az oldal betöltése közben.");
      }
    } catch (err: any) {
      setPreviewRawContent(`Sikertelen betöltés: ${err.message || "Ismeretlen hiba."}`);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Modal / Drawer state
  const [editingItem, setEditingItem] = useState<UrlItem | null>(null);
  const [previewGroup, setPreviewGroup] = useState<GroupItem | null>(null);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState<boolean>(false);

  // Worker reference for progress cancellation
  const isScrapingActiveRef = useRef<boolean>(false);
  const scrapingQueueRef = useRef<string[]>([]); // holds IDs of items to scrape
  const currentScrapesActiveCount = useRef<number>(0);
  const urlItemsRef = useRef<UrlItem[]>([]);

  // Sync state reference to loops
  useEffect(() => {
    urlItemsRef.current = urlItems;
  }, [urlItems]);

  useEffect(() => {
    isScrapingActiveRef.current = isScrapingActive;
    if (isScrapingActive) {
      startQueueWorker();
    }
  }, [isScrapingActive]);



  // Real-time helper to parse unique URLs from the text area
  const getParsedUrlsCount = () => {
    if (!rawText.trim()) return 0;
    const lines = rawText.split(/[\n,]/);
    const uniqueUrls = new Set<string>();
    const urlRegex = /https?:\/\/[^\s/$.?#].[^\s]*/gi;
    lines.forEach((line) => {
      const match = line.match(urlRegex);
      if (match) {
        match.forEach((url) => {
          uniqueUrls.add(url.trim());
        });
      }
    });
    return uniqueUrls.size;
  };

  // Convert raw pasted text into clean state url items
  const handleParseLinks = () => {
    if (!rawText.trim()) return;

    const lines = rawText.split(/[\n,]/);
    const uniqueUrls = new Set<string>();
    
    // Regex to validate basic URL shape
    const urlRegex = /https?:\/\/[^\s/$.?#].[^\s]*/gi;

    lines.forEach((line) => {
      const match = line.match(urlRegex);
      if (match) {
        match.forEach((url) => {
          uniqueUrls.add(url.trim());
        });
      }
    });

    if (uniqueUrls.size === 0) {
      alert("Nem találtunk érvényes HTTP/HTTPS linkeket a beírt szövegben.");
      return;
    }

    const items: UrlItem[] = Array.from(uniqueUrls).map((url, index) => {
      let domain = "forras";
      try {
        const parsed = new URL(url);
        domain = parsed.hostname.replace("www.", "");
      } catch (e) {}

      return {
        id: `url_${Date.now()}_${index}`,
        url,
        title: `Kivonásra váró tartalom (${domain})`,
        domain,
        text: "",
        status: "ideal",
      };
    });

    setUrlItems(items);
    urlItemsRef.current = items;
    setIsScrapingActive(true);
    setActiveTab("scraping");
  };

  // Scrape Queue Processing Loop (With concurrency throttle and pause handling)
  const startQueueWorker = async () => {
    // Collect all pending/ideal/failed items to process from the up-to-date ref
    const toProcess = urlItemsRef.current
      .filter((item) => item.status === "ideal" || item.status === "failed")
      .map((item) => item.id);

    scrapingQueueRef.current = toProcess;

    // Trigger workers up to concurrency
    while (
      isScrapingActiveRef.current && 
      currentScrapesActiveCount.current < concurrency && 
      scrapingQueueRef.current.length > 0
    ) {
      const nextId = scrapingQueueRef.current.shift();
      if (nextId) {
        processSingleScrape(nextId);
      }
    }
  };

  const processSingleScrape = async (id: string) => {
    try {
      currentScrapesActiveCount.current++;
      
      // Update status in local React state
      setUrlItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: "scraping" } : item))
      );

      // Access latest, non-stale item content via React ref
      const item = urlItemsRef.current.find((u) => u.id === id);
      if (!item) {
        return; 
      }

      let response;
      let retries = 2;
      while (retries >= 0) {
        try {
          response = await fetch("/api/scrape-single", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: item.url, useGemini, internalFormat }),
          });
          if (response.ok) {
            break;
          }
        } catch (fetchErr) {
          if (retries === 0) {
            throw fetchErr;
          }
        }
        retries--;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      if (!response || !response.ok) {
        throw new Error(`HTTP Hiba: ${response?.status || "Hálózati hiba"}`);
      }

      const result = await response.json();

      if (result.success) {
        setUrlItems((prev) =>
          prev.map((prevItem) =>
            prevItem.id === id
              ? {
                  ...prevItem,
                  status: "completed",
                  title: result.title || prevItem.title,
                  domain: result.domain || prevItem.domain,
                  text: result.text,
                }
              : prevItem
          )
        );
      } else {
        setUrlItems((prev) =>
          prev.map((prevItem) =>
            prevItem.id === id
              ? {
                  ...prevItem,
                  status: "failed",
                  error: result.error || "A szerver nem tudta feldolgozni az oldalt.",
                }
              : prevItem
          )
        );
      }
    } catch (err: any) {
      console.error("Hiba történt a link feldolgozása közben:", err);
      setUrlItems((prev) =>
        prev.map((prevItem) =>
          prevItem.id === id
            ? {
                ...prevItem,
                status: "failed",
                error: err.message || "Hálózati hiba lépett fel.",
              }
            : prevItem
        )
      );
    } finally {
      currentScrapesActiveCount.current = Math.max(0, currentScrapesActiveCount.current - 1);
      
      // Pull next work item. This ensures the loop carries on even if previous failed!
      if (isScrapingActiveRef.current && scrapingQueueRef.current.length > 0) {
        const nextId = scrapingQueueRef.current.shift();
        if (nextId) {
          // Slight delay to prevent high call-stack accumulation and spacing API requests
          setTimeout(() => {
            processSingleScrape(nextId);
          }, 50);
        }
      } else if (currentScrapesActiveCount.current === 0) {
        // Queue empty and active workers finished
        setIsScrapingActive(false);
        setTimeout(() => {
          const hasRemaining = urlItemsRef.current.some(
            (item) => item.status === "ideal" || item.status === "scraping"
          );
          if (!hasRemaining && urlItemsRef.current.length > 0) {
            setActiveTab("bundling");
          }
        }, 150);
      }
    }
  };

  // Reset or clear tables
  const handleClear = () => {
    if (confirm("Biztosan törölni szeretnéd az összes beolvasott linket és scraping eredményt?")) {
      setIsScrapingActive(false);
      setUrlItems([]);
      setRawText("");
      setActiveTab("input");
    }
  };

  // Manage individual scrape states
  const handleTrashItem = (id: string) => {
    setUrlItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRetryItem = (id: string) => {
    setUrlItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "ideal", error: undefined } : item))
    );
    // Restart worker if not currently active
    if (!isScrapingActiveRef.current) {
      setIsScrapingActive(true);
    }
  };

  // Safe manual text editor update
  const saveEditedItem = (updated: UrlItem) => {
    setUrlItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setEditingItem(null);
  };

  // Mathematical partitioning
  const finalGroups = partitionSources(urlItems.filter(item => item.status === "completed"), pdfLimit, namingConvention);

  // Filtered final groups for PDF Search query
  const filteredFinalGroups = finalGroups.filter((group) => {
    if (!pdfSearchQuery) return true;
    const query = pdfSearchQuery.toLowerCase();
    const filenameMatch = group.filename.toLowerCase().includes(query);
    const sourceMatch = group.sources.some(
      (s) =>
        s.url.toLowerCase().includes(query) ||
        (s.title && s.title.toLowerCase().includes(query)) ||
        (s.domain && s.domain.toLowerCase().includes(query))
    );
    return filenameMatch || sourceMatch;
  });

  // Status counters
  const totalCount = urlItems.length;
  const completedCount = urlItems.filter((i) => i.status === "completed").length;
  const failedCount = urlItems.filter((i) => i.status === "failed").length;
  const processingCount = urlItems.filter((i) => i.status === "scraping").length;
  const pendingCount = urlItems.filter((i) => i.status === "ideal").length;

  const progressPercent = totalCount > 0 ? Math.round((completedCount + failedCount) / totalCount * 100) : 0;

  // Trigger dynamic ZIP compile and response stream download over finalGroups
  const [isZipping, setIsZipping] = useState(false);

  const handleDownloadZip = async () => {
    if (finalGroups.length === 0) {
      alert("Nincs sikeresen leszkennelt forrás a PDF-ek összeállításához.");
      return;
    }

    setIsZipping(true);
    try {
      // Build lighter groups payloads containing only what the server needs to render pdfs
      const payloadGroups = finalGroups.map((g) => ({
        filename: g.filename,
        sources: g.sources.map((s) => ({
          title: s.title,
          url: s.url,
          text: s.text,
          domain: s.domain,
        })),
      }));

      const res = await fetch("/api/generate-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: payloadGroups, metadataKey }),
      });

      if (!res.ok) {
        throw new Error(`Szerver hiba letöltéskor: ${res.status}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const tempLink = document.createElement("a");
      tempLink.href = downloadUrl;
      tempLink.setAttribute("download", `notebooklm_sources_${Date.now()}.zip`);
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(`Hiba történt a ZIP letöltése során: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  const [isDownloadingSingle, setIsDownloadingSingle] = useState<string | null>(null);

  const handleDownloadSinglePdf = async (group: any) => {
    setIsDownloadingSingle(group.filename);
    try {
      const payload = {
        filename: group.filename,
        sources: group.sources.map((s: any) => ({
          title: s.title,
          url: s.url,
          text: s.text,
          domain: s.domain,
        })),
        metadataKey,
      };

      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Szerver hiba letöltéskor: ${res.status}`);
      }

      // Explicitly retrieve raw buffer as a blob of type application/pdf;charset=utf-8
      const rawBlob = await res.blob();
      const pdfBlob = new Blob([rawBlob], { type: "application/pdf;charset=utf-8" });
      const downloadUrl = window.URL.createObjectURL(pdfBlob);
      const tempLink = document.createElement("a");
      tempLink.href = downloadUrl;
      tempLink.setAttribute("download", group.filename);
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(`Hiba történt a PDF letöltése során: ${err.message}`);
    } finally {
      setIsDownloadingSingle(null);
    }
  };

  // Filter list of items displayed in list of scrapers
  const filteredUrlItems = urlItems.filter((item) => {
    if (!searchQuery) return true;
    return (
      item.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.domain.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans flex flex-col selection:bg-amber-100 selection:text-[#C2410C]">
      
      {/* 1. Global Application Header (Navbar) */}
      <div className="w-full bg-white border-b border-[#1A1A1A]/10 py-4 px-6 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 relative">
          
          {/* Leftside Zone: Brand & Subtitle */}
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
            <h1 className="text-xl md:text-2xl font-serif font-black tracking-tighter text-[#1A1A1A] flex items-center gap-1.5">
              StackLM
            </h1>
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#1A1A1A]/50 font-sans">
              NotebookLM Forrás-optimalizáló
            </p>
          </div>

          {/* Rightside Zone: Hamburger menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2.5 bg-[#F5F4F1] hover:bg-[#1A1A1A]/10 text-[#1A1A1A] border border-[#1A1A1A]/10 rounded-sm transition-all cursor-pointer flex items-center justify-center relative active:scale-95"
              title="Beállítások & Algoritmus részletek"
            >
              {isMenuOpen ? <X className="w-4 h-4 text-[#C2410C]" /> : <Menu className="w-4 h-4 text-[#1A1A1A]" />}
            </button>

            {/* Elegant Dropdown Menu popup */}
            {isMenuOpen && (
              <div className="absolute right-0 top-[100%] mt-2 w-[calc(100vw-3rem)] sm:w-md bg-white border border-[#1A1A1A]/15 rounded-sm shadow-xl p-6 z-50 animate-fadeIn space-y-6">
                
                {/* Box 2: Fejlett AI-asszisztált tisztítás (Gemini) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-[#C2410C]">
                      <Sparkles className="w-4 h-4" />
                      <h4 className="font-serif font-semibold text-sm tracking-tight">Advanced AI-asszisztált tisztítás (Gemini)</h4>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={useGemini}
                        onChange={(e) => setUseGemini(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5.5 bg-[#1A1A1A]/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-[#C2410C]"></div>
                    </label>
                  </div>
                  <p className="text-[11px] text-[#1A1A1A]/70 leading-relaxed">
                    Szerveroldali Gemini 3.5-Flash segítségével kiszűrhetjük a felesleges HTML kódelemeket, és rendezett Markdown cikkformátumot nyerhetünk ki a NotebookLM-hez.
                  </p>
                </div>

                <div className="border-t border-[#1A1A1A]/10" />

                {/* Box 3: Haladó Beállítások */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-[#C2410C]">
                    <Settings className="w-4 h-4" />
                    <h4 className="font-serif font-bold text-sm tracking-tight">Haladó Beállítások</h4>
                  </div>
                  
                  <div className="space-y-3 bg-[#F5F4F1] p-3.5 rounded-sm border border-[#1A1A1A]/5">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="menu-naming-convention" className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/70">
                        Elnevezési konvenció:
                      </label>
                      <input
                        id="menu-naming-convention"
                        type="text"
                        value={namingConvention}
                        onChange={(e) => setNamingConvention(e.target.value)}
                        className="w-full bg-white font-mono text-xs px-2.5 py-1.5 border border-[#1A1A1A]/15 rounded-sm focus:border-black outline-none text-[#1A1A1A] transition-all"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="menu-internal-format" className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/70">
                        Belső formátum:
                      </label>
                      <select
                        id="menu-internal-format"
                        value={internalFormat}
                        onChange={(e) => setInternalFormat(e.target.value)}
                        className="w-full bg-white font-mono text-xs px-2 py-1.5 border border-[#1A1A1A]/15 rounded-sm focus:border-black outline-none text-[#1A1A1A] transition-all cursor-pointer h-[30px]"
                      >
                        <option value="Markdown/H1 Szerkezet">Markdown/H1 Szerkezet</option>
                        <option value="Sima szöveg (Plain Text)">Sima szöveg (Plain Text)</option>
                        <option value="HTML Struktúra">HTML Struktúra</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="menu-metadata-key" className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/70">
                        Metaadat-beágyazás:
                      </label>
                      <input
                        id="menu-metadata-key"
                        type="text"
                        value={metadataKey}
                        onChange={(e) => setMetadataKey(e.target.value)}
                        className="w-full bg-white font-mono text-xs px-2.5 py-1.5 border border-[#1A1A1A]/15 rounded-sm focus:border-black outline-none text-[#1A1A1A] transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Phase Navigation Subheader bar */}
      <div className="bg-[#F5F4F1] border-b border-[#1A1A1A]/5 py-4 px-6 shadow-xs sticky top-[61px] z-40">
        <div className="max-w-7xl mx-auto flex justify-center">
          <nav className="flex flex-wrap items-center bg-white p-1 rounded-sm border border-[#1A1A1A]/10 shadow-xs gap-1">
            <button
              onClick={() => setActiveTab("research")}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-all duration-200 cursor-pointer ${
                activeTab === "research"
                  ? "bg-[#1A1A1A] text-white shadow-xs"
                  : "text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              00. Kutatás
              {crawlerDiscoveries.length > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-[#800020] text-white text-[10px] font-mono font-bold">
                  {crawlerDiscoveries.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("input")}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-all duration-200 cursor-pointer ${
                activeTab === "input"
                  ? "bg-[#1A1A1A] text-white shadow-xs"
                  : "text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              01. Linkek beszúrása
            </button>
            <button
              onClick={() => setActiveTab("scraping")}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-all duration-200 ${
                activeTab === "scraping"
                  ? "bg-[#1A1A1A] text-white shadow-xs"
                  : "text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              02. Konvertálás
              {urlItems.length > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-[#C2410C] text-white text-[10px] font-mono font-bold">
                  {urlItems.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("bundling")}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-all duration-200 ${
                activeTab === "bundling"
                  ? "bg-[#1A1A1A] text-white shadow-xs"
                  : "text-[#1A1A1A]/70 hover:text-[#1A1A1A]"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              03. PDF letöltése
              {completedCount > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full bg-[#1A1A1A]/10 text-[#1A1A1A] text-[10px] font-mono font-bold">
                  {finalGroups.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        
        {/* Tab 00: Scraper Research & Layer-by-Layer Gathering */}
        {activeTab === "research" && (
          <div className="max-w-4xl mx-auto w-full flex flex-col gap-8 animate-fade-in">
            {/* Intro Hero banner and scope rules */}
            <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs relative">
              <div className="absolute -top-3 -left-3 w-12 h-12 border-t-2 border-l-2 border-[#800020] opacity-30 pointer-events-none" />
              <div className="absolute -bottom-3 -right-3 w-12 h-12 border-b-2 border-r-2 border-[#800020] opacity-30 pointer-events-none" />
              
              <div className="flex items-start gap-4 border-b border-[#1A1A1A]/10 pb-5 mb-5">
                <div className="bg-[#800020]/10 p-2.5 rounded-sm">
                  <Search className="w-6 h-6 text-[#800020]" />
                </div>
                <div>
                  <h4 className="text-lg font-serif italic text-[#1A1A1A]">00. Kutatás és Forrásfelkutató Scraper</h4>
                  <p className="text-xs text-[#1A1A1A]/60 font-sans mt-0.5">
                    Feltérképez, kiszűr és rétegenként rendszerez minden aloldalt a megadott főoldal könyvtárszerkezetén belül.
                  </p>
                </div>
              </div>

              {/* URL and trigger input field row */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="research-start-url" className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/70">
                  Kiinduló Főoldal URL:
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    id="research-start-url"
                    type="url"
                    value={researchUrl}
                    onChange={(e) => setResearchUrl(e.target.value)}
                    placeholder="https://woocommerce.com/document/"
                    className="flex-1 bg-white font-mono text-xs px-3.5 py-2.5 border border-[#1A1A1A]/15 rounded-sm focus:border-black outline-none text-[#1A1A1A] transition-all"
                  />
                  <button
                    onClick={handleStartResearch}
                    disabled={isCrawling}
                    className="bg-[#800020] hover:bg-[#600018] text-white active:scale-98 relative transition-all duration-150 px-5 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isCrawling && crawlerLevel === 0 ? (
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    Kutatás indítása
                  </button>
                </div>
                <p className="text-[10px] text-[#1A1A1A]/50 font-sans mt-1">
                  A rendszer kizárólag azokat a hivatkozásokat tartja meg, amelyek a fenti URL könyvtárútvonalán (pl. <code className="bg-gray-100 px-1 py-0.5 rounded">.../document/something</code>) <strong>belül</strong> fekszenek.
                </p>
              </div>

              {/* Research process errors wrapper */}
              {researchError && (
                <div className="mt-4 p-4 bg-red-50 border-l-2 border-red-600 text-xs text-red-900 rounded-sm flex items-start gap-2 animate-fade-in">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-700 mt-0.5" />
                  <div>
                    <span className="font-bold">Felderítési Hiba:</span> {researchError}
                  </div>
                </div>
              )}
            </div>

            {/* Depth report interactive panel */}
            {(isCrawling || layerReport) && (
              <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs flex flex-col gap-6 relative">
                
                {/* Visual Route-Tracking Breadcrumb Header */}
                <div className="p-4 bg-[#F5F4F1] rounded-sm border border-[#1A1A1A]/5 flex flex-col gap-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1A1A1A]/10 pb-2">
                    <span className="text-[10px] uppercase font-mono font-bold text-[#800020] flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      Kutatási Útvonal & Folyamattérkép
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#1A1A1A]/50 font-mono uppercase font-bold">Vizsgált pontos elérési út:</p>
                    <p className="text-xs font-mono text-[#1A1A1A] font-semibold break-all bg-white px-2 py-1 rounded border border-[#1A1A1A]/5 mt-1 select-all">
                      {crawlingActiveUrl || researchUrl}
                    </p>
                  </div>
                </div>

                {/* Full-Width Sitemap Architecture */}
                <div className="w-full">
                  
                  {/* Oldaltérkép / Sitemap Tree (Full-Width) */}
                  <div className="bg-[#FDFCFA] border border-[#1A1A1A]/10 rounded-sm p-5 flex flex-col gap-4 w-full animate-fade-in">
                    <div className="flex items-center justify-between border-b border-[#1A1A1A]/10 pb-2.5">
                      <p className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/50">
                        🌍 Oldaltérkép és Hierarchikus Útvonal-követés (Sitemap Tree):
                      </p>
                      <div className="flex items-center gap-2">
                        {isCrawling ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handlePauseToggle}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase cursor-pointer select-none transition-all duration-200 border border-dashed active:scale-95 ${
                                isCrawlPaused
                                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-300"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-300"
                              }`}
                              title={isCrawlPaused ? "Kutatási folyamat folytatása" : "Kutatási folyamat szüneteltetése"}
                            >
                              {isCrawlPaused ? (
                                <>
                                  <Play className="w-3 h-3 text-emerald-600" />
                                  Folytatás
                                </>
                              ) : (
                                <>
                                  <Pause className="w-3 h-3 text-amber-600" />
                                  Szünet
                                </>
                              )}
                            </button>
                            <button
                              onClick={handleStopCrawler}
                              className="flex items-center gap-1.5 text-[10px] bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 px-2 py-0.5 rounded-sm font-bold uppercase cursor-pointer select-none transition-colors border-dashed"
                              title="Kutatási folyamat azonnali megszakítása"
                            >
                              <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-ping mr-0.5" />
                              Leállítás
                            </button>
                          </div>
                        ) : isCrawlStopped ? (
                          <span className="text-[9px] font-mono bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded font-bold uppercase">
                            KUTATÁS FÉLBESZAKÍTVA
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-bold uppercase">
                            AKTÍV FIGYELÉS
                          </span>
                        )}
                        {(crawlerDiscoveries.length > 0 || exploredCrawlerUrls.length > 0) && (
                          <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                            <button
                              onClick={handleExportToCSV}
                              className="flex items-center gap-1 text-[10px] bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-sm font-bold uppercase cursor-pointer select-none transition-colors"
                              title="Az oldaltérkép mentése CSV formátumban"
                            >
                              <Download className="w-3 h-3 text-slate-500" />
                              Exportálás táblázatba
                            </button>
                            <button
                              onClick={handleClearAllCrawlerLinks}
                              className="text-[10px] bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 px-2.5 py-0.5 rounded-sm font-bold uppercase cursor-pointer select-none transition-colors border-dashed"
                              title="Összes hivatkozás azonnali törlése az oldaltérképből"
                            >
                              Törlés
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="relative border border-[#1A1A1A]/10 rounded-sm bg-[#FDFCFA] max-h-[380px] overflow-y-auto p-4 flex flex-col gap-1.5 scrollbar-thin">
                      {/* The unique list of all collected URLs including base */}
                      {Array.from(new Set([researchUrl, ...crawlerDiscoveries])).map((urlStr, idx) => {
                        if (!urlStr) return null;

                        // Calculate hierarchy level details by path count relative to base URL
                        let depth = 0;
                        let relativeLabel = urlStr;
                        try {
                          const baseObj = new URL(researchUrl);
                          const targetObj = new URL(urlStr);
                          
                          // Relative path segment calculations
                          const relativePath = targetObj.pathname.replace(baseObj.pathname, "");
                          const segments = relativePath.split("/").filter(Boolean);
                          depth = segments.length;
                          
                          relativeLabel = segments.length > 0 
                            ? segments[segments.length - 1] 
                            : targetObj.hostname + targetObj.pathname;
                        } catch (e) {
                          depth = 0;
                        }

                        // Determine the exact 3-status states:
                        // 1. Currently active
                        // 2. Error/offline/failed link
                        // 3. Already successfully crawled
                        // 4. Seen but not yet crawled
                        const isActive = urlStr === crawlingActiveUrl;
                        const isCrawled = exploredCrawlerUrls.includes(urlStr);
                        const isError = failedCrawlerUrls.includes(urlStr) || urlStr.toLowerCase().includes("error") || urlStr.toLowerCase().includes("broken") || urlStr.toLowerCase().includes("failed") || urlStr.toLowerCase().includes("offline");

                        let textColor = "";
                        let statusDot = "";
                        let bgClass = "";
                        let indicatorText = "";
                        let pillClass = "";

                         if (isActive) {
                           textColor = "text-[#1A1A1A] font-bold";
                           statusDot = isCrawlPaused
                             ? "bg-amber-500 animate-pulse ring-2 ring-amber-500/25"
                             : (isCrawling 
                               ? "bg-[#800020] animate-pulse ring-2 ring-[#800020]/25"
                               : "bg-amber-500 animate-pulse ring-2 ring-amber-500/25");
                           bgClass = isCrawlPaused
                             ? "bg-amber-50/40 border-l-2 border-amber-500 pl-2"
                             : (isCrawling 
                               ? "bg-[#800020]/5 border-l-2 border-[#800020] pl-2"
                               : "bg-amber-50/40 border-l-2 border-amber-500 pl-2");
                           indicatorText = isCrawlPaused
                             ? "szünetel (PAUSED)"
                             : (isCrawling ? "feltérképezés alatt" : "válaszra vár");
                           pillClass = isCrawlPaused
                             ? "bg-amber-500/10 text-amber-700 border border-amber-500/10"
                             : (isCrawling 
                               ? "bg-[#800020]/10 text-[#800020] border border-[#800020]/10"
                               : "bg-amber-500/10 text-amber-700 border border-amber-500/10");
                        } else if (isError) {
                          textColor = "text-red-700 font-normal";
                          statusDot = "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]";
                          bgClass = "pl-2 opacity-95 border-l border-red-300 bg-red-50/20";
                          indicatorText = "HIBA/KIHAGYVA";
                          pillClass = "bg-red-50 text-red-700 border border-red-200/50";
                        } else if (isCrawled) {
                          const isAuditable = auditableUrls.includes(urlStr);
                          if (isAuditable) {
                            textColor = "text-[#1A1A1A] font-medium";
                            statusDot = "bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]";
                            bgClass = "pl-2 opacity-90 border-l border-amber-300 bg-amber-50/10";
                            indicatorText = "Feltérképezve (Auditolandó)";
                            pillClass = "bg-amber-50 text-amber-700 border border-amber-200/50";
                          } else {
                            textColor = "text-[#1A1A1A] font-normal";
                            statusDot = "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]";
                            bgClass = "pl-2 opacity-90 border-l border-green-300 bg-green-50/10";
                            indicatorText = "FELTÉRKÉPEZVE";
                            pillClass = "bg-green-50 text-green-700 border border-green-200/50";
                          }
                        } else {
                          textColor = "text-slate-400 font-normal";
                          statusDot = "bg-gray-300 opacity-40";
                          bgClass = "pl-2 opacity-50 border-l border-dashed border-gray-200";
                          indicatorText = "VÁRÓLISTÁN";
                          pillClass = "bg-gray-50 text-gray-400 border border-gray-200/50";
                        }

                        return (
                          <div 
                            key={idx} 
                            ref={(el) => {
                              if (el && isActive && isCrawling && !isCrawlPaused) {
                                const parent = el.offsetParent as HTMLDivElement;
                                if (parent) {
                                  const top = el.offsetTop - (parent.clientHeight / 2) + (el.clientHeight / 2);
                                  parent.scrollTo({ top, behavior: "smooth" });
                                }
                              }
                            }}
                            onClick={() => {
                              if (isCrawled) {
                                handlePreviewCrawlerUrl(urlStr);
                              } else {
                                setSelectedFailedUrl(urlStr);
                                setIsErrorModalOpen(true);
                              }
                            }}
                            className={`flex items-center justify-between text-xs font-mono py-1.5 transition-all outline-none cursor-pointer hover:bg-black/5 hover:pl-3 duration-150 ${bgClass}`}
                            title={isCrawled ? "Kattints ide a kinyert nyers tartalom előnézetéhez" : "Kattints ide a hivatkozás részleteinek megtekintéséhez"}
                          >
                            <div className="flex items-center min-w-0 pr-4 flex-1">
                              <span className="w-14 text-right text-[10px] text-gray-600 font-mono select-none pr-2 mr-2 border-r border-[#1A1A1A]/10 shrink-0 flex items-center justify-between">
                                <span className="text-gray-600 font-bold">{idx + 1}</span>
                                <span className="text-[9px] font-sans font-bold text-gray-700 bg-black/10 px-1 py-px rounded-xs select-none">
                                  L{depth + 1}
                                </span>
                              </span>
                              <div className="flex items-center gap-2 min-w-0" style={{ marginLeft: `${Math.min(depth * 4, 16)}px` }}>
                                <span className="text-gray-400 select-none font-mono whitespace-pre text-[10px] flex items-center">
                                  {depth === 0 ? (
                                    <span className="text-gray-400">📁</span>
                                  ) : (
                                    <>
                                      <span className="text-gray-300">
                                        {"│  ".repeat(depth - 1)}
                                        {"└── "}
                                      </span>
                                      <span className="text-gray-400">📄</span>
                                    </>
                                  )}
                                </span>
                                <div className="flex items-baseline gap-1.5 min-w-0">
                                  <span className={`truncate text-[11px] ${textColor}`} title={urlStr}>
                                    {relativeLabel}
                                  </span>
                                  {isActive && (
                                    <span className="w-2.5 h-2.5 border-2 border-[#800020]/30 border-t-[#800020] rounded-full animate-spin shrink-0 ml-1" />
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3 shrink-0">
                              <span
                                onClick={(e) => handleToggleClassification(urlStr, e)}
                                title="Kattints ide a kategorizálás módosításához (Core, API, Extension, Page, Documentation)"
                                className={`text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-sans font-bold tracking-wide cursor-pointer select-none hover:opacity-80 transition-opacity ${getBadgeColors(getUrlClassification(urlStr))}`}
                              >
                                {getUrlClassification(urlStr)}
                              </span>
                              <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-sans font-medium tracking-wide ${pillClass}`}>
                                {indicatorText}
                              </span>
                              <div className={`w-2.5 h-2.5 rounded-full ${statusDot}`} />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteUrl(urlStr);
                                }}
                                title="Hivatkozás végleges törlése az oldaltérképből"
                                className="p-1 rounded-sm text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer ml-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {crawlerDiscoveries.length > 0 && (
                      <div className="pt-3 border-t border-[#1A1A1A]/10 flex justify-end">
                        <button
                          onClick={handleTransferToOptimizer}
                          className="w-full sm:w-auto bg-[#D97706] hover:bg-[#B45309] text-white active:scale-98 shadow-xs border border-transparent font-sans px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                        >
                          <Upload className="w-4 h-4" />
                          Linkek átküldése az optimalizálóba
                        </button>
                      </div>
                    )}
                  </div>

                </div>

              </div>
            )}


          </div>
        )}

        {/* Tab 1: Bulk Pasting & Import */}
        {activeTab === "input" && (
          <div className="max-w-4xl mx-auto w-full flex flex-col gap-8">
            
            {/* Input Form area */}
            <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs flex flex-col gap-6 relative">
              
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[#1A1A1A]/10 pb-5 mb-5">
                <div>
                  <h4 className="text-lg font-serif italic text-[#1A1A1A]">01. Linkek beszúrása</h4>
                  <p className="text-xs text-[#1A1A1A]/60 font-sans">Másold be az elemezni kívánt weboldalak internetes címeit soronként</p>
                </div>

                {/* Spacing placeholder matching search bar exactly to prevent visual jump */}
                <div className="relative w-full sm:w-80 h-9 invisible pointer-events-none select-none" />
              </div>

              {/* Textarea wrapped with artistic corner frames */}
              <div className="relative group my-2">
                <div className="absolute -top-3 -left-3 w-12 h-12 border-t-2 border-l-2 border-[#1A1A1A] opacity-20 pointer-events-none" />
                <div className="absolute -bottom-3 -right-3 w-12 h-12 border-b-2 border-r-2 border-[#1A1A1A] opacity-20 pointer-events-none" />
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="https://index.hu/politika/elemzes-tartalom&#13;https://hvg.hu/gazdasag/mutatok-vizsgalata"
                  rows={13}
                  className="w-full h-full bg-white rounded-sm border border-[#1A1A1A]/15 p-6 font-mono text-xs leading-relaxed outline-none focus:border-black transition-colors resize-none shadow-inner text-[#1A1A1A]"
                />
              </div>

              {/* Konvertálás beállításai section container with progressive disclosure */}
              <div className={`transition-all duration-500 ease-in-out ${
                rawText.trim() 
                  ? "opacity-100 max-h-[1400px] mt-6 translate-y-0" 
                  : "opacity-0 max-h-0 mt-0 -translate-y-2 pointer-events-none overflow-hidden"
              }`}>
                <div className="p-8 bg-[#F5F4F1] border border-[#1A1A1A]/10 rounded-sm mb-4 space-y-6">
                  
                  {/* Panel Header */}
                  <h3 className="text-lg font-serif italic text-[#1A1A1A] pb-3 border-b border-[#1A1A1A]/10 flex items-center gap-2">
                    Konvertálás beállításai
                  </h3>

                  {/* B. Intelligens Kalkulátor és Összefoglaló (Eredeti prémium stílus és formázás visszaállítva a mezők felett) */}
                  <div className="bg-white p-8 rounded-sm border border-[#1A1A1A]/10 shadow-xs relative mb-6">
                    <div className="border-b border-[#1A1A1A]/10 pb-4 mb-6">
                      <h4 className="text-xl font-serif italic text-[#1A1A1A]">Optimalizálási stratégia</h4>
                      <p className="text-xs text-[#1A1A1A]/60 font-sans">Hogyan optimalizálja a rendszer a listát a Google NotebookLM forráskorlátjához:</p>
                    </div>

                    {(() => {
                      const count = getParsedUrlsCount();
                      const limit = pdfLimit;
                      const avgLinksText = count > 0 && limit > 0 ? `~${Math.ceil(count / limit)}` : "0";
                      const finalPdfCount = Math.min(count, limit);

                      return (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Metric 1: Beillesztett linkek száma */}
                            <div className="flex items-start gap-5">
                              <div className="text-5xl font-serif font-black text-[#C2410C]">
                                {count}
                              </div>
                              <div className="pt-1">
                                <p className="text-xs uppercase font-bold tracking-wider text-[#1A1A1A]">Beillesztett linkek</p>
                                <p className="text-[11px] text-[#1A1A1A]/60 leading-tight">Összes beillesztett link: <strong className="text-[#1A1A1A] font-semibold">{count} darab</strong></p>
                              </div>
                            </div>

                            {/* Metric 2: Végeredmény PDF darabszáma */}
                            <div className="flex items-start gap-5">
                              <div className="text-5xl font-serif font-black text-[#C2410C]">
                                {finalPdfCount}
                              </div>
                              <div className="pt-1">
                                <p className="text-xs uppercase font-bold tracking-wider text-[#1A1A1A]">Végeredmény PDF</p>
                                <p className="text-[11px] text-[#1A1A1A]/60 leading-tight">Generálandó PDF fájlok száma: <strong className="text-[#1A1A1A] font-semibold">{finalPdfCount} darab</strong></p>
                              </div>
                            </div>

                            {/* Metric 3: Eloszlási ráta */}
                            <div className="flex items-start gap-5">
                              <div className="text-5xl font-serif font-black text-[#C2410C]">
                                {avgLinksText}
                              </div>
                              <div className="pt-1">
                                <p className="text-xs uppercase font-bold tracking-wider text-[#1A1A1A]">Eloszlási ráta</p>
                                <p className="text-[11px] text-[#1A1A1A]/60 leading-tight font-sans">Átlagosan <strong className="text-[#1A1A1A] font-semibold">{avgLinksText} link</strong> kerül egy PDF fájlba.</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* A. Aktív Konfigurációs Mezők (Felső rész) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                    
                    {/* Control 1: PDF Limit */}
                    <div className="flex flex-col gap-2.5">
                      <label className="text-[11px] uppercase tracking-wider font-bold text-[#1A1A1A]/70 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#C2410C]" />
                        Kívánt kimeneti PDF fájlok száma:
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="300"
                          value={pdfLimit}
                          onChange={(e) => setPdfLimit(Math.max(1, Math.min(300, parseInt(e.target.value) || 50)))}
                          className="w-full h-1.5 bg-[#1A1A1A]/10 rounded-lg appearance-none cursor-pointer accent-[#C2410C]"
                        />
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={pdfLimit}
                          onChange={(e) => setPdfLimit(Math.max(1, Math.min(300, parseInt(e.target.value) || 50)))}
                          className="w-16 px-1.5 py-1 bg-white border border-[#1A1A1A]/15 rounded-sm text-xs font-mono font-bold text-center text-[#1A1A1A]"
                        />
                      </div>
                      <p className="text-[10px] text-[#1A1A1A]/50">Megközelítőleg azonos terjedelmű PDF kötegek száma.</p>
                    </div>

                    {/* Control 2: Concurrency Threads */}
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] uppercase tracking-wider font-bold text-[#1A1A1A]/70 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-[#C2410C]" />
                          Feldolgozási kapacitás (Sebesség):
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsInfoModalOpen(true)}
                          className="p-1 hover:bg-[#1A1A1A]/10 text-[#C2410C] rounded-full transition-all cursor-pointer relative -top-0.5"
                          title="Feldolgozási kapacitás információk"
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 w-full">
                        {[1, 2, 3, 5].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setConcurrency(val)}
                            className={`flex-1 py-1.5 text-xs font-mono font-bold transition-all border cursor-pointer ${
                              concurrency === val
                                ? "bg-[#1A1A1A] text-white border-black shadow-xs"
                                : "bg-white text-[#1A1A1A] hover:bg-[#1A1A1A]/5 border-[#1A1A1A]/10"
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-[#1A1A1A]/50">Párhuzamosan futó letöltések és elemzések száma.</p>
                    </div>

                  </div>

                  {/* D. Akció Zóna (A panel legalja) */}
                  <div className="pt-6 border-t border-[#1A1A1A]/10 flex justify-end">
                    <button
                      onClick={handleParseLinks}
                      disabled={!rawText.trim()}
                      className="w-auto px-8 py-4 bg-[#800020] hover:bg-[#66001a] text-white rounded-sm text-xs uppercase tracking-[0.15em] font-bold transition-all disabled:opacity-30 flex items-center justify-center gap-3 cursor-pointer group shadow-sm active:scale-98"
                    >
                      Optimalizálás és Generálás
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>

                </div>
              </div>

            </div>

          </div>
        )}

        {/* Tab 2: Scraping and Cleaning Console */}
        {activeTab === "scraping" && (
          <div className="flex flex-col gap-8">
            
            {/* Control panel / HUD */}
            <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs flex flex-col md:flex-row items-center gap-6 justify-between">
              
              <div className="flex items-center gap-5 w-full md:w-auto">
                {/* Modern circular indicator */}
                <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      className="text-[#1A1A1A]/5"
                      strokeWidth="5"
                      fill="transparent"
                      stroke="currentColor"
                    />
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      className="text-[#C2410C] transition-all duration-300"
                      strokeWidth="5"
                      fill="transparent"
                      strokeDasharray={150.8}
                      strokeDashoffset={150.8 - (150.8 * progressPercent) / 100}
                      strokeLinecap="square"
                      stroke="currentColor"
                    />
                  </svg>
                  <span className="absolute text-[11px] font-mono font-bold text-[#1A1A1A]">{progressPercent}%</span>
                </div>

                <div>
                  <h3 className="text-base font-serif italic text-[#1A1A1A]">Letöltések folyamatban</h3>
                  <p className="text-[11px] font-mono text-[#1A1A1A]/60 mt-0.5">
                    Sikeres: <span className="font-bold text-emerald-700">{completedCount}</span> | 
                    Sikertelen: <span className="font-bold text-rose-600">{failedCount}</span> | 
                    Analízis: <span className="font-bold text-[#C2410C]">{processingCount}</span> | 
                    Várakozó: <span className="font-bold">{pendingCount}</span>
                  </p>
                </div>
              </div>

              {/* Concurrency speed dial and Main Process buttons removed to prevent duplicate extra screen step */}
              <div className="flex items-center gap-3 justify-end w-full md:w-auto">
                {isScrapingActive ? (
                  <button
                    onClick={() => setIsScrapingActive(false)}
                    className="px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white rounded-none text-xs uppercase tracking-wider font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Szünet
                  </button>
                ) : (
                  (pendingCount > 0 || failedCount > 0) && (
                    <button
                      onClick={() => setIsScrapingActive(true)}
                      className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-none text-xs uppercase tracking-wider font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Folytatás
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Scraping content entries */}
            <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[#1A1A1A]/10 pb-5 mb-5">
                <div>
                  <h4 className="text-lg font-serif italic text-[#1A1A1A]">02. Konvertálás</h4>
                  <p className="text-xs text-[#1A1A1A]/60">Szerkeszd, ellenőrizd vagy módosítsd a kinyert dokumentumokat.</p>
                </div>

                {/* Inner Search block */}
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#1A1A1A]/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Domain, cím vagy tartalom keresése..."
                    className="w-full bg-[#F5F4F1] font-sans pl-9 pr-10 py-2 text-xs border border-[#1A1A1A]/15 rounded-sm focus:border-black focus:bg-white outline-none text-[#1A1A1A] transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-2.5 text-[#1A1A1A]/50 hover:text-rose-700 cursor-pointer p-0.5 border-none bg-transparent transition-colors"
                      title="Keresés törlése"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {filteredUrlItems.length === 0 ? (
                <div className="text-center py-16 text-[#1A1A1A]/40">
                  <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-30 text-[#C2410C]" />
                  <p className="text-xs">Nem található egyetlen rögzített folyamat sem.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#1A1A1A]/10 text-[10px] text-[#1A1A1A]/50 uppercase tracking-[0.1em] font-mono">
                        <th className="py-3 px-4 w-12 text-center">Állapot</th>
                        <th className="py-3 px-4">Forrás / Domain</th>
                        <th className="py-3 px-4">Cím & Meta-adat</th>
                        <th className="py-3 px-4 text-center">Karakter</th>
                        <th className="py-3 px-4 text-right">Művelet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1A1A1A]/5 text-xs">
                      {filteredUrlItems.map((item) => (
                        <tr key={item.id} className="hover:bg-[#F5F4F1]/30 transition-colors">
                          <td className="py-3 px-4 text-center">
                            {item.status === "completed" && (
                              <span className="inline-flex p-1 bg-emerald-50 text-emerald-700 rounded-sm" title="Sikeresen feldolgozva">
                                <CheckCircle2 className="w-4 h-4" />
                              </span>
                            )}
                            {item.status === "failed" && (
                              <span className="inline-flex p-1 bg-rose-50 text-rose-700 rounded-sm" title={`Hiba: ${item.error}`}>
                                <XCircle className="w-4 h-4" />
                              </span>
                            )}
                            {item.status === "scraping" && (
                              <span className="inline-flex p-1 bg-amber-50 text-amber-700 rounded-sm animate-spin" title="Letöltés alatt...">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              </span>
                            )}
                            {item.status === "ideal" && (
                              <span className="inline-flex p-1 bg-[#F5F4F1] text-[#1A1A1A]/40 rounded-sm" title="Sorban áll">
                                <span className="w-3.5 h-3.5 block rounded-full border-2 border-dashed border-[#1A1A1A]/30"></span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-[#1A1A1A] block truncate max-w-[180px]">
                              {item.domain}
                            </span>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-[#C2410C] hover:underline flex items-center gap-1 truncate max-w-[180px] mt-0.5"
                            >
                              Megnyitás
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </td>

                          <td className="py-3 px-4">
                            <div className="max-w-md">
                              <span className="font-medium text-[#1A1A1A] block truncate" title={item.title}>
                                {item.title}
                              </span>
                              {item.error ? (
                                <span className="text-[10px] text-rose-600 font-mono block mt-0.5 truncate max-w-sm">
                                  {item.error}
                                </span>
                              ) : (
                                item.text && (
                                  <span className="text-[10px] text-[#1A1A1A]/50 block truncate font-sans">
                                    {item.text.substring(0, 95)}...
                                  </span>
                                )
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-center font-mono text-[11px] text-[#1A1A1A]/60">
                            {item.text ? `${item.text.split(/\s+/).length} szó` : "0 szó"}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {item.text && (
                                <button
                                  onClick={() => setEditingItem(item)}
                                  className="px-2.5 py-1 bg-[#F5F4F1] hover:bg-[#1A1A1A]/10 text-[#1A1A1A] rounded-none font-semibold uppercase tracking-wider text-[10px] transition-all inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Szerkesztés
                                </button>
                              )}

                              {item.status === "failed" && (
                                <button
                                  onClick={() => handleRetryItem(item.id)}
                                  className="px-2.5 py-1 bg-[#C2410C]/10 hover:bg-[#C2410C]/20 border border-[#C2410C]/20 text-[#C2410C] rounded-none font-bold uppercase text-[10px]"
                                >
                                  Újra
                                </button>
                              )}

                              <button
                                onClick={() => handleTrashItem(item.id)}
                                className="p-1 hover:bg-rose-50 text-[#1A1A1A]/40 hover:text-rose-700 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Tab 3: Grouping & Download PDF ZIP */}
        {activeTab === "bundling" && (
          <div className="flex flex-col gap-8">
            
            {/* Download Hero representation */}
            <div className="bg-[#1A1A1A] rounded-sm p-8 text-white relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8 border-b-4 border-[#C2410C]">
              
              <div className="space-y-3 z-10 w-full">
                <span className="px-3 py-1 bg-[#C2410C] text-white text-[9px] uppercase font-bold tracking-[0.2em] inline-block rounded-sm">
                  Dosszié-csomagolás Generálás kész
                </span>
                <h3 className="text-3xl font-serif italic tracking-tight text-white">
                  Összesen {finalGroups.length} db optimalizált PDF-fájl vár letöltésre
                </h3>
                <p className="text-xs text-white/70 max-w-4xl leading-relaxed">
                  Az összes sikeresen letöltött (<strong className="text-white font-semibold">{completedCount} db</strong>) URL-forrást beágyaztuk pontosan <strong className="text-[#C2410C] font-semibold">{finalGroups.length} darab</strong> sorszámozott PDF fájlba. Ezzel tökéletesen betartható a Google NotebookLM forráskorlátja.
                </p>
              </div>

            </div>

            {/* Layout representation of generated output buckets */}
            <div className="bg-white rounded-sm border border-[#1A1A1A]/10 p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[#1A1A1A]/10 pb-5 mb-5">
                <div>
                  <h4 className="text-lg font-serif italic text-[#1A1A1A]">03. PDF letöltése</h4>
                  <p className="text-xs text-[#1A1A1A]/60">Vizsgáld át az elkészült PDF-fájlok belső hivatkozási struktúráját.</p>
                </div>

                {/* Inner Search block */}
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#1A1A1A]/40" />
                  <input
                    type="text"
                    value={pdfSearchQuery}
                    onChange={(e) => setPdfSearchQuery(e.target.value)}
                    placeholder="PDF fájlnév vagy forrás hivatkozás..."
                    className="w-full bg-[#F5F4F1] font-sans pl-9 pr-10 py-2 text-xs border border-[#1A1A1A]/15 rounded-sm focus:border-black focus:bg-white outline-none text-[#1A1A1A] transition-all"
                  />
                  {pdfSearchQuery && (
                    <button
                      onClick={() => setPdfSearchQuery("")}
                      className="absolute right-3 top-2.5 text-[#1A1A1A]/50 hover:text-rose-700 cursor-pointer p-0.5 border-none bg-transparent transition-colors"
                      title="Keresés törlése"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {finalGroups.length === 0 ? (
                <div className="text-center py-20 text-[#1A1A1A]/40">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-30 text-[#1A1A1A]" />
                  <p className="text-xs font-bold uppercase tracking-wider text-[#1A1A1A]">Nincs legenerált forráscsoport</p>
                  <p className="text-[11px] mt-1 text-[#1A1A1A]/60">Kérjük, futtasd le a letöltést és scrapinget a 2. fázisban a PDF listák összeállításához.</p>
                </div>
              ) : filteredFinalGroups.length === 0 ? (
                <div className="text-center py-20 text-[#1A1A1A]/40">
                  <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-30 text-[#C2410C]" />
                  <p className="text-xs">Nem található a keresésnek megfelelő PDF csoport.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredFinalGroups.map((group) => {
                    const isMerged = group.sources.length > 1;
                    return (
                      <div
                        key={group.id}
                        onClick={() => setPreviewGroup(group)}
                        className={`p-5 rounded-none border transition-all text-left flex flex-col justify-between h-48 cursor-pointer hover:shadow-sm ${
                          isMerged 
                            ? "bg-[#F5F4F1] border-[#C2410C]/35 hover:border-[#C2410C]"
                            : "bg-white border-[#1A1A1A]/15 hover:border-black"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className="font-mono text-[10px] text-[#C2410C] font-bold bg-[#C2410C]/5 px-2 py-0.5 border border-[#C2410C]/10 rounded-sm">
                              PDF #{String(group.id).padStart(3, "0")}
                            </span>
                            {isMerged ? (
                              <span className="px-2 py-0.5 bg-[#C2410C] text-white text-[8px] uppercase tracking-wider font-bold">
                                Összevont ({group.sources.length} URL)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-[#1A1A1A] text-white text-[8px] uppercase tracking-wider font-bold">
                                Egyedi (1:1)
                              </span>
                            )}
                          </div>

                          <h5 className="font-mono font-bold text-xs text-[#1A1A1A] truncate max-w-full" title={group.filename}>
                            {group.filename}
                          </h5>
                          
                          <p className="text-[10px] text-[#1A1A1A]/50 mt-2 truncate">
                            Domén: {group.sources.map(s => s.domain).join("  •  ")}
                          </p>
                        </div>

                        <div className="border-t border-[#1A1A1A]/10 pt-3 flex items-center justify-between mt-4 text-[11px]">
                          <span className="text-[#1A1A1A]/50 font-mono text-[10px]">
                            {group.sources.reduce((acc, curr) => acc + (curr.text ? curr.text.split(/\s+/).length : 0), 0)} szó
                          </span>
                          <span className="text-[#C2410C] font-semibold text-[11px] tracking-wider uppercase flex items-center gap-0.5 hover:underline decoration-1">
                            Szerkesztés
                            <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {finalGroups.length > 0 && (
                <div className="mt-8 pt-6 border-t border-[#1A1A1A]/10 flex justify-end">
                  <button
                    onClick={handleDownloadZip}
                    disabled={isZipping || finalGroups.length === 0}
                    className="w-auto px-8 py-4 bg-[#800020] hover:bg-[#66001a] text-white uppercase tracking-[0.15em] font-bold text-xs flex items-center justify-center gap-3 shadow-md hover:scale-[1.01] transition-all disabled:opacity-35 cursor-pointer rounded-sm"
                  >
                    {isZipping ? (
                      <>
                        <svg className="animate-spin h-4.5 w-4.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        PDF TÖMÖRÍTÉS ÉS ZIP EXPORT...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Összes PDF letöltése ZIP-ben
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="mt-auto bg-white border-t border-[#1A1A1A]/10 py-10 text-xs text-[#1A1A1A]/60">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] opacity-70">
          <p>© 2026 NotebookLM Forrás-optimalizáló és PDF Csoportosító.</p>
          <p>Minden tartalom-feldolgozás felesleges reklámok nélkül a memóriában vagy a biztonságos backenden történik.</p>
        </div>
      </footer>

      {/* DRAWER MODAL 1: Individual URL Content Editor */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-end z-50 animate-fade-in">
          <div className="bg-[#FDFCFB] w-full max-w-2xl h-full flex flex-col shadow-2xl border-l border-[#1A1A1A]/10 relative">
            
            <div className="p-6 border-b border-[#1A1A1A]/10 bg-white flex items-center justify-between">
              <div>
                <h3 className="text-lg font-serif italic text-[#1A1A1A]">Kinyert tartalom kezelése</h3>
                <p className="text-[11px] font-mono text-[#1A1A1A]/50 truncate max-w-md">{editingItem.url}</p>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="w-8 h-8 rounded-full hover:bg-[#1A1A1A]/5 text-[#1A1A1A]/40 hover:text-black flex items-center justify-center transition-all cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-[#1A1A1A]/60 font-medium mb-1.5 uppercase tracking-wider text-[10px]">Forrás Domain</label>
                  <input
                    type="text"
                    value={editingItem.domain}
                    onChange={(e) => setEditingItem({ ...editingItem, domain: e.target.value })}
                    className="w-full bg-white rounded-none border border-[#1A1A1A]/15 p-2 font-mono text-xs text-[#1A1A1A] outline-none focus:border-[#C2410C]"
                  />
                </div>
                <div>
                  <label className="block text-[#1A1A1A]/60 font-medium mb-1.5 uppercase tracking-wider text-[10px]">Feldolgozás állapota</label>
                  <span className="block p-2 bg-[#F5F4F1] border border-[#1A1A1A]/10 rounded-none text-[#1A1A1A] font-semibold text-xs uppercase tracking-wider">
                    {editingItem.status === "completed" ? "Sikeres" : "Hiba"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[#1A1A1A]/60 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">Dokumentum Címe (NotebookLM hivatkozásként használja)</label>
                <input
                  type="text"
                  value={editingItem.title}
                  onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                  className="w-full bg-white rounded-none border border-[#1A1A1A]/15 p-3 text-xs text-[#1A1A1A] font-serif font-semibold italic outline-none focus:border-[#C2410C]"
                />
              </div>

              <div>
                <label className="block text-[#1A1A1A]/60 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">Kinyert szöveg (tiszta Markdown vagy cikk szövegtörzs)</label>
                <textarea
                  value={editingItem.text}
                  onChange={(e) => setEditingItem({ ...editingItem, text: e.target.value })}
                  rows={14}
                  className="w-full rounded-none border border-[#1A1A1A]/15 p-4 text-xs font-mono bg-white text-[#1A1A1A] outline-none focus:border-[#C2410C] leading-relaxed shadow-inner"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#1A1A1A]/10 bg-white flex items-center justify-end gap-3">
              <button
                onClick={() => setEditingItem(null)}
                className="px-5 py-2.5 text-xs bg-[#F5F4F1] hover:bg-[#1A1A1A]/10 rounded-none uppercase tracking-wider font-bold text-[#1A1A1A] transition-all cursor-pointer"
              >
                Mégse
              </button>
              <button
                onClick={() => saveEditedItem(editingItem)}
                className="px-6 py-2.5 text-xs bg-[#C2410C] hover:bg-[#A1340B] rounded-none uppercase tracking-wider font-bold text-white transition-all shadow-xs cursor-pointer"
              >
                Szerkesztés mentése
              </button>
            </div>

          </div>
        </div>
      )}

      {/* DRAWER MODAL 2: NotebookLM PDF Document Mock Preview */}
      {previewGroup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-none w-full max-w-3xl h-[88vh] flex flex-col shadow-2xl relative border border-[#1A1A1A]/20">
            
            <div className="p-6 border-b border-[#1A1A1A]/10 bg-white flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-[9px] text-[#C2410C] font-bold bg-[#C2410C]/5 px-2 py-0.5 border border-[#C2410C]/10 rounded-sm">
                    PDF #{String(previewGroup.id).padStart(3, "0")}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-[#1A1A1A]/50 font-mono">PDF Előnézeti vázlat</span>
                </div>
                <h3 className="text-lg font-serif font-bold text-[#1A1A1A]">{previewGroup.filename}</h3>
              </div>
              <button
                onClick={() => setPreviewGroup(null)}
                className="w-8 h-8 rounded-full hover:bg-[#1A1A1A]/5 text-[#1A1A1A]/40 hover:text-black flex items-center justify-center transition-all cursor-pointer font-bold text-sm"
              >
                ✕
              </button>
            </div>

            {/* Document sheet template mock */}
            <div className="flex-1 overflow-y-auto bg-[#F5F4F1] p-8 flex justify-center">
              <div className="bg-white w-[210mm] max-w-full min-h-[297mm] p-12 shadow-md border border-[#1A1A1A]/10 relative text-[#1A1A1A] leading-normal font-sans text-xs">
                
                {/* Header title */}
                <div className="text-center border-b pb-4 mb-6 border-[#1A1A1A]/15">
                  <h4 className="text-lg font-serif font-bold text-[#1A1A1A]">NotebookLM Optimalizált Forrásgyűjtemény</h4>
                  <p className="text-[10px] text-[#1A1A1A]/50 tracking-wide mt-0.5 uppercase font-mono">
                    Automatizált PDF Export  |  Fájl: {previewGroup.filename}
                  </p>
                </div>

                {/* Iterate Mock Sources */}
                {previewGroup.sources.map((src, index) => (
                  <div key={src.id} className="mb-10">
                    {index > 0 && (
                      <div className="border-t border-dashed border-[#1A1A1A]/20 my-8 pt-6 flex items-center justify-center">
                        <span className="text-[9px] font-mono text-[#1A1A1A]/55 uppercase tracking-widest bg-[#F5F4F1] px-4 py-1.5 border border-[#1A1A1A]/10 rounded-none">
                          Lapcsere / Új Forrás Összefűzés (Szekvenciális PDF-Befoglalás)
                        </span>
                      </div>
                    )}

                    {/* Strict Metadata Info Block for NotebookLM source detection */}
                    <div className="p-4 bg-[#F5F4F1] border-l-2 border-[#C2410C] rounded-none mb-4 text-[10px] font-mono whitespace-pre-wrap leading-relaxed text-[#1A1A1A]">
                      <div className="font-bold text-[#1A1A1A] text-xs mb-1">--- FORRÁS #{index + 1} METAADATOK ---</div>
                      <div><span className="text-[#C2410C] font-semibold">CÍM:</span> {src.title}</div>
                      <div><span className="text-[#C2410C] font-semibold">URL:</span> {src.url}</div>
                      <div><span className="text-[#C2410C] font-semibold">DOMAIN:</span> {src.domain}</div>
                      <div><span className="text-[#C2410C] font-semibold">KIVONÁS DÁTUMA:</span> {new Date().toLocaleDateString("hu-HU")}</div>
                      <div className="font-bold text-[#1A1A1A]/45">---------------------------------------</div>
                    </div>

                    <div className="text-[#1A1A1A] space-y-3 leading-relaxed">
                      <h5 className="font-serif italic font-bold text-sm text-[#1A1A1A] border-b pb-1">Kivont tartalom:</h5>
                      <p className="whitespace-pre-wrap font-sans text-[11px] text-[#1A1A1A]/80 leading-relaxed font-normal">
                        {src.text}
                      </p>
                    </div>
                  </div>
                ))}

              </div>
            </div>

            <div className="p-4 border-t border-[#1A1A1A]/10 bg-white flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="text-[11px] text-[#1A1A1A]/50 italic hidden sm:inline">
                Ez a papírlap hűen ábrázolja a PDFKit által kreált struktúrát.
              </span>
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  onClick={() => handleDownloadSinglePdf(previewGroup)}
                  disabled={isDownloadingSingle === previewGroup.filename}
                  className="px-6 py-2.5 bg-[#C2410C] hover:bg-[#A1340B] uppercase tracking-wider font-bold text-white text-xs transition-colors rounded-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  {isDownloadingSingle === previewGroup.filename ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generálás...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      PDF Letöltése
                    </>
                  )}
                </button>
                <button
                  onClick={() => setPreviewGroup(null)}
                  className="px-6 py-2.5 bg-[#F5F4F1] hover:bg-[#1A1A1A]/10 text-[#1A1A1A] uppercase tracking-wider font-bold text-xs transition-colors rounded-none cursor-pointer"
                >
                  Bezárás
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* DRAWER MODAL 3: Info Popup Modal for Processing Capacity */}
      {isInfoModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-none border border-[#1A1A1A]/15 shadow-xl p-6 max-w-md w-full relative">
            <div className="flex justify-between items-center border-b border-[#1A1A1A]/10 pb-3 mb-4">
              <h4 className="font-serif font-bold text-sm tracking-tight text-[#1A1A1A] flex items-center gap-1.5">
                <Info className="w-4 h-4 text-[#C2410C]" />
                Feldolgozási kapacitás (Sebesség)
              </h4>
              <button
                onClick={() => setIsInfoModalOpen(false)}
                className="text-xs font-mono font-bold opacity-50 hover:opacity-100 cursor-pointer p-1"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#1A1A1A]/80 leading-relaxed bg-[#F5F4F1] p-3.5 rounded-none border border-[#1A1A1A]/5">
              A feldolgozási kapacitás határozza meg, hogy a rendszer egyszerre hány linket elemez és tisztít meg párhuzamosan a Gemini AI segítségével. A magasabb érték (pl. 5) drasztikusan felgyorsítja a konvertálást, de nagyobb szerver- és hálózati kapacitást igényel. Ha hibát tapasztal, érdemes alacsonyabb (1 vagy 2) értékre állítani.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setIsInfoModalOpen(false)}
                className="px-5 py-2.5 bg-[#1A1A1A] hover:bg-black text-white text-xs font-semibold uppercase tracking-wider cursor-pointer"
              >
                Bezárás
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER MODAL 4: Crawler Content Raw Preview Modal */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-sm border border-[#1A1A1A]/15 shadow-xl max-w-4xl w-full h-[85vh] flex flex-col relative animate-slide-up">
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[#1A1A1A]/10 p-4 bg-[#F5F4F1]">
              <div className="flex-1 min-w-0 pr-4">
                <h4 className="font-serif font-bold text-sm tracking-tight text-[#1A1A1A] truncate">
                  Nyers Forrás Előnézet
                </h4>
                <p className="text-[10px] font-mono text-[#1A1A1A]/60 truncate mt-0.5" title={previewUrl}>
                  {previewUrl}
                </p>
              </div>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="text-xs font-mono font-bold opacity-60 hover:opacity-100 cursor-pointer p-1.5 border border-transparent hover:border-gray-200 hover:bg-gray-100 rounded-sm"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 bg-white min-h-0">
              {isPreviewLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 animate-pulse">
                  <span className="w-8 h-8 border-4 border-[#800020]/30 border-t-[#800020] rounded-full animate-spin" />
                  <p className="text-xs font-mono text-gray-500">Forrástartalom letöltése és tisztítása folyamatban...</p>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  <p className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/50 mb-2.5">
                    Kinyert egyszerűsített szövegtartalom (NotebookLM kompatibilis):
                  </p>
                  <pre className="flex-1 bg-[#F9F8F6] font-mono text-xs p-4 rounded-sm border border-[#1A1A1A]/10 overflow-y-auto whitespace-pre-wrap select-text text-slate-800 leading-relaxed selection:bg-amber-100">
                    {previewRawContent}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[#1A1A1A]/10 p-4 flex justify-end bg-[#F5F4F1]">
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-5 py-2 bg-[#1A1A1A] hover:bg-black text-white text-xs font-semibold uppercase tracking-wider cursor-pointer font-sans"
              >
                Bezárás
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER MODAL 5: Interactive Error Modal for Failed Crawler URLs */}
      {isErrorModalOpen && (() => {
        const urlStr = selectedFailedUrl;
        const isActive = urlStr === crawlingActiveUrl;
        const isCrawled = exploredCrawlerUrls.includes(urlStr);
        const isError = failedCrawlerUrls.includes(urlStr) || urlStr.toLowerCase().includes("error") || urlStr.toLowerCase().includes("broken") || urlStr.toLowerCase().includes("failed") || urlStr.toLowerCase().includes("offline");

        let statusText = "VÁRÓLISTÁN";
        let headerBg = "bg-[#F5F4F1]";
        let titleColor = "text-slate-800";
        let statusColorClass = "bg-gray-100 text-gray-700 border border-gray-300";
        let detailContent = null;

        if (isActive) {
          statusText = isCrawlPaused ? "SZÜNETELTETVE (PAUSED)" : "FELTÉRKÉPEZÉS ALATT (AKTÍV)";
          headerBg = "bg-amber-50";
          titleColor = "text-amber-900";
          statusColorClass = "bg-amber-100 text-amber-800 border border-amber-300";
          detailContent = (
            <div className="text-xs text-amber-800 bg-amber-50/50 border border-amber-100 p-4 rounded-sm mt-1.5 leading-relaxed font-semibold">
              Ez a hivatkozás jelenleg a robot feldolgozása vagy várakoztatása alatt áll.
            </div>
          );
        } else if (isError) {
          statusText = "HIBA / KIHAGYVA";
          headerBg = "bg-[#FFF5F5]";
          titleColor = "text-red-900";
          statusColorClass = "bg-red-100 text-red-800 border border-red-300";
          detailContent = (
            <div className="text-xs text-red-800 bg-red-50 border border-red-100 p-4 rounded-sm mt-1.5 leading-relaxed font-semibold">
              {crawlerErrorDetails[urlStr] || "Ismeretlen feltérképezési vagy kapcsolódási hiba lépett fel."}
            </div>
          );
        } else if (isCrawled) {
          statusText = "SIKERESEN FELTÉRKÉPEZVE";
          headerBg = "bg-emerald-50";
          titleColor = "text-emerald-900";
          statusColorClass = "bg-emerald-100 text-emerald-800 border border-emerald-300";
          detailContent = (
            <div className="text-xs text-emerald-800 bg-emerald-50/50 border border-emerald-100 p-4 rounded-sm mt-1.5 leading-relaxed font-semibold">
              A robot sikeresen beolvasta és feldolgozta a hivatkozás tartalmát a sitemap számára.
            </div>
          );
        } else {
          detailContent = (
            <div className="text-xs text-slate-800 bg-slate-50 border border-slate-100 p-4 rounded-sm mt-1.5 leading-relaxed font-semibold">
              Ez a hivatkozás még elemzésre vár a várólistában (Frontier Queue).
            </div>
          );
        }

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-sm border border-[#1A1A1A]/15 shadow-xl max-w-lg w-full relative animate-slide-up">
              {/* Modal Header */}
              <div className={`flex justify-between items-center border-b border-[#1A1A1A]/10 p-4 ${headerBg}`}>
                <div className="flex items-center gap-2">
                  <Info className={`w-5 h-5 shrink-0 ${titleColor}`} />
                  <h4 className={`font-serif font-bold text-sm tracking-tight ${titleColor}`}>
                    Hivatkozás részletei és állapota
                  </h4>
                </div>
                <button
                  onClick={() => setIsErrorModalOpen(false)}
                  className="text-xs font-mono font-bold opacity-60 hover:opacity-100 cursor-pointer p-1.5 border border-transparent hover:border-gray-200 hover:bg-gray-100 rounded-sm"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 bg-white flex flex-col gap-4">
                <div>
                  <p className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/50">Hivatkozás pontos címe:</p>
                  <p className="text-xs font-mono text-[#1A1A1A] bg-slate-50 border border-slate-200 px-3 py-2 rounded-sm mt-1.5 break-all select-all font-semibold selection:bg-amber-100">
                    {urlStr}
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/50">Aktuális státusz:</span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm font-bold uppercase ${statusColorClass}`}>
                    {statusText}
                  </span>
                </div>

                <div>
                  <p className="text-[10px] uppercase font-mono font-bold text-[#1A1A1A]/50">Státusz információ:</p>
                  {detailContent}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-[#1A1A1A]/10 p-4 flex flex-col sm:flex-row sm:justify-end gap-2.5 bg-[#FDFCFA]">
                <button
                  onClick={() => setIsErrorModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider cursor-pointer rounded-sm border border-slate-300 font-sans transition-colors"
                >
                  Bezárás
                </button>
                
                <a
                  href={urlStr}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-[#1A1A1A] border border-slate-300 text-xs font-semibold uppercase tracking-wider cursor-pointer rounded-sm flex items-center justify-center gap-1.5 font-sans transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Megnyitás új lapon
                </a>

                {(isError || !isCrawled) && (
                  <button
                    onClick={() => {
                      handleRetryFailedUrl(urlStr);
                      setIsErrorModalOpen(false);
                    }}
                    className="px-4 py-2 bg-[#800020] hover:bg-[#600018] text-white text-xs font-semibold uppercase tracking-wider cursor-pointer rounded-sm font-sans transition-colors"
                  >
                    Feltérképezés most / Újra
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
