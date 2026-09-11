import React, { useState, useEffect } from 'react';
import { Search, Disc, Check, X, Image as ImageIcon, Sparkles, ExternalLink, Globe, Music, Layers } from 'lucide-react';
import { MusicBrainzCandidate } from '../types';

interface MetadataEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentArtist: string;
  currentAlbum: string;
  currentTitle: string;
  currentArtUrl: string;
  currentMbid?: string;
  onSaved: () => void;
}

const isTurntableOrIdle = (str?: string): boolean => {
  if (!str) return true;
  const s = str.trim().toLowerCase();
  return (
    s === '' ||
    s.includes('turntable') ||
    s.includes('analogair') ||
    s.includes('idle') ||
    s.includes('unknown') ||
    s.includes('standby') ||
    s.includes('default')
  );
};

export const MetadataEditorModal: React.FC<MetadataEditorModalProps> = ({
  isOpen,
  onClose,
  currentArtist,
  currentAlbum,
  currentTitle,
  currentArtUrl,
  currentMbid,
  onSaved
}) => {
  // Separate search fields for Artist and Album (+ optional Track)
  const [searchArtist, setSearchArtist] = useState('');
  const [searchAlbum, setSearchAlbum] = useState('');
  const [searchTrack, setSearchTrack] = useState('');

  // Target overrides to apply
  const [customArtist, setCustomArtist] = useState(currentArtist);
  const [customAlbum, setCustomAlbum] = useState(currentAlbum);
  const [customArtUrl, setCustomArtUrl] = useState(currentArtUrl);
  const [selectedMbid, setSelectedMbid] = useState(currentMbid || '');
  const [format, setFormat] = useState('12" Vinyl LP');
  const [year, setYear] = useState('');

  const [candidates, setCandidates] = useState<MusicBrainzCandidate[]>([]);
  const [itunesArtworks, setItunesArtworks] = useState<Array<{ album: string; artworkUrl: string; artist: string; releaseDate?: string; trackCount?: number }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'mb' | 'itunes' | 'manual'>('mb');
  const [message, setMessage] = useState<string | null>(null);

  // Initialize modal state whenever opened
  useEffect(() => {
    if (isOpen) {
      const initArtist = isTurntableOrIdle(currentArtist) ? '' : currentArtist;
      const initAlbum = isTurntableOrIdle(currentAlbum) ? '' : currentAlbum;
      const initTrack = isTurntableOrIdle(currentTitle) ? '' : currentTitle;

      setSearchArtist(initArtist);
      setSearchAlbum(initAlbum);
      setSearchTrack(initTrack);

      setCustomArtist(initArtist || currentArtist);
      setCustomAlbum(initAlbum || currentAlbum);
      setCustomArtUrl(currentArtUrl);
      setSelectedMbid(currentMbid || '');
      setMessage(null);

      // Auto-trigger search if we have artist or album
      if (initArtist || initAlbum || initTrack) {
        handleSearch(initArtist, initAlbum, initTrack);
      } else {
        setCandidates([]);
        setItunesArtworks([]);
      }
    }
  }, [isOpen, currentArtist, currentAlbum, currentArtUrl, currentMbid, currentTitle]);

  if (!isOpen) return null;

  const handleSearch = async (overrideArtist?: string, overrideAlbum?: string, overrideTrack?: string) => {
    const art = (overrideArtist !== undefined ? overrideArtist : searchArtist).trim();
    const alb = (overrideAlbum !== undefined ? overrideAlbum : searchAlbum).trim();
    const trk = (overrideTrack !== undefined ? overrideTrack : searchTrack).trim();

    if (!art && !alb && !trk) {
      setMessage('Please enter an Artist name or Album title to search.');
      return;
    }

    setIsSearching(true);
    setMessage(null);

    try {
      // 1. MusicBrainz Master Release / Release Group Search
      const mbParams = new URLSearchParams();
      if (art) mbParams.set('artist', art);
      if (alb) mbParams.set('album', alb);
      if (trk) mbParams.set('recording', trk);

      const mbRes = await fetch(`/api/search/musicbrainz?${mbParams.toString()}`);
      const isMbJson = mbRes.ok && (mbRes.headers.get('content-type') || '').includes('application/json');
      const mbData = isMbJson ? await mbRes.json() : { candidates: [] };
      const mbCandidates: MusicBrainzCandidate[] = mbData.candidates || [];
      setCandidates(mbCandidates);

      // 2. iTunes High-Res Cover Art & Tracklist Database
      const itunesParams = new URLSearchParams();
      if (art) itunesParams.set('artist', art);
      if (alb) itunesParams.set('album', alb);
      if (trk) itunesParams.set('track', trk);

      const itunesRes = await fetch(`/api/search/itunes?${itunesParams.toString()}`);
      const isItunesJson = itunesRes.ok && (itunesRes.headers.get('content-type') || '').includes('application/json');
      const itunesData = isItunesJson ? await itunesRes.json() : { results: [] };
      const arts = itunesData.results || [];
      setItunesArtworks(arts);

      if (mbCandidates.length === 0 && arts.length === 0) {
        setMessage('No exact match found. Try entering alternative spelling or set custom details manually.');
      }
    } catch {
      setMessage('Search request failed. You can enter details manually below.');
    } finally {
      setIsSearching(false);
    }
  };

  const selectCandidate = (c: MusicBrainzCandidate) => {
    setCustomAlbum(c.title);
    setCustomArtist(c.artist || customArtist || searchArtist);
    setSelectedMbid(c.id);
    setFormat(c.format || '12" Vinyl LP');
    setYear(c.year || '');

    // Match best artwork: CAA first if present, or match from iTunes gallery
    if (c.artUrl && c.artUrl.startsWith('http')) {
      setCustomArtUrl(c.artUrl);
    } else {
      const matchedArt = itunesArtworks.find(a =>
        a.album.toLowerCase().includes(c.title.toLowerCase()) ||
        c.title.toLowerCase().includes(a.album.toLowerCase())
      );
      if (matchedArt?.artworkUrl) {
        setCustomArtUrl(matchedArt.artworkUrl);
      }
    }
  };

  const handleSaveOverride = async () => {
    setIsSaving(true);
    // Use identified track opener or fallback key
    const trackKey = (currentArtist && currentTitle && !isTurntableOrIdle(currentTitle))
      ? `${currentArtist} - ${currentTitle}`
      : `${customArtist} - ${customAlbum}`;

    try {
      const res = await fetch('/api/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackKey,
          customArtist: customArtist.trim(),
          customAlbum: customAlbum.trim(),
          customArtUrl: customArtUrl.trim(),
          releaseMbid: selectedMbid,
          format,
          year
        })
      });

      if (res.ok) {
        onSaved();
        onClose();
      } else {
        setMessage('Failed to save override.');
      }
    } catch {
      setMessage('Network error while saving override.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-100">Fix Vinyl Album & Artwork</h2>
              <p className="text-xs text-neutral-400">
                Acoustic Needle Match:{' '}
                <span className="text-amber-300 font-medium">
                  {currentArtist && !isTurntableOrIdle(currentArtist) ? currentArtist : 'AnalogAir Vinyl'}
                  {currentTitle && !isTurntableOrIdle(currentTitle) ? ` — ${currentTitle}` : ''}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Dual Search Box: Artist & Album Separated */}
          <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span>Search MusicBrainz & iTunes</span>
              </span>
              <span className="text-[11px] text-neutral-500">
                Targeted Artist & Album Query
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Artist Search Box */}
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 mb-1 block">
                  Artist (e.g. Morrissey, Pink Floyd, 紅雀)
                </label>
                <input
                  type="text"
                  value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Artist name..."
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-xl text-neutral-100 text-sm focus:outline-none transition-colors"
                />
              </div>

              {/* Album Search Box */}
              <div>
                <label className="text-[11px] font-semibold text-neutral-400 mb-1 block">
                  Album Title (e.g. Your Arsenal, Benisuzume)
                </label>
                <input
                  type="text"
                  value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Album title..."
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-800 focus:border-amber-500 rounded-xl text-neutral-100 text-sm focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Optional Track Opener + Search Button */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1 items-stretch sm:items-center">
              <div className="flex-1">
                <input
                  type="text"
                  value={searchTrack}
                  onChange={(e) => setSearchTrack(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Track / Side Opener (optional, e.g. You're Gonna Need Someone on Your Side)"
                  className="w-full px-3 py-2 bg-neutral-900/70 border border-neutral-800/80 focus:border-amber-500 rounded-xl text-neutral-300 text-xs focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={() => handleSearch()}
                disabled={isSearching}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 whitespace-nowrap"
              >
                {isSearching ? (
                  <span>Searching...</span>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Search Databases</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {message && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
              {message}
            </div>
          )}

          {/* Search Results Navigation Tabs */}
          <div className="flex border-b border-neutral-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab('mb')}
              className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'mb'
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Disc className="w-3.5 h-3.5" />
              <span>MusicBrainz & Vinyl ({candidates.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('itunes')}
              className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'itunes'
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Cover Art Gallery ({itunesArtworks.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === 'manual'
                  ? 'border-amber-500 text-amber-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Custom Manual Fields</span>
            </button>
          </div>

          {/* Tab 1: MusicBrainz Release Groups & Vinyl Candidates */}
          {activeTab === 'mb' && (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {candidates.length === 0 && !isSearching && (
                <div className="text-center py-8 text-neutral-500 text-xs">
                  Enter an Artist or Album above and click <strong>Search Databases</strong> to find canonical studio albums and vinyl pressings.
                </div>
              )}
              {candidates.map((c) => {
                const isSelected = customAlbum === c.title;
                return (
                  <div
                    key={c.id}
                    onClick={() => selectCandidate(c)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/15 border-amber-500/50 text-neutral-100 shadow-md ring-1 ring-amber-500/30'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 font-mono text-xs overflow-hidden shrink-0">
                        {c.artUrl ? (
                          <img
                            src={c.artUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Disc className="w-5 h-5 text-amber-400/60" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{c.title}</span>
                          {c.isFullAlbum && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-normal">
                              Studio LP
                            </span>
                          )}
                          {c.isCompilation && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-800 font-normal">
                              Compilation
                            </span>
                          )}
                          {c.sideOpener && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-normal">
                              {c.sideOpener}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-400 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-neutral-300">{c.artist}</span>
                          <span>•</span>
                          <span>{c.year || 'Release'}</span>
                          <span>•</span>
                          <span className="text-neutral-500">{c.format}</span>
                          {c.trackCount && (
                            <>
                              <span>•</span>
                              <span className="text-neutral-500">{c.trackCount} Tracks</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center shrink-0 ml-2">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: iTunes Cover Art Picker */}
          {activeTab === 'itunes' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1">
              {itunesArtworks.length === 0 && !isSearching && (
                <div className="col-span-full text-center py-8 text-neutral-500 text-xs">
                  No images loaded. Enter Artist and Album to browse high-res artwork options.
                </div>
              )}
              {itunesArtworks.map((art, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setCustomArtUrl(art.artworkUrl);
                    if (!customAlbum || isTurntableOrIdle(customAlbum)) {
                      setCustomAlbum(art.album);
                    }
                    if (!customArtist || isTurntableOrIdle(customArtist)) {
                      setCustomArtist(art.artist);
                    }
                  }}
                  className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all aspect-square ${
                    customArtUrl === art.artworkUrl
                      ? 'border-amber-500 ring-2 ring-amber-500/50'
                      : 'border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <img src={art.artworkUrl} alt={art.album} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 text-left">
                    <p className="text-xs font-bold text-white truncate">{art.album}</p>
                    <p className="text-[10px] text-neutral-300 truncate">{art.artist} {art.releaseDate ? `(${art.releaseDate})` : ''}</p>
                  </div>
                  {customArtUrl === art.artworkUrl && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center shadow-lg">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tab 3: Custom Manual Fields */}
          {activeTab === 'manual' && (
            <div className="p-4 bg-neutral-950/60 border border-neutral-800 rounded-xl space-y-3 text-xs">
              <p className="text-neutral-400">
                You can manually enter the release metadata and format specifications below:
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-neutral-400 mb-1 block">Release Year</label>
                  <input
                    type="text"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="e.g. 1992"
                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="text-neutral-400 mb-1 block">Vinyl Media Format</label>
                  <input
                    type="text"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                    placeholder={'e.g. 12" Vinyl LP (Stereo)'}
                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Target Metadata Preview & Output */}
          <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-3">
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Target Metadata Applied to AirPlay & Stream</span>
            </div>

            <div className="flex gap-4 items-center">
              <div className="w-20 h-20 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden flex-shrink-0 relative shadow-inner">
                {customArtUrl ? (
                  <img
                    src={customArtUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 text-sm">
                <div>
                  <label className="text-[11px] text-neutral-400 block mb-0.5">
                    Album Title (Shown on AirPlay Speakers & Dashboard)
                  </label>
                  <input
                    type="text"
                    value={customAlbum}
                    onChange={(e) => setCustomAlbum(e.target.value)}
                    placeholder="e.g. Your Arsenal"
                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-0.5">Artist</label>
                    <input
                      type="text"
                      value={customArtist}
                      onChange={(e) => setCustomArtist(e.target.value)}
                      placeholder="e.g. Morrissey"
                      className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-400 block mb-0.5">Artwork Image URL</label>
                    <input
                      type="text"
                      value={customArtUrl}
                      onChange={(e) => setCustomArtUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500 truncate"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-neutral-900/90 border-t border-neutral-800 flex items-center justify-between">
          <p className="text-xs text-neutral-500 hidden sm:block">
            Locked to Vinyl side: Future plays of this record will show this information automatically.
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveOverride}
              disabled={isSaving || !customAlbum.trim()}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-bold text-sm rounded-xl transition-all flex items-center gap-1.5 shadow-lg active:scale-95"
            >
              {isSaving ? 'Saving...' : 'Save & Lock to Vinyl'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
