import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  Trash2, 
  Layers, 
  Sliders, 
  AlertTriangle, 
  CheckCircle, 
  Loader2,
  FileText
} from 'lucide-react';

// Link státusz típusok
type LinkStatus = 'VÁRÓLISTÁN' | 'FELTÉRKÉPEZVE' | 'SZÜNETEL (PAUSED)' | 'HIBA';

// Egyedi link objektum struktúra
interface SitemapItem {
  id: number;
  url: string;
  level: number;
  category: 'Core' | 'Extension' | 'Documentation' | 'Page';
  status: LinkStatus;
}

export default function App() {
  // --- ÁLLAPOTOK (STATES) ---
  const [baseUrl, setBaseUrl] = useState('https://woocommerce.com/document/');
  const [sitemapTree, setSitemapTree] = useState<SitemapItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [threads, setThreads] = useState(3);
  const [pdfLimit, setPdfLimit] = useState(500);
  const [activeTab, setActiveTab] = useState<'kutatas' | 'konvertalas'>('kutatas');

  // Belső referenciák a rekurzió és a párhuzamos futás követésére
  const queueRef = useRef<string[]>([]);
  const visitedSetRef = useRef<Set<string>>(new Set());
  const isRunningRef = useRef(false);
  const idCounterRef = useRef(1);

  // Szinkronizáljuk a ref-et az állapottal a leállítás/indítás azonnali kezeléséhez
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  // --- 1. URL TISZTÍTÁS ÉS KANONIZÁCIÓ ---
  const canonicalizeUrl = (urlStr: string): string => {
    try {
      // Levágjuk a query paramétereket és a hash/horgony jelöléseket
      let cleanUrl = urlStr.split('?')[0].split('#')[0];
      // Biztosítjuk a trailing slasht a konzisztens egyediség-ellenőrzéshez
      if (!cleanUrl.endsWith('/') && !cleanUrl.endsWith('.html') && !cleanUrl.endsWith('.htm')) {
        cleanUrl += '/';
      }
      return cleanUrl.trim();
    } catch {
      return urlStr.trim();
    }
  };

  // --- 2. KATEGÓRIA MEGHATÁROZÁSA ---
  const detectCategory = (url: string): 'Core' | 'Extension' | 'Documentation' | 'Page' => {
    const lower = url.toLowerCase();
    if (lower.includes('/documentation/')) return 'Documentation';
    if (lower.includes('/extensions/') || lower.includes('/extension/')) return 'Extension';
    if (lower.includes('/document/')) return 'Core';
    return 'Page';
  };

  // --- 3. SZIGORÚ LINK KIGYŰJTÉS (MAIN / ARTICLE SCOPE) ---
  const extractValidLinks = (htmlText: string, currentUrl: string): string[] => {
    const validLinks: string[] = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      
      // Korlátozzuk a keresést kizárólag a fő tartalmi blokkokra (kihagyva a menüt/footert)
      const contentArea = doc.querySelector('main') || 
                          doc.querySelector('article') || 
                          doc.querySelector('.entry-content') || 
                          doc.querySelector('.main-content') || 
                          doc.body;

      const anchorElements = contentArea.querySelectorAll('a');
      
      anchorElements.forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) return;

        try {
          // Abszolút URL létrehozása a relatív linkekből
          const absoluteUrl = new URL(href, currentUrl).toString();
          const cleanUrl = canonicalizeUrl(absoluteUrl);

          // SZŰRŐMÁTRIX:
          // A: Csak a hivatalos woocommerce document/documentation ág jöhet szóba
          const isTargetDomain = cleanUrl.startsWith('https://woocommerce.com/document/') || 
                                 cleanUrl.startsWith('https://woocommerce.com/documentation/');
          
          // B: Hard Blacklist (Pagináció, Feedek és nem-HTML állományok tiltása)
          const isPageLoop = cleanUrl.includes('/page/');
          const isStaticFile = /\.(png|jpg|jpeg|gif|pdf|zip|css|js|xml)$/i.test(cleanUrl);

          if (isTargetDomain && !isPageLoop && !isStaticFile) {
            validLinks.push(cleanUrl);
          }
        } catch {
          // Hibás vagy külső protokollos (mailto, tel) linkek eldobása
        }
      });
    } catch (err) {
      console.error("Hiba a HTML parszolása közben:", err);
    }
    return validLinks;
  };

  // --- 4. EGYETLEN CIKLUS / WORKER FUTTATÁSA ---
  const workerProcess = async () => {
    while (isRunningRef.current && queueRef.current.length > 0) {
      // Ellenőrizzük, hogy elértük-e a beállított PDF darabszám limitet
      if (visitedSetRef.current.size >= pdfLimit) {
        setIsRunning(false);
        break;
      }

      // Kivesszük a következő URL-t a várólistáról
      const nextUrl = queueRef.current.shift();
      if (!nextUrl) continue;

      // Átállítjuk a státuszt a vizuális fában 'FELTÉRKÉPEZVE'-re (vagy folyamatban lévőre)
      setSitemapTree(prev => 
        prev.map(item => item.url === nextUrl ? { ...item, status: 'FELTÉRKÉPEZVE' } : item)
      );

      try {
        // AI Studio környezetbarát proxy vagy közvetlen fetch lekérés
        const response = await fetch(nextUrl);
        if (!response.ok) throw new Error("Sikertelen letöltés");
        
        const htmlText = await response.text();
        const discoveredLinks = extractValidLinks(htmlText, nextUrl);

        // Újonnan talált linkek feldolgozása és szűrése
        discoveredLinks.forEach(link => {
          // ABSZOLÚT EGYEDISÉG ELLENŐRZÉS: Ha valaha láttuk vagy a fában van, nem nyúlunk hozzá!
          if (!visitedSetRef.current.has(link)) {
            visitedSetRef.current.add(link);
            queueRef.current.push(link);

            // Meghatározzuk a mélységi szintet az URL struktúra perjelei alapján
            const pathSegments = new URL(link).pathname.split('/').filter(Boolean);
            const level = Math.max(1, pathSegments.length - 1);

            // Hozzáadjuk az új elemet az Oldaltérkép fához
            const newItem: SitemapItem = {
              id: idCounterRef.current++,
              url: link,
              level: level,
              category: detectCategory(link),
              status: 'VÁRÓLISTÁN'
            };

            setSitemapTree(prev => [...prev, newItem]);
          }
        });

      } catch (error) {
        setSitemapTree(prev => 
          prev.map(item => item.url === nextUrl ? { ...item, status: 'HIBA' } : item)
        );
      }

      // Rövid aszinkron szünet a szálak kímélése és a UI reszponzivitása érdekében
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  // --- 5. FOLYAMAT INDÍTÁSA / FOLYTATÁSA ---
  const handleStart = () => {
    if (!baseUrl) return;
    
    const cleanRoot = canonicalizeUrl(baseUrl);
    
    // Ha teljesen új kutatás indul, inicializáljuk az alapállapotot
    if (sitemapTree.length === 0) {
      visitedSetRef.current.clear();
      queueRef.current = [];
      idCounterRef.current = 1;

      visitedSetRef.current.add(cleanRoot);
      queueRef.current.push(cleanRoot);

      const rootItem: SitemapItem = {
        id: idCounterRef.current++,
        url: cleanRoot,
        level: 1,
        category: detectCategory(cleanRoot),
        status: 'VÁRÓLISTÁN'
      };
      setSitemapTree([rootItem]);
    } else {
      // Ha szüneteltetés után folytatjuk, a VÁRÓLISTÁN lévő elemeket visszatöltjük a ref queue-ba
      const pendingUrls = sitemapTree
        .filter(item => item.status === 'VÁRÓLISTÁN' || item.status === 'SZÜNETEL (PAUSED)')
        .map(item => item.url);
      queueRef.current = pendingUrls;
      
      setSitemapTree(prev => 
        prev.map(item => item.status === 'SZÜNETEL (PAUSED)' ? { ...item, status: 'VÁRÓLISTÁN' } : item)
      );
    }

    setIsRunning(true);
    isRunningRef.current = true;

    // Elindítjuk a párhuzamos munkavégzőket (Threads)
    for (let i = 0; i < threads; i++) {
      workerProcess();
    }
  };

  // --- 6. FOLYAMAT SZÜNETELTETÉSE ---
  const handlePause = () => {
    setIsRunning(false);
    isRunningRef.current = false;
    setSitemapTree(prev => 
      prev.map(item => item.status === 'VÁRÓLISTÁN' ? { ...item, status: 'SZÜNETEL (PAUSED)' } : item)
    );
  };

  // --- 7. LINKER TÖRLÉSE (EGYENLEGESÍTETT, MEGERŐSÍTETT FUNKCIÓ) ---
  const handleClearAll = () => {
    const confirmDelete = window.confirm(
      "Biztosan törölni szeretnéd az összes eddigi kutatási eredményt és linket? Ez a folyamat nem vonható vissza."
    );
    if (confirmDelete) {
      setIsRunning(false);
      isRunningRef.current = false;
      queueRef.current = [];
      visitedSetRef.current.clear();
      idCounterRef.current = 1;
      setSitemapTree([]);
    }
  };

  // --- 8. TÁBLÁZAT EXPORTÁLÁS (CSV EXPORT) ---
  const handleExportToCSV = () => {
    if (sitemapTree.length === 0) {
      alert("Nincs exportálható adat!");
      return;
    }

    // CSV Fejléc összeállítása
    let csvContent = "\uFEFFSorszám,Szint,Kategória,URL,Státusz\n";
    
    // Sorok generálása az adatbázisból
    sitemapTree.forEach(item => {
      const row = `${item.id},L${item.level},${item.category},"${item.url}",${item.status}`;
      csvContent += row + "\n";
    });

    // Letöltési link generálása a böngészőben
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "woocommerce-kutatas-export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Címke manuális módosítása (Kattintható korrekciós funkció)
  const toggleCategory = (id: number) => {
    const categories: ('Core' | 'Extension' | 'Documentation' | 'Page')[] = ['Core', 'Extension', 'Documentation', 'Page'];
    setSitemapTree(prev => prev.map(item => {
      if (item.id === id) {
        const nextIndex = (categories.indexOf(item.category) + 1) % categories.length;
        return { ...item, category: categories[nextIndex] };
      }
      return item;
    }));
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4 mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-indigo-400">
            <Layers className="w-6 h-6" /> StackLM <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">v1.2</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">NotebookLM Tiszta Forrás-Optimalizáló és Intelligens Crawler</p>
        </div>
        
        {/* TABS */}
        <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button 
            onClick={() => setActiveTab('kutatas')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'kutatas' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
          >
            00. Kutatás <span className="ml-1 px-1.5 py-0.5 text-xs bg-slate-900 text-indigo-300 rounded-full font-mono">{sitemapTree.length}</span>
          </button>
          <button 
            onClick={() => setActiveTab('konvertalas')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'konvertalas' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
          >
            01. Konvertálás (PDF)
          </button>
        </div>
      </header>

      {activeTab === 'kutatas' && (
        <div className="space-y-6">
          {/* BEÁLLÍTÁSOK PANEL */}
          <section className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-5 space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                Kiindulási Dokumentáció URL
              </label>
              <input 
                type="text" 
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={isRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors"
                placeholder="https://woocommerce.com/document/..."
              />
            </div>

            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Sliders className="w-3 h-3" /> Párhuzamos Szálak
              </label>
              <select 
                value={threads}
                onChange={(e) => setThreads(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              >
                {[1, 2, 3, 4, 5, 8, 10].map(n => <option key={n} value={n}>{n} szál</option>)}
              </select>
            </div>

            <div className="lg:col-span-2 space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-3 h-3" /> PDF Limit (Max Link)
              </label>
              <input 
                type="number" 
                value={pdfLimit}
                onChange={(e) => setPdfLimit(Number(e.target.value))}
                disabled={isRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                min="10"
              />
            </div>

            {/* VEZÉRLŐ GOMBOK */}
            <div className="lg:col-span-3 flex gap-2">
              {!isRunning ? (
                <button 
                  onClick={handleStart}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 font-medium text-sm text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all"
                >
                  <Play className="w-4 h-4 fill-current" /> Folytatás
                </button>
              ) : (
                <button 
                  onClick={handlePause}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 font-medium text-sm text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-amber-900/20 transition-all"
                >
                  <Pause className="w-4 h-4 fill-current" /> Leállítás
                </button>
              )}
            </div>
          </section>

          {/* SITEMAP FA ÉS LISTA PANEL */}
          <main className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {/* LISTA FEJBLOKK FELIRATOKKAL */}
            <div className="bg-slate-800/40 border-b border-slate-800 p-4 flex justify-between items-center flex-wrap gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                Oldaltérkép és Hierarchikus Útvonal-követés:
                {isRunning && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
              </span>
              
              <div className="flex gap-2">
                <button 
                  onClick={handleExportToCSV}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Exportálás táblázatba
                </button>
                <button 
                  onClick={handleClearAll}
                  className="bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 font-medium text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Linkek törlése
                </button>
              </div>
            </div>

            {/* FA STRUKTÚRA DREINÁLÁSA */}
            <div className="p-4 max-h-[600px] overflow-y-auto font-mono text-xs divide-y divide-slate-800/50">
              {sitemapTree.length === 0 ? (
                <div className="text-center py-12 text-slate-500 space-y-2">
                  <AlertTriangle className="w-8 h-8 mx-auto text-slate-600" />
                  <p>A kutatási adatbázis üres. Add meg a kezdő URL-t, és nyomj a Folytatás gombra!</p>
                </div>
              ) : (
                sitemapTree.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between hover:bg-slate-800/20 px-2 rounded transition-colors group">
                    <div className="flex items-center space-x-3 overflow-hidden mr-4">
                      {/* Konzekvens sorszámozás */}
                      <span className="text-slate-600 text-[10px] w-6 text-right select-none">{item.id}</span>
                      
                      {/* Kontrasztos szintjelző címke */}
                      <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 rounded font-bold text-[10px] shadow-sm">
                        L{item.level}
                      </span>
                      
                      {/* Fatörzs eltolódás vizualizációja */}
                      <span className="text-slate-700 select-none">{'· '.repeat(item.level - 1)}</span>
                      
                      {/* URL tiszta kiírása */}
                      <span className="text-slate-300 hover:text-indigo-400 truncate transition-colors">
                        {item.url}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {/* Kattintható korrekciós kategória címke */}
                      <button 
                        onClick={() => toggleCategory(item.id)}
                        className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider transition-all border ${
                          item.category === 'Core' ? 'bg-indigo-950/80 border-indigo-700 text-indigo-300' :
                          item.category === 'Extension' ? 'bg-purple-950/80 border-purple-700 text-purple-300' :
                          item.category === 'Documentation' ? 'bg-teal-950/80 border-teal-700 text-teal-300' :
                          'bg-slate-800 border-slate-600 text-slate-400'
                        }`}
                      >
                        {item.category}
                      </button>

                      {/* Státusz visszajelzés */}
                      <span className={`px-2 py-0.5 text-[9px] rounded font-semibold ${
                        item.status === 'FELTÉRKÉPEZVE' ? 'bg-emerald-950/50 text-emerald-400' :
                        item.status === 'SZÜNETEL (PAUSED)' ? 'bg-amber-950/50 text-amber-400' :
                        item.status === 'HIBA' ? 'bg-rose-950/50 text-rose-400' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </main>
        </div>
      )}

      {activeTab === 'konvertalas' && (
        <div className="bg-slate-800/30 border border-slate-800 p-8 rounded-xl text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-indigo-500 mx-auto" />
          <h3 className="text-lg font-medium">PDF Forrás-Optimalizálás Előkészítve</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            A "00. Kutatás" fülön sikeresen összegyűjtött tiszta link-adatbázis alapján itt tudod majd a NotebookLM számára ideális méretű csomagokká formázni az anyagot.
          </p>
        </div>
      )}
    </div>
  );
}
