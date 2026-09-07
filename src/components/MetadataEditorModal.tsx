import React, { useState, useEffect } from 'react';
import { Search, Disc, Check, X, Image as ImageIcon, Sparkles, ExternalLink, Globe } from 'lucide-react';
import { MusicBrainzCandidate, ReleaseOverride } from '../types';

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
  const [searchQuery, setSearchQuery] = useState(`${currentArtist} ${currentAlbum}`);
  const [customArtist, setCustomArtist] = useState(currentArtist);
  const [customAlbum, setCustomAlbum] = useState(currentAlbum);
  const [customArtUrl, setCustomArtUrl] = useState(currentArtUrl);
  const [selectedMbid, setSelectedMbid] = useState(currentMbid || '');
  const [format, setFormat] = useState('12" Vinyl LP');
  const [year, setYear] = useState('');

  const [candidates, setCandidates] = useState<MusicBrainzCandidate[]>([]);
  const [itunesArtworks, setItunesArtworks] = useState<Array<{ album: string; artworkUrl: string; artist: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'mb' | 'itunes' | 'manual'>('mb');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCustomArtist(currentArtist);
      setCustomAlbum(currentAlbum);
      setCustomArtUrl(currentArtUrl);
      setSelectedMbid(currentMbid || '');
      setSearchQuery(`${currentArtist} ${currentAlbum}`);
      setMessage(null);
      // Auto-trigger search
      handleSearch(`${currentArtist} ${currentAlbum}`);
    }
  }, [isOpen, currentArtist, currentAlbum, currentArtUrl, currentMbid]);

  if (!isOpen) return null;

  const handleSearch = async (overrideQuery?: string) => {
    const q = overrideQuery !== undefined ? overrideQuery : searchQuery;
    if (!q.trim()) return;

    setIsSearching(true);
    setMessage(null);

    try {
      // 1. Search MusicBrainz
      const mbRes = await fetch(`/api/search/musicbrainz?query=${encodeURIComponent(q)}&artist=${encodeURIComponent(customArtist)}&recording=${encodeURIComponent(currentTitle)}`);
      const isMbJson = mbRes.ok && (mbRes.headers.get('content-type') || '').includes('application/json');
      const mbData = isMbJson ? await mbRes.json() : { candidates: [] };
      setCandidates(mbData.candidates || []);

      // 2. Search iTunes for high-res artwork
      const itunesRes = await fetch(`/api/search/itunes?query=${encodeURIComponent(q)}`);
      const isItunesJson = itunesRes.ok && (itunesRes.headers.get('content-type') || '').includes('application/json');
      const itunesData = isItunesJson ? await itunesRes.json() : { results: [] };
      setItunesArtworks(itunesData.results || []);

      if ((!mbData.candidates || mbData.candidates.length === 0) && (!itunesData.results || itunesData.results.length === 0)) {
        setMessage('No exact match found on MusicBrainz. You can enter details manually.');
      }
    } catch (err) {
      setMessage('Search request failed. Please check network or enter manually.');
    } finally {
      setIsSearching(false);
    }
  };

  const selectCandidate = (c: MusicBrainzCandidate) => {
    setCustomAlbum(c.title);
    setCustomArtist(c.artist || customArtist);
    setSelectedMbid(c.id);
    setFormat(c.format || '12" Vinyl');
    setYear(c.year || '');

    // Try finding matching artwork from itunes or CAA
    const matchedArt = itunesArtworks.find(a => 
      a.album.toLowerCase().includes(c.title.toLowerCase()) || 
      c.title.toLowerCase().includes(a.album.toLowerCase())
    );

    if (matchedArt?.artworkUrl) {
      setCustomArtUrl(matchedArt.artworkUrl);
    } else if (c.artUrl) {
      setCustomArtUrl(c.artUrl);
    }
  };

  const handleSaveOverride = async () => {
    setIsSaving(true);
    const trackKey = `${currentArtist} - ${currentTitle}`;

    try {
      const res = await fetch('/api/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackKey,
          customArtist,
          customAlbum,
          customArtUrl,
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
    } catch (err) {
      setMessage('Network error while saving override.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-100">Fix Vinyl Album & Artwork</h2>
              <p className="text-xs text-neutral-400">
                Identified track opener: <span className="text-amber-300 font-medium">{currentArtist} — {currentTitle}</span>
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
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Search bar */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-neutral-400 tracking-wide uppercase">
              Search MusicBrainz & iTunes Database
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Artist name or Album title..."
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-950 border border-neutral-800 focus:border-amber-500 rounded-xl text-neutral-100 text-sm focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={() => handleSearch()}
                disabled={isSearching}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-semibold text-sm rounded-xl transition-colors flex items-center gap-1.5"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {message && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
              {message}
            </div>
          )}

          {/* Search Tabs */}
          <div className="flex border-b border-neutral-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab('mb')}
              className={`pb-2.5 px-3 border-b-2 transition-colors ${
                activeTab === 'mb' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              MusicBrainz Releases ({candidates.length})
            </button>
            <button
              onClick={() => setActiveTab('itunes')}
              className={`pb-2.5 px-3 border-b-2 transition-colors ${
                activeTab === 'itunes' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Cover Art Gallery ({itunesArtworks.length})
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`pb-2.5 px-3 border-b-2 transition-colors ${
                activeTab === 'manual' ? 'border-amber-500 text-amber-400' : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Custom Fields
            </button>
          </div>

          {/* Tab 1: MusicBrainz Candidates */}
          {activeTab === 'mb' && (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {candidates.length === 0 && !isSearching && (
                <div className="text-center py-6 text-neutral-500 text-sm">
                  Search above to pull verified MusicBrainz vinyl pressings.
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
                        ? 'bg-amber-500/10 border-amber-500/40 text-neutral-100'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700 text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400 font-mono text-xs overflow-hidden">
                        {c.artUrl ? (
                          <img src={c.artUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                        ) : (
                          <Disc className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          <span>{c.title}</span>
                          {c.isFullAlbum && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                              Studio LP
                            </span>
                          )}
                          {c.isCompilation && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                              Compilation
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-400 flex items-center gap-2 mt-0.5">
                          <span>{c.artist}</span>
                          <span>•</span>
                          <span>{c.year}</span>
                          <span>•</span>
                          <span className="text-neutral-500">{c.format}</span>
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center">
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
            <div className="grid grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1">
              {itunesArtworks.map((art, idx) => (
                <div
                  key={idx}
                  onClick={() => setCustomArtUrl(art.artworkUrl)}
                  className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all aspect-square ${
                    customArtUrl === art.artworkUrl
                      ? 'border-amber-500 ring-2 ring-amber-500/50'
                      : 'border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <img src={art.artworkUrl} alt={art.album} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 text-left">
                    <p className="text-xs font-bold text-white truncate">{art.album}</p>
                    <p className="text-[10px] text-neutral-300 truncate">{art.artist}</p>
                  </div>
                  {customArtUrl === art.artworkUrl && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Preview & Override Form */}
          <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-xl space-y-3">
            <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Target Metadata Applied to AirPlay</span>
            </div>

            <div className="flex gap-4 items-center">
              <div className="w-20 h-20 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden flex-shrink-0 relative">
                {customArtUrl ? (
                  <img src={customArtUrl} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 text-sm">
                <div>
                  <label className="text-[11px] text-neutral-400">Album Title (Sent to AirPlay)</label>
                  <input
                    type="text"
                    value={customAlbum}
                    onChange={(e) => setCustomAlbum(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-neutral-400">Artist</label>
                    <input
                      type="text"
                      value={customArtist}
                      onChange={(e) => setCustomArtist(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-400">Artwork Image URL</label>
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

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-neutral-900/90 border-t border-neutral-800 flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            Saved to SQLite: Future plays of this record side will show this info instantly.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveOverride}
              disabled={isSaving || !customAlbum.trim()}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-bold text-sm rounded-xl transition-colors flex items-center gap-1.5"
            >
              {isSaving ? 'Saving...' : 'Save & Lock to Vinyl'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
